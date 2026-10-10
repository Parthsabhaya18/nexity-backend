import mongoose, { Types } from 'mongoose';

import { emitToUser, isOnline } from '../../realtime/io';
import { ApiError } from '../../utils/ApiError';
import { Follow } from '../follows/follow.model';
import { Media } from '../media/media.model';
import type { MediaKind } from '../media/media.rules';
import { viewUrl } from '../media/media.storage';
import { Post } from '../posts/post.model';
import { Reel } from '../reels/reel.model';
import { Story } from '../stories/story.model';
import {
  PUBLIC_USER_FIELDS,
  type PublicUserSource,
  sharesActivity,
  toPublicUserDto,
  User,
  withAvatarUrls,
} from '../users/user.model';
import {
  Conversation,
  type ConversationAttrs,
  type ConversationMember,
  directKeyOf,
} from './conversation.model';
import { EDIT_WINDOW_MS, Message, type MessageAttrs } from './message.model';
import type { SendMessageInput } from './messages.schema';

const PREVIEW_LENGTH = 200;
const MONGO_DUPLICATE_KEY = 11000;

type Page = { cursor?: string; limit: number };

const oid = (id: string) => new Types.ObjectId(id);
const isDuplicateKey = (err: unknown) =>
  err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY;
const notFound = () => ApiError.notFound('Conversation not found');

function memberOf(convo: ConversationAttrs, userId: string): ConversationMember | undefined {
  return convo.members.find((m) => m.user_id.toString() === userId);
}

async function loadUsers(ids: readonly Types.ObjectId[]) {
  const users = await withAvatarUrls(
    await User.find({ _id: { $in: ids } })
      .select(PUBLIC_USER_FIELDS)
      .lean<PublicUserSource[]>(),
  );
  return new Map(users.map((u) => [u._id.toString(), u]));
}

type UserMap = Map<string, PublicUserSource>;

function participantDto(id: string, users: UserMap) {
  const user = users.get(id);
  const base = user
    ? toPublicUserDto(user)
    : {
        id,
        username: 'nexity.user',
        display_name: 'Nexity user',
        avatar_url: null,
        last_active_at: null,
      };
  return { ...base, is_online: sharesActivity(user) && isOnline(id) };
}

type ReplySource = Pick<
  MessageAttrs,
  '_id' | 'sender_id' | 'type' | 'body' | 'deleted_at' | 'edited_at' | 'media' | 'media_items'
>;

type MediaSource = NonNullable<MessageAttrs['media']>;

function mediaDto(m: MediaSource) {
  return {
    provider: m.provider,
    provider_id: m.provider_id ?? null,
    media_id: m.media_id ? m.media_id.toString() : null,
    url: m.url,
    preview_url: m.preview_url ?? null,
    width: m.width ?? null,
    height: m.height ?? null,
    duration_ms: m.duration_ms ?? null,
  };
}

/** Thumbnail for a quote: the replied-to photo / video, or the first of an album with its size. */
function quotedMedia(reply: ReplySource, index: number | null | undefined) {
  if (reply.deleted_at) return null;
  const items = reply.media_items ?? [];
  if (items.length) {
    const picked = index != null ? items[index] : undefined;
    const shown = picked ?? items[0]!;
    const card = (m: MediaSource) => ({
      url: m.preview_url ?? m.url,
      kind: m.duration_ms != null ? ('video' as const) : ('image' as const),
    });
    return {
      ...card(shown),
      count: picked ? 1 : items.length,
      next_url: picked ? null : (items[1]?.preview_url ?? items[1]?.url ?? null),
      // The same three cards the album bubble shows.
      stack: picked ? [] : items.slice(0, 3).map(card),
    };
  }
  if (reply.media && (reply.type === 'image' || reply.type === 'video' || reply.type === 'gif' || reply.type === 'sticker')) {
    return {
      url: reply.media.preview_url ?? reply.media.url,
      kind: reply.type === 'video' ? ('video' as const) : ('image' as const),
      count: 1,
      next_url: null,
      stack: [],
    };
  }
  return null;
}

type ReactionSource = { user_id: Types.ObjectId; emoji: string; created_at?: Date | null };

/** Groups reactions by emoji, oldest emoji first: [{ emoji: '😂', user_ids: [...], count: 2 }]. */
export function groupReactions(list: readonly ReactionSource[] | null | undefined) {
  const groups = new Map<string, string[]>();
  const sorted = [...(list ?? [])].sort(
    (a, b) => (a.created_at?.getTime() ?? 0) - (b.created_at?.getTime() ?? 0),
  );
  for (const r of sorted) {
    const users = groups.get(r.emoji) ?? [];
    users.push(r.user_id.toString());
    groups.set(r.emoji, users);
  }
  return [...groups].map(([emoji, user_ids]) => ({ emoji, user_ids, count: user_ids.length }));
}

