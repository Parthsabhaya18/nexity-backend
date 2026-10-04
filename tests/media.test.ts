import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type FakePart = { bytes: number; data: Uint8Array };

const store = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  /** Real size of objects assembled from parts (their data only keeps the first bytes). */
  sizes: new Map<string, number>(),
  uploads: new Map<string, { key: string; parts: Map<number, FakePart> }>(),
  nextUpload: 0,
}));

vi.mock('../src/modules/media/media.storage', () => ({
  presignUpload: vi.fn(async ({ key, contentType }: { key: string; contentType: string }) => ({
    url: 'https://s3.test/bucket',
    fields: { key, 'Content-Type': contentType, Policy: 'policy', 'X-Amz-Signature': 'sig' },
  })),
  createMultipartUpload: vi.fn(async ({ key }: { key: string }) => {
    const id = `upload-${++store.nextUpload}`;
    store.uploads.set(id, { key, parts: new Map() });
    return id;
  }),
  presignPart: vi.fn(
    async (o: { uploadId: string; partNumber: number; contentLength: number }) =>
      `https://s3.test/part?uploadId=${o.uploadId}&partNumber=${o.partNumber}&length=${o.contentLength}`,
  ),
  listParts: vi.fn(async (_key: string, uploadId: string) => {
    const upload = store.uploads.get(uploadId);
    if (!upload) return null;
    return [...upload.parts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([partNumber, p]) => ({ partNumber, etag: `"etag-${partNumber}"`, bytes: p.bytes }));
  }),
  completeMultipartUpload: vi.fn(async (key: string, uploadId: string) => {
    const upload = store.uploads.get(uploadId)!;
    const parts = [...upload.parts.entries()].sort(([a], [b]) => a - b).map(([, p]) => p);
    store.objects.set(key, parts[0]!.data);
    store.sizes.set(
      key,
      parts.reduce((sum, p) => sum + p.bytes, 0),
    );
    store.uploads.delete(uploadId);
  }),
  abortMultipartUpload: vi.fn(async (_key: string, uploadId: string) => {
    store.uploads.delete(uploadId);
  }),
  statObject: vi.fn(async (key: string) => {
    const obj = store.objects.get(key);
    return obj ? { bytes: store.sizes.get(key) ?? obj.length } : null;
  }),
  readObjectStart: vi.fn(async (key: string, length: number) =>
    (store.objects.get(key) ?? new Uint8Array()).subarray(0, length),
  ),
  deleteObjects: vi.fn(async (keys: string[]) => {
    for (const k of keys) store.objects.delete(k);
  }),
  publicUrl: (key: string) => `https://cdn.test/${key}`,
  viewUrl: async (key: string) => `https://cdn.test/${key}`,
}));

import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { OtpCode } from '../src/modules/auth/otpCode.model';
import { RefreshToken } from '../src/modules/auth/refreshToken.model';
import { Media } from '../src/modules/media/media.model';
import { purgeAbandonedUploads } from '../src/modules/media/media.service';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const MP4 = Uint8Array.from([0, 0, 0, 0x20, ...Buffer.from('ftypisom'), 0, 0, 2, 0]);
const HTML = Uint8Array.from(Buffer.from('<html><script>alert(1)</script></html>'));

async function signUp(username: string) {
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({
      display_name: 'Test User',
      username,
      email: `${username}@example.com`,
      password: 'secretPass1',
      gender: 'woman',
      date_of_birth: '1998-04-12',
      accept_terms: true,
    });
  const verified = await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ email: `${username}@example.com`, code: reg.body.dev_code });
  return `Bearer ${verified.body.access_token as string}`;
}

const startUpload = (auth: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/media/uploads').set('Authorization', auth).send(body);

const complete = (auth: string, id: string) =>
  request(app).post(`/api/v1/media/${id}/complete`).set('Authorization', auth);

let auth: string;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Promise.all([User.init(), OtpCode.init(), RefreshToken.init(), Media.init()]);
}, 120_000);

afterAll(async () => {
  await disconnectDatabase();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    OtpCode.deleteMany({}),
    RefreshToken.deleteMany({}),
    Media.deleteMany({}),
  ]);
  store.objects.clear();
  store.sizes.clear();
  store.uploads.clear();
  auth = await signUp('media.tester');
});

