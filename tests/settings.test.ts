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
import { SupportTicket } from '../src/modules/support/supportTicket.model';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();
const PASSWORD = 'secretPass1';

async function signUp(username: string) {
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({
      display_name: 'Test User',
      username,
      email: `${username}@example.com`,
      password: PASSWORD,
      gender: 'woman',
      date_of_birth: '1998-04-12',
      accept_terms: true,
    });
  const verified = await request(app)
    .post('/api/v1/auth/verify-email')
    .set('X-Platform', 'android')
    .send({ email: `${username}@example.com`, code: reg.body.dev_code });
  return {
    auth: `Bearer ${verified.body.access_token as string}`,
    id: verified.body.user.id as string,
    refresh: verified.body.refresh_token as string,
  };
}

const login = (identifier: string, password = PASSWORD) =>
  request(app).post('/api/v1/auth/login').set('X-Platform', 'ios').send({ identifier, password });

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
    Follow.deleteMany({}),
    SupportTicket.deleteMany({}),
  ]);
});

describe('privacy and notification settings', () => {
  it('returns defaults and saves changes', async () => {
    const { auth } = await signUp('settings_a');
    const me = await request(app).get('/api/v1/users/me').set('Authorization', auth);
    expect(me.body.privacy).toEqual({ show_activity_status: true, message_privacy: 'everyone' });
    expect(me.body.notification_settings).toEqual({
      paused: false,
      comments: true,
      story_likes: true,
    });

    const updated = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', auth)
      .send({ show_activity_status: false, message_privacy: 'following' });
    expect(updated.status).toBe(200);
    expect(updated.body.privacy).toEqual({
      show_activity_status: false,
      message_privacy: 'following',
    });

    const notif = await request(app)
      .patch('/api/v1/users/me/notification-settings')
      .set('Authorization', auth)
      .send({ comments: false });
    expect(notif.body).toEqual({ paused: false, comments: false, story_likes: true });
  });

  it('blocks messages from people the recipient does not follow', async () => {
    const a = await signUp('sender_a');
    const b = await signUp('receiver_b');
    await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', b.auth)
      .send({ message_privacy: 'following' });

    const convo = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', a.auth)
      .send({ type: 'direct', participant_ids: [b.id] });
    const send = () =>
      request(app)
        .post(`/api/v1/conversations/${convo.body.id as string}/messages`)
        .set('Authorization', a.auth)
        .send({ body: 'hi', client_message_id: crypto.randomUUID() });

    const blocked = await send();
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MESSAGES_RESTRICTED');

    await request(app).post(`/api/v1/users/${a.id}/follow`).set('Authorization', b.auth);
    expect((await send()).status).toBe(201);
  });
});

describe('password, sessions and account', () => {
  it('changes the password and signs out other devices', async () => {
    const { auth } = await signUp('pw_user');
    const other = await login('pw_user');
    expect(other.status).toBe(200);

    const wrong = await request(app)
      .post('/api/v1/users/me/password')
      .set('Authorization', auth)
      .send({ current_password: 'nope12345', new_password: 'newSecret22' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_PASSWORD');

    const ok = await request(app)
      .post('/api/v1/users/me/password')
      .set('Authorization', auth)
      .send({ current_password: PASSWORD, new_password: 'newSecret22' });
    expect(ok.status).toBe(200);
    expect(ok.body.access_token).toBeTruthy();

    const refreshOther = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: other.body.refresh_token });
    expect(refreshOther.status).toBe(401);

    const fresh = `Bearer ${ok.body.access_token as string}`;
    expect((await request(app).get('/api/v1/users/me').set('Authorization', fresh)).status).toBe(
      200,
    );
    expect((await login('pw_user', 'newSecret22')).status).toBe(200);
  });

  it('lists sessions and logs out other devices', async () => {
    const { auth } = await signUp('sess_user');
    await login('sess_user');

    const list = await request(app).get('/api/v1/users/me/sessions').set('Authorization', auth);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0]).toMatchObject({ current: true, device: 'Android phone' });
    expect(list.body.items[1]).toMatchObject({ current: false, device: 'iPhone' });

    const self = await request(app)
      .delete(`/api/v1/users/me/sessions/${list.body.items[0].id as string}`)
      .set('Authorization', auth);
    expect(self.status).toBe(400);

    await request(app).delete('/api/v1/users/me/sessions').set('Authorization', auth);
    const after = await request(app).get('/api/v1/users/me/sessions').set('Authorization', auth);
    expect(after.body.items).toHaveLength(1);
    expect(after.body.items[0].current).toBe(true);
  });

  it('deletes the account and releases the username', async () => {
    const a = await signUp('leaving');
    const b = await signUp('friend_b');
    await request(app).post(`/api/v1/users/${b.id}/follow`).set('Authorization', a.auth);
    expect((await User.findById(b.id))!.followers_count).toBe(1);

    const wrong = await request(app)
      .delete('/api/v1/users/me')
      .set('Authorization', a.auth)
      .send({ password: 'wrongPass1' });
    expect(wrong.status).toBe(400);

    const gone = await request(app)
      .delete('/api/v1/users/me')
      .set('Authorization', a.auth)
      .send({ password: PASSWORD });
    expect(gone.status).toBe(204);

    expect((await User.findById(b.id))!.followers_count).toBe(0);
    expect((await request(app).get('/api/v1/users/me').set('Authorization', a.auth)).status).toBe(
      401,
    );
    expect((await login('leaving')).status).toBe(401);
    const available = await request(app)
      .get('/api/v1/auth/username-available')
      .query({ username: 'leaving' });
    expect(available.body.available).toBe(true);
  });
});

