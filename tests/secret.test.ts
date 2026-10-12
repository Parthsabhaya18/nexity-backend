import { randomUUID } from 'node:crypto';

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
import { Encounter, NearbyLocationPing } from '../src/modules/nearby/nearby.models';
import { Notification } from '../src/modules/notifications/notification.model';
import { Block } from '../src/modules/safety/block.model';
import { Report } from '../src/modules/safety/report.model';
import {
  SecretBlock,
  SecretMessage,
  SecretThread,
} from '../src/modules/secret-messages/secret.models';
import { SecretUsage } from '../src/modules/subscriptions/usage.model';
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

const send = (a: Account, recipient: Account, body = 'Honestly, I admire you a lot') =>
  api(a).post('/secret-messages', {
    recipient_id: recipient.id,
    body,
    client_message_id: randomUUID(),
  });

const reply = (a: Account, threadId: string, body: string) =>
  api(a).post(`/secret-messages/${threadId}/messages`, { body, client_message_id: randomUUID() });

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
    Report.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
    SecretThread.deleteMany({}),
    SecretMessage.deleteMany({}),
    SecretBlock.deleteMany({}),
    SecretUsage.deleteMany({}),
    Encounter.deleteMany({}),
    NearbyLocationPing.deleteMany({}),
  ]);
});

describe('plans', () => {
  it('lists three plans and switches plan in development', async () => {
    const alice = await signUp('alice');
    const plans = await api(alice).get('/plans');
    expect(plans.body.data.map((p: { id: string }) => p.id)).toEqual(['free', 'plus', 'premium']);

    expect((await api(alice).get('/subscriptions/me')).body.plan).toBe('free');
    const res = await plan(alice, 'plus');
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('plus');
    expect(res.body.usage.secret_messages_left).toBe(5);
  });
});