describe('POST /media/uploads', () => {
  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/v1/media/uploads')
      .send({ purpose: 'post', content_type: 'image/jpeg', bytes: 1000 });
    expect(res.status).toBe(401);
  });

  it('returns a presigned POST and a pending media row', async () => {
    const res = await startUpload(auth, {
      purpose: 'post',
      content_type: 'image/jpg',
      bytes: 250_000,
      width: 1080,
      height: 1350,
    });
    expect(res.status).toBe(201);
    expect(res.body.media).toMatchObject({
      purpose: 'post',
      kind: 'image',
      status: 'pending',
      url: null,
      content_type: 'image/jpeg',
      width: 1080,
      height: 1350,
    });
    expect(res.body.upload.method).toBe('post');
    expect(res.body.upload.url).toBe('https://s3.test/bucket');
    expect(res.body.upload.fields.key).toMatch(
      new RegExp(`^media/posts/[a-f\\d]{24}/${res.body.media.id}\\.jpg$`),
    );
    expect(Date.parse(res.body.upload.expires_at)).toBeGreaterThan(Date.now());
  });

  it('accepts videos up to the Instagram length and drops bad metadata', async () => {
    const reel = await startUpload(auth, {
      purpose: 'reel',
      content_type: 'video/mp4',
      bytes: 900 * 1024 * 1024,
      duration_ms: 3 * 60 * 1000 + 400,
    });
    expect(reel.status).toBe(201);
    expect(reel.body.media.duration_ms).toBe(3 * 60 * 1000 + 400);

    const chatVideo = await startUpload(auth, {
      purpose: 'message',
      content_type: 'video/mp4',
      bytes: 50_000_000,
      duration_ms: 45 * 60 * 1000,
    });
    expect(chatVideo.status).toBe(201);

    const noMeta = await startUpload(auth, {
      purpose: 'story',
      content_type: 'video/mp4',
      bytes: 5_000_000,
      width: 0,
      duration_ms: -1,
    });
    expect(noMeta.status).toBe(201);
    expect(noMeta.body.media).toMatchObject({ width: null, duration_ms: null });
  });

  it('rejects unsupported types, wrong kinds and files over the safety ceiling', async () => {
    const gif = await startUpload(auth, { purpose: 'post', content_type: 'image/gif', bytes: 10 });
    expect(gif.status).toBe(400);
    expect(gif.body.error.code).toBe('VALIDATION_ERROR');

    const reelPhoto = await startUpload(auth, {
      purpose: 'reel',
      content_type: 'image/jpeg',
      bytes: 10,
    });
    expect(reelPhoto.body.error.code).toBe('MEDIA_KIND_NOT_ALLOWED');

    const bigAvatar = await startUpload(auth, {
      purpose: 'avatar',
      content_type: 'image/png',
      bytes: 25 * 1024 * 1024,
    });
    expect(bigAvatar.body.error.code).toBe('MEDIA_TOO_LARGE');
    expect(bigAvatar.body.error.details.max_bytes).toBe(20 * 1024 * 1024);
  });

  it('rejects videos longer than Instagram allows for each purpose', async () => {
    const cases = [
      { purpose: 'reel', duration_ms: 3 * 60 * 1000 + 2000, max: 180_000, text: '3 minutes' },
      { purpose: 'story', duration_ms: 61_500, max: 60_000, text: '60 seconds' },
      { purpose: 'post', duration_ms: 90_000, max: 60_000, text: '60 seconds' },
    ];
    for (const c of cases) {
      const res = await startUpload(auth, {
        purpose: c.purpose,
        content_type: 'video/mp4',
        bytes: 5_000_000,
        duration_ms: c.duration_ms,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MEDIA_TOO_LONG');
      expect(res.body.error.details.max_duration_ms).toBe(c.max);
      expect(res.body.error.message).toContain(c.text);
    }
  });
});

