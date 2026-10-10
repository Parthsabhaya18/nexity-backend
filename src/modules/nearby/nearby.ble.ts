import { createHash, randomBytes } from 'node:crypto';

import { type Types } from 'mongoose';

import { nearbyConfig } from '../../config/env';
import { emitToUser } from '../../realtime/io';
import { ApiError } from '../../utils/ApiError';
import { toUserSummaries } from '../follows/follow.service';
import { User, type UserDoc } from '../users/user.model';
import { blockedEither, pairKeyOf, recordEncounter } from './nearby.encounters';
import { NearbyBleSighting, NearbyBleToken, NearbyPresence } from './nearby.models';

const TOKEN_MS = 15 * 60_000;
const BATCH = 8;
const MAX_LIVE = 16;
const MAX_ISSUED_PER_WINDOW = 30;
const SKEW_MS = 2 * 60_000;
const PRESENCE_MS = 300_000;
const MAX_SIGHTING_AGE_MS = 10 * 60_000;
const MONGO_DUPLICATE_KEY = 11000;

const hashOf = (ephId: string) => createHash('sha256').update(ephId).digest('hex');

function bluetoothOn(user: UserDoc) {
  return nearbyConfig.enabled && Boolean(user.nearby?.enabled && user.nearby.bluetooth_enabled);
}

/** Revoke every Bluetooth id and drop this person from the live circle. */
export async function dropBluetooth(userId: Types.ObjectId) {
  const now = new Date();
  await Promise.all([
    NearbyBleToken.updateMany(
      { user_id: userId, revoked_at: null },
      { $set: { revoked_at: now } },
    ),
    NearbyPresence.deleteMany({ $or: [{ user_a: userId }, { user_b: userId }] }),
    NearbyBleSighting.deleteMany({ $or: [{ reporter_id: userId }, { subject_id: userId }] }),
  ]);
}

export async function issueTokens(user: UserDoc, now = new Date()) {
  if (!nearbyConfig.enabled) {
    throw ApiError.conflict('Nearby is paused for everyone right now.', 'NEARBY_UNAVAILABLE');
  }
  if (!bluetoothOn(user)) {
    throw ApiError.conflict('Turn on Bluetooth discovery first.', 'NEARBY_DISABLED');
  }
  const windowStart = new Date(now.getTime() - TOKEN_MS);
  const issued = await NearbyBleToken.countDocuments({
    user_id: user._id,
    created_at: { $gte: windowStart },
  });
  if (issued >= MAX_ISSUED_PER_WINDOW) {
    throw ApiError.tooMany('Wait a few minutes before refreshing Bluetooth ids.', undefined, 'TOO_MANY_REQUESTS');
  }

  const live = await NearbyBleToken.find({
    user_id: user._id,
    revoked_at: null,
    valid_until: { $gt: now },
  }).sort({ valid_until: 1 });
  const overflow = live.length + BATCH - MAX_LIVE;
  if (overflow > 0) {
    const drop = live.slice(0, overflow).map((row) => row._id);
    await NearbyBleToken.updateMany({ _id: { $in: drop } }, { $set: { revoked_at: now } });
  }

  const items = Array.from({ length: BATCH }, (_, i) => {
    const validFrom = new Date(now.getTime() + i * TOKEN_MS);
    const validUntil = new Date(validFrom.getTime() + TOKEN_MS);
    const ephId = randomBytes(16).toString('base64url');
    return { ephId, validFrom, validUntil };
  });
  await NearbyBleToken.insertMany(
    items.map((item) => ({
      token_hash: hashOf(item.ephId),
      user_id: user._id,
      valid_from: item.validFrom,
      valid_until: item.validUntil,
      expire_at: new Date(item.validUntil.getTime() + 60 * 60_000),
      created_at: now,
    })),
  );
  return {
    items: items.map((item) => ({
      eph_id: item.ephId,
      valid_from: item.validFrom.toISOString(),
      valid_until: item.validUntil.toISOString(),
    })),
  };
}

export type SightingInput = {
  eph_id: string;
  first_seen_at: Date;
  last_seen_at: Date;
  count: number;
  rssi_max: number;
};

export async function reportSightings(user: UserDoc, sightings: SightingInput[], now = new Date()) {
  if (!nearbyConfig.enabled) {
    throw ApiError.conflict('Nearby is paused for everyone right now.', 'NEARBY_UNAVAILABLE');
  }
  if (!bluetoothOn(user)) {
    throw ApiError.conflict('Turn on Bluetooth discovery first.', 'NEARBY_DISABLED');
  }
  let accepted = 0;
  for (const row of sightings.slice(0, 50)) {
    if (await storeSighting(user, row, now)) accepted += 1;
  }
  return { accepted };
}