/** The story a message replied to, or `url: null` once it expired or was deleted. */
export type StoryRef = { id: string; author_id: string | null; kind: string | null; url: string | null };

type ShareKind = 'post' | 'reel' | 'profile';

/** Card for a shared post, reel or profile; `available` is false once it was deleted. */
export type SharedRef = {
  kind: ShareKind;
  id: string;
  available: boolean;
  /** The post/reel author, or the shared account itself. */
  author: { id: string; username: string; avatar_url: string | null } | null;
  caption: string;
  /** Photo of the post, or the reel's cover; null when there is only a video. */
  image_url: string | null;
  video_url: string | null;
  aspect_ratio: number;
  /** Shared accounts only: name and their latest posts (empty for private accounts). */
  profile?: {
    display_name: string;
    is_private: boolean;
    grid: { url: string; video: boolean }[];
  };
};

/** Posts are keyed with the photo/video that was on screen when shared. */
const sharedKey = (kind: ShareKind, id: string, index = 0) =>
  kind === 'post' ? `post:${id}:${index}` : `${kind}:${id}`;

const PROFILE_GRID = 6;

export function toMessageDto(
  m: MessageAttrs,
  replies: Map<string, ReplySource> = new Map(),
  stories: Map<string, StoryRef> = new Map(),
  shares: Map<string, SharedRef> = new Map(),
) {
  const deleted = Boolean(m.deleted_at);
  const reply = m.reply_to_id ? replies.get(m.reply_to_id.toString()) : undefined;
  const storyId = m.story_id ? m.story_id.toString() : null;
  const share = m.post_id
    ? { kind: 'post' as const, id: m.post_id.toString() }
    : m.reel_id
      ? { kind: 'reel' as const, id: m.reel_id.toString() }
      : m.profile_id
        ? { kind: 'profile' as const, id: m.profile_id.toString() }
        : null;
  return {
    id: m._id.toString(),
    conversation_id: m.conversation_id.toString(),
    sender_id: m.sender_id.toString(),
    type: m.type,
    body: deleted ? '' : m.body,
    media: !deleted && m.media ? mediaDto(m.media) : null,
    media_items: deleted ? [] : (m.media_items ?? []).map(mediaDto),
    reply_to_id: m.reply_to_id ? m.reply_to_id.toString() : null,
    reply_to_index: m.reply_to_index ?? null,
    /** Quoted preview so the bubble can render without fetching the original. */
    reply_to: reply
      ? {
          id: reply._id.toString(),
          sender_id: reply.sender_id.toString(),
          type: reply.type,
          body: reply.deleted_at ? '' : reply.body.slice(0, PREVIEW_LENGTH),
          is_deleted: Boolean(reply.deleted_at),
          is_edited: Boolean(reply.edited_at),
          media: quotedMedia(reply, m.reply_to_index),
        }
      : null,
    story:
      storyId && !deleted
        ? (stories.get(storyId) ?? { id: storyId, author_id: null, kind: null, url: null })
        : null,
    shared:
      share && !deleted
        ? (shares.get(sharedKey(share.kind, share.id, m.post_media_index ?? 0)) ?? {
            ...share,
            available: false,
            author: null,
            caption: '',
            image_url: null,
            video_url: null,
            aspect_ratio: 1,
          })
        : null,
    client_message_id: m.client_message_id,
    reactions: deleted ? [] : groupReactions(m.reactions as ReactionSource[]),
    edited_at: m.edited_at && !deleted ? m.edited_at.toISOString() : null,
    is_deleted: deleted,
    created_at: (m as unknown as { created_at: Date }).created_at.toISOString(),
  };
}

export type MessageDto = ReturnType<typeof toMessageDto>;

/** Converts rows to DTOs, loading quoted replies in one query. */
async function toMessageDtos(rows: MessageAttrs[]) {
  const replyIds = [...new Set(rows.flatMap((m) => (m.reply_to_id ? [m.reply_to_id.toString()] : [])))];
  const replies = replyIds.length
    ? await Message.find({ _id: { $in: replyIds } })
        .select('_id sender_id type body deleted_at edited_at media media_items')
        .lean<ReplySource[]>()
    : [];
  const signedReplies = await Promise.all(replies.map(withFreshMediaUrl));
  const byId = new Map(signedReplies.map((r) => [r._id.toString(), r]));
  const signed = await Promise.all(rows.map(withFreshMediaUrl));
  const [stories, shares] = await Promise.all([storyRefs(rows), sharedRefs(rows)]);
  return signed.map((m) => toMessageDto(m, byId, stories, shares));
}

