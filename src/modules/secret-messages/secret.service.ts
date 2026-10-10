import { randomInt, randomUUID } from 'node:crypto';

import mongoose, { isValidObjectId, Types } from 'mongoose';

import { env } from '../../config/env';
import { emitToUser } from '../../realtime/io';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { importRevealedSecret } from '../messages/messages.service';
import { hintsFor, type NearbyHint } from '../nearby/nearby.hints';
import { dayKey } from '../nearby/nearby.time';
import { notifySystem } from '../notifications/notification.service';
import { Notification } from '../notifications/notification.model';
import { isBlockedEither } from '../safety/block.service';
import { type REPORT_REASONS, Report } from '../safety/report.model';
import { MONGO_DUPLICATE_KEY } from '../../utils/mongo';
import {
  entitlementOf,
  planRequired,
  reserveSecretMessage,
  secretUsage,
} from '../subscriptions/entitlement.service';
import {
  PUBLIC_USER_FIELDS,
  type PublicUserSource,
  toPublicUserDto,
  User,
  type UserDoc,
  withAvatarUrls,
} from '../users/user.model';
import { decryptBody, encryptBody } from './secret.crypto';
import {
  SecretBlock,
  SecretMessage,
  type SecretMessageAttrs,
  SecretThread,
  type SecretThreadAttrs,
} from './secret.models';

export const FIRST_MIN = 3;
export const FIRST_MAX = 300;
export const BODY_MAX = 500;
export const MAX_FOLLOWUPS = 3;
const ARCHIVE_AFTER_MS = 30 * 86_400_000;
const FOLLOWUP_NOTICE_GAP_MS = 60 * 60_000;
const LIST_MAX = 50;

export const RECEIVED_NOTICE = 'Someone is trying to reach you with a Secret Message 💌';
const FOLLOWUP_NOTICE = 'Someone sent you another secret message 💌';

/**
 * http(s)://, www., or a domain that continues into a path or query.
 * A bare name such as "nexity.in" in a sentence is not treated as a link.
 */