describe('POST /media/:id/complete', () => {
  async function uploaded(body: Record<string, unknown>, bytes: Uint8Array) {
    const res = await startUpload(auth, body);
    store.objects.set(res.body.upload.fields.key, bytes);
    return res.body.media.id as string;
  }

  it('marks a verified image ready with its public URL', async () => {
    const id = await uploaded({ purpose: 'post', content_type: 'image/jpeg', bytes: 12 }, JPEG);
    const res = await complete(auth, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: 'ready', bytes: JPEG.length });
    expect(res.body.url).toMatch(/^https:\/\/cdn\.test\/media\/posts\//);

    const again = await complete(auth, id);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('ready');
  });

  it('accepts a QuickTime-labelled MP4 video', async () => {
    const id = await uploaded(
      { purpose: 'reel', content_type: 'video/quicktime', bytes: 20, duration_ms: 15_000 },
      MP4,
    );
    const res = await complete(auth, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'video', duration_ms: 15_000, status: 'ready' });
  });

  it('fails when the file never reached S3', async () => {
    const res = await startUpload(auth, { purpose: 'post', content_type: 'image/jpeg', bytes: 12 });
    const done = await complete(auth, res.body.media.id);
    expect(done.status).toBe(400);
    expect(done.body.error.code).toBe('UPLOAD_NOT_FOUND');
  });

  it('deletes files whose content does not match the declared type', async () => {
    const res = await startUpload(auth, { purpose: 'post', content_type: 'image/jpeg', bytes: 40 });
    const key = res.body.upload.fields.key as string;
    store.objects.set(key, HTML);

    const done = await complete(auth, res.body.media.id);
    expect(done.status).toBe(400);
    expect(done.body.error.code).toBe('INVALID_MEDIA');
    expect(store.objects.has(key)).toBe(false);
    expect(await Media.countDocuments()).toBe(0);
  });

  it("hides other users' media", async () => {
    const id = await uploaded({ purpose: 'post', content_type: 'image/jpeg', bytes: 12 }, JPEG);
    const other = await signUp('someone.else');
    expect((await complete(other, id)).status).toBe(404);
    expect((await request(app).get(`/api/v1/media/${id}`).set('Authorization', other)).status).toBe(
      404,
    );
    expect(
      (await request(app).delete(`/api/v1/media/${id}`).set('Authorization', other)).status,
    ).toBe(404);
  });

  it('rejects malformed ids', async () => {
    const res = await complete(auth, 'not-an-id');
    expect(res.status).toBe(400);
  });
});

describe('DELETE /media/:id', () => {
  it('removes the object and the row', async () => {
    const res = await startUpload(auth, { purpose: 'post', content_type: 'image/jpeg', bytes: 12 });
    const key = res.body.upload.fields.key as string;
    store.objects.set(key, JPEG);

    const del = await request(app)
      .delete(`/api/v1/media/${res.body.media.id}`)
      .set('Authorization', auth);
    expect(del.status).toBe(204);
    expect(store.objects.has(key)).toBe(false);
    expect(await Media.countDocuments()).toBe(0);
  });
});