async function sharedRefs(rows: MessageAttrs[]) {
  const postIds = [...new Set(rows.flatMap((m) => (m.post_id ? [m.post_id.toString()] : [])))];
  const reelIds = [...new Set(rows.flatMap((m) => (m.reel_id ? [m.reel_id.toString()] : [])))];
  const profileIds = [...new Set(rows.flatMap((m) => (m.profile_id ? [m.profile_id.toString()] : [])))];
  const refs = new Map<string, SharedRef>();
  if (!postIds.length && !reelIds.length && !profileIds.length) return refs;
  const [posts, reels] = await Promise.all([
    postIds.length ? Post.find({ _id: { $in: postIds }, deleted_at: null }).lean() : [],
    reelIds.length ? Reel.find({ _id: { $in: reelIds }, deleted_at: null }).lean() : [],
  ]);
  const users = await loadUsers([
    ...posts.map((p) => p.author_id),
    ...reels.map((r) => r.author_id),
    ...profileIds.map((id) => new Types.ObjectId(id)),
  ]);
  const accounts = new Map(
    (profileIds.length
      ? await User.find({ _id: { $in: profileIds } }).select('_id status is_private display_name').lean()
      : []
    ).map((u) => [u._id.toString(), u]),
  );
  const authorOf = (id: Types.ObjectId) => {
    const u = users.get(id.toString());
    if (!u) return null;
    const dto = toPublicUserDto(u);
    return { id: dto.id, username: dto.username, avatar_url: dto.avatar_url };
  };
  const indexes = new Map<string, Set<number>>();
  for (const m of rows) {
    if (!m.post_id) continue;
    const id = m.post_id.toString();
    indexes.set(id, (indexes.get(id) ?? new Set()).add(m.post_media_index ?? 0));
  }
  await Promise.all([
    ...posts.flatMap((p) =>
      [...(indexes.get(p._id.toString()) ?? [0])].map(async (index) => {
        const shown = p.media[index] ?? p.media[0];
        const url = shown ? await viewUrl(shown.key) : null;
        refs.set(sharedKey('post', p._id.toString(), index), {
          kind: 'post',
          id: p._id.toString(),
          available: true,
          author: authorOf(p.author_id),
          caption: p.caption ?? '',
          image_url: shown?.kind === 'image' ? url : null,
          video_url: shown?.kind === 'video' ? url : null,
          aspect_ratio: p.aspect_ratio ?? 1,
        });
      }),
    ),
    ...reels.map(async (r) => {
      refs.set(sharedKey('reel', r._id.toString()), {
        kind: 'reel',
        id: r._id.toString(),
        available: true,
        author: authorOf(r.author_id),
        caption: r.caption ?? '',
        image_url: r.cover_key ? await viewUrl(r.cover_key) : null,
        video_url: await viewUrl(r.video_key),
        aspect_ratio: 9 / 16,
      });
    }),
    ...profileIds.map(async (id) => {
      const author = authorOf(new Types.ObjectId(id));
      const user = accounts.get(id);
      if (!author || !user || user.status !== 'active') return;
      const latest = user.is_private
        ? []
        : await Post.find({ author_id: user._id, deleted_at: null })
            .sort({ _id: -1 })
            .limit(PROFILE_GRID)
            .select('media')
            .lean();
      const grid = await Promise.all(
        latest.flatMap((p) => {
          const first = p.media[0];
          return first ? [viewUrl(first.key).then((url) => ({ url, video: first.kind === 'video' }))] : [];
        }),
      );
      refs.set(sharedKey('profile', id), {
        kind: 'profile',
        id,
        available: true,
        author,
        caption: '',
        image_url: null,
        video_url: null,
        aspect_ratio: 1,
        profile: { display_name: user.display_name ?? '', is_private: Boolean(user.is_private), grid },
      });
    }),
  ]);
  return refs;
}

async function storyRefs(rows: MessageAttrs[]) {
  const ids = [...new Set(rows.flatMap((m) => (m.story_id ? [m.story_id.toString()] : [])))];
  if (!ids.length) return new Map<string, StoryRef>();
  const live = await Story.find({ _id: { $in: ids }, expires_at: { $gt: new Date() } })
    .select('_id author_id kind key')
    .lean();
  const refs = await Promise.all(
    live.map(async (s): Promise<StoryRef> => ({
      id: s._id.toString(),
      author_id: s.author_id.toString(),
      kind: s.kind,
      url: await viewUrl(s.key),
    })),
  );
  return new Map(refs.map((r) => [r.id, r]));
}

async function freshUrl<T extends MediaSource>(m: T): Promise<T> {
  return m.provider === 'upload' && m.key ? { ...m, url: await viewUrl(m.key) } : m;
}

