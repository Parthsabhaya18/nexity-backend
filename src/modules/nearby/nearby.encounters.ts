import mongoose, { type Types } from 'mongoose';

import { nearbyConfig } from '../../config/env';
import { Block } from '../safety/block.model';
import { SecretBlock } from '../secret-messages/secret.models';
import { User } from '../users/user.model';
import { Encounter } from './nearby.models';
import { nextLocalMidnight } from './nearby.time';
import { MONGO_DUPLICATE_KEY } from '../../utils/mongo';

const DAY_MS = 86_400_000;

export type EncounterSource = 'ble' | 'location';

export const pairKeyOf = (a: Types.ObjectId | string, b: Types.ObjectId | string) =>
  [a.toString(), b.toString()].sort().join(':');

type NearbyUser = {
  _id: Types.ObjectId;
  status: string;
  nearby?: {
    enabled?: boolean | null;
    bluetooth_enabled?: boolean | null;
    location_enabled?: boolean | null;
    timezone?: string | null;
  } | null;
};

/** Normal blocks and anonymous Secret blocks, either direction. */
export async function blockedEither(a: Types.ObjectId, b: Types.ObjectId) {
  const either = {
    $or: [
      { blocker_id: a, blocked_id: b },
      { blocker_id: b, blocked_id: a },
    ],
  };
  const [normal, secret] = await Promise.all([Block.exists(either), SecretBlock.exists(either)]);
  return Boolean(normal || secret);
}

function signalOn(u: NearbyUser, source: EncounterSource | 'any') {
  if (u.status !== 'active' || !u.nearby?.enabled) return false;
  if (source === 'location') return Boolean(u.nearby.location_enabled);
  if (source === 'ble') return Boolean(u.nearby.bluetooth_enabled);
  return true;
}

export async function eligiblePair(a: NearbyUser, b: NearbyUser, source: EncounterSource | 'any') {
  if (!nearbyConfig.enabled || a._id.equals(b._id)) return false;
  if (!signalOn(a, source) || !signalOn(b, source)) return false;
  return !(await blockedEither(a._id, b._id));
}

/** End of the later local day of the two people, plus the extra retention days. */
function expiryFor(at: Date, a: NearbyUser, b: NearbyUser) {
  const ends = [a, b].map((u) => nextLocalMidnight(at, u.nearby?.timezone).getTime());
  return new Date(Math.max(...ends) + (nearbyConfig.retentionDays - 1) * DAY_MS);
}

export type RecordResult = 'created' | 'refreshed' | 'deduped' | 'ineligible';

/** Upsert by pair: refreshed at most once per cooldown. Never creates a message, crush or match. */
export async function recordEncounter(
  aId: Types.ObjectId,
  bId: Types.ObjectId,
  source: EncounterSource,
  now = new Date(),
): Promise<RecordResult> {
  const users = await User.find({ _id: { $in: [aId, bId] } })
    .select('_id status nearby')
    .lean<NearbyUser[]>();
  const a = users.find((u) => u._id.equals(aId));
  const b = users.find((u) => u._id.equals(bId));
  if (!a || !b || !(await eligiblePair(a, b, source))) return 'ineligible';

  const pairKey = pairKeyOf(aId, bId);
  const [low, high] = aId.toString() < bId.toString() ? [aId, bId] : [bId, aId];
  const expiresAt = expiryFor(now, a, b);
  const existing = await Encounter.findOne({ pair_key: pairKey }).lean();

  if (!existing || existing.expires_at <= now) {
    try {
      await Encounter.findOneAndUpdate(
        { pair_key: pairKey },
        {
          $set: {
            participant_a: low,
            participant_b: high,
            detected_at: now,
            last_detected_at: now,
            source,
            validation_status: 'verified',
            expires_at: expiresAt,
          },
        },
        { upsert: true },
      );
    } catch (err) {
      if (!(err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY)) {
        throw err;
      }
      return 'deduped';
    }
    return 'created';
  }

  const cooldownMs = nearbyConfig.encounterCooldownMinutes * 60_000;
  if (now.getTime() - existing.last_detected_at.getTime() < cooldownMs) return 'deduped';
  await Encounter.updateOne(
    { pair_key: pairKey },
    {
      $set: {
        last_detected_at: now,
        expires_at: expiresAt,
        source: existing.source === source ? source : 'hybrid',
      },
    },
  );
  return 'refreshed';
}