const LINK_PATTERN =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|net|org|io|co|me|app|ly|gg|xyz|info|link|site)[/?#]|\.[a-z]{2,6}\/)/i;

const isDuplicateKey = (err: unknown) =>
  err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY;

const notFound = () => ApiError.notFound('This secret message is no longer available.');
const cannotSend = () =>
  ApiError.forbidden("You can't send a Secret Message to this person.", 'CANNOT_SEND_SECRET');

/** Random 30–120 s, so a notice's arrival can't be matched to the sender's activity. */
const noticeDelayMs = () => (env.NODE_ENV === 'test' ? 0 : randomInt(30_000, 120_001));

function later(ms: number, task: () => void) {
  if (ms <= 0) {
    task();
    return;
  }
  setTimeout(task, ms).unref();
}

function checkBody(body: string, min: number, max: number) {
  const text = body.trim();
  if (text.length < min || text.length > max) {
    throw ApiError.badRequest(
      min > 1
        ? `Write between ${min} and ${max} characters.`
        : `Messages can be up to ${max} characters.`,
      { field: 'body' },
      'VALIDATION_ERROR',
    );
  }
  if (LINK_PATTERN.test(text)) {
    throw ApiError.badRequest(
      "Links aren't allowed in Secret Messages.",
      { field: 'body' },
      'LINKS_NOT_ALLOWED',
    );
  }
  return text;
}

/** Sealed threads nobody replied to for 30 days are archived (hidden from both lists). */
const notArchived = (now = new Date()) => [
  { status: 'revealed' as const },
  { replies_used: { $gt: 0 } },
  { created_at: { $gt: new Date(now.getTime() - ARCHIVE_AFTER_MS) } },
];

const liveFilter = (now = new Date()) => ({
  status: { $in: ['sealed' as const, 'revealed' as const] },
  $or: notArchived(now),
});

const isLive = (t: SecretThreadAttrs, now = new Date()) =>
  (t.status === 'sealed' || t.status === 'revealed') &&
  (t.status === 'revealed' ||
    t.replies_used > 0 ||
    t.created_at.getTime() > now.getTime() - ARCHIVE_AFTER_MS);

async function secretBlockedSenders(userId: Types.ObjectId) {
  const rows = await SecretBlock.find({ blocker_id: userId }).select('blocked_id').lean();
  return rows.map((r) => r.blocked_id);
}

async function loadUsers(ids: readonly Types.ObjectId[]) {
  if (!ids.length) return new Map<string, PublicUserSource & { status?: string }>();
  const users = await withAvatarUrls(
    await User.find({ _id: { $in: ids } })
      .select(`${PUBLIC_USER_FIELDS} status`)
      .lean<(PublicUserSource & { status?: string })[]>(),
  );
  return new Map(users.map((u) => [u._id.toString(), u]));
}

type Role = 'sent' | 'received';

const roleOf = (t: SecretThreadAttrs, userId: Types.ObjectId): Role | null =>
  t.sender_id.equals(userId) ? 'sent' : t.recipient_id.equals(userId) ? 'received' : null;

const otherOf = (t: SecretThreadAttrs, role: Role) =>
  role === 'sent' ? t.recipient_id : t.sender_id;

type Ctx = {
  viewer: UserDoc;
  users: Map<string, PublicUserSource & { status?: string }>;
  hints: Map<string, NearbyHint>;
};

const publicUser = (u: PublicUserSource | undefined) => {
  if (!u) return null;
  const dto = toPublicUserDto(u);
  return {
    id: dto.id,
    username: dto.username,
    display_name: dto.display_name,
    avatar_url: dto.avatar_url,
  };
};

/** The receiver's sealed view carries no sender, no text, no length and no exact time. */
function threadDto(t: SecretThreadAttrs, role: Role, ctx: Ctx) {
  const tz = ctx.viewer.nearby?.timezone;
  const other = otherOf(t, role);
  const hint = ctx.hints.get(other.toString()) ?? null;
  const day = dayKey(t.created_at, tz);
  const conversationId = t.conversation_id ? t.conversation_id.toString() : null;

  if (role === 'received') {
    const unread = Boolean(
      t.status === 'sealed' &&
        t.last_sender_message_at &&
        (!t.recipient_last_read_at || t.last_sender_message_at > t.recipient_last_read_at),
    );
    if (t.status === 'sealed') {
      return {
        id: t.public_id,
        role,
        status: 'sealed' as const,
        replies_used: t.replies_used,
        has_unread: unread,
        day,
        sender: null,
        conversation_id: null,
        revealed_at: null,
        nearby_hint: hint,
      };
    }
    return {
      id: t.public_id,
      role,
      status: 'revealed' as const,
      replies_used: 2,
      has_unread: false,
      day,
      sender: publicUser(ctx.users.get(other.toString())),
      conversation_id: conversationId,
      revealed_at: t.revealed_at ? t.revealed_at.toISOString() : null,
      nearby_hint: hint,
    };
  }

  return {
    id: t.public_id,
    role,
    status: t.status === 'revealed' ? ('revealed' as const) : ('sealed' as const),
    recipient: publicUser(ctx.users.get(other.toString())),
    replies_received: t.status === 'revealed' ? 2 : t.replies_used,
    followups_left:
      t.status === 'sealed' ? Math.max(0, MAX_FOLLOWUPS - t.sender_followups_unanswered) : 0,
    has_unread: Boolean(
      t.last_recipient_message_at &&
        (!t.sender_last_read_at || t.last_recipient_message_at > t.sender_last_read_at),
    ),
    day,
    created_at: t.created_at.toISOString(),
    conversation_id: conversationId,
    revealed_at: t.revealed_at ? t.revealed_at.toISOString() : null,
    nearby_hint: hint,
  };
}

export type SecretThreadDto = ReturnType<typeof threadDto>;

async function contextFor(viewer: UserDoc, threads: SecretThreadAttrs[]): Promise<Ctx> {
  const others = threads.flatMap((t) => {
    const role = roleOf(t, viewer._id);
    return role ? [otherOf(t, role)] : [];
  });
  // Sealed senders are never loaded for the receiver.
  const visible = threads.flatMap((t) => {
    const role = roleOf(t, viewer._id);
    if (!role) return [];
    if (role === 'received' && t.status !== 'revealed') return [];
    return [otherOf(t, role)];
  });
  const [users, hints] = await Promise.all([loadUsers(visible), hintsFor(viewer, others)]);
  return { viewer, users, hints };
}

const decodeOffset = (cursor?: string) => {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString());
  if (!Number.isInteger(n) || n < 0) {
    throw ApiError.badRequest('Invalid cursor', undefined, 'INVALID_CURSOR');
  }
  return n;
};
const encodeOffset = (n: number) => Buffer.from(String(n)).toString('base64url');