async function withFreshMediaUrl<
  T extends Pick<MessageAttrs, 'media' | 'media_items' | 'deleted_at'>,
>(m: T): Promise<T> {
  if (m.deleted_at) return m;
  return {
    ...m,
    media: m.media ? await freshUrl(m.media) : m.media,
    media_items: m.media_items?.length
      ? await Promise.all(m.media_items.map(freshUrl))
      : m.media_items,
  };
}

const MESSAGE_TYPE_OF: Record<MediaKind, 'image' | 'video' | 'voice'> = {
  image: 'image',
  video: 'video',
  audio: 'voice',
};

/** Keeps the index only when it points at an item of the quoted album. */
async function validReplyIndex(replyToId: string, index: number | null | undefined) {
  if (index == null) return null;
  const target = await Message.findById(replyToId).select('media_items').lean<Pick<MessageAttrs, 'media_items'>>();
  return target && index < (target.media_items?.length ?? 0) ? index : null;
}

/** A finished upload of mine for messages, ready to attach. */
async function attachableMedia(userId: string, mediaId: string) {
  const media = await Media.findOne({ _id: mediaId, owner_id: oid(userId) }).lean();
  if (!media || media.status !== 'ready' || media.purpose !== 'message') {
    throw ApiError.badRequest(
      "That file didn't finish uploading. Please try again.",
      { field: 'media_id' },
      'INVALID_MEDIA',
    );
  }
  return {
    type: MESSAGE_TYPE_OF[media.kind],
    media: {
      provider: 'upload' as const,
      media_id: media._id,
      key: media.key,
      url: await viewUrl(media.key),
      width: media.width ?? null,
      height: media.height ?? null,
      duration_ms: media.duration_ms ?? null,
    },
  };
}

const previewOf = (m: Pick<MessageAttrs, 'body' | 'deleted_at'>) =>
  m.deleted_at ? '' : m.body.slice(0, PREVIEW_LENGTH);

/** Conversation as seen by one participant (unread count, read state and "peer" differ per viewer). */
function toConversationDto(convo: ConversationAttrs, viewerId: string, users: UserMap) {
  const me = memberOf(convo, viewerId);
  const other = convo.members.find((m) => m.user_id.toString() !== viewerId);
  const last = convo.last_message;
  const lastVisible = last && (!me?.cleared_at || last.created_at > me.cleared_at) ? last : null;
  const timestamps = convo as unknown as { created_at: Date; updated_at: Date };

  return {
    id: convo._id.toString(),
    type: convo.type,
    peer: convo.type === 'direct' && other ? participantDto(other.user_id.toString(), users) : null,
    participants: convo.participant_ids.map((id) => participantDto(id.toString(), users)),
    last_message: lastVisible
      ? {
          id: lastVisible.id.toString(),
          sender_id: lastVisible.sender_id.toString(),
          type: lastVisible.type,
          body: lastVisible.body,
          is_deleted: Boolean(lastVisible.is_deleted),
          created_at: lastVisible.created_at.toISOString(),
        }
      : null,
    unread_count: me?.unread_count ?? 0,
    last_read_message_id: me?.last_read_message_id?.toString() ?? null,
    peer_last_read_message_id: other?.last_read_message_id?.toString() ?? null,
    is_muted: Boolean(me?.muted_until && me.muted_until > new Date()),
    created_at: timestamps.created_at.toISOString(),
    updated_at: timestamps.updated_at.toISOString(),
  };
}

export type ConversationDto = ReturnType<typeof toConversationDto>;

async function requireMembership(conversationId: string, userId: string) {
  const convo = await Conversation.findOne({
    _id: conversationId,
    participant_ids: oid(userId),
  }).lean<ConversationAttrs>();
  if (!convo) throw notFound();
  return convo;
}

async function conversationFor(convo: ConversationAttrs, viewerId: string) {
  return toConversationDto(convo, viewerId, await loadUsers(convo.participant_ids));
}

/** Sends each participant their own view of the conversation so inbox rows update live. */
async function broadcastConversation(conversationId: Types.ObjectId) {
  const convo = await Conversation.findById(conversationId).lean<ConversationAttrs>();
  if (!convo) return;
  const users = await loadUsers(convo.participant_ids);
  for (const id of convo.participant_ids) {
    const userId = id.toString();
    emitToUser(userId, 'conversation.updated', toConversationDto(convo, userId, users));
  }
}

