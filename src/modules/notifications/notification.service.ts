import { type Types } from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import { Conversation } from '../messages/conversation.model';
import {
  avatarUrlOf,
  type NotificationSettingKey,
  notificationSettingsOf,
  User,
  type UserDoc,
} from '../users/user.model';
import { Notification, type NotificationType } from './notification.model';

const pageOf = (limit: number) => Math.min(50, Math.max(1, limit || 20));

/** Delayed rows stay hidden until `deliver_at`. */
const delivered = (now = new Date()) => ({
  $or: [{ deliver_at: null }, { deliver_at: { $lte: now } }],
});

const ANONYMOUS: ReadonlySet<NotificationType> = new Set([
  'secret_message_received',
  'secret_message_followup',
  'nearby_encounter',
  'crush_added',
]);

/** In-app notice with no actor. Anonymous types never carry the sender's id, name or text. */
export async function notifySystem(opts: {
  recipientId: Types.ObjectId;
  type: NotificationType;
  text: string;
  actorId?: Types.ObjectId | null;
  secretThreadId?: string | null;
  crushMatchId?: string | null;
  conversationId?: Types.ObjectId | null;
  deliverAt?: Date | null;
}) {
  return Notification.create({
    recipient_id: opts.recipientId,
    actor_id: opts.actorId ?? null,
    type: opts.type,
    text: opts.text,
    secret_thread_id: opts.secretThreadId ?? null,
    crush_match_id: opts.crushMatchId ?? null,
    conversation_id: opts.conversationId ?? null,
    deliver_at: opts.deliverAt ?? null,
  });
}

function snippet(body: string) {
  return body.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** False when the recipient paused notifications or turned this kind off. */
export async function wantsNotification(
  recipientId: Types.ObjectId,
  kind: Exclude<NotificationSettingKey, 'paused'>,
) {
  const recipient = await User.findById(recipientId).select('notification_settings').lean();
  if (!recipient) return false;
  const settings = notificationSettingsOf(recipient);
  return !settings.paused && settings[kind];
}

/** In-app activity. Skips notifying yourself. */
export async function notifyComment(opts: {
  actor: UserDoc;
  recipientId: Types.ObjectId;
  kind: 'post' | 'reel';
  body: string;
  postId?: Types.ObjectId | null;
  reelId?: Types.ObjectId | null;
  commentId: Types.ObjectId;
  reply?: boolean;
}) {
  if (opts.actor._id.equals(opts.recipientId)) return;
  if (!(await wantsNotification(opts.recipientId, 'comments'))) return;
  const action =
    opts.kind === 'reel'
      ? 'commented on your reel'
      : opts.reply
        ? 'replied to your comment'
        : 'commented';
  await Notification.create({
    recipient_id: opts.recipientId,
    actor_id: opts.actor._id,
    type: opts.kind === 'reel' ? 'comment_reel' : 'comment_post',
    text: `${opts.actor.username} ${action}: ${snippet(opts.body)}`,
    post_id: opts.postId ?? null,
    reel_id: opts.reelId ?? null,
    comment_id: opts.commentId,
  });
}

export async function listNotifications(
  viewer: UserDoc,
  cursor: string | undefined,
  limit: number,
) {
  const take = pageOf(limit);
  const filter: Record<string, unknown> = { recipient_id: viewer._id, ...delivered() };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Notification.find(filter)
    .sort({ _id: -1 })
    .limit(take + 1);
  const page = rows.slice(0, take);
  const actorIds = page.flatMap((n) => (n.actor_id ? [n.actor_id] : []));
  const actors = actorIds.length ? await User.find({ _id: { $in: actorIds } }) : [];
  const byId = new Map(actors.map((u) => [u.id as string, u]));
  const items = await Promise.all(
    page.map(async (n) => {
      const anonymous = ANONYMOUS.has(n.type);
      const actor = !anonymous && n.actor_id ? byId.get(n.actor_id.toHexString()) : undefined;
      const shownAt = n.deliver_at ?? (n.get('created_at') as Date);
      return {
        id: n.id as string,
        type: n.type,
        text: n.text,
        post_id: n.post_id ? n.post_id.toHexString() : null,
        reel_id: n.reel_id ? n.reel_id.toHexString() : null,
        secret_thread_id: n.secret_thread_id ?? null,
        crush_match_id: n.crush_match_id ?? null,
        conversation_id: n.conversation_id ? n.conversation_id.toHexString() : null,
        anonymous,
        read: n.read_at != null,
        created_at: shownAt.toISOString(),
        actor: actor
          ? {
              id: actor.id as string,
              username: actor.username,
              display_name: actor.display_name,
              avatar_url: await avatarUrlOf(actor),
            }
          : null,
      };
    }),
  );
  return {
    items,
    next_cursor: rows.length > take ? (page[page.length - 1]!.id as string) : null,
  };
}

export async function unreadCount(viewer: UserDoc) {
  const [notifications, messageRows] = await Promise.all([
    Notification.countDocuments({
      recipient_id: viewer._id,
      read_at: null,
      ...delivered(),
    }),
    Conversation.aggregate<{ total: number }>([
      { $match: { participant_ids: viewer._id } },
      { $unwind: '$members' },
      { $match: { 'members.user_id': viewer._id, 'members.hidden': { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$members.unread_count' } } },
    ]),
  ]);
  return { notifications, messages: messageRows[0]?.total ?? 0 };
}

export async function markRead(viewer: UserDoc, id: string) {
  const row = await Notification.findOne({ _id: id, recipient_id: viewer._id });
  if (!row) throw ApiError.notFound('That notification is no longer available.');
  if (!row.read_at) {
    row.read_at = new Date();
    await row.save();
  }
}

export async function markAllRead(viewer: UserDoc) {
  await Notification.updateMany(
    { recipient_id: viewer._id, read_at: null },
    { $set: { read_at: new Date() } },
  );
}
