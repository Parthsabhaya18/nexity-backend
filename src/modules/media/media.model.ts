import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

import { MEDIA_KINDS, MEDIA_PURPOSES } from './media.rules';

export const MEDIA_STATUSES = ['pending', 'ready'] as const;

const mediaSchema = new mongoose.Schema(
  {
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: MEDIA_PURPOSES, required: true },
    kind: { type: String, enum: MEDIA_KINDS, required: true },
    key: { type: String, required: true, unique: true },
    content_type: { type: String, required: true },
    /** Declared size while pending; the stored object's size once ready. */
    bytes: { type: Number, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration_ms: { type: Number, default: null },
    status: { type: String, enum: MEDIA_STATUSES, default: 'pending' },
    /** When the presigned upload stops working; pending rows past this are purged. */
    upload_expires_at: { type: Date, required: true },
    /** S3 multipart upload id while a large file is uploading in parts. */
    upload_id: { type: String, default: null },
    part_size: { type: Number, default: null },
  },
  {
    collection: 'media_assets',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

mediaSchema.index({ status: 1, upload_expires_at: 1 });

export type MediaAttrs = InferSchemaType<typeof mediaSchema>;
export type MediaDoc = HydratedDocument<MediaAttrs>;

export const Media = mongoose.model('Media', mediaSchema);