/** Unsent messages vanish (like Instagram): the inbox preview falls back to the latest visible one. */
async function refreshLastMessage(conversationId: Types.ObjectId) {
  const previous = await Message.findOne({ conversation_id: conversationId, deleted_at: null })
    .sort({ _id: -1 })
    .lean<MessageAttrs>();
  const lastMessage = previous
    ? {
        id: previous._id,
        sender_id: previous.sender_id,
        type: previous.type,
        body: previewOf(previous),
        is_deleted: false,
        created_at: (previous as unknown as { created_at: Date }).created_at,
      }
    : null;
  await Conversation.updateOne({ _id: conversationId }, { $set: { last_message: lastMessage } });
  return lastMessage;
}

const encodeCursor = (at: Date, id: Types.ObjectId) =>
  Buffer.from(`${at.getTime()}:${id.toString()}`).toString('base64url');

function decodeCursor(cursor: string) {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  const time = Number(ms);
  if (!Number.isFinite(time) || !id || !Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest('Invalid cursor', undefined, 'INVALID_CURSOR');
  }
  return { at: new Date(time), id: oid(id) };
}

export async function listConversations(userId: string, { cursor, limit }: Page) {
  const me = oid(userId);
  const filter: Record<string, unknown> = {
    participant_ids: me,
    last_message_at: { $ne: null },
    members: { $elemMatch: { user_id: me, hidden: false } },
  };
  if (cursor) {
    const { at, id } = decodeCursor(cursor);
    filter.$or = [{ last_message_at: { $lt: at } }, { last_message_at: at, _id: { $lt: id } }];
  }

  const rows = await Conversation.find(filter)
    .sort({ last_message_at: -1, _id: -1 })
    .limit(limit + 1)
    .lean<ConversationAttrs[]>();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  // Chats unsent before previews fell back to the previous message: repair them once.
  await Promise.all(
    page
      .filter((c) => c.last_message?.is_deleted)
      .map(async (c) => {
        c.last_message = (await refreshLastMessage(c._id)) as typeof c.last_message;
      }),
  );
  const users = await loadUsers([...new Set(page.flatMap((c) => c.participant_ids))]);
  const last = page[page.length - 1];

  return {
    data: page.map((c) => toConversationDto(c, userId, users)),
    pagination: {
      next_cursor: hasMore && last?.last_message_at ? encodeCursor(last.last_message_at, last._id) : null,
      has_more: hasMore,
    },
  };
}

export async function getConversation(userId: string, conversationId: string) {
  return conversationFor(await requireMembership(conversationId, userId), userId);
}

/** Returns the existing direct conversation with this person, or creates it. */
export async function openDirectConversation(userId: string, participantId: string) {
  if (participantId === userId) {
    throw ApiError.badRequest("You can't message yourself.", undefined, 'INVALID_PARTICIPANT');
  }
  const peer = await User.exists({ _id: participantId, status: 'active', is_verified: true });
  if (!peer) throw ApiError.notFound('This account is not available.');

  const directKey = directKeyOf(userId, participantId);
  const existing = await Conversation.findOne({ direct_key: directKey }).lean<ConversationAttrs>();
  if (existing) return { conversation: await conversationFor(existing, userId), created: false };

  try {
    const now = new Date();
    const member = (id: string) => ({
      user_id: oid(id),
      role: 'member',
      joined_at: now,
      last_read_message_id: null,
      last_read_at: null,
      unread_count: 0,
      muted_until: null,
      cleared_at: null,
      hidden: false,
    });
    const created = await Conversation.create({
      type: 'direct',
      direct_key: directKey,
      participant_ids: [oid(userId), oid(participantId)],
      members: [member(userId), member(participantId)],
      created_by: oid(userId),
    });
    return {
      conversation: await conversationFor(created.toObject() as ConversationAttrs, userId),
      created: true,
    };
  } catch (err) {
    // Both people opened the chat at the same moment; the other request won the insert.
    if (!isDuplicateKey(err)) throw err;
    const winner = await Conversation.findOne({ direct_key: directKey }).lean<ConversationAttrs>();
    if (!winner) throw err;
    return { conversation: await conversationFor(winner, userId), created: false };
  }
}

export async function listMessages(
  userId: string,
  conversationId: string,
  { cursor, after, limit }: Page & { after?: string },
) {
  const convo = await requireMembership(conversationId, userId);
  const clearedAt = memberOf(convo, userId)?.cleared_at;

  const filter: Record<string, unknown> = { conversation_id: convo._id };
  if (clearedAt) filter.created_at = { $gt: clearedAt };
  if (after) filter._id = { $gt: oid(after) };
  else if (cursor) filter._id = { $lt: oid(cursor) };

  const rows = await Message.find(filter)
    .sort({ _id: after ? 1 : -1 })
    .limit(limit + 1)
    .lean<MessageAttrs[]>();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  return {
    data: await toMessageDtos(page),
    pagination: {
      next_cursor: hasMore ? (page[page.length - 1]?._id.toString() ?? null) : null,
      has_more: hasMore,
    },
  };
}

