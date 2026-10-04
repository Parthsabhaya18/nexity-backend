import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/modules/media/media.storage', () => ({
  abortMultipartUpload: vi.fn(async () => {}),
  deleteObjects: vi.fn(async () => {}),
  publicUrl: (key: string) => `https://cdn.test/${key}`,
  viewUrl: async (key: string) => `https://cdn.test/${key}`,
}));

import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { OtpCode } from '../src/modules/auth/otpCode.model';
import { RefreshToken } from '../src/modules/auth/refreshToken.model';
import { Follow } from '../src/modules/follows/follow.model';
import { Media } from '../src/modules/media/media.model';
import { extractHashtags, extractMentions } from '../src/modules/posts/caption';
import { Hashtag, Post } from '../src/modules/posts/post.model';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();

type Account = { auth: string; id: string; username: string };

async function signUp(username: string): Promise<Account> {
  const email = `${username.replace(/\./g, '')}@example.com`;
  const reg = await request(app).post('/api/v1/auth/register').send({
    display_name: username,
    username,
    email,
    password: 'secretPass1',
    gender: 'woman',
    date_of_birth: '1998-04-12',
    accept_terms: true,
  });
  const verified = await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ email, code: reg.body.dev_code });
  return {
    auth: `Bearer ${verified.body.access_token as string}`,
    id: verified.body.user.id as string,
    username,
  };
}

const api = (a: Account) => ({
  get: (path: string) => request(app).get(`/api/v1${path}`).set('Authorization', a.auth),
  post: (path: string, body?: object) =>
    request(app)
      .post(`/api/v1${path}`)
      .set('Authorization', a.auth)
      .send(body ?? {}),
  patch: (path: string, body: object) =>
    request(app).patch(`/api/v1${path}`).set('Authorization', a.auth).send(body),
  del: (path: string) => request(app).delete(`/api/v1${path}`).set('Authorization', a.auth),
});

let counter = 0;
async function readyMedia(owner: Account, overrides: Record<string, unknown> = {}) {
  const media = await Media.create({
    owner_id: owner.id,
    purpose: 'post',
    kind: 'image',
    key: `posts/${owner.id}/${++counter}.jpg`,
    content_type: 'image/jpeg',
    bytes: 1000,
    width: 1080,
    height: 1350,
    status: 'ready',
    upload_expires_at: new Date(Date.now() + 60_000),
    ...overrides,
  });
  return media.id as string;
}

let alice: Account;
let bob: Account;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Promise.all([
    User.init(),
    OtpCode.init(),
    RefreshToken.init(),
    Follow.init(),
    Media.init(),
    Post.init(),
    Hashtag.init(),
  ]);
}, 120_000);