type Page = { cursor?: string; limit: number };

async function receivedFilter(viewer: UserDoc, now = new Date()) {
  const blocked = await secretBlockedSenders(viewer._id);
  return {
    recipient_id: viewer._id,
    recipient_hidden: false,
    ...(blocked.length ? { sender_id: { $nin: blocked } } : {}),
    ...liveFilter(now),
  };
}

/** Deleted or disabled senders' threads disappear from the receiver's list. */
async function withoutInactiveSenders(threads: SecretThreadAttrs[]) {
  if (!threads.length) return threads;
  const active = await User.find({
    _id: { $in: [...new Set(threads.map((t) => t.sender_id.toString()))] },
    status: 'active',
  })
    .select('_id')
    .lean();
  const ok = new Set(active.map((u) => u._id.toString()));
  return threads.filter((t) => ok.has(t.sender_id.toString()));
}

export async function listInbox(viewer: UserDoc, { cursor, limit }: Page) {
  if (!entitlementOf(viewer).limits.read_secret) throw planRequired('read_secret');
  const take = Math.min(LIST_MAX, limit);
  const offset = decodeOffset(cursor);
  const rows = await SecretThread.find(await receivedFilter(viewer))
    .sort({ last_activity_at: -1, _id: -1 })
    .skip(offset)
    .limit(take + 1)
    .lean<SecretThreadAttrs[]>();
  const hasMore = rows.length > take;
  const page = await withoutInactiveSenders(rows.slice(0, take));
  const ctx = await contextFor(viewer, page);
  return {
    data: page.map((t) => threadDto(t, 'received', ctx)),
    pagination: { next_cursor: hasMore ? encodeOffset(offset + take) : null, has_more: hasMore },
  };
}

export async function listSent(viewer: UserDoc, { cursor, limit }: Page) {
  const take = Math.min(LIST_MAX, limit);
  const offset = decodeOffset(cursor);
  const rows = await SecretThread.find({
    sender_id: viewer._id,
    sender_hidden: false,
    ...liveFilter(),
  })
    .sort({ last_activity_at: -1, _id: -1 })
    .skip(offset)
    .limit(take + 1)
    .lean<SecretThreadAttrs[]>();
  const hasMore = rows.length > take;
  const page = rows.slice(0, take);
  const ctx = await contextFor(viewer, page);
  return {
    data: page.map((t) => threadDto(t, 'sent', ctx)),
    pagination: { next_cursor: hasMore ? encodeOffset(offset + take) : null, has_more: hasMore },
  };
}

