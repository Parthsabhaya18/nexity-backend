import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deleted = vi.hoisted(() => [] as string[]);

vi.mock('../src/modules/media/media.storage', () => ({
  abortMultipartUpload: vi.fn(async () => {}),
  deleteObjects: vi.fn(async (keys: string[]) => {
    deleted.push(...keys);
  }),
  publicUrl: (key: string) => `https://cdn.test/${key}`,
  viewUrl: async (key: string) => `https://cdn.test/${key}`,
}));

import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { OtpCode } from '../src/modules/auth/otpCode.model';
import { RefreshToken } from '../src/modules/auth/refreshToken.model';
import { Media } from '../src/modules/media/media.model';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();

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

const patchMe = (auth: string, body: Record<string, unknown>) =>
  request(app).patch('/api/v1/users/me').set('Authorization', auth).send(body);

async function readyMedia(username: string, overrides: Record<string, unknown> = {}) {
  const owner = await User.findOne({ username });
  const media = await Media.create({
    owner_id: owner!._id,
    purpose: 'avatar',
    kind: 'image',
    key: `media/avatars/${owner!.id as string}/${Math.random().toString(16).slice(2)}.jpg`,
    content_type: 'image/jpeg',
    bytes: 50_000,
    status: 'ready',
    upload_expires_at: new Date(),
    ...overrides,
  });
  return media;
}

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
  deleted.length = 0;
  auth = await signUp('profile.owner');
});

describe('GET /users/me', () => {
  it('includes the profile fields and counts', async () => {
    const res = await request(app).get('/api/v1/users/me').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username: 'profile.owner',
      bio: '',
      website: '',
      avatar_url: null,
      is_private: false,
      posts_count: 0,
      followers_count: 0,
      following_count: 0,
    });
  });
});

describe('PATCH /users/me', () => {
  it('requires authentication', async () => {
    const res = await request(app).patch('/api/v1/users/me').send({ bio: 'hi' });
    expect(res.status).toBe(401);
  });

  it('updates only the fields that are sent', async () => {
    const res = await patchMe(auth, {
      display_name: '  Jane Doe ',
      bio: 'Coffee & sunsets',
      website: 'jane.dev/links',
      is_private: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      display_name: 'Jane Doe',
      username: 'profile.owner',
      bio: 'Coffee & sunsets',
      website: 'https://jane.dev/links',
      is_private: true,
    });

    const again = await patchMe(auth, { bio: '' });
    expect(again.body).toMatchObject({
      bio: '',
      website: 'https://jane.dev/links',
      is_private: true,
    });
  });

  it('ignores fields users may not change', async () => {
    const res = await patchMe(auth, { role: 'admin', is_verified: false, followers_count: 999 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'user', is_verified: true, followers_count: 0 });
  });

  it('validates bio, website and name', async () => {
    const longBio = await patchMe(auth, { bio: 'x'.repeat(151) });
    expect(longBio.status).toBe(400);
    expect(longBio.body.error.details[0].path).toBe('bio');

    for (const website of ['not a url', 'javascript:alert(1)', 'localhost']) {
      const res = await patchMe(auth, { website });
      expect(res.status, website).toBe(400);
      expect(res.body.error.details[0].path).toBe('website');
    }

    const shortName = await patchMe(auth, { display_name: 'J' });
    expect(shortName.status).toBe(400);
  });

  it('changes the username and rejects taken ones', async () => {
    await signUp('taken.name');
    const taken = await patchMe(auth, { username: 'Taken.Name' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('USERNAME_TAKEN');

    const invalid = await patchMe(auth, { username: 'no spaces' });
    expect(invalid.status).toBe(400);

    const ok = await patchMe(auth, { username: 'New.Handle' });
    expect(ok.status).toBe(200);
    expect(ok.body.username).toBe('new.handle');

    const same = await patchMe(auth, { username: 'new.handle' });
    expect(same.status).toBe(200);
  });

  it('sets the avatar from an uploaded photo and deletes the old one', async () => {
    const first = await readyMedia('profile.owner');
    const res = await patchMe(auth, { avatar_media_id: first.id });
    expect(res.status).toBe(200);
    expect(res.body.avatar_url).toBe(`https://cdn.test/${first.key}`);

    const second = await readyMedia('profile.owner');
    const replaced = await patchMe(auth, { avatar_media_id: second.id });
    expect(replaced.body.avatar_url).toBe(`https://cdn.test/${second.key}`);
    await vi.waitFor(async () => expect(await Media.exists({ _id: first._id })).toBeNull());
    expect(deleted).toContain(first.key);

    const removed = await patchMe(auth, { avatar_media_id: null });
    expect(removed.body.avatar_url).toBeNull();
    await vi.waitFor(async () => expect(await Media.exists({ _id: second._id })).toBeNull());
  });

  it("rejects media that isn't a ready avatar of this user", async () => {
    const pending = await readyMedia('profile.owner', { status: 'pending' });
    const post = await readyMedia('profile.owner', { purpose: 'post' });
    await signUp('someone.else');
    const foreign = await readyMedia('someone.else');

    for (const media of [pending, post, foreign]) {
      const res = await patchMe(auth, { avatar_media_id: media.id });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_AVATAR');
    }
    const me = await User.findOne({ username: 'profile.owner' });
    expect(me!.avatar_url).toBeNull();
  });
});
