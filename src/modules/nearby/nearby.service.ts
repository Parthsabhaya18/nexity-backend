import mongoose, { type Types } from 'mongoose';

import { nearbyConfig } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { notifySystem } from '../notifications/notification.service';
import { User, type UserDoc } from '../users/user.model';
import { pairKeyOf, recordEncounter } from './nearby.encounters';
import { cellsAround, geohash, haversineMeters, roundCoord } from './nearby.geo';
import { dropBluetooth } from './nearby.ble';
import { type LocationPingAttrs, NearbyLocationPing, NearbyNotification } from './nearby.models';
import { isValidTimezone, localDayStart } from './nearby.time';

const MONGO_DUPLICATE_KEY = 11000;
const PING_TTL_MS = 15 * 60_000;
const MIN_PING_GAP_MS = 55_000;
const MAX_FUTURE_SKEW_MS = 60_000;
const MAX_SAMPLE_AGE_MS = 2 * 60_000;
const NOTIFICATION_RETENTION_MS = 7 * 86_400_000;
export const NEARBY_NOTICE = 'Someone is near you on Nexity. ✨';

export function settingsDto(user: UserDoc) {
  const n = user.nearby;
  return {
    enabled: Boolean(n?.enabled),
    bluetooth_enabled: Boolean(n?.bluetooth_enabled),
    location_enabled: Boolean(n?.location_enabled),
    notifications_enabled: Boolean(n?.notifications_enabled),
    timezone: n?.timezone ?? 'Asia/Kolkata',
    updated_at: n?.updated_at ? n.updated_at.toISOString() : null,
    feature_available: nearbyConfig.enabled,
    location_sample_seconds: nearbyConfig.sampleSeconds,
    location_accuracy_limit_m: nearbyConfig.accuracyLimitMeters,
  };
}

export type SettingsPatch = {
  enabled?: boolean;
  bluetooth_enabled?: boolean;
  location_enabled?: boolean;
  notifications_enabled?: boolean;
  timezone?: string;
};

export async function updateSettings(user: UserDoc, patch: SettingsPatch) {
  if (patch.timezone !== undefined && !isValidTimezone(patch.timezone)) {
    throw ApiError.badRequest('Unknown time zone.', { field: 'timezone' }, 'VALIDATION_ERROR');
  }
  if ((patch.enabled || patch.location_enabled || patch.bluetooth_enabled) && !nearbyConfig.enabled) {
    throw ApiError.conflict('Nearby is paused for everyone right now.', 'NEARBY_UNAVAILABLE');
  }
  const now = new Date();
  const set: Record<string, unknown> = { 'nearby.updated_at': now };
  if (patch.enabled !== undefined) set['nearby.enabled'] = patch.enabled;
  if (patch.bluetooth_enabled !== undefined) set['nearby.bluetooth_enabled'] = patch.bluetooth_enabled;
  if (patch.location_enabled !== undefined) set['nearby.location_enabled'] = patch.location_enabled;
  if (patch.notifications_enabled !== undefined) {
    set['nearby.notifications_enabled'] = patch.notifications_enabled;
  }
  if (patch.timezone !== undefined) set['nearby.timezone'] = patch.timezone;
  if (patch.enabled && !user.nearby?.consented_at) {
    set['nearby.consented_at'] = now;
    // The first opt-in also turns on the generic notice; the user can switch it off.
    if (patch.notifications_enabled === undefined) set['nearby.notifications_enabled'] = true;
  }
  const updated = await User.findByIdAndUpdate(user._id, { $set: set }, { returnDocument: 'after' });
  if (!updated) throw ApiError.notFound('User not found');

  // Opt-out takes effect at once: stored locations go with it.
  if (patch.enabled === false || patch.location_enabled === false) {
    await NearbyLocationPing.deleteMany({ user_id: user._id });
  }
  if (patch.enabled === false || patch.bluetooth_enabled === false) {
    await dropBluetooth(user._id);
  }
  return settingsDto(updated);
}

export type LocationSample = { lat: number; lng: number; accuracy_m: number; captured_at: Date };

type PingRow = Pick<LocationPingAttrs, 'user_id' | 'lat' | 'lng' | 'captured_at'>;

/**
 * Two people count as together only after ≥ 2 co-located sample pairs spanning at least the
 * minimum duration for each of them. One matching coordinate is never enough.
 */
function together(mine: PingRow[], theirs: PingRow[]) {
  const windowMs = Math.max(nearbyConfig.sampleSeconds * 1000, 120_000);
  const myTimes: number[] = [];
  const theirTimes: number[] = [];
  let pairs = 0;
  for (const a of mine) {
    for (const b of theirs) {
      if (Math.abs(a.captured_at.getTime() - b.captured_at.getTime()) > windowMs) continue;
      if (haversineMeters(a.lat, a.lng, b.lat, b.lng) > nearbyConfig.radiusMeters) continue;
      pairs++;
      myTimes.push(a.captured_at.getTime());
      theirTimes.push(b.captured_at.getTime());
    }
  }
  if (pairs < 2) return false;
  const span = (t: number[]) => Math.max(...t) - Math.min(...t);
  const minMs = nearbyConfig.minEncounterSeconds * 1000;
  return span(myTimes) >= minMs && span(theirTimes) >= minMs;
}

