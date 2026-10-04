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
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();

type Account = { auth: string; id: string; username: string };

async function signUp(username: string, displayName = 'Test User'): Promise<Account> {
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({
      display_name: displayName,
      username,
      email: `${username.replace(/\./g, '')}@example.com`,
      password: 'secretPass1',
      gender: 'woman',
      date_of_birth: '1998-04-12',
      accept_terms: true,
    });
  const verified = await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ email: `${username.replace(/\./g, '')}@example.com`, code: reg.body.dev_code });
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

const counts = async (a: Account) => {
  const res = await api(a).get('/users/me');
  return {
    followers: res.body.followers_count as number,
    following: res.body.following_count as number,
    requests: res.body.follow_requests_count as number,
  };
};

let alice: Account;
let bob: Account;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Promise.all([User.init(), OtpCode.init(), RefreshToken.init(), Follow.init()]);
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
    Follow.deleteMany({}),
  ]);
  alice = await signUp('alice', 'Alice Walker');
  bob = await signUp('bob.smith', 'Bob Smith');
});

describe('follow / unfollow', () => {
  it('follows a public account and updates both counts', async () => {
    const res = await api(alice).post(`/users/${bob.id}/follow`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'accepted' });
    expect(await counts(alice)).toMatchObject({ following: 1, followers: 0 });
    expect(await counts(bob)).toMatchObject({ followers: 1, following: 0 });

    const again = await api(alice).post(`/users/${bob.id}/follow`);
    expect(again.body).toEqual({ status: 'accepted' });
    expect(await counts(bob)).toMatchObject({ followers: 1 });

    expect((await api(alice).del(`/users/${bob.id}/follow`)).status).toBe(204);
    expect(await counts(alice)).toMatchObject({ following: 0 });
    expect(await counts(bob)).toMatchObject({ followers: 0 });

    // Unfollowing twice never drives counts negative.
    await api(alice).del(`/users/${bob.id}/follow`);
    expect(await counts(bob)).toMatchObject({ followers: 0 });
  });

  it('rejects following yourself and unknown users', async () => {
    const self = await api(alice).post(`/users/${alice.id}/follow`);
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_FOLLOW_SELF');

    const missing = await api(alice).post('/users/0123456789abcdef01234567/follow');
    expect(missing.status).toBe(404);

    const invalid = await api(alice).post('/users/not-an-id/follow');
    expect(invalid.status).toBe(400);
  });
});

