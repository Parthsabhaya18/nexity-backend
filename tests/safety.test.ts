import { MongoMemoryServer } from 'mongodb-memory-server';
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
import { Notification } from '../src/modules/notifications/notification.model';
import { Comment } from '../src/modules/posts/post.engage.model';
import { Post } from '../src/modules/posts/post.model';
import { Block } from '../src/modules/safety/block.model';
import { Mute } from '../src/modules/safety/mute.model';
import { Report } from '../src/modules/safety/report.model';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();
let n = 0;

type Account = { auth: string; id: string; username: string };

async function signUp(username: string): Promise<Account> {
  const email = `${username}@example.com`;
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
    request(app).post(`/api/v1${path}`).set('Authorization', a.auth).send(body ?? {}),
  del: (path: string) => request(app).delete(`/api/v1${path}`).set('Authorization', a.auth),
});

async function postMedia(owner: Account) {
  const row = await Media.create({
    owner_id: owner.id,
    purpose: 'post',
    kind: 'image',
    key: `post/${++n}.jpg`,
    content_type: 'image/jpeg',
    bytes: 1000,
    width: 1080,
    height: 1080,
    status: 'ready',
    upload_expires_at: new Date(Date.now() + 60_000),
  });
  return row.id as string;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Follow.deleteMany({}),
    Post.deleteMany({}),
    Comment.deleteMany({}),
    Media.deleteMany({}),
    Block.deleteMany({}),
    Mute.deleteMany({}),
    Report.deleteMany({}),
    Notification.deleteMany({}),
    OtpCode.deleteMany({}),
    RefreshToken.deleteMany({}),
  ]);
});

describe('block, report and comment notifications', () => {
  it('hides a blocked account and drops the follow', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await api(alice).post(`/users/${bob.id}/follow`);
    expect((await api(alice).post(`/users/${bob.id}/block`)).status).toBe(204);
    expect((await api(alice).get('/users/by-username/bob')).status).toBe(404);
    expect((await api(bob).get('/users/by-username/alice')).status).toBe(404);
    expect((await api(alice).post(`/users/${bob.id}/follow`)).status).toBe(404);
    expect((await api(alice).get('/users/me')).body.following_count).toBe(0);

    const blocked = await api(alice).get('/users/me/blocked');
    expect(blocked.body.items.map((u: { username: string }) => u.username)).toEqual(['bob']);

    const post = await api(bob).post('/posts', { media_ids: [await postMedia(bob)] });
    expect((await api(alice).get('/feed')).body.items).toEqual([]);
    expect((await api(alice).get(`/posts/${post.body.id as string}`)).status).toBe(404);
    expect((await api(alice).get('/search?q=bob&type=users')).body.users).toEqual([]);

    expect((await api(alice).del(`/users/${bob.id}/block`)).status).toBe(204);
    expect((await api(alice).get('/users/by-username/bob')).status).toBe(200);
    expect((await api(alice).get('/users/me')).body.following_count).toBe(0);
  });

  it('mutes and unmutes quietly, shown only to the muter', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    expect((await api(alice).post(`/users/${bob.id}/mute`)).status).toBe(204);
    expect((await api(alice).post(`/users/${bob.id}/mute`)).status).toBe(204);
    expect(await Mute.countDocuments()).toBe(1);
    expect((await api(alice).get('/users/by-username/bob')).body.muted).toBe(true);
    expect((await api(bob).get('/users/by-username/alice')).body.muted).toBe(false);

    expect((await api(alice).post(`/users/${alice.id}/mute`)).status).toBe(400);
    expect((await api(alice).post('/users/0123456789abcdef01234567/mute')).status).toBe(404);
    expect((await request(app).post(`/api/v1/users/${bob.id}/mute`)).status).toBe(401);

    expect((await api(alice).del(`/users/${bob.id}/mute`)).status).toBe(204);
    expect((await api(alice).get('/users/by-username/bob')).body.muted).toBe(false);
  });

  it('accepts a report once and notifies the post author about a comment', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const post = await api(alice).post('/posts', { media_ids: [await postMedia(alice)] });
    const id = post.body.id as string;

    const first = await api(bob).post('/reports', {
      target_type: 'post',
      target_id: id,
      reason: 'spam',
    });
    const again = await api(bob).post('/reports', {
      target_type: 'post',
      target_id: id,
      reason: 'spam',
    });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await Report.countDocuments()).toBe(1);

    const other = await api(bob).post('/reports', {
      target_type: 'post',
      target_id: id,
      reason: 'other',
      details: 'short',
    });
    expect(other.status).toBe(400);

    await api(alice).post(`/users/${bob.id}/follow`);
    const comment = await api(bob).post(`/posts/${id}/comments`, { body: 'Nice photo from the river.' });
    expect(comment.status).toBe(201);

    const inbox = await api(alice).get('/notifications');
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0]).toMatchObject({
      type: 'comment_post',
      post_id: id,
      read: false,
    });
    expect(inbox.body.items[0].text).toContain('bob commented');
    expect((await api(alice).get('/notifications/unread-count')).body.notifications).toBe(1);
    expect((await api(alice).post('/notifications/read-all')).status).toBe(204);
    expect((await api(alice).get('/notifications/unread-count')).body.notifications).toBe(0);
  });
});