describe('multipart uploads (large files)', () => {
  const MB = 1024 * 1024;
  const BYTES = 20 * MB + 5 * MB + 123; // 25 MB + a bit: 3 parts of 8 MB + a tail
  const BIG = 40 * MB + 123;

  const startBig = (bytes = BIG) =>
    startUpload(auth, { purpose: 'reel', content_type: 'video/mp4', bytes, duration_ms: 170_000 });

  const partUrls = (id: string, partNumbers: number[], as = auth) =>
    request(app)
      .post(`/api/v1/media/${id}/parts`)
      .set('Authorization', as)
      .send({ part_numbers: partNumbers });

  const listParts = (id: string) =>
    request(app).get(`/api/v1/media/${id}/parts`).set('Authorization', auth);

  /** Simulates the app PUTting a part to its presigned URL. */
  function putPart(partNumber: number, bytes: number, data = MP4) {
    const [upload] = [...store.uploads.values()];
    upload!.parts.set(partNumber, { bytes, data });
  }

  it('keeps files up to 32 MB on a single presigned POST', async () => {
    const res = await startBig(BYTES);
    expect(res.body.upload.method).toBe('post');
    expect(store.uploads.size).toBe(0);
  });

  it('starts an S3 multipart upload with 8 MB parts for large files', async () => {
    const res = await startBig();
    expect(res.status).toBe(201);
    expect(res.body.upload).toEqual({
      method: 'multipart',
      part_size: 8 * MB,
      part_count: 6,
      expires_at: expect.any(String),
    });
    expect(res.body.media).toMatchObject({ status: 'pending', bytes: BIG, kind: 'video' });
    expect(store.uploads.size).toBe(1);
  });

  it('signs each part with its exact size and keeps the upload alive', async () => {
    const id = (await startBig()).body.media.id as string;
    await Media.updateOne(
      { _id: id },
      { $set: { upload_expires_at: new Date(Date.now() + 1000) } },
    );

    const res = await partUrls(id, [1, 6, 6]);
    expect(res.status).toBe(200);
    expect(res.body.parts).toEqual([
      { part_number: 1, url: expect.stringContaining(`length=${8 * MB}`) },
      { part_number: 6, url: expect.stringContaining(`length=${BIG - 5 * 8 * MB}`) },
    ]);
    const row = await Media.findById(id).lean();
    expect(row!.upload_expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);

    const outOfRange = await partUrls(id, [7]);
    expect(outOfRange.status).toBe(400);
    expect(outOfRange.body.error.code).toBe('INVALID_PART_NUMBER');
  });

  it('rejects part requests for small uploads and for other users', async () => {
    const small = await startUpload(auth, {
      purpose: 'post',
      content_type: 'image/jpeg',
      bytes: 12,
    });
    const res = await partUrls(small.body.media.id, [1]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_MULTIPART_UPLOAD');

    const id = (await startBig()).body.media.id as string;
    const other = await signUp('someone.else');
    expect((await partUrls(id, [1], other)).status).toBe(404);
  });

  it('reports received parts so an interrupted upload can resume', async () => {
    const id = (await startBig()).body.media.id as string;
    putPart(1, 8 * MB);
    putPart(3, 8 * MB);
    putPart(2, 1000); // a broken part is not counted

    const res = await listParts(id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      part_size: 8 * MB,
      part_count: 6,
      parts: [
        { part_number: 1, bytes: 8 * MB },
        { part_number: 3, bytes: 8 * MB },
      ],
    });
  });

  it('refuses to complete until every part arrived, then assembles and verifies', async () => {
    const id = (await startBig()).body.media.id as string;
    for (const n of [1, 2, 3, 4, 5]) putPart(n, 8 * MB);

    const early = await complete(auth, id);
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('UPLOAD_INCOMPLETE');
    expect(early.body.error.details.received).toEqual([1, 2, 3, 4, 5]);

    putPart(6, BIG - 5 * 8 * MB);
    const done = await complete(auth, id);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ id, status: 'ready', bytes: BIG, kind: 'video' });
    expect(done.body.url).toMatch(/^https:\/\/cdn\.test\/media\/reels\//);
    expect((await Media.findById(id).lean())!.upload_id).toBeNull();

    const again = await complete(auth, id);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('ready');
  });

  it('deletes an assembled file whose content is not a video', async () => {
    const id = (await startBig()).body.media.id as string;
    for (let n = 1; n <= 5; n++) putPart(n, 8 * MB, n === 1 ? HTML : MP4);
    putPart(6, BIG - 5 * 8 * MB);

    const res = await complete(auth, id);
    expect(res.body.error.code).toBe('INVALID_MEDIA');
    expect(store.objects.size).toBe(0);
    expect(await Media.countDocuments()).toBe(0);
  });

  it('aborts the S3 multipart upload on delete and on purge', async () => {
    const deleted = (await startBig()).body.media.id as string;
    putPart(1, 8 * MB);
    const del = await request(app).delete(`/api/v1/media/${deleted}`).set('Authorization', auth);
    expect(del.status).toBe(204);
    expect(store.uploads.size).toBe(0);

    const abandoned = (await startBig()).body.media.id as string;
    await Media.updateOne(
      { _id: abandoned },
      { $set: { upload_expires_at: new Date(Date.now() - 7 * 60 * 60 * 1000) } },
    );
    expect(await purgeAbandonedUploads()).toBe(1);
    expect(store.uploads.size).toBe(0);
  });

  it('tells the app to restart when S3 no longer has the upload', async () => {
    const id = (await startBig()).body.media.id as string;
    store.uploads.clear();
    expect((await listParts(id)).body.error.code).toBe('UPLOAD_EXPIRED');
    expect((await complete(auth, id)).body.error.code).toBe('UPLOAD_EXPIRED');
  });
});

describe('purgeAbandonedUploads', () => {
  it('removes expired pending uploads and keeps the rest', async () => {
    const stale = await startUpload(auth, {
      purpose: 'post',
      content_type: 'image/jpeg',
      bytes: 12,
    });
    const fresh = await startUpload(auth, {
      purpose: 'post',
      content_type: 'image/jpeg',
      bytes: 12,
    });
    const ready = await startUpload(auth, {
      purpose: 'post',
      content_type: 'image/jpeg',
      bytes: 12,
    });
    store.objects.set(stale.body.upload.fields.key, JPEG);
    store.objects.set(ready.body.upload.fields.key, JPEG);
    await complete(auth, ready.body.media.id);

    const past = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await Media.updateMany(
      { _id: { $in: [stale.body.media.id, ready.body.media.id] } },
      { $set: { upload_expires_at: past } },
    );
    // Expired an hour ago: may still be uploading a big video, so it is kept.
    await Media.updateOne(
      { _id: fresh.body.media.id },
      { $set: { upload_expires_at: new Date(Date.now() - 60 * 60 * 1000) } },
    );

    expect(await purgeAbandonedUploads()).toBe(1);
    expect(store.objects.has(stale.body.upload.fields.key)).toBe(false);
    const left = (await Media.find().lean()).map((m) => String(m._id)).sort();
    expect(left).toEqual([fresh.body.media.id, ready.body.media.id].sort());
  });
});
