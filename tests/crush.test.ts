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
import { Conversation } from '../src/modules/messages/conversation.model';
import { Message } from '../src/modules/messages/message.model';
import { pairKeyOf } from '../src/modules/nearby/nearby.encounters';
import { Encounter } from '../src/modules/nearby/nearby.models';
import { Notification } from '../src/modules/notifications/notification.model';
import { Block } from '../src/modules/safety/block.model';
import {
  Crush,
  CrushAdmirerCount,
  CrushMatch,
} from '../src/modules/secret-crush/crush.models';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();

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
  patch: (path: string, body?: object) =>
    request(app).patch(`/api/v1${path}`).set('Authorization', a.auth).send(body ?? {}),
  del: (path: string) => request(app).delete(`/api/v1${path}`).set('Authorization', a.auth),
});

const plan = (a: Account, id: 'free' | 'plus' | 'premium') =>
  api(a).post('/subscriptions/dev/activate', { plan: id });
const add = (a: Account, b: Account) => api(a).post('/secret-crushes', { user_id: b.id });

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
    OtpCode.deleteMany({}),
    RefreshToken.deleteMany({}),
    Notification.deleteMany({}),
    Block.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
    Crush.deleteMany({}),
    CrushMatch.deleteMany({}),
    CrushAdmirerCount.deleteMany({}),
    Encounter.deleteMany({}),
  ]);
});

