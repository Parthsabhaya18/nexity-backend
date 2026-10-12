/**
 * Verifies the S3 setup end to end with the credentials in .env:
 * presigned POST upload, size limit, multipart upload, read-back, public URL and delete.
 * Usage: npm run media:check
 */
import { env, isMediaConfigured } from '../src/config/env';
import { detectContentType, SNIFF_BYTES } from '../src/modules/media/media.sniff';
import * as storage from '../src/modules/media/media.storage';

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

async function postFile(upload: storage.PresignedUpload, body: Buffer) {
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  form.append('file', new Blob([new Uint8Array(body)], { type: 'image/jpeg' }), 'check.jpg');
  const res = await fetch(upload.url, { method: 'POST', body: form });
  return { status: res.status, text: await res.text() };
}

function step(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

const putPart = async (url: string, body: Buffer) => {
  const res = await fetch(url, { method: 'PUT', body: new Uint8Array(body) });
  return { status: res.status, text: await res.text() };
};

/** Large-file path: two parts (S3's 5 MB minimum + a tail), resume listing, assemble. */
async function checkMultipart(key: string) {
  const first = Buffer.alloc(5 * 1024 * 1024);
  JPEG.copy(first);
  const parts = [first, Buffer.from('tail')];
  const total = first.length + parts[1]!.length;
  const uploadId = await storage.createMultipartUpload({ key, contentType: 'image/jpeg' });
  try {
    const sign = (partNumber: number) =>
      storage.presignPart({
        key,
        uploadId,
        partNumber,
        contentLength: parts[partNumber - 1]!.length,
        expiresInSeconds: 120,
      });

    const wrongSize = await putPart(await sign(2), Buffer.from('longer tail'));
    step(
      wrongSize.status === 403,
      'S3 rejects a part of the wrong size',
      `HTTP ${wrongSize.status}`,
    );

    for (const n of [1, 2]) {
      const res = await putPart(await sign(n), parts[n - 1]!);
      if (
        !step(
          res.status === 200,
          `Upload part ${n} with presigned PUT`,
          `HTTP ${res.status} ${res.text}`,
        )
      ) {
        return;
      }
    }

    const listed = await storage.listParts(key, uploadId);
    step(
      listed?.length === 2,
      'ListParts reports uploaded parts (resume)',
      `${listed?.length} parts`,
    );

    await storage.completeMultipartUpload(key, uploadId, listed!);
    const stat = await storage.statObject(key);
    step(
      stat?.bytes === total,
      'CompleteMultipartUpload assembled the file',
      `${stat?.bytes} bytes`,
    );
  } catch (err) {
    step(false, 'Multipart upload', String(err));
  } finally {
    await storage.abortMultipartUpload(key, uploadId).catch(() => {});
    await storage.deleteObjects([key]).catch(() => {});
  }
}

async function main() {
  if (!isMediaConfigured) {
    console.error('Set AWS_REGION and S3_BUCKET in backend/.env first.');
    process.exit(1);
  }
  console.log(`Bucket ${env.S3_BUCKET} (${env.AWS_REGION})\n`);
  const key = `media/posts/_healthcheck/${Date.now()}.jpg`;

  try {
    const upload = await storage.presignUpload({
      key,
      contentType: 'image/jpeg',
      maxBytes: 1024,
      expiresInSeconds: 120,
    });
    const put = await postFile(upload, JPEG);
    if (!step(put.status === 204, 'Upload with presigned POST', `HTTP ${put.status} ${put.text}`)) {
      return;
    }

    const tooBig = await postFile(
      await storage.presignUpload({
        key: `${key}.big`,
        contentType: 'image/jpeg',
        maxBytes: 10,
        expiresInSeconds: 120,
      }),
      JPEG,
    );
    step(
      tooBig.status === 400 && tooBig.text.includes('EntityTooLarge'),
      'S3 rejects files over the policy limit',
      `HTTP ${tooBig.status}`,
    );

    const stat = await storage.statObject(key);
    step(stat?.bytes === JPEG.length, 'HeadObject returns the stored size', `${stat?.bytes} bytes`);

    const head = await storage.readObjectStart(key, SNIFF_BYTES);
    step(detectContentType(head) === 'image/jpeg', 'Read first bytes and detect JPEG');

    await checkMultipart(`${key}.parts`);

    const url = storage.publicUrl(key);
    const pub = await fetch(url);
    step(
      pub.ok,
      'Public URL is readable',
      pub.ok
        ? url
        : `HTTP ${pub.status} at ${url} — set up CloudFront (MEDIA_PUBLIC_BASE_URL) or a public-read policy on media/*`,
    );
  } finally {
    try {
      await storage.deleteObjects([key]);
      step((await storage.statObject(key)) === null, 'DeleteObjects removed the test file');
    } catch (err) {
      step(false, 'Delete the test file', String(err));
    }
  }
}

main().catch((err) => {
  console.error(`FAIL  ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  process.exit(1);
});