/**
 * "Who can message you: People you follow". Once the recipient has written in the chat
 * themselves, the conversation stays open both ways.
 */
async function assertPeerAcceptsMessages(convo: ConversationAttrs, senderId: string) {
  if (convo.type !== 'direct') return;
  const peerId = convo.participant_ids.find((id) => id.toString() !== senderId);
  if (!peerId) return;
  const peer = await User.findById(peerId).select('username message_privacy').lean();
  if (!peer || peer.message_privacy !== 'following') return;
  const [follows, replied] = await Promise.all([
    Follow.exists({ follower_id: peerId, following_id: oid(senderId), status: 'accepted' }),
    Message.exists({ conversation_id: convo._id, sender_id: peerId }),
  ]);
  if (follows || replied) return;
  throw ApiError.forbidden(
    `@${peer.username} only gets messages from people they follow.`,
    'MESSAGES_RESTRICTED',
  );
}

export async function sendMessage(
  userId: string,
  conversationId: string,
  input: SendMessageInput,
  {
    storyId = null,
    share = null,
  }: {
    storyId?: Types.ObjectId | null;
    share?: { kind: ShareKind; id: Types.ObjectId; index?: number } | null;
  } = {},
) {
  const convo = await requireMembership(conversationId, userId);
  const me = oid(userId);
  const duplicateOf = async () => {
    const existing = await Message.findOne({
      sender_id: me,
      client_message_id: input.client_message_id,
    }).lean<MessageAttrs>();
    if (existing && !existing.conversation_id.equals(convo._id)) {
      throw ApiError.conflict(
        'client_message_id was already used in another conversation.',
        'DUPLICATE_CLIENT_MESSAGE_ID',
      );
    }
    return existing;
  };

  // A retry after a lost response returns the stored message instead of sending it twice.
  const retried = await duplicateOf();
  if (retried) return (await toMessageDtos([retried]))[0]!;
  await assertPeerAcceptsMessages(convo, userId);

  if (input.reply_to_id) {
    const target = await Message.exists({
      _id: input.reply_to_id,
      conversation_id: convo._id,
      deleted_at: null,
    });
    if (!target) {
      throw ApiError.badRequest(
        'The message you replied to no longer exists.',
        undefined,
        'REPLY_TARGET_NOT_FOUND',
      );
    }
  }

  const gif = input.gif;
  const ids = input.media_ids ?? (input.media_id ? [input.media_id] : []);
  const uploads = await Promise.all(ids.map((id) => attachableMedia(userId, id)));
  if (uploads.length > 1 && uploads.some((u) => u.type === 'voice')) {
    throw ApiError.badRequest(
      'Voice messages are sent one at a time.',
      { field: 'media_ids' },
      'INVALID_MEDIA',
    );
  }
  const upload = uploads.length === 1 ? uploads[0]! : null;
  const album = uploads.length > 1 ? uploads.map((u) => u.media) : [];
  const replyIndex = input.reply_to_id ? await validReplyIndex(input.reply_to_id, input.reply_to_index) : null;
  let message: MessageAttrs;
  try {
    const doc = await Message.create({
      conversation_id: convo._id,
      sender_id: me,
      type: share
        ? (`share_${share.kind}` as const)
        : album.length
          ? 'album'
          : upload
            ? upload.type
            : gif
              ? gif.kind
              : 'text',
      body: input.body,
      media_items: album,
      reply_to_index: replyIndex,
      media: upload
        ? upload.media
        : gif
          ? {
              provider: 'giphy',
              provider_id: gif.id,
              url: gif.url,
              preview_url: gif.preview_url ?? null,
              width: gif.width,
              height: gif.height,
            }
          : null,
      reply_to_id: input.reply_to_id ?? null,
      story_id: storyId,
      post_id: share?.kind === 'post' ? share.id : null,
      reel_id: share?.kind === 'reel' ? share.id : null,
      profile_id: share?.kind === 'profile' ? share.id : null,
      post_media_index: share?.kind === 'post' ? (share.index ?? 0) : 0,
      client_message_id: input.client_message_id,
    });
    message = doc.toObject() as MessageAttrs;
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const raced = await duplicateOf();
    if (!raced) throw err;
    return (await toMessageDtos([raced]))[0]!;
  }

  const createdAt = (message as unknown as { created_at: Date }).created_at;
  await Conversation.updateOne(
    { _id: convo._id },
    {
      $set: {
        last_message: {
          id: message._id,
          sender_id: me,
          type: message.type,
          body: previewOf(message),
          is_deleted: false,
          created_at: createdAt,
        },
        last_message_at: createdAt,
        'members.$[me].last_read_message_id': message._id,
        'members.$[me].last_read_at': createdAt,
        // Replying means everything before it has been read.
        'members.$[me].unread_count': 0,
        'members.$[me].hidden': false,
        'members.$[other].hidden': false,
      },
      $inc: { message_count: 1, 'members.$[other].unread_count': 1 },
    },
    { arrayFilters: [{ 'me.user_id': me }, { 'other.user_id': { $ne: me } }] },
  );

  const dto = (await toMessageDtos([message]))[0]!;
  for (const id of convo.participant_ids) emitToUser(id.toString(), 'message.new', dto);
  await broadcastConversation(convo._id);
  return dto;
}

