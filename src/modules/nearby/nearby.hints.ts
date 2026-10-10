import type { Types } from 'mongoose';

import { nearbyConfig } from '../../config/env';
import { Block } from '../safety/block.model';
import { SecretBlock } from '../secret-messages/secret.models';
import { entitlementOf } from '../subscriptions/entitlement.service';
import { User, type UserDoc } from '../users/user.model';
import { pairKeyOf } from './nearby.encounters';
import { Encounter } from './nearby.models';
import { hintState, nextLocalMidnight } from './nearby.time';

/** `locked`: an encounter exists but the plan lacks `limits.nearby`; the day is not sent. */
export type NearbyHint = { state: 'today' | 'yesterday' | 'locked'; valid_until: string };

/**
 * Hints between the viewer and each of `otherIds` (only people the viewer already shares a
 * Secret thread with). Requires both to have Nearby on and no block of any kind either way.
 */
export async function hintsFor(
  viewer: UserDoc,
  otherIds: readonly Types.ObjectId[],
  now = new Date(),
): Promise<Map<string, NearbyHint>> {
  const hints = new Map<string, NearbyHint>();
  if (!nearbyConfig.enabled || !viewer.nearby?.enabled || !otherIds.length) return hints;

  const ids = [...new Map(otherIds.map((id) => [id.toString(), id])).values()];
  const keys = ids.map((id) => pairKeyOf(viewer._id, id));
  const either = {
    $or: [
      { blocker_id: viewer._id, blocked_id: { $in: ids } },
      { blocker_id: { $in: ids }, blocked_id: viewer._id },
    ],
  };
  const [encounters, others, blocks, secretBlocks] = await Promise.all([
    Encounter.find({ pair_key: { $in: keys }, expires_at: { $gt: now } }).lean(),
    User.find({ _id: { $in: ids }, status: 'active', 'nearby.enabled': true }).select('_id').lean(),
    Block.find(either).select('blocker_id blocked_id').lean(),
    SecretBlock.find(either).select('blocker_id blocked_id').lean(),
  ]);
  if (!encounters.length) return hints;

  const optedIn = new Set(others.map((u) => u._id.toString()));
  const blocked = new Set(
    [...blocks, ...secretBlocks].map((b) =>
      (b.blocker_id.equals(viewer._id) ? b.blocked_id : b.blocker_id).toString(),
    ),
  );
  const byPair = new Map(encounters.map((e) => [e.pair_key, e]));
  const tz = viewer.nearby?.timezone;
  const validUntil = nextLocalMidnight(now, tz).toISOString();
  const canSee = entitlementOf(viewer, now).limits.nearby;

  for (const id of ids) {
    const key = id.toString();
    if (!optedIn.has(key) || blocked.has(key)) continue;
    const e = byPair.get(pairKeyOf(viewer._id, id));
    if (!e) continue;
    const state = hintState(e.last_detected_at, e.expires_at, now, tz);
    if (!state) continue;
    hints.set(key, { state: canSee ? state : 'locked', valid_until: validUntil });
  }
  return hints;
}
