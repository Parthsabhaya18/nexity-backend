import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env, isMediaConfigured } from '../../config/env';
import { ApiError } from '../../utils/ApiError';

let client: S3Client | undefined;

function s3() {
  if (!isMediaConfigured) {
    throw new ApiError(
      503,
      'Media uploads are not available right now. Please try again later.',
      undefined,
      'MEDIA_NOT_CONFIGURED',
    );
  }
  client ??= new S3Client({
    region: env.AWS_REGION,
    // Otherwise presigned part URLs carry the CRC32 of an empty body and S3 rejects every part.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  return client;
}

const bucket = () => env.S3_BUCKET!;

const OBJECT_HEADERS = { CacheControl: 'public, max-age=31536000, immutable' } as const;

export type PresignedUpload = { url: string; fields: Record<string, string> };

/**
 * Browser-style POST policy: S3 itself rejects files over `maxBytes` or with a
 * different Content-Type, which a presigned PUT cannot enforce.
 */
export async function presignUpload(opts: {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresInSeconds: number;
}): Promise<PresignedUpload> {
  return createPresignedPost(s3(), {
    Bucket: bucket(),
    Key: opts.key,
    Conditions: [['content-length-range', 1, opts.maxBytes]],
    Fields: {
      'Content-Type': opts.contentType,
      'Cache-Control': OBJECT_HEADERS.CacheControl,
    },
    Expires: opts.expiresInSeconds,
  });
}

export async function createMultipartUpload(opts: {
  key: string;
  contentType: string;
}): Promise<string> {
  const res = await s3().send(
    new CreateMultipartUploadCommand({
      Bucket: bucket(),
      Key: opts.key,
      ContentType: opts.contentType,
      ...OBJECT_HEADERS,
    }),
  );
  if (!res.UploadId) throw new Error('S3 did not return an UploadId');
  return res.UploadId;
}

/**
 * Presigned PUT for one part. Content-Length is signed, so S3 rejects a part of
 * any other size and the object can never grow past what was reserved.
 */
export function presignPart(opts: {
  key: string;
  uploadId: string;
  partNumber: number;
  contentLength: number;
  expiresInSeconds: number;
}): Promise<string> {
  return getSignedUrl(
    s3(),
    new UploadPartCommand({
      Bucket: bucket(),
      Key: opts.key,
      UploadId: opts.uploadId,
      PartNumber: opts.partNumber,
      ContentLength: opts.contentLength,
    }),
    { expiresIn: opts.expiresInSeconds, signableHeaders: new Set(['content-length']) },
  );
}

export type UploadedPart = { partNumber: number; etag: string; bytes: number };

const isNoSuchUpload = (err: unknown) =>
  err instanceof S3ServiceException && err.name === 'NoSuchUpload';

/** Parts received so far, in order; `null` once the upload is completed or aborted. */
export async function listParts(key: string, uploadId: string): Promise<UploadedPart[] | null> {
  const parts: UploadedPart[] = [];
  let marker: string | undefined;
  try {
    for (;;) {
      const res = await s3().send(
        new ListPartsCommand({
          Bucket: bucket(),
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const p of res.Parts ?? []) {
        if (p.PartNumber && p.ETag) {
          parts.push({ partNumber: p.PartNumber, etag: p.ETag, bytes: p.Size ?? 0 });
        }
      }
      if (!res.IsTruncated) break;
      marker = res.NextPartNumberMarker;
    }
  } catch (err) {
    if (isNoSuchUpload(err)) return null;
    throw err;
  }
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: UploadedPart[],
): Promise<void> {
  await s3().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }),
  );
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  try {
    await s3().send(
      new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }),
    );
  } catch (err) {
    if (!isNoSuchUpload(err)) throw err;
  }
}

const isNotFound = (err: unknown) =>
  err instanceof S3ServiceException &&
  (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata.httpStatusCode === 404);

export async function statObject(key: string): Promise<{ bytes: number } | null> {
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { bytes: head.ContentLength ?? 0 };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function readObjectStart(key: string, length: number): Promise<Uint8Array> {
  const res = await s3().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${length - 1}` }),
  );
  return res.Body ? res.Body.transformToByteArray() : new Uint8Array();
}

const DELETE_BATCH = 1000;

export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const batch = keys.slice(i, i + DELETE_BATCH);
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}

/** Under S3's 7-day presign limit. */
const SIGNED_VIEW_TTL_SECONDS = 6 * 24 * 60 * 60;
/** Reused for a while so devices can cache the image; renewed long before it expires. */
const SIGNED_VIEW_REUSE_MS = 6 * 60 * 60 * 1000;
const SIGNED_VIEW_CACHE_MAX = 10_000;
const signedViews = new Map<string, { url: string; renewAt: number }>();

/**
 * URL a device can load the object from: the CDN when `MEDIA_PUBLIC_BASE_URL`
 * is set, otherwise a presigned GET, because the bucket blocks public access.
 */
export async function viewUrl(key: string): Promise<string> {
  if (env.MEDIA_PUBLIC_BASE_URL || !isMediaConfigured) return publicUrl(key);
  const now = Date.now();
  const cached = signedViews.get(key);
  if (cached && cached.renewAt > now) {
    signedViews.delete(key);
    signedViews.set(key, cached);
    return cached.url;
  }

  const url = await getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: SIGNED_VIEW_TTL_SECONDS,
  });
  signedViews.delete(key);
  signedViews.set(key, { url, renewAt: now + SIGNED_VIEW_REUSE_MS });
  while (signedViews.size > SIGNED_VIEW_CACHE_MAX) {
    const oldest = signedViews.keys().next().value;
    if (oldest === undefined) break;
    signedViews.delete(oldest);
  }
  return url;
}

export function publicUrl(key: string) {
  const base =
    env.MEDIA_PUBLIC_BASE_URL ??
    (env.S3_ENDPOINT
      ? `${env.S3_ENDPOINT}/${env.S3_BUCKET}`
      : `https://${env.S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com`);
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `${base.replace(/\/+$/, '')}/${path}`;
}
