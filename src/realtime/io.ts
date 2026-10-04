import type { Server as HttpServer } from 'node:http';

import { isValidObjectId } from 'mongoose';
import { type DefaultEventsMap, Server, type Socket } from 'socket.io';

import { env } from '../config/env';
import { authenticateAccessToken } from '../middlewares/requireAuth';
import { User } from '../modules/users/user.model';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

export const CHAT_SOCKET_PATH = '/ws/v1/chat';

const MAX_PRESENCE_SUBSCRIPTIONS = 200;

export interface SocketData {
  userId: string;
}

export type ChatSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

let io: Server | null = null;
/** Open sockets per user on this instance. Multi-instance deployments need the Redis adapter. */
const connections = new Map<string, number>();

const userRoom = (userId: string) => `user:${userId}`;
const presenceRoom = (userId: string) => `presence:${userId}`;

/**
 * A user whose last socket dropped stays "online" this long, so app reloads, network
 * switches and server restarts don't flash "Active 1m ago" for someone who is still here.
 */
const OFFLINE_GRACE_MS = env.PRESENCE_OFFLINE_GRACE_MS;
const pendingOffline = new Map<string, ReturnType<typeof setTimeout>>();

export const isOnline = (userId: string) =>
  (connections.get(userId) ?? 0) > 0 || pendingOffline.has(userId);

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(userRoom(userId)).emit(event, payload);
}

function emitPresence(userId: string, online: boolean, lastActiveAt: Date | null) {
  io?.to(presenceRoom(userId)).emit('presence.update', {
    user_id: userId,
    is_online: online,
    last_active_at: lastActiveAt ? lastActiveAt.toISOString() : null,
  });
}

async function authenticate(socket: ChatSocket, next: (err?: Error) => void) {
  try {
    const raw: unknown = socket.handshake.auth?.token;
    if (typeof raw !== 'string' || !raw) throw ApiError.unauthorized('Missing access token');
    const user = await authenticateAccessToken(raw);
    socket.data.userId = user.id as string;
    next();
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : null;
    const error = new Error(apiErr?.message ?? 'Unauthorized') as Error & { data?: unknown };
    error.data = { code: apiErr?.code ?? 'UNAUTHORIZED' };
    if (!apiErr) logger.error({ err }, 'Socket authentication failed');
    next(error);
  }
}

function trackPresence(socket: ChatSocket) {
  const { userId } = socket.data;
  const count = (connections.get(userId) ?? 0) + 1;
  connections.set(userId, count);
  const pending = pendingOffline.get(userId);
  if (pending) {
    // Came back within the grace window: observers never saw them leave.
    clearTimeout(pending);
    pendingOffline.delete(userId);
  } else if (count === 1) {
    emitPresence(userId, true, null);
  }

  socket.on('disconnect', () => {
    const left = (connections.get(userId) ?? 1) - 1;
    if (left > 0) {
      connections.set(userId, left);
      return;
    }
    connections.delete(userId);
    pendingOffline.set(
      userId,
      setTimeout(() => {
        pendingOffline.delete(userId);
        if (isOnline(userId)) return;
        const now = new Date();
        emitPresence(userId, false, now);
        User.updateOne({ _id: userId }, { $set: { last_active_at: now } }).catch(
          (err: unknown) => logger.warn({ err, userId }, 'Could not store last_active_at'),
        );
      }, OFFLINE_GRACE_MS),
    );
  });

  /** Client asks to follow the online status of the people on screen; ack returns their current status. */
  socket.on('presence.subscribe', async (payload: unknown, ack?: unknown) => {
    const ids = Array.isArray((payload as { user_ids?: unknown })?.user_ids)
      ? ((payload as { user_ids: unknown[] }).user_ids.filter(
          (id) => typeof id === 'string' && isValidObjectId(id),
        ) as string[])
      : [];
    const unique = [...new Set(ids)].slice(0, MAX_PRESENCE_SUBSCRIPTIONS);
    for (const id of unique) void socket.join(presenceRoom(id));

    if (typeof ack !== 'function') return;
    const users = await User.find({ _id: { $in: unique } })
      .select('_id last_active_at')
      .lean();
    (ack as (data: unknown) => void)({
      data: users.map((u) => ({
        user_id: u._id.toString(),
        is_online: isOnline(u._id.toString()),
        last_active_at: u.last_active_at ? u.last_active_at.toISOString() : null,
      })),
    });
  });
}

export function attachRealtime(server: HttpServer, onConnection: (socket: ChatSocket) => void) {
  io = new Server(server, {
    path: CHAT_SOCKET_PATH,
    serveClient: false,
    cors: { origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS },
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use((socket, next) => void authenticate(socket as ChatSocket, next));

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as ChatSocket;
    void socket.join(userRoom(socket.data.userId));
    trackPresence(socket);
    onConnection(socket);
  });

  logger.info(`Chat socket ready at ${CHAT_SOCKET_PATH}`);
  return io;
}

/** Drops every socket so the HTTP server can finish closing. */
export function closeRealtime() {
  io?.disconnectSockets(true);
  io = null;
  connections.clear();
  pendingOffline.forEach(clearTimeout);
  pendingOffline.clear();
}