describe('support tickets', () => {
  it('creates and lists my requests', async () => {
    const { auth } = await signUp('needs_help');
    const bad = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', auth)
      .send({ subject: 'Account', message: 'short' });
    expect(bad.status).toBe(400);

    const created = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', auth)
      .send({ subject: 'Report a bug', message: 'The feed does not refresh after posting.' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ subject: 'Report a bug', status: 'pending' });
    expect(created.body.reference).toMatch(/^NX-[0-9A-F]{6}$/);

    const mine = await request(app).get('/api/v1/support/tickets').set('Authorization', auth);
    expect(mine.body.items).toHaveLength(1);

    const one = await request(app)
      .get(`/api/v1/support/tickets/${created.body.id as string}`)
      .set('Authorization', auth);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: created.body.id, status: 'pending' });
    expect(one.body.updated_at).toEqual(expect.any(String));

    const other = await signUp('someone_else');
    const hidden = await request(app)
      .get(`/api/v1/support/tickets/${created.body.id as string}`)
      .set('Authorization', other.auth);
    expect(hidden.status).toBe(404);
  });

  it('attaches up to four screenshots and keeps them from being deleted', async () => {
    const { auth, id } = await signUp('with_shot');
    const makeShot = (n: number, purpose: 'support' | 'message' = 'support') =>
      Media.create({
        owner_id: id,
        purpose,
        kind: 'image',
        key: `media/support/${id}/shot${n}.jpg`,
        content_type: 'image/jpeg',
        bytes: 1234,
        status: 'ready',
        upload_expires_at: new Date(),
      });
    const shots = await Promise.all([1, 2, 3, 4, 5].map((n) => makeShot(n)));
    const send = (ids: string[]) =>
      request(app)
        .post('/api/v1/support/tickets')
        .set('Authorization', auth)
        .send({
          subject: 'Report a bug',
          message: 'The screenshots show the broken screen.',
          screenshot_media_ids: ids,
        });

    const tooMany = await send(shots.map((s) => s.id as string));
    expect(tooMany.status).toBe(400);

    const chatPhoto = await makeShot(6, 'message');
    const wrongKind = await send([chatPhoto.id as string]);
    expect(wrongKind.status).toBe(400);
    expect(wrongKind.body.error.code).toBe('INVALID_SCREENSHOT');

    const created = await send(shots.slice(0, 4).map((s) => s.id as string));
    expect(created.status).toBe(201);
    expect(created.body.screenshot_urls).toEqual(
      [1, 2, 3, 4].map((n) => `https://cdn.test/media/support/${id}/shot${n}.jpg`),
    );

    const removed = await request(app)
      .delete(`/api/v1/media/${shots[0]!.id as string}`)
      .set('Authorization', auth);
    expect(removed.status).toBe(409);
  });

  it('refuses support screenshots over 5 MB', async () => {
    const { auth } = await signUp('big_shot');
    const res = await request(app)
      .post('/api/v1/media/uploads')
      .set('Authorization', auth)
      .send({ purpose: 'support', content_type: 'image/jpeg', bytes: 5 * 1024 * 1024 + 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_TOO_LARGE');
  });
});