describe('secret crush', () => {
  it('needs a plan to add, but Free users are told and see the count', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');

    const denied = await add(alice, bob);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PLAN_REQUIRED');

    await plan(alice, 'plus');
    const ok = await add(alice, bob);
    expect(ok.status).toBe(201);
    expect(ok.body.matched).toBe(false);
    expect(ok.body.crush.user.id).toBe(bob.id);

    const summary = await api(bob).get('/secret-crushes/summary');
    expect(summary.body.admirers_count).toBe(1);
    expect(summary.body.can_add).toBe(false);

    const notes = await api(bob).get('/notifications');
    const note = notes.body.items.find((n: { type: string }) => n.type === 'crush_added');
    expect(note.text).toBe('Someone added you as a Secret Crush 👀');
    expect(note.actor).toBeNull();
    expect(note.anonymous).toBe(true);

    const mine = await api(alice).get('/secret-crushes');
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].status).toBe('active');
    expect((await api(alice).get(`/secret-crushes/status/${bob.id}`)).body.state).toBe('active');
  });

  it('rejects self, duplicates and re-adds within 24 h, and never notifies twice', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');

    expect((await api(alice).post('/secret-crushes', { user_id: alice.id })).body.error.code).toBe(
      'CANNOT_CRUSH_SELF',
    );
    expect((await add(alice, bob)).status).toBe(201);
    const dup = await add(alice, bob);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_CRUSH');

    expect((await api(alice).del(`/secret-crushes/${bob.id}`)).status).toBe(204);
    const cooldown = await add(alice, bob);
    expect(cooldown.status).toBe(429);
    expect(cooldown.body.error.code).toBe('CRUSH_COOLDOWN');

    await Crush.updateOne(
      { status: 'removed' },
      { $set: { removed_at: new Date(Date.now() - 25 * 3_600_000) } },
    );
    expect((await add(alice, bob)).status).toBe(201);
    const notices = await Notification.countDocuments({ type: 'crush_added' });
    expect(notices).toBe(1);
  });

  it('limits spots by plan', async () => {
    const alice = await signUp('alice');
    const others = await Promise.all(['bobby1', 'bobby2', 'bobby3', 'bobby4'].map(signUp));
    await plan(alice, 'plus');
    for (const o of others.slice(0, 3)) expect((await add(alice, o)).status).toBe(201);
    const full = await add(alice, others[3]!);
    expect(full.status).toBe(403);
    expect(full.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(full.body.error.details.limit).toBe(3);

    const summary = await api(alice).get('/secret-crushes/summary');
    expect(summary.body.spots).toEqual({ limit: 3, used: 3, left: 0 });
  });

  it('matches mutual crushes once, opens a love chat and celebrates once', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');
    await plan(bob, 'premium');

    expect((await add(alice, bob)).body.matched).toBe(false);
    const res = await add(bob, alice);
    expect(res.status).toBe(201);
    expect(res.body.matched).toBe(true);
    expect(res.body.match.user.id).toBe(alice.id);
    const { id: matchId, conversation_id: conversationId } = res.body.match;
    expect(conversationId).toBeTruthy();

    expect(await CrushMatch.countDocuments()).toBe(1);
    const convo = await Conversation.findById(conversationId).lean();
    expect(convo?.theme).toBe('love');
    expect(convo?.origin).toBe('secret_crush_match');
    const line = await Message.findOne({ conversation_id: conversationId, type: 'system' }).lean();
    expect(line?.body).toBe('You matched via Secret Crush 💘');

    for (const a of [alice, bob]) {
      const notes = await api(a).get('/notifications');
      const note = notes.body.items.find((n: { type: string }) => n.type === 'crush_match');
      expect(note.crush_match_id).toBe(matchId);
      expect(note.text).toContain('are a match 💘');

      const summary = await api(a).get('/secret-crushes/summary');
      expect(summary.body.matches_count).toBe(1);
      expect(summary.body.pending_celebration_match_id).toBe(matchId);
      // The matched crush frees the spot and leaves the list.
      expect(summary.body.spots.used).toBe(0);
      expect((await api(a).get('/secret-crushes')).body.data).toHaveLength(0);
    }

    const detail = await api(alice).get(`/secret-crushes/matches/${matchId}`);
    expect(detail.body.user.id).toBe(bob.id);
    expect(detail.body.me.id).toBe(alice.id);
    expect(detail.body.celebrated).toBe(false);
    expect((await api(alice).post(`/secret-crushes/matches/${matchId}/celebrated`)).status).toBe(204);
    expect((await api(alice).get('/secret-crushes/summary')).body.pending_celebration_match_id).toBeNull();

    const conv = await api(alice).get(`/conversations/${conversationId}`);
    if (conv.status === 200) expect(conv.body.theme).toBe('love');

    const remove = await api(alice).del(`/secret-crushes/${bob.id}`);
    expect(remove.status).toBe(409);
    expect(remove.body.error.code).toBe('CRUSH_MATCHED');
    expect((await api(alice).get(`/secret-crushes/status/${bob.id}`)).body.state).toBe('matched');

    const stranger = await signUp('carol');
    expect((await api(stranger).get(`/secret-crushes/matches/${matchId}`)).status).toBe(404);
  });

  it('creates exactly one match when both add at the same moment', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');
    await plan(bob, 'plus');
    const results = await Promise.all([add(alice, bob), add(bob, alice)]);
    expect(results.some((r) => r.body.matched)).toBe(true);
    expect(await CrushMatch.countDocuments()).toBe(1);
    expect(await Conversation.countDocuments()).toBe(1);
    expect(await Notification.countDocuments({ type: 'crush_match' })).toBe(2);
    const states = await Crush.find().lean();
    expect(states.every((c) => c.status === 'matched')).toBe(true);
  });

  it('pauses crushes when the plan ends and matches on re-subscribe', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');
    await add(alice, bob);
    await plan(alice, 'free');
    expect((await api(alice).get('/secret-crushes')).body.data[0].status).toBe('paused');

    await plan(bob, 'plus');
    const res = await add(bob, alice);
    expect(res.body.matched).toBe(false);
    expect(await CrushMatch.countDocuments()).toBe(0);

    await plan(alice, 'plus');
    expect(await CrushMatch.countDocuments()).toBe(1);
    expect((await api(bob).get('/secret-crushes/summary')).body.matches_count).toBe(1);
  });

  it('blocks hide matches and stop adds', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');
    await plan(bob, 'plus');
    await Block.create({ blocker_id: bob.id, blocked_id: alice.id });
    const denied = await add(alice, bob);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('CANNOT_ADD_CRUSH');
  });

  it('shows a today hint on my crush row when both opted in to Nearby', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');
    await add(alice, bob);

    const now = new Date();
    const pair = pairKeyOf(alice.id, bob.id);
    await Encounter.create({
      pair_key: pair,
      participant_a: pair.split(':')[0],
      participant_b: pair.split(':')[1],
      detected_at: now,
      last_detected_at: now,
      source: 'location',
      validation_status: 'verified',
      expires_at: new Date(now.getTime() + 2 * 86_400_000),
    });
    expect((await api(alice).get('/secret-crushes')).body.data[0].nearby_hint).toBeNull();
    for (const a of [alice, bob]) {
      await api(a).patch('/nearby/settings', {
        enabled: true,
        location_enabled: true,
        timezone: 'Asia/Kolkata',
      });
    }
    const list = await api(alice).get('/secret-crushes');
    expect(list.body.data[0].nearby_hint.state).toBe('today');
    // Never on the admirer side.
    const summary = await api(bob).get('/secret-crushes/summary');
    expect(summary.body).not.toHaveProperty('nearby_hint');
  });
});