/** Stores one foreground sample and checks it against other opted-in people nearby. */
export async function ingestLocation(user: UserDoc, sample: LocationSample, now = new Date()) {
  if (!nearbyConfig.enabled) {
    throw ApiError.conflict('Nearby is paused for everyone right now.', 'NEARBY_UNAVAILABLE');
  }
  if (!user.nearby?.enabled || !user.nearby.location_enabled) {
    throw ApiError.conflict('Location notifications are off.', 'NEARBY_DISABLED');
  }
  const capturedAt = sample.captured_at.getTime();
  if (capturedAt > now.getTime() + MAX_FUTURE_SKEW_MS || now.getTime() - capturedAt > MAX_SAMPLE_AGE_MS) {
    return { accepted: false };
  }
  if (sample.accuracy_m > nearbyConfig.accuracyLimitMeters) return { accepted: false };

  const recent = await NearbyLocationPing.exists({
    user_id: user._id,
    captured_at: { $gt: new Date(capturedAt - MIN_PING_GAP_MS) },
  });
  if (recent) return { accepted: false };

  const lat = roundCoord(sample.lat);
  const lng = roundCoord(sample.lng);
  await NearbyLocationPing.create({
    user_id: user._id,
    cell: geohash(lat, lng),
    lat,
    lng,
    accuracy_m: Math.round(sample.accuracy_m),
    captured_at: sample.captured_at,
    expire_at: new Date(now.getTime() + PING_TTL_MS),
  });

  try {
    await matchNearby(user, lat, lng, now);
  } catch (err) {
    logger.warn({ err }, 'Nearby matching failed');
  }
  return { accepted: true };
}

async function matchNearby(user: UserDoc, lat: number, lng: number, now: Date) {
  const lookbackMs = Math.min(
    PING_TTL_MS,
    (nearbyConfig.minEncounterSeconds + 2 * nearbyConfig.sampleSeconds) * 1000,
  );
  const since = new Date(now.getTime() - lookbackMs);
  const nearby = await NearbyLocationPing.find({
    cell: { $in: cellsAround(lat, lng) },
    captured_at: { $gte: since },
    user_id: { $ne: user._id },
  })
    .select('user_id')
    .lean();
  const candidates = [...new Set(nearby.map((p) => p.user_id.toString()))].slice(0, 50);
  if (!candidates.length) return;

  const window = { captured_at: { $gte: since } };
  const [mine, theirs] = await Promise.all([
    NearbyLocationPing.find({ user_id: user._id, ...window }).select('user_id lat lng captured_at').lean<PingRow[]>(),
    NearbyLocationPing.find({ user_id: { $in: candidates }, ...window })
      .select('user_id lat lng captured_at')
      .lean<PingRow[]>(),
  ]);

  for (const id of candidates) {
    const other = theirs.filter((p) => p.user_id.toString() === id);
    if (!together(mine, other)) continue;
    const otherId = other[0]!.user_id;
    const result = await recordEncounter(user._id, otherId, 'location', now);
    if (result === 'created' || result === 'refreshed') {
      await Promise.all([notifyNearby(user._id, otherId, now), notifyNearby(otherId, user._id, now)]);
    }
  }
}

/** Generic notice with per-pair cooldown, a daily cap and an idempotency key. Push isn't wired yet. */
async function notifyNearby(recipientId: Types.ObjectId, otherId: Types.ObjectId, now: Date) {
  const recipient = await User.findById(recipientId).select('status nearby').lean();
  if (!recipient || recipient.status !== 'active' || !recipient.nearby?.notifications_enabled) return;

  const pairKey = pairKeyOf(recipientId, otherId);
  const cooldownMs = nearbyConfig.notificationCooldownMinutes * 60_000;
  const recentForPair = await NearbyNotification.exists({
    recipient_id: recipientId,
    pair_key: pairKey,
    created_at: { $gt: new Date(now.getTime() - cooldownMs) },
  });
  if (recentForPair) return;
  const sentToday = await NearbyNotification.countDocuments({
    recipient_id: recipientId,
    created_at: { $gte: localDayStart(now, recipient.nearby.timezone) },
  });
  if (sentToday >= nearbyConfig.maxPushesPerDay) return;

  const bucket = cooldownMs > 0 ? Math.floor(now.getTime() / cooldownMs) : now.getTime();
  try {
    const row = await NearbyNotification.create({
      dedup_key: `nearby:${recipientId.toString()}:${pairKey}:${bucket}`,
      recipient_id: recipientId,
      pair_key: pairKey,
      created_at: now,
      expire_at: new Date(now.getTime() + NOTIFICATION_RETENTION_MS),
    });
    const notice = await notifySystem({
      recipientId,
      type: 'nearby_encounter',
      text: NEARBY_NOTICE,
    });
    await NearbyNotification.updateOne({ _id: row._id }, { $set: { notification_id: notice._id } });
  } catch (err) {
    if (!(err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY)) {
      throw err;
    }
  }
}

/** TTL indexes do the deleting; this catches rows when the TTL monitor lags. */
export async function purgeExpiredNearby(now = new Date()) {
  const [pings, notices] = await Promise.all([
    NearbyLocationPing.deleteMany({ expire_at: { $lte: now } }),
    NearbyNotification.deleteMany({ expire_at: { $lte: now } }),
  ]);
  return { pings: pings.deletedCount, notices: notices.deletedCount };
}