/** Every plan: counts for badges and the Free locked card (ids and days only). */
export async function summary(viewer: UserDoc) {
  const ent = entitlementOf(viewer);
  const received = await withoutInactiveSenders(
    await SecretThread.find(await receivedFilter(viewer))
      .sort({ last_activity_at: -1, _id: -1 })
      .limit(200)
      .lean<SecretThreadAttrs[]>(),
  );
  const sentOpen = await SecretThread.countDocuments({
    sender_id: viewer._id,
    sender_hidden: false,
    status: 'sealed',
    $or: notArchived(),
  });
  const sentTotal = await SecretThread.countDocuments({
    sender_id: viewer._id,
    sender_hidden: false,
    ...liveFilter(),
  });
  const sealed = received.filter((t) => t.status === 'sealed');
  const tz = viewer.nearby?.timezone;
  return {
    sealed_count: sealed.length,
    unread_count: sealed.filter(
      (t) =>
        t.last_sender_message_at &&
        (!t.recipient_last_read_at || t.last_sender_message_at > t.recipient_last_read_at),
    ).length,
    received_count: received.length,
    sent_open_count: sentOpen,
    sent_count: sentTotal,
    can_read: ent.limits.read_secret,
    can_send: ent.limits.secret_messages_per_month !== 0,
    plan: ent.plan,
    usage: await secretUsage(viewer),
    /** What the Free locked card lists: no sender, no text, the day only. */
    locked_items: ent.limits.read_secret
      ? []
      : sealed.map((t) => ({ id: t.public_id, day: dayKey(t.created_at, tz) })),
  };
}

async function findThread(viewer: UserDoc, threadId: string) {
  const t = await SecretThread.findOne({ public_id: threadId }).lean<SecretThreadAttrs>();
  if (!t || !isLive(t)) throw notFound();
  const role = roleOf(t, viewer._id);
  if (!role) throw notFound();
  if (role === 'received') {
    if (t.recipient_hidden) throw notFound();
    if (t.status === 'sealed') {
      const [blocked, sender] = await Promise.all([
        SecretBlock.exists({ blocker_id: viewer._id, blocked_id: t.sender_id }),
        User.exists({ _id: t.sender_id, status: 'active' }),
      ]);
      if (blocked || !sender) throw notFound();
    }
  } else if (t.sender_hidden) {
    throw notFound();
  }
  return { thread: t, role };
}

function requireRead(viewer: UserDoc, role: Role, t: SecretThreadAttrs) {
  if (role === 'received' && t.status === 'sealed' && !entitlementOf(viewer).limits.read_secret) {
    throw planRequired('read_secret');
  }
}

export async function getThread(viewer: UserDoc, threadId: string) {
  const { thread, role } = await findThread(viewer, threadId);
  requireRead(viewer, role, thread);
  const ctx = await contextFor(viewer, [thread]);
  return threadDto(thread, role, ctx);
}

function messageDto(m: SecretMessageAttrs, viewerRole: Role, sealed: boolean, tz?: string | null) {
  const mine = (m.from === 'sender') === (viewerRole === 'sent');
  if (sealed && viewerRole === 'received' && m.from === 'sender') {
    return { id: m.public_id, from: 'them' as const, sealed: true as const, day: dayKey(m.created_at, tz) };
  }
  return {
    id: m.public_id,
    from: mine ? ('me' as const) : ('them' as const),
    sealed: false as const,
    body: decryptBody(m.body_enc),
    created_at: m.created_at.toISOString(),
  };
}

export async function listThreadMessages(viewer: UserDoc, threadId: string) {
  const { thread, role } = await findThread(viewer, threadId);
  requireRead(viewer, role, thread);
  const rows = await SecretMessage.find({ thread_id: thread._id })
    .sort({ _id: 1 })
    .limit(200)
    .lean<SecretMessageAttrs[]>();
  const sealed = thread.status === 'sealed';
  return {
    data: rows.map((m) => messageDto(m, role, sealed, viewer.nearby?.timezone)),
    pagination: { next_cursor: null, has_more: false },
  };
}

async function canMessage(sender: UserDoc, recipientId: string) {
  if (!isValidObjectId(recipientId) || sender._id.equals(recipientId)) return null;
  const recipient = await User.findOne({ _id: recipientId, status: 'active', is_verified: true })
    .select('_id')
    .lean();
  if (!recipient) return null;
  const [blocked, secretBlocked] = await Promise.all([
    isBlockedEither(sender._id, recipient._id),
    SecretBlock.exists({ blocker_id: recipient._id, blocked_id: sender._id }),
  ]);
  return blocked || secretBlocked ? null : recipient._id;
}