/** Marks messages read up to `messageId` (default: the latest) and notifies the other participants. */
export async function markRead(userId: string, conversationId: string, messageId?: string) {
  const convo = await requireMembership(conversationId, userId);
  const member = memberOf(convo, userId)!;

  let target: Types.ObjectId | null = convo.last_message?.id ?? null;
  if (messageId) {
    const exists = await Message.exists({ _id: messageId, conversation_id: convo._id });
    if (!exists) throw ApiError.notFound('Message not found');
    target = oid(messageId);
  }

  const current = member.last_read_message_id;
  if (current && (!target || current.toHexString() >= target.toHexString())) target = current;
  if (!target) {
    return { conversation_id: conversationId, last_read_message_id: null, unread_count: 0 };
  }

  const unread = await Message.countDocuments({
    conversation_id: convo._id,
    _id: { $gt: target },
    sender_id: { $ne: oid(userId) },
    deleted_at: null,
  });
  const unchanged = current?.equals(target) && member.unread_count === unread;
  const readAt = new Date();

  if (!unchanged) {
    await Conversation.updateOne(
      { _id: convo._id, 'members.user_id': oid(userId) },
      {
        $set: {
          'members.$.last_read_message_id': target,
          'members.$.last_read_at': readAt,
          'members.$.unread_count': unread,
        },
      },
    );
    const receipt = {
      conversation_id: conversationId,
      user_id: userId,
      last_read_message_id: target.toString(),
      read_at: readAt.toISOString(),
    };
    for (const id of convo.participant_ids) {
      if (id.toString() !== userId) emitToUser(id.toString(), 'message.read', receipt);
    }
    // The reader's other devices clear their unread badge too.
    const updated = await Conversation.findById(convo._id).lean<ConversationAttrs>();
    if (updated) emitToUser(userId, 'conversation.updated', await conversationFor(updated, userId));
  }

  return {
    conversation_id: conversationId,
    last_read_message_id: target.toString(),
    unread_count: unread,
  };
}

/**
 * Unsend: removes the message for everyone. The row stays for moderation, the inbox
 * preview falls back to the previous message, and unread counts drop if unread.
 */
export async function unsendMessage(userId: string, conversationId: string, messageId: string) {
  const convo = await requireMembership(conversationId, userId);
  const message = await Message.findOne({
    _id: messageId,
    conversation_id: convo._id,
  }).lean<MessageAttrs>();
  if (!message) throw ApiError.notFound('Message not found');
  if (message.sender_id.toString() !== userId) {
    throw ApiError.forbidden('You can only unsend your own messages.', 'NOT_MESSAGE_OWNER');
  }
  if (message.deleted_at) return (await toMessageDtos([message]))[0]!;

  const deletedAt = new Date();
  await Message.updateOne({ _id: message._id }, { $set: { deleted_at: deletedAt } });
  if (convo.last_message?.id.equals(message._id)) {
    await refreshLastMessage(convo._id);
  }

  await Promise.all(
    convo.members
      .filter((m) => m.user_id.toString() !== userId)
      .map(async (member) => {
        const unread = await Message.countDocuments({
          conversation_id: convo._id,
          sender_id: { $ne: member.user_id },
          deleted_at: null,
          ...(member.last_read_message_id ? { _id: { $gt: member.last_read_message_id } } : {}),
          ...(member.cleared_at ? { created_at: { $gt: member.cleared_at } } : {}),
        });
        await Conversation.updateOne(
          { _id: convo._id, 'members.user_id': member.user_id },
          { $set: { 'members.$.unread_count': unread } },
        );
      }),
  );

  const event = { conversation_id: conversationId, message_id: messageId };
  for (const id of convo.participant_ids) emitToUser(id.toString(), 'message.deleted', event);
  await broadcastConversation(convo._id);
  return (await toMessageDtos([{ ...message, deleted_at: deletedAt }]))[0]!;
}

async function findVisibleMessage(conversationId: Types.ObjectId, messageId: string) {
  const message = await Message.findOne({
    _id: messageId,
    conversation_id: conversationId,
    deleted_at: null,
  }).lean<MessageAttrs>();
  if (!message) throw ApiError.notFound('Message not found');
  return message;
}