describe('private accounts', () => {
  beforeEach(async () => {
    await api(bob).patch('/users/me', { is_private: true });
  });

  it('creates a pending request that counts nothing until accepted', async () => {
    const res = await api(alice).post(`/users/${bob.id}/follow`);
    expect(res.body).toEqual({ status: 'pending' });
    expect(await counts(bob)).toEqual({ followers: 0, following: 0, requests: 1 });

    const list = await api(bob).get('/users/me/follow-requests');
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].user).toMatchObject({ username: 'alice', follow_status: 'none' });

    const accepted = await api(bob).post(`/follow-requests/${list.body.items[0].id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.user).toMatchObject({ username: 'alice', follow_status: 'none' });
    expect(await counts(bob)).toEqual({ followers: 1, following: 0, requests: 0 });
    expect(await counts(alice)).toMatchObject({ following: 1 });

    // Accepting twice is harmless.
    await api(bob).post(`/follow-requests/${list.body.items[0].id}/accept`);
    expect(await counts(bob)).toMatchObject({ followers: 1 });
  });

  it('lets the requester cancel and the owner decline', async () => {
    await api(alice).post(`/users/${bob.id}/follow`);
    await api(alice).del(`/users/${bob.id}/follow`);
    expect(await counts(bob)).toMatchObject({ requests: 0 });

    await api(alice).post(`/users/${bob.id}/follow`);
    const { body } = await api(bob).get('/users/me/follow-requests');
    expect((await api(bob).post(`/follow-requests/${body.items[0].id}/decline`)).status).toBe(204);
    expect(await counts(bob)).toEqual({ followers: 0, following: 0, requests: 0 });

    const gone = await api(bob).post(`/follow-requests/${body.items[0].id}/accept`);
    expect(gone.status).toBe(404);
  });

  it('hides lists from non-followers and shows a limited profile', async () => {
    const profile = await api(alice).get('/users/by-username/bob.smith');
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({
      username: 'bob.smith',
      is_private: true,
      follow_status: 'none',
      can_view_content: false,
      is_self: false,
    });

    const followers = await api(alice).get(`/users/${bob.id}/followers`);
    expect(followers.status).toBe(403);
    expect(followers.body.error.code).toBe('PRIVATE_ACCOUNT');

    expect((await api(bob).get(`/users/${bob.id}/followers`)).status).toBe(200);
  });

  it('approves every pending request when the account goes public', async () => {
    const carol = await signUp('carol');
    await api(alice).post(`/users/${bob.id}/follow`);
    await api(carol).post(`/users/${bob.id}/follow`);

    const res = await api(bob).patch('/users/me', { is_private: false });
    expect(res.body).toMatchObject({
      is_private: false,
      followers_count: 2,
      follow_requests_count: 0,
    });
    expect(await counts(alice)).toMatchObject({ following: 1 });
    expect(await counts(carol)).toMatchObject({ following: 1 });
  });
});

describe('profile and lists', () => {
  it('returns the relationship in both directions', async () => {
    await api(bob).post(`/users/${alice.id}/follow`);
    const res = await api(alice).get('/users/by-username/BOB.SMITH');
    expect(res.body).toMatchObject({
      follow_status: 'none',
      follows_you: true,
      can_view_content: true,
    });

    const self = await api(alice).get('/users/by-username/alice');
    expect(self.body).toMatchObject({ is_self: true, follow_status: 'none' });

    expect((await api(alice).get('/users/by-username/nobody.here')).status).toBe(404);
  });

  it('pages followers newest first, filters by name and shows viewer state', async () => {
    const fans: Account[] = [];
    for (const name of ['fan.one', 'fan.two', 'fan.three']) {
      const fan = await signUp(name, `Fan ${name.split('.')[1]}`);
      await api(fan).post(`/users/${bob.id}/follow`);
      fans.push(fan);
    }
    await api(alice).post(`/users/${fans[0]!.id}/follow`);

    const first = await api(alice).get(`/users/${bob.id}/followers?limit=2`);
    expect(first.body.items.map((u: { username: string }) => u.username)).toEqual([
      'fan.three',
      'fan.two',
    ]);
    expect(first.body.next_cursor).toBeTruthy();

    const second = await api(alice).get(
      `/users/${bob.id}/followers?limit=2&cursor=${first.body.next_cursor}`,
    );
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0]).toMatchObject({ username: 'fan.one', follow_status: 'accepted' });
    expect(second.body.next_cursor).toBeNull();

    const filtered = await api(alice).get(`/users/${bob.id}/followers?q=two`);
    expect(filtered.body.items.map((u: { username: string }) => u.username)).toEqual(['fan.two']);

    const following = await api(alice).get(`/users/${fans[1]!.id}/following`);
    expect(following.body.items[0]).toMatchObject({ username: 'bob.smith' });
  });

  it('lets an account remove a follower', async () => {
    await api(alice).post(`/users/${bob.id}/follow`);
    expect((await api(bob).del(`/users/me/followers/${alice.id}`)).status).toBe(204);
    expect(await counts(bob)).toMatchObject({ followers: 0 });
    expect(await counts(alice)).toMatchObject({ following: 0 });
  });
});

describe('GET /search', () => {
  it('finds people by username or name and excludes yourself', async () => {
    await signUp('bobby', 'Robert Jones');
    await api(alice).post(`/users/${bob.id}/follow`);

    const byUsername = await api(alice).get('/search?q=@bob');
    expect(byUsername.status).toBe(200);
    const names = byUsername.body.users.map((u: { username: string }) => u.username);
    expect(names).toEqual(['bob.smith', 'bobby']);
    expect(byUsername.body.users[0]).toMatchObject({ follow_status: 'accepted' });

    const byName = await api(alice).get('/search?q=jones');
    expect(byName.body.users.map((u: { username: string }) => u.username)).toEqual(['bobby']);

    const byPart = await api(alice).get('/search?q=smith');
    expect(byPart.body.users.map((u: { username: string }) => u.username)).toEqual([
      'bob.smith',
    ]);

    const self = await api(alice).get('/search?q=alice');
    expect(self.body.users).toEqual([]);

    const empty = await api(alice).get('/search?q=');
    expect(empty.body.users).toEqual([]);

    const regexy = await api(alice).get(`/search?q=${encodeURIComponent('.*')}`);
    expect(regexy.body.users).toEqual([]);
  });
});

describe('GET /users/suggestions', () => {
  it('suggests other people, then hides followed and blocked accounts', async () => {
    const cara = await signUp('cara.lee', 'Cara Lee');

    const suggested = await api(alice).get('/users/suggestions');
    expect(suggested.status).toBe(200);
    const names = suggested.body.users.map((u: { username: string }) => u.username);
    expect(names).toEqual(['bob.smith', 'cara.lee']);
    expect(suggested.body.users[0]).toMatchObject({
      display_name: 'Bob Smith',
      follow_status: 'none',
      is_self: false,
    });

    await api(alice).post(`/users/${bob.id}/follow`);
    const afterFollow = await api(alice).get('/users/suggestions');
    expect(afterFollow.body.users.map((u: { username: string }) => u.username)).toEqual([
      'cara.lee',
    ]);

    expect((await api(alice).post(`/users/${cara.id}/block`)).status).toBe(204);
    const afterBlock = await api(alice).get('/users/suggestions');
    expect(afterBlock.body.users).toEqual([]);
  });
});
