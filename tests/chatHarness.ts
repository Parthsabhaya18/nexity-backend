import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { signAccessToken } from '../src/modules/auth/tokens';
import { Conversation } from '../src/modules/messages/conversation.model';
import { Message } from '../src/modules/messages/message.model';
import { registerChatHandlers } from '../src/modules/messages/messages.socket';
import { User } from '../src/modules/users/user.model';
import { attachRealtime, CHAT_SOCKET_PATH, closeRealtime } from '../src/realtime/io';

export type Person = { id: string; token: string; username: string };

export const app = createApp();
let mongo: MongoMemoryServer;
let server: Server;
let baseUrl = '';
const sockets: Socket[] = [];

/** Spins up Mongo, the HTTP server and the chat socket once per test file; wipes data per test. */
export function useChatHarness() {
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await connectDatabase(mongo.getUri());
    await Promise.all([User.init(), Conversation.init(), Message.init()]);
    server = createServer(app);
    attachRealtime(server, registerChatHandlers);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    sockets.splice(0).forEach((s) => s.disconnect());
    closeRealtime();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectDatabase();
    await mongo?.stop();
  });

  beforeEach(async () => {
    sockets.splice(0).forEach((s) => s.disconnect());
    await Promise.all([User.deleteMany({}), Conversation.deleteMany({}), Message.deleteMany({})]);
  });
}

export async function person(
  username: string,
  overrides: Partial<{ is_verified: boolean; status: 'active' | 'disabled'; is_private: boolean; bio: string }> = {},
): Promise<Person> {
  const user = await User.create({
    email: `${username}@example.com`,
    username,
    display_name: username.replace('.', ' '),
    password_hash: 'x',
    gender: 'prefer_not_to_say',
    date_of_birth: new Date('1998-01-01'),
    is_verified: true,
    ...overrides,
  });
  return { id: user.id as string, token: signAccessToken(user.id as string), username };
}

export const api = (who: Person) => ({
  get: (url: string) =>
    request(app).get(`/api/v1${url}`).set('Authorization', `Bearer ${who.token}`),
  post: (url: string, body: object = {}) =>
    request(app).post(`/api/v1${url}`).set('Authorization', `Bearer ${who.token}`).send(body),
  put: (url: string, body: object = {}) =>
    request(app).put(`/api/v1${url}`).set('Authorization', `Bearer ${who.token}`).send(body),
  patch: (url: string, body: object = {}) =>
    request(app).patch(`/api/v1${url}`).set('Authorization', `Bearer ${who.token}`).send(body),
  delete: (url: string) =>
    request(app).delete(`/api/v1${url}`).set('Authorization', `Bearer ${who.token}`),
});

export async function openChat(a: Person, b: Person) {
  const res = await api(a).post('/conversations', { participant_ids: [b.id] });
  return res.body.id as string;
}

export async function send(
  who: Person,
  conversationId: string,
  body: Record<string, unknown> | string,
) {
  const payload = typeof body === 'string' ? { body } : body;
  return api(who).post(`/conversations/${conversationId}/messages`, {
    client_message_id: randomUUID(),
    ...payload,
  });
}

export function socketFor(who: Person | null, token?: string) {
  const socket = connect(baseUrl, {
    path: CHAT_SOCKET_PATH,
    transports: ['websocket'],
    auth: token !== undefined ? { token } : who ? { token: who.token } : {},
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return socket;
}

export const connected = (socket: Socket) =>
  new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });

export const nextEvent = <T>(socket: Socket, event: string, timeoutMs = 3000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

/** Resolves true if the event does NOT arrive within the window. */
export const noEvent = (socket: Socket, event: string, windowMs = 400) =>
  new Promise<boolean>((resolve) => {
    const handler = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(true);
    }, windowMs);
    socket.once(event, handler);
  });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