function emitSummary(userId: Types.ObjectId, event: string, payload: Record<string, unknown>, delay = 0) {
  later(delay, () => {
    emitToUser(userId.toString(), event, payload);
    emitToUser(userId.toString(), 'secret.summary', {});
  });
}

async function sentView(viewer: UserDoc, thread: SecretThreadAttrs) {
  const ctx = await contextFor(viewer, [thread]);
  return threadDto(thread, 'sent', ctx);
}

export async function startThread(
  viewer: UserDoc,
  input: { recipient_id: string; body: string; client_message_id: string },
) {
  if (entitlementOf(viewer).limits.secret_messages_per_month === 0) {
    throw planRequired('send_secret');
  }
  const body = checkBody(input.body, FIRST_MIN, FIRST_MAX);

  // A retry after a lost response returns the thread it already created.
  const retried = await SecretMessage.findOne({
    author_id: viewer._id,
    client_message_id: input.client_message_id,
  }).lean<SecretMessageAttrs>();
  if (retried) {
    const thread = await SecretThread.findById(retried.thread_id).lean<SecretThreadAttrs>();
    if (!thread || !thread.sender_id.equals(viewer._id)) {
      throw ApiError.conflict(
        'client_message_id was already used.',
        'DUPLICATE_CLIENT_MESSAGE_ID',
      );
    }
    return {
      created: false,
      thread: { ...(await sentView(viewer, thread)), usage: await secretUsage(viewer) },
    };
  }

  const recipientId = await canMessage(viewer, input.recipient_id);
  if (!recipientId) throw cannotSend();

  const open = await SecretThread.findOne({
    sender_id: viewer._id,
    recipient_id: recipientId,
    status: 'sealed',
  }).lean<SecretThreadAttrs>();
  if (open && isLive(open)) {
    throw ApiError.conflict(
      'You already have a secret conversation going with them.',
      'SECRET_THREAD_EXISTS',
      { thread_id: open.public_id },
    );
  }
  if (open) await SecretThread.updateOne({ _id: open._id }, { $set: { status: 'archived' } });

  const refund = await reserveSecretMessage(viewer);
  const now = new Date();
  let thread: SecretThreadAttrs;
  try {
    const doc = await SecretThread.create({
      public_id: randomUUID(),
      sender_id: viewer._id,
      recipient_id: recipientId,
      last_activity_at: now,
      last_sender_message_at: now,
      sender_last_read_at: now,
    });
    thread = doc.toObject() as SecretThreadAttrs;
    try {
      await SecretMessage.create({
        public_id: randomUUID(),
        thread_id: thread._id,
        author_id: viewer._id,
        from: 'sender',
        body_enc: encryptBody(body),
        client_message_id: input.client_message_id,
      });
    } catch (err) {
      await SecretThread.deleteOne({ _id: thread._id });
      throw err;
    }
  } catch (err) {
    await refund();
    if (isDuplicateKey(err)) {
      const raced = await SecretThread.findOne({
        sender_id: viewer._id,
        recipient_id: recipientId,
        status: 'sealed',
      }).lean<SecretThreadAttrs>();
      if (raced) {
        throw ApiError.conflict(
          'You already have a secret conversation going with them.',
          'SECRET_THREAD_EXISTS',
          { thread_id: raced.public_id },
        );
      }
    }
    throw err;
  }

  const delay = noticeDelayMs();
  await notifySystem({
    recipientId,
    type: 'secret_message_received',
    text: RECEIVED_NOTICE,
    secretThreadId: thread.public_id,
    deliverAt: new Date(now.getTime() + delay),
  });
  emitSummary(recipientId, 'secret.new', { thread_id: thread.public_id }, delay);

  return {
    created: true,
    thread: { ...(await sentView(viewer, thread)), usage: await secretUsage(viewer) },
  };
}

