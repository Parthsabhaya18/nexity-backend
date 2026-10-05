import mongoose from 'mongoose';

import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { Message } from '../messages/message.model';
import { Post } from '../posts/post.model';
import type { UserDoc } from '../users/user.model';
import { Media, type MediaDoc } from './media.model';
import {
  CONTENT_TYPES,
  DURATION_TOLERANCE_MS,
  formatBytes,
  formatDuration,
  KEY_FOLDERS,
  MEDIA_RULES,
  type MediaKind,
  type MediaPurpose,
  MULTIPART_THRESHOLD,
  partSizeFor,
} from './media.rules';
import type { CreateUploadInput } from './media.schema';
import { detectContentType, isCompatibleType, SNIFF_BYTES } from './media.sniff';
import * as storage from './media.storage';

/** Unfinished uploads a user may hold at once; stops presign spam. */
const MAX_PENDING_PER_USER = 30;
/** A part upload keeps a multipart upload alive this long, so slow networks can resume. */
const MULTIPART_IDLE_MS = 24 * 60 * 60 * 1000;

const PURPOSE_LABEL: Record<MediaPurpose, string> = {
  avatar: 'Profile photos',
  post: 'Videos in a post',
  reel: 'Reels',
  story: 'Story videos',
  message: 'Videos in messages',
};

const partCountOf = (media: MediaDoc) => Math.ceil(media.bytes / media.part_size!);

function partLength(media: MediaDoc, partNumber: number) {
  const size = media.part_size!;
  return partNumber < partCountOf(media) ? size : media.bytes - (partNumber - 1) * size;
}

export async function toMediaDto(media: MediaDoc) {
  return {
    id: media.id as string,
    purpose: media.purpose,
    kind: media.kind,
    status: media.status,
    url: media.status === 'ready' ? await storage.viewUrl(media.key) : null,
    content_type: media.content_type,
    bytes: media.bytes,
    width: media.width ?? null,
    height: media.height ?? null,
    duration_ms: media.duration_ms ?? null,
    created_at: (media.get('created_at') as Date).toISOString(),
  };
}

const KIND_LABEL: Record<MediaKind, string> = {
  image: 'Photos',
  video: 'Videos',
  audio: 'Voice messages',
};

function ruleFor(purpose: MediaPurpose, kind: MediaKind) {
  const rule = MEDIA_RULES[purpose][kind];
  if (!rule) {
    throw ApiError.badRequest(
      `${KIND_LABEL[kind]} can't be used here.`,
      { purpose, kind },
      'MEDIA_KIND_NOT_ALLOWED',
    );
  }
  return rule;
}

export async function createUpload(user: UserDoc, input: CreateUploadInput) {
  const { kind, ext } = CONTENT_TYPES[input.content_type]!;
  const rule = ruleFor(input.purpose, kind);

  if (input.bytes > rule.maxBytes) {
    throw ApiError.badRequest(
      `This file is too large. The limit is ${formatBytes(rule.maxBytes)}.`,
      { max_bytes: rule.maxBytes },
      'MEDIA_TOO_LARGE',
    );
  }
  const maxDuration = rule.maxDurationMs;
  if (
    kind !== 'image' &&
    maxDuration &&
    input.duration_ms &&
    input.duration_ms > maxDuration + DURATION_TOLERANCE_MS
  ) {
    const label = kind === 'audio' ? KIND_LABEL.audio : PURPOSE_LABEL[input.purpose];
    throw ApiError.badRequest(
      `This ${kind === 'audio' ? 'voice message' : 'video'} is too long. ${label} can be up to ${formatDuration(maxDuration)}.`,
      { max_duration_ms: maxDuration },
      'MEDIA_TOO_LONG',
    );
  }
  if (input.client_upload_id) {
    const resumed = await resumeUpload(user, input, rule.maxBytes);
    if (resumed) return resumed;
  }

  const pending = await Media.countDocuments({
    owner_id: user._id,
    status: 'pending',
    upload_expires_at: { $gt: new Date() },
  });
  if (pending >= MAX_PENDING_PER_USER) {
    throw ApiError.tooMany(
      'You have too many uploads in progress. Finish or cancel them first.',
      undefined,
      'TOO_MANY_PENDING_UPLOADS',
    );
  }

  const id = new mongoose.Types.ObjectId();
  const key = `media/${KEY_FOLDERS[input.purpose]}/${user.id as string}/${id.toHexString()}.${ext}`;

  try {
    if (input.bytes > MULTIPART_THRESHOLD) {
      const partSize = partSizeFor(input.bytes);
      const uploadId = await storage.createMultipartUpload({ key, contentType: input.content_type });
      const expiresAt = new Date(Date.now() + MULTIPART_IDLE_MS);
      const media = await Media.create({
        ...newMediaFields(user, input, kind, key, expiresAt),
        _id: id,
        upload_id: uploadId,
        part_size: partSize,
      });
      return { media: await toMediaDto(media), upload: multipartTicket(media) };
    }

    const ttl = env.MEDIA_UPLOAD_URL_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const media = await Media.create({
      ...newMediaFields(user, input, kind, key, expiresAt),
      _id: id,
    });
    return {
      media: await toMediaDto(media),
      upload: await postTicket(media, rule.maxBytes),
    };
  } catch (err) {
    // The same client_upload_id was sent twice at once: answer with the winner.
    if (
      input.client_upload_id &&
      err instanceof mongoose.mongo.MongoServerError &&
      err.code === MONGO_DUPLICATE_KEY
    ) {
      const raced = await resumeUpload(user, input, rule.maxBytes);
      if (raced) return raced;
    }
    throw err;
  }
}