describe('secret messages', () => {
  it('blocks sending and reading on Free, with a locked card', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const denied = await send(alice, bob);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PLAN_REQUIRED');

    await plan(alice, 'plus');
    const sent = await send(alice, bob);
    expect(sent.status).toBe(201);
    expect(sent.body.recipient.username).toBe('bob');
    expect(sent.body.usage.secret_messages_left).toBe(4);

    const summary = await api(bob).get('/secret-messages/summary');
    expect(summary.body).toMatchObject({ sealed_count: 1, can_read: false });
    expect(summary.body.locked_items).toHaveLength(1);
    expect(Object.keys(summary.body.locked_items[0]).sort()).toEqual(['day', 'id']);
    expect((await api(bob).get('/secret-messages/inbox')).body.error.code).toBe('PLAN_REQUIRED');

    const notices = await api(bob).get('/notifications');
    const notice = notices.body.items.find(
      (x: { type: string }) => x.type === 'secret_message_received',
    );
    expect(notice.actor).toBeNull();
    expect(JSON.stringify(notice)).not.toContain('alice');
  });

  it('keeps sealed messages hidden and reveals on the second reply', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');
    await plan(bob, 'plus');
    const threadId = (await send(alice, bob, 'Your smile makes my day')).body.id as string;

    const inbox = await api(bob).get('/secret-messages/inbox');
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0].sender).toBeNull();
    expect(JSON.stringify(inbox.body)).not.toContain('alice');

    const sealed = await api(bob).get(`/secret-messages/${threadId}/messages`);
    expect(sealed.body.data[0]).toMatchObject({ from: 'them', sealed: true });
    expect(sealed.body.data[0].body).toBeUndefined();

    const first = await reply(bob, threadId, 'Who is this?');
    expect(first.status).toBe(201);
    expect(first.body.thread.replies_used).toBe(1);
    const senderView = await api(alice).get(`/secret-messages/${threadId}/messages`);
    expect(senderView.body.data.map((m: { body: string }) => m.body)).toEqual([
      'Your smile makes my day',
      'Who is this?',
    ]);

    const second = await reply(bob, threadId, 'Tell me!');
    expect(second.status).toBe(201);
    expect(second.body.sender.username).toBe('alice');
    expect(second.body.revealed_messages[0].body).toBe('Your smile makes my day');
    const conversationId = second.body.thread.conversation_id as string;
    expect(conversationId).toBeTruthy();

    const chat = await Message.find({ conversation_id: conversationId }).sort({ _id: 1 }).lean();
    expect(chat.map((m) => m.body)).toEqual([
      'Started as a Secret Message 💌 — unsealed',
      'Your smile makes my day',
      'Who is this?',
      'Tell me!',
    ]);
    const convo = await Conversation.findById(conversationId).lean();
    expect(convo?.origin).toBe('secret_message');

    const third = await reply(bob, threadId, 'again');
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('SECRET_THREAD_REVEALED');
  });

  it('caps follow-ups, rejects links and refuses a second open thread', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'premium');
    const threadId = (await send(alice, bob)).body.id as string;

    for (let i = 0; i < 3; i += 1) {
      expect((await reply(alice, threadId, `follow ${i}`)).status).toBe(201);
    }
    const capped = await reply(alice, threadId, 'one more');
    expect(capped.status).toBe(429);
    expect(capped.body.error.code).toBe('SECRET_FOLLOWUP_LIMIT');

    const link = await send(alice, await signUp('carol'), 'see https://example.com');
    expect(link.body.error.code).toBe('LINKS_NOT_ALLOWED');

    const again = await send(alice, bob);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      code: 'SECRET_THREAD_EXISTS',
      details: { thread_id: threadId },
    });
  });

  it('enforces the Plus monthly limit and refunds failed sends', async () => {
    const alice = await signUp('alice');
    await plan(alice, 'plus');
    const people = await Promise.all(['person1', 'person2', 'person3', 'person4', 'person5', 'person6'].map(signUp));
    for (const p of people.slice(0, 5)) expect((await send(alice, p)).status).toBe(201);
    const over = await send(alice, people[5]!);
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('is idempotent on client_message_id', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');
    const payload = {
      recipient_id: bob.id,
      body: 'Hello there friend',
      client_message_id: randomUUID(),
    };
    const one = await api(alice).post('/secret-messages', payload);
    const two = await api(alice).post('/secret-messages', payload);
    expect(one.status).toBe(201);
    expect(two.status).toBe(200);
    expect(two.body.id).toBe(one.body.id);
    expect(two.body.usage.secret_messages_left).toBe(4);
  });

  it('refuses blocked users and supports anonymous blocking', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');
    const threadId = (await send(alice, bob)).body.id as string;

    expect((await api(bob).post(`/secret-messages/${threadId}/block-sender`)).status).toBe(204);
    expect((await api(bob).get('/secret-messages/summary')).body.sealed_count).toBe(0);
    await api(alice).del(`/secret-messages/${threadId}`);
    const again = await send(alice, bob);
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('CANNOT_SEND_SECRET');

    const blocks = await api(bob).get('/users/me/secret-blocks');
    expect(blocks.body.data).toHaveLength(1);
    expect(JSON.stringify(blocks.body)).not.toContain('alice');
    await api(bob).del(`/users/me/secret-blocks/${blocks.body.data[0].id as string}`);
    expect((await send(alice, bob)).status).toBe(201);

    const carol = await signUp('carol');
    await api(carol).post(`/users/${alice.id}/block`);
    expect((await send(alice, carol)).body.error.code).toBe('CANNOT_SEND_SECRET');
  });

  it('lets a Free receiver report a locked thread', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');
    const threadId = (await send(alice, bob)).body.id as string;
    const res = await api(bob).post(`/secret-messages/${threadId}/report`, { reason: 'harassment' });
    expect(res.status).toBe(201);
    const row = await Report.findOne({ target_type: 'secret_thread' }).lean();
    expect(row?.target_id).toBe(threadId);
  });
});

describe('nearby', () => {
  it('saves settings and shows a today hint only when both opted in', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await plan(alice, 'plus');
    await plan(bob, 'plus');
    const threadId = (await send(alice, bob)).body.id as string;

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

    let inbox = await api(bob).get('/secret-messages/inbox');
    expect(inbox.body.data[0].nearby_hint).toBeNull();

    for (const a of [alice, bob]) {
      const res = await api(a).patch('/nearby/settings', {
        enabled: true,
        location_enabled: true,
        timezone: 'Asia/Kolkata',
      });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
    }
    inbox = await api(bob).get('/secret-messages/inbox');
    expect(inbox.body.data[0].nearby_hint.state).toBe('today');
    expect(inbox.body.data[0].id).toBe(threadId);

    const location = await api(bob).post('/nearby/location', {
      lat: 23.0225,
      lng: 72.5714,
      accuracy_m: 12,
      captured_at: new Date().toISOString(),
    });
    expect(location.status).toBe(202);
  });

  it('rejects location samples while Nearby is off', async () => {
    const alice = await signUp('alice');
    const res = await api(alice).post('/nearby/location', {
      lat: 23.0225,
      lng: 72.5714,
      accuracy_m: 12,
      captured_at: new Date().toISOString(),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NEARBY_DISABLED');
  });
});