async function decryptedThreadMessages(threadId: Types.ObjectId) {
  const rows = await SecretMessage.find({ thread_id: threadId }).sort({ _id: 1 }).lean<SecretMessageAttrs[]>();
  return rows.map((m) => ({ row: m, body: decryptBody(m.body_enc) }));
}

/** Copies the thread into the chat and flips it to revealed. Safe to call again after a failure. */
async function completeReveal(thread: SecretThreadAttrs) {
  const messages = await decryptedThreadMessages(thread._id);
  const conversationId = await importRevealedSecret({
    senderId: thread.sender_id,
    recipientId: thread.recipient_id,
    threadPublicId: thread.public_id,
    messages: messages.map((m) => ({ id: m.row.public_id, author_id: m.row.author_id, body: m.body })),
  });
  const now = new Date();
  const updated = await SecretThread.findOneAndUpdate(
    { _id: thread._id, status: 'sealed' },
    { $set: { status: 'revealed', revealed_at: now, conversation_id: conversationId, last_activity_at: now } },
    { returnDocument: 'after' },
  ).lean<SecretThreadAttrs>();
  if (!updated) {
    const current = await SecretThread.findById(thread._id).lean<SecretThreadAttrs>();
    return { thread: current ?? thread, messages, revealedNow: false };
  }

  const recipient = await User.findById(thread.recipient_id).select('username').lean();
  await notifySystem({
    recipientId: thread.sender_id,
    actorId: thread.recipient_id,
    type: 'secret_message_revealed',
    text: `${recipient?.username ?? 'Someone'} replied twice — you've been revealed ✨ Your chat is open.`,
    secretThreadId: thread.public_id,
    conversationId,
  });
  // The receiver's sealed notices are settled by the reveal.
  await Notification.updateMany(
    { recipient_id: thread.recipient_id, secret_thread_id: thread.public_id, read_at: null },
    { $set: { read_at: now } },
  );
  const payload = { thread_id: thread.public_id, conversation_id: conversationId.toString() };
  emitSummary(thread.sender_id, 'secret.revealed', payload);
  emitSummary(thread.recipient_id, 'secret.revealed', payload);
  return { thread: updated, messages, revealedNow: true };
}

async function revealPayload(thread: SecretThreadAttrs, messages: { row: SecretMessageAttrs; body: string }[]) {
  const users = await loadUsers([thread.sender_id]);
  return {
    sender: publicUser(users.get(thread.sender_id.toString())),
    revealed_messages: messages
      .filter((m) => m.row.from === 'sender')
      .map((m) => ({
        id: m.row.public_id,
        from: 'them' as const,
        sealed: false as const,
        body: m.body,
        created_at: m.row.created_at.toISOString(),
      })),
    thread: {
      id: thread.public_id,
      status: thread.status,
      conversation_id: thread.conversation_id ? thread.conversation_id.toString() : null,
    },
  };
}