afterAll(async () => {
  await disconnectDatabase();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all(
    [User, OtpCode, RefreshToken, Follow, Media, Post, Hashtag].map((m) =>
      (m as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
  alice = await signUp('alice');
  bob = await signUp('bob.smith');
});

describe('caption parsing', () => {
  it('finds hashtags and mentions like Instagram', () => {
    expect(extractHashtags('Sunset #Travel #travel #goa2026 #123 a#b #ગુજરાત')).toEqual([
      'travel',
      'goa2026',
      'ગુજરાત',
    ]);
    expect(extractMentions('with @Bob.Smith. and @al, me@mail.com @alice')).toEqual([
      'bob.smith',
      'alice',
    ]);
  });
});

describe('POST /posts', () => {
  it('creates a carousel in order with tags, mentions and location', async () => {
    const ids = [await readyMedia(alice), await readyMedia(alice), await readyMedia(alice)];
    const res = await api(alice).post('/posts', {
      media_ids: ids,
      caption: '  Sunset with @bob.smith and @nobody_here #Travel #goa  ',
      alt_texts: ['Beach', '', 'Friends'],
      location_name: 'Goa, India',
      aspect_ratio: 0.8,
      filters: ['clarendon', 'normal', 'moon'],
      client_upload_id: 'upload-123456',
    });
    expect(res.status).toBe(201);
    expect(res.body.media.map((m: { id: string }) => m.id)).toEqual(ids);
    expect(res.body.media.map((m: { filter: string }) => m.filter)).toEqual([
      'clarendon',
      'normal',
      'moon',
    ]);
    expect(res.body.media[0]).toMatchObject({
      kind: 'image',
      alt_text: 'Beach',
      url: expect.stringContaining('https://cdn.test/posts/'),
    });
    expect(res.body).toMatchObject({
      caption: 'Sunset with @bob.smith and @nobody_here #Travel #goa',
      hashtags: ['travel', 'goa'],
      mentions: ['bob.smith'],
      location_name: 'Goa, India',
      aspect_ratio: 0.8,
      likes_count: 0,
      is_owner: true,
      author: { id: alice.id, username: 'alice' },
    });

    const me = await api(alice).get('/users/me');
    expect(me.body.posts_count).toBe(1);
    expect(await Hashtag.findOne({ name: 'travel' }).lean()).toMatchObject({ post_count: 1 });
  });

  it('is idempotent with client_upload_id', async () => {
    const body = { media_ids: [await readyMedia(alice)], client_upload_id: 'retry-abcdefgh' };
    const first = await api(alice).post('/posts', body);
    const second = await api(alice).post('/posts', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await Post.countDocuments()).toBe(1);
    expect((await api(alice).get('/users/me')).body.posts_count).toBe(1);
  });

  it('rejects media that is not a ready post upload owned by the author', async () => {
    const cases = [
      await readyMedia(bob),
      await readyMedia(alice, { status: 'pending' }),
      await readyMedia(alice, { purpose: 'avatar' }),
      new mongoose.Types.ObjectId().toHexString(),
    ];
    for (const id of cases) {
      const res = await api(alice).post('/posts', { media_ids: [id] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_MEDIA');
    }
    expect(await Post.countDocuments()).toBe(0);
  });

  it('never reuses media and protects it from deletion', async () => {
    const id = await readyMedia(alice);
    expect((await api(alice).post('/posts', { media_ids: [id] })).status).toBe(201);
    const again = await api(alice).post('/posts', { media_ids: [id] });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('MEDIA_IN_USE');
    const del = await api(alice).del(`/media/${id}`);
    expect(del.status).toBe(409);
  });

  it('validates the body', async () => {
    const id = await readyMedia(alice);
    const bad = [
      { media_ids: [] },
      { media_ids: [id, id] },
      { media_ids: [id], caption: 'x'.repeat(2201) },
      { media_ids: [id], aspect_ratio: 3 },
      { media_ids: [id], caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ') },
    ];
    for (const body of bad) {
      expect((await api(alice).post('/posts', body)).status).toBe(400);
    }
  });
});

describe('GET /posts/:id', () => {
  it('hides posts of private accounts from non-followers', async () => {
    await api(alice).patch('/users/me', { is_private: true });
    const created = await api(alice).post('/posts', {
      media_ids: [await readyMedia(alice)],
      hide_like_count: true,
    });
    const path = `/posts/${created.body.id as string}`;

    const blocked = await api(bob).get(path);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PRIVATE_ACCOUNT');

    await api(bob).post(`/users/${alice.id}/follow`);
    const requests = await api(alice).get('/users/me/follow-requests');
    await api(alice).post(`/follow-requests/${requests.body.items[0].id as string}/accept`);

    const visible = await api(bob).get(path);
    expect(visible.status).toBe(200);
    expect(visible.body).toMatchObject({ is_owner: false, likes_count: null });
    expect((await api(alice).get(path)).body.likes_count).toBe(0);
    expect(
      (await api(bob).get(`/posts/${new mongoose.Types.ObjectId().toHexString()}`)).status,
    ).toBe(404);
  });
});

describe('search tags and places', () => {
  it('suggests hashtags and public locations', async () => {
    await api(alice).post('/posts', {
      media_ids: [await readyMedia(alice)],
      caption: '#travel #travelgram',
      location_name: 'Goa, India',
    });
    await api(bob).patch('/users/me', { is_private: true });
    await api(bob).post('/posts', {
      media_ids: [await readyMedia(bob)],
      caption: '#travel',
      location_name: 'Secret Beach',
    });

    const tags = await api(alice).get('/search?type=tags&q=%23trav');
    expect(tags.body.tags).toEqual([
      { name: 'travel', post_count: 2 },
      { name: 'travelgram', post_count: 1 },
    ]);
    const places = await api(alice).get('/search?type=places&q=goa');
    expect(places.body.places[0]).toEqual({ name: 'Goa, India', post_count: 1 });
    expect(places.body.places).toContainEqual({ name: 'Goa', post_count: 0 });
    const hidden = await api(alice).get('/search?type=places&q=secret');
    expect(hidden.body.places).toEqual([]);
    const own = await api(bob).get('/search?type=places&q=beach');
    expect(own.body.places).toEqual([{ name: 'Secret Beach', post_count: 1 }]);
  });
});
