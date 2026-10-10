import mongoose, { type InferSchemaType, type Types } from 'mongoose';

/** Rounded coordinates, kept 15 minutes. Nothing else in Nexity stores a location. */
const locationPingSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** geohash-7 (~150 m) for neighbour lookups. */
    cell: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy_m: { type: Number, required: true },
    captured_at: { type: Date, required: true },
    expire_at: { type: Date, required: true },
  },
  { collection: 'nearby_location_pings', timestamps: false },
);
locationPingSchema.index({ cell: 1, captured_at: -1 });
locationPingSchema.index({ user_id: 1, captured_at: -1 });
locationPingSchema.index({ expire_at: 1 }, { expireAfterSeconds: 0 });

export type LocationPingAttrs = InferSchemaType<typeof locationPingSchema> & { _id: Types.ObjectId };
export const NearbyLocationPing = mongoose.model('NearbyLocationPing', locationPingSchema);

/** Latest validated encounter per pair only: no history, counts or coordinates. */
const encounterSchema = new mongoose.Schema(
  {
    pair_key: { type: String, required: true },
    participant_a: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    participant_b: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    detected_at: { type: Date, required: true },
    last_detected_at: { type: Date, required: true },
    source: { type: String, enum: ['ble', 'location', 'hybrid'], required: true },
    validation_status: { type: String, enum: ['verified'], default: 'verified' },
    expires_at: { type: Date, required: true },
  },
  {
    collection: 'encounters',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);
encounterSchema.index({ pair_key: 1 }, { unique: true });
encounterSchema.index({ participant_a: 1, last_detected_at: -1 });
encounterSchema.index({ participant_b: 1, last_detected_at: -1 });
encounterSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export type EncounterAttrs = InferSchemaType<typeof encounterSchema> & { _id: Types.ObjectId };
export const Encounter = mongoose.model('Encounter', encounterSchema);

/** One row per sent "Someone is near you" notice; the unique key makes delivery idempotent. */
const nearbyNotificationSchema = new mongoose.Schema(
  {
    dedup_key: { type: String, required: true },
    recipient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pair_key: { type: String, required: true },
    notification_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', default: null },
    created_at: { type: Date, default: () => new Date() },
    expire_at: { type: Date, required: true },
  },
  { collection: 'nearby_notifications', timestamps: false },
);
nearbyNotificationSchema.index({ dedup_key: 1 }, { unique: true });
nearbyNotificationSchema.index({ recipient_id: 1, created_at: -1 });
nearbyNotificationSchema.index({ recipient_id: 1, pair_key: 1, created_at: -1 });
nearbyNotificationSchema.index({ expire_at: 1 }, { expireAfterSeconds: 0 });

export const NearbyNotification = mongoose.model('NearbyNotification', nearbyNotificationSchema);

/** Rotating Bluetooth id. Only the hash is stored. */
const bleTokenSchema = new mongoose.Schema(
  {
    token_hash: { type: String, required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    valid_from: { type: Date, required: true },
    valid_until: { type: Date, required: true },
    revoked_at: { type: Date, default: null },
    expire_at: { type: Date, required: true },
    created_at: { type: Date, default: () => new Date() },
  },
  { collection: 'nearby_ble_tokens', timestamps: false },
);
bleTokenSchema.index({ token_hash: 1 }, { unique: true });
bleTokenSchema.index({ user_id: 1, valid_until: -1 });
bleTokenSchema.index({ expire_at: 1 }, { expireAfterSeconds: 0 });
export const NearbyBleToken = mongoose.model('NearbyBleToken', bleTokenSchema);

/** One phone reporting another phone's current Bluetooth id. */
const bleSightingSchema = new mongoose.Schema(
  {
    reporter_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    token_hash: { type: String, required: true },
    subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    first_seen_at: { type: Date, required: true },
    last_seen_at: { type: Date, required: true },
    rssi_bucket: { type: String, enum: ['near', 'far'], required: true },
    expire_at: { type: Date, required: true },
  },
  { collection: 'nearby_ble_sightings', timestamps: false },
);
bleSightingSchema.index({ reporter_id: 1, token_hash: 1 }, { unique: true });
bleSightingSchema.index({ subject_id: 1, reporter_id: 1 });
bleSightingSchema.index({ expire_at: 1 }, { expireAfterSeconds: 0 });
export const NearbyBleSighting = mongoose.model('NearbyBleSighting', bleSightingSchema);

/** Both phones saw each other. Expires a few minutes after the last mutual sighting. */
const presenceSchema = new mongoose.Schema(
  {
    pair_key: { type: String, required: true },
    user_a: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    user_b: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expires_at: { type: Date, required: true },
  },
  { collection: 'nearby_presence', timestamps: false },
);
presenceSchema.index({ pair_key: 1 }, { unique: true });
presenceSchema.index({ user_a: 1, expires_at: 1 });
presenceSchema.index({ user_b: 1, expires_at: 1 });
presenceSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
export const NearbyPresence = mongoose.model('NearbyPresence', presenceSchema);