export async function sendThreadMessage(
  viewer: UserDoc,
  threadId: string,
  input: { body: string; client_message_id: string },
) {
  const { thread, role } = await findThread(viewer, threadId);
  const retried = await SecretMessage.findOne({
    author_id: viewer._id,
    client_message_id: input.client_message_id,
  }).lean<SecretMessageAttrs>();
  if (retried) {
    if (!retried.thread_id.equals(thread._id)) {
      throw ApiError.conflict('client_message_id was already used.', 'DUPLICATE_CLIENT_MESSAGE_ID');
    }
    if (role === 'received' && thread.status === 'sealed' && thread.replies_used >= 2) {
      const done = await completeReveal(thread);
      return {
        message: messageDto(retried, role, false),
        ...(await revealPayload(done.thread, done.messages)),
      };
    }
    return {
      message: messageDto(retried, role, false),
      thread: { id: thread.public_id, status: thread.status, conversation_id: thread.conversation_id?.toString() ?? null },
    };
  }

  if (thread.status === 'revealed') {
    throw ApiError.conflict('This conversation is now a regular chat.', 'SECRET_THREAD_REVEALED', {
      conversation_id: thread.conversation_id?.toString() ?? null,
    });
  }
  const body = checkBody(input.body, 1, BODY_MAX);
  const now = new Date();

  if (role === 'sent') {
    const claimed = await SecretThread.findOneAndUpdate(
      { _id: thread._id, status: 'sealed', sender_followups_unanswered: { $lt: MAX_FOLLOWUPS } },
      {
        $inc: { sender_followups_unanswered: 1 },
        $set: { last_activity_at: now, last_sender_message_at: now, sender_last_read_at: now },
      },
      { returnDocument: 'after' },
    ).lean<SecretThreadAttrs>();
    if (!claimed) {
      const current = await SecretThread.findById(thread._id).lean<SecretThreadAttrs>();
      if (current?.status === 'revealed') {
        throw ApiError.conflict('This conversation is now a regular chat.', 'SECRET_THREAD_REVEALED', {
          conversation_id: current.conversation_id?.toString() ?? null,
        });
      }
      throw ApiError.tooMany(
        'Wait for their reply. You can add up to 3 messages in a row.',
        undefined,
        'SECRET_FOLLOWUP_LIMIT',
      );
    }
    const doc = await SecretMessage.create({
      public_id: randomUUID(),
      thread_id: thread._id,
      author_id: viewer._id,
      from: 'sender',
      body_enc: encryptBody(body),
      client_message_id: input.client_message_id,
    });

    // At most one follow-up notice per thread per hour.
    const notify = await SecretThread.findOneAndUpdate(
      {
        _id: thread._id,
        $or: [
          { followup_notified_at: null },
          { followup_notified_at: { $lt: new Date(now.getTime() - FOLLOWUP_NOTICE_GAP_MS) } },
        ],
      },
      { $set: { followup_notified_at: now } },
    );
    const delay = noticeDelayMs();
    if (notify) {
      await notifySystem({
        recipientId: thread.recipient_id,
        type: 'secret_message_followup',
        text: FOLLOWUP_NOTICE,
        secretThreadId: thread.public_id,
        deliverAt: new Date(now.getTime() + delay),
      });
    }
    emitSummary(thread.recipient_id, 'secret.message', { thread_id: thread.public_id }, delay);
    const ctx = await contextFor(viewer, [claimed]);
    return {
      message: messageDto(doc.toObject() as SecretMessageAttrs, 'sent', false),
      thread: threadDto(claimed, 'sent', ctx),
    };
  }

  // Receiver reply: the conditional $inc lets exactly one request become reply #2.
  if (!entitlementOf(viewer).limits.read_secret) throw planRequired('read_secret');
  const claimed = await SecretThread.findOneAndUpdate(
    { _id: thread._id, status: 'sealed', replies_used: { $lt: 2 } },
    {
      $inc: { replies_used: 1 },
      $set: {
        sender_followups_unanswered: 0,
        last_activity_at: now,
        last_recipient_message_at: now,
        recipient_last_read_at: now,
      },
    },
    { returnDocument: 'after' },
  ).lean<SecretThreadAttrs>();
  if (!claimed) {
    const current = await SecretThread.findById(thread._id).lean<SecretThreadAttrs>();
    throw ApiError.conflict('This conversation is now a regular chat.', 'SECRET_THREAD_REVEALED', {
      conversation_id: current?.conversation_id?.toString() ?? null,
    });
  }
  const doc = await SecretMessage.create({
    public_id: randomUUID(),
    thread_id: thread._id,
    author_id: viewer._id,
    from: 'recipient',
    body_enc: encryptBody(body),
    client_message_id: input.client_message_id,
  });
  const message = messageDto(doc.toObject() as SecretMessageAttrs, 'received', false);

  if (claimed.replies_used < 2) {
    await notifySystem({
      recipientId: thread.sender_id,
      actorId: viewer._id,
      type: 'secret_message_reply',
      text: `${viewer.username} replied to your Secret Message (1 of 2)`,
      secretThreadId: thread.public_id,
    });
    emitSummary(thread.sender_id, 'secret.message', { thread_id: thread.public_id });
    const ctx = await contextFor(viewer, [claimed]);
    return { message, thread: threadDto(claimed, 'received', ctx) };
  }

  try {
    const done = await completeReveal(claimed);
    return { message, ...(await revealPayload(done.thread, done.messages)) };
  } catch (err) {
    logger.error({ err }, 'Secret Message reveal failed; a retry will finish it');
    throw err;
  }
}