const MONGO_DUPLICATE_KEY = 11000;

function multipartTicket(media: MediaDoc) {
  return {
    method: 'multipart' as const,
    part_size: media.part_size!,
    part_count: partCountOf(media),
    expires_at: media.upload_expires_at.toISOString(),
  };
}

/** A fresh presigned POST for the media's key; also pushes back its expiry. */
async function postTicket(media: MediaDoc, maxBytes: number) {
  const ttl = env.MEDIA_UPLOAD_URL_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const upload = await storage.presignUpload({
    key: media.key,
    contentType: media.content_type,
    maxBytes,
    expiresInSeconds: ttl,
  });
  if (media.upload_expires_at.getTime() < expiresAt.getTime()) {
    media.upload_expires_at = expiresAt;
    await media.save();
  }
  return { method: 'post' as const, ...upload, expires_at: expiresAt.toISOString() };
}

/**
 * Same `client_upload_id` again (retry or app restart): hands back the upload
 * that already exists. `complete` when it already finished; the same multipart
 * upload so sent parts are kept; a new presigned POST for the same key.
 * A different file (size / type) or an expired upload starts over.
 */
async function resumeUpload(user: UserDoc, input: CreateUploadInput, maxBytes: number) {
  const media = await Media.findOne({
    owner_id: user._id,
    client_upload_id: input.client_upload_id,
  });
  if (!media) return null;
  if (media.status === 'ready') {
    return {
      media: await toMediaDto(media),
      upload: { method: 'complete' as const },
      resumed: true,
    };
  }
  const sameFile =
    media.purpose === input.purpose &&
    media.content_type === input.content_type &&
    media.bytes === input.bytes;
  const expired = media.upload_expires_at.getTime() < Date.now();
  if (!sameFile || expired) {
    await discard(media);
    return null;
  }
  if (media.upload_id) {
    return { media: await toMediaDto(media), upload: multipartTicket(media), resumed: true };
  }
  return {
    media: await toMediaDto(media),
    upload: await postTicket(media, maxBytes),
    resumed: true,
  };
}

function newMediaFields(
  user: UserDoc,
  input: CreateUploadInput,
  kind: MediaKind,
  key: string,
  expiresAt: Date,
) {
  return {
    owner_id: user._id,
    purpose: input.purpose,
    kind,
    key,
    content_type: input.content_type,
    bytes: input.bytes,
    width: input.width ?? null,
    height: input.height ?? null,
    duration_ms: kind === 'image' ? null : (input.duration_ms ?? null),
    client_upload_id: input.client_upload_id ?? null,
    upload_expires_at: expiresAt,
  };
}

async function findOwned(user: UserDoc, id: string) {
  const media = await Media.findOne({ _id: id, owner_id: user._id });
  if (!media) throw ApiError.notFound('Media not found');
  return media;
}

async function discard(media: MediaDoc) {
  if (media.upload_id) await storage.abortMultipartUpload(media.key, media.upload_id);
  await storage.deleteObjects([media.key]);
  await media.deleteOne();
}

async function findMultipart(user: UserDoc, id: string) {
  const media = await findOwned(user, id);
  if (media.status !== 'pending' || !media.upload_id || !media.part_size) {
    throw ApiError.conflict('This upload is not sent in parts.', 'NOT_MULTIPART_UPLOAD');
  }
  return media;
}

const uploadExpired = () =>
  ApiError.badRequest('The upload expired. Please try again.', undefined, 'UPLOAD_EXPIRED');

/** Fresh presigned URLs for the given parts; also keeps the upload from being purged. */
export async function presignParts(user: UserDoc, id: string, partNumbers: number[]) {
  const media = await findMultipart(user, id);
  const count = partCountOf(media);
  const outOfRange = partNumbers.filter((n) => n > count);
  if (outOfRange.length) {
    throw ApiError.badRequest(
      `This upload has ${count} parts.`,
      { part_count: count, invalid: outOfRange },
      'INVALID_PART_NUMBER',
    );
  }

  const ttl = env.MEDIA_UPLOAD_URL_TTL_SECONDS;
  media.upload_expires_at = new Date(Date.now() + MULTIPART_IDLE_MS);
  await media.save();

  const parts = await Promise.all(
    partNumbers.map(async (n) => ({
      part_number: n,
      url: await storage.presignPart({
        key: media.key,
        uploadId: media.upload_id!,
        partNumber: n,
        contentLength: partLength(media, n),
        expiresInSeconds: ttl,
      }),
    })),
  );
  return { parts, expires_at: new Date(Date.now() + ttl * 1000).toISOString() };
}