async function storeSighting(reporter: UserDoc, row: SightingInput, now: Date) {
  if (row.first_seen_at > row.last_seen_at) return false;
  if (row.last_seen_at.getTime() > now.getTime() + 60_000) return false;
  if (now.getTime() - row.last_seen_at.getTime() > MAX_SIGHTING_AGE_MS) return false;
  if (row.rssi_max < -100 && row.count < 2) return false;

  const token = await NearbyBleToken.findOne({
    token_hash: hashOf(row.eph_id),
    revoked_at: null,
  }).lean();
  if (!token) return false;
  const seen = row.last_seen_at.getTime();
  if (seen < token.valid_from.getTime() - SKEW_MS || seen > token.valid_until.getTime() + SKEW_MS) {
    return false;
  }
  if (token.user_id.equals(reporter._id)) return false;

  const subject = await User.findById(token.user_id).select('_id status nearby');
  if (!subject || subject.status !== 'active' || !subject.nearby?.enabled || !subject.nearby.bluetooth_enabled) {
    return false;
  }

  const bucket = row.rssi_max >= -70 ? 'near' : 'far';
  const expireAt = new Date(row.last_seen_at.getTime() + 15 * 60_000);
  try {
    await NearbyBleSighting.create({
      reporter_id: reporter._id,
      token_hash: token.token_hash,
      subject_id: subject._id,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      rssi_bucket: bucket,
      expire_at: expireAt,
    });
  } catch (err) {
    if ((err as { code?: number }).code !== MONGO_DUPLICATE_KEY) throw err;
    await NearbyBleSighting.updateOne(
      { reporter_id: reporter._id, token_hash: token.token_hash },
      {
        $set: { last_seen_at: row.last_seen_at, rssi_bucket: bucket, expire_at: expireAt },
        $min: { first_seen_at: row.first_seen_at },
      },
    );
  }
  await verifyMutual(reporter._id, subject._id, now);
  return true;
}

function overlaps(aFirst: Date, aLast: Date, bFirst: Date, bLast: Date) {
  return aLast.getTime() + SKEW_MS >= bFirst.getTime() && bLast.getTime() + SKEW_MS >= aFirst.getTime();
}

async function verifyMutual(reporterId: Types.ObjectId, subjectId: Types.ObjectId, now: Date) {
  const [mine, theirs] = await Promise.all([
    NearbyBleSighting.find({ reporter_id: reporterId, subject_id: subjectId }).lean(),
    NearbyBleSighting.find({ reporter_id: subjectId, subject_id: reporterId }).lean(),
  ]);
  const mutual = mine.some((a) =>
    theirs.some((b) => overlaps(a.first_seen_at, a.last_seen_at, b.first_seen_at, b.last_seen_at)),
  );
  if (!mutual) return;
  const [low, high] = reporterId.toString() < subjectId.toString()
    ? [reporterId, subjectId]
    : [subjectId, reporterId];
  const expiresAt = new Date(now.getTime() + PRESENCE_MS);
  await NearbyPresence.updateOne(
    { pair_key: pairKeyOf(reporterId, subjectId) },
    { $set: { user_a: low, user_b: high, expires_at: expiresAt } },
    { upsert: true },
  );
  const at = now.toISOString();
  emitToUser(reporterId.toString(), 'nearby.updated', { at });
  emitToUser(subjectId.toString(), 'nearby.updated', { at });
  await recordEncounter(reporterId, subjectId, 'ble', now);
}

export async function listNearbyUsers(viewer: UserDoc, now = new Date()) {
  if (!bluetoothOn(viewer)) return { items: [], refreshed_at: now.toISOString() };
  const rows = await NearbyPresence.find({
    expires_at: { $gt: now },
    $or: [{ user_a: viewer._id }, { user_b: viewer._id }],
  })
    .limit(50)
    .lean();
  const otherIds = rows.map((row) => (row.user_a.equals(viewer._id) ? row.user_b : row.user_a));
  const users = await User.find({
    _id: { $in: otherIds },
    status: 'active',
    'nearby.enabled': true,
    'nearby.bluetooth_enabled': true,
  });
  const visible = [];
  for (const user of users) {
    if (!(await blockedEither(viewer._id, user._id))) visible.push(user);
  }
  const cards = await toUserSummaries(viewer, visible);
  const byId = new Map(visible.map((u) => [u.id as string, u]));
  return {
    items: cards
      .filter((card) => !card.is_self)
      .map((card) => {
        const user = byId.get(card.id);
        return {
          user: {
            id: card.id,
            username: card.username,
            display_name: card.display_name,
            avatar_url: card.avatar_url,
          },
          follow_state: card.follow_status,
          is_premium: user?.entitlement?.plan === 'premium',
        };
      }),
    refreshed_at: now.toISOString(),
  };
}