export async function markThreadRead(viewer: UserDoc, threadId: string) {
  const { thread, role } = await findThread(viewer, threadId);
  requireRead(viewer, role, thread);
  const field = role === 'sent' ? 'sender_last_read_at' : 'recipient_last_read_at';
  const now = new Date();
  await SecretThread.updateOne({ _id: thread._id }, { $set: { [field]: now } });
  await Notification.updateMany(
    { recipient_id: viewer._id, secret_thread_id: thread.public_id, read_at: null, deliver_at: { $lte: now } },
    { $set: { read_at: now } },
  );
  emitToUser(viewer.id as string, 'secret.summary', {});
}

export async function reportThread(
  viewer: UserDoc,
  threadId: string,
  input: { reason: (typeof REPORT_REASONS)[number]; details: string },
) {
  const { thread } = await findThread(viewer, threadId);
  try {
    await Report.create({
      reporter_id: viewer._id,
      target_type: 'secret_thread',
      target_id: thread.public_id,
      reason: input.reason,
      details: input.details.trim(),
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
}

/** Anonymous block: hides the sender's sealed threads and stops future Secret Messages from them. */
export async function blockSender(viewer: UserDoc, threadId: string) {
  const { thread, role } = await findThread(viewer, threadId);
  if (role !== 'received') {
    throw ApiError.badRequest('Only the receiver can block the sender.', undefined, 'NOT_RECEIVER');
  }
  try {
    await SecretBlock.create({
      public_id: randomUUID(),
      blocker_id: viewer._id,
      blocked_id: thread.sender_id,
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
  await SecretThread.updateMany(
    { recipient_id: viewer._id, sender_id: thread.sender_id, status: 'sealed' },
    { $set: { recipient_hidden: true } },
  );
  emitToUser(viewer.id as string, 'secret.summary', {});
}

export async function listSecretBlocks(viewer: UserDoc) {
  const rows = await SecretBlock.find({ blocker_id: viewer._id }).sort({ _id: -1 }).limit(200).lean();
  const tz = viewer.nearby?.timezone;
  return {
    data: rows.map((r) => ({
      id: r.public_id,
      day: dayKey((r as unknown as { created_at: Date }).created_at, tz),
    })),
  };
}

export async function removeSecretBlock(viewer: UserDoc, blockId: string) {
  await SecretBlock.deleteOne({ blocker_id: viewer._id, public_id: blockId });
}

/** Receiver: hide for me. Sender: withdraw a sealed thread for both (quota isn't refunded). */
export async function deleteThread(viewer: UserDoc, threadId: string) {
  const { thread, role } = await findThread(viewer, threadId);
  if (role === 'received') {
    await SecretThread.updateOne({ _id: thread._id }, { $set: { recipient_hidden: true } });
  } else if (thread.status === 'sealed') {
    await SecretThread.updateOne({ _id: thread._id, status: 'sealed' }, { $set: { status: 'withdrawn' } });
    emitSummary(thread.recipient_id, 'secret.message', { thread_id: thread.public_id });
  } else {
    await SecretThread.updateOne({ _id: thread._id }, { $set: { sender_hidden: true } });
  }
  emitToUser(viewer.id as string, 'secret.summary', {});
}