/** What S3 already has, so an interrupted upload resumes instead of restarting. */
export async function listUploadedParts(user: UserDoc, id: string) {
  const media = await findMultipart(user, id);
  const parts = await storage.listParts(media.key, media.upload_id!);
  if (!parts) throw uploadExpired();
  return {
    part_size: media.part_size!,
    part_count: partCountOf(media),
    parts: parts
      .filter((p) => p.bytes === partLength(media, p.partNumber))
      .map((p) => ({ part_number: p.partNumber, bytes: p.bytes })),
  };
}

async function finishMultipart(media: MediaDoc) {
  const parts = await storage.listParts(media.key, media.upload_id!);
  if (parts) {
    const count = partCountOf(media);
    const received = parts.filter((p) => p.bytes === partLength(media, p.partNumber));
    if (received.length !== count || received.some((p, i) => p.partNumber !== i + 1)) {
      throw ApiError.badRequest(
        "The upload didn't finish. Please try again.",
        { part_count: count, received: received.map((p) => p.partNumber) },
        'UPLOAD_INCOMPLETE',
      );
    }
    await storage.completeMultipartUpload(media.key, media.upload_id!, received);
  } else if (!(await storage.statObject(media.key))) {
    // Aborted rather than already completed by an earlier request.
    throw uploadExpired();
  }
  media.upload_id = null;
  await media.save();
}

/** Verifies the object really landed in S3 and is the type it claimed to be. */
export async function completeUpload(user: UserDoc, id: string) {
  const media = await findOwned(user, id);
  if (media.status === 'ready') return await toMediaDto(media);
  if (media.upload_id) await finishMultipart(media);

  const stat = await storage.statObject(media.key);
  if (!stat) {
    throw ApiError.badRequest(
      "We didn't receive the file. Please try uploading again.",
      undefined,
      'UPLOAD_NOT_FOUND',
    );
  }

  const rule = ruleFor(media.purpose, media.kind);
  if (stat.bytes > rule.maxBytes) {
    await discard(media);
    throw ApiError.badRequest(
      `This file is too large. The limit is ${formatBytes(rule.maxBytes)}.`,
      { max_bytes: rule.maxBytes },
      'MEDIA_TOO_LARGE',
    );
  }

  const detected = detectContentType(await storage.readObjectStart(media.key, SNIFF_BYTES));
  if (!isCompatibleType(media.content_type, detected)) {
    logger.warn(
      { mediaId: media.id, declared: media.content_type, detected },
      'Rejected upload with mismatched content',
    );
    await discard(media);
    throw ApiError.badRequest(
      "This file couldn't be read. Try a different photo or video.",
      undefined,
      'INVALID_MEDIA',
    );
  }

  media.bytes = stat.bytes;
  media.status = 'ready';
  await media.save();
  return await toMediaDto(media);
}

export async function getMedia(user: UserDoc, id: string) {
  return await toMediaDto(await findOwned(user, id));
}

export async function deleteMedia(user: UserDoc, id: string) {
  const media = await findOwned(user, id);
  if (await Post.exists({ 'media.media_id': media._id })) {
    throw ApiError.conflict('This file is part of a post.', 'MEDIA_IN_USE');
  }
  if (
    await Message.exists({
      $or: [{ 'media.media_id': media._id }, { 'media_items.media_id': media._id }],
    })
  ) {
    throw ApiError.conflict('This file was sent in a message.', 'MEDIA_IN_USE');
  }
  await discard(media);
}

/** The presigned POST is checked when the upload starts; big videos on slow networks can take hours. */
const PURGE_GRACE_MS = 6 * 60 * 60 * 1000;
const PURGE_BATCH = 500;

/** Removes uploads that were started but never completed, from S3 and the database. */
export async function purgeAbandonedUploads(now = new Date()) {
  const cutoff = new Date(now.getTime() - PURGE_GRACE_MS);
  let purged = 0;
  for (;;) {
    const batch = await Media.find({ status: 'pending', upload_expires_at: { $lt: cutoff } })
      .select('_id key upload_id')
      .limit(PURGE_BATCH)
      .lean();
    if (!batch.length) break;
    for (const m of batch) {
      if (m.upload_id) await storage.abortMultipartUpload(m.key, m.upload_id);
    }
    await storage.deleteObjects(batch.map((m) => m.key));
    await Media.deleteMany({ _id: { $in: batch.map((m) => m._id) }, status: 'pending' });
    purged += batch.length;
    if (batch.length < PURGE_BATCH) break;
  }
  return purged;
}