/**
 * Sets (or with `emoji = null`, removes) my reaction. One reaction per person:
 * a new emoji replaces the previous one. Everyone in the chat gets `message.reaction`.
 */
export async function setReaction(
  userId: string,
  conversationId: string,
  messageId: string,
  emoji: string | null,
) {
  const convo = await requireMembership(conversationId, userId);
  const message = await findVisibleMessage(convo._id, messageId);
  const me = oid(userId);

  await Message.updateOne({ _id: message._id }, { $pull: { reactions: { user_id: me } } });
  if (emoji) {
    await Message.updateOne(
      { _id: message._id },
      { $push: { reactions: { user_id: me, emoji, created_at: new Date() } } },
    );
  }

  const updated = await Message.findById(message._id).select('reactions').lean<MessageAttrs>();
  const event = {
    conversation_id: conversationId,
    message_id: messageId,
    reactions: groupReactions((updated?.reactions ?? []) as ReactionSource[]),
  };
  for (const id of convo.participant_ids) emitToUser(id.toString(), 'message.reaction', event);
  return event;
}

/** Edits my own text message within EDIT_WINDOW_MS; quotes and the inbox preview follow. */
export async function editMessage(
  userId: string,
  conversationId: string,
  messageId: string,
  body: string,
) {
  const convo = await requireMembership(conversationId, userId);
  const message = await findVisibleMessage(convo._id, messageId);
  if (message.sender_id.toString() !== userId) {
    throw ApiError.forbidden('You can only edit your own messages.', 'NOT_MESSAGE_OWNER');
  }
  if (message.type !== 'text') {
    throw ApiError.badRequest('Only text messages can be edited.', undefined, 'MESSAGE_NOT_EDITABLE');
  }
  const createdAt = (message as unknown as { created_at: Date }).created_at;
  if (Date.now() - createdAt.getTime() > EDIT_WINDOW_MS) {
    throw ApiError.badRequest(
      'Messages can only be edited for 15 minutes.',
      undefined,
      'EDIT_WINDOW_EXPIRED',
    );
  }
  if (message.body === body) return (await toMessageDtos([message]))[0]!;

  const editedAt = new Date();
  await Message.updateOne({ _id: message._id }, { $set: { body, edited_at: editedAt } });
  const updated = { ...message, body, edited_at: editedAt };
  if (convo.last_message?.id.equals(message._id)) {
    await Conversation.updateOne(
      { _id: convo._id },
      { $set: { 'last_message.body': previewOf(updated) } },
    );
    await broadcastConversation(convo._id);
  }

  const dto = (await toMessageDtos([updated]))[0]!;
  for (const id of convo.participant_ids) emitToUser(id.toString(), 'message.updated', dto);
  return dto;
}

const MUTED_FOREVER = new Date('9999-12-31T00:00:00.000Z');

/** Mute only affects this member (push notifications will respect it). */
export async function setMuted(userId: string, conversationId: string, muted: boolean) {
  const convo = await requireMembership(conversationId, userId);
  await Conversation.updateOne(
    { _id: convo._id, 'members.user_id': oid(userId) },
    { $set: { 'members.$.muted_until': muted ? MUTED_FOREVER : null } },
  );
  const updated = await Conversation.findById(convo._id).lean<ConversationAttrs>();
  const dto = await conversationFor(updated!, userId);
  emitToUser(userId, 'conversation.updated', dto);
  return dto;
}

/**
 * "Delete chat" for me only: hides it from my inbox and hides its history from me.
 * A new message brings the conversation back, starting from that message.
 */
export async function deleteConversationForMe(userId: string, conversationId: string) {
  const convo = await requireMembership(conversationId, userId);
  const now = new Date();
  await Conversation.updateOne(
    { _id: convo._id, 'members.user_id': oid(userId) },
    {
      $set: {
        'members.$.cleared_at': now,
        'members.$.hidden': true,
        'members.$.unread_count': 0,
        ...(convo.last_message ? { 'members.$.last_read_message_id': convo.last_message.id } : {}),
        'members.$.last_read_at': now,
      },
    },
  );
  emitToUser(userId, 'conversation.deleted', { conversation_id: conversationId });
}

/** Participant ids for socket relays (typing). Returns null when the user is not a member. */
export async function participantIdsFor(conversationId: string, userId: string) {
  const convo = await Conversation.findOne(
    { _id: conversationId, participant_ids: oid(userId) },
    { participant_ids: 1 },
  ).lean<Pick<ConversationAttrs, '_id' | 'participant_ids'>>();
  return convo ? convo.participant_ids.map((id) => id.toString()) : null;
}
