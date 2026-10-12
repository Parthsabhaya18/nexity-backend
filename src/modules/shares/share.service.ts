import { randomUUID } from 'node:crypto';

import { Types } from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import { Follow } from '../follows/follow.model';
import { findVisibleUser } from '../follows/follow.service';
import { Conversation } from '../messages/conversation.model';
import { openDirectConversation, sendMessage } from '../messages/messages.service';
import { getPost } from '../posts/post.service';
import { getReel } from '../reels/reel.service';
import { blockIdsFor, isBlockedEither } from '../safety/block.service';
import {
  PUBLIC_USER_FIELDS,
  type PublicUserSource,
  toPublicUserDto,
  User,
  type UserDoc,
  withAvatarUrls,
} from '../users/user.model';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * People a post or reel can be sent to: everyone you have chatted with (newest
 * chat first), then the people you follow, then your followers.
 */
export async function shareTargets(viewer: UserDoc, q: string, limit: number) {
  const me = viewer._id;
  const [chats, following, followers, blocked] = await Promise.all([
    Conversation.find({ participant_ids: me, type: 'direct', last_message_at: { $ne: null } })
      .sort({ last_message_at: -1 })
      .limit(200)
      .select('participant_ids')
      .lean(),
    Follow.find({ follower_id: me, status: 'accepted' }).sort({ _id: -1 }).select('following_id').lean(),
    Follow.find({ following_id: me, status: 'accepted' }).sort({ _id: -1 }).select('follower_id').lean(),
    blockIdsFor(me),
  ]);
  const hidden = new Set([me.toHexString(), ...blocked.map((id) => id.toHexString())]);
  const order: string[] = [];
  const add = (id: Types.ObjectId) => {
    const key = id.toHexString();
    if (!hidden.has(key) && !order.includes(key)) order.push(key);
  };
  chats.forEach((c) => c.participant_ids.forEach(add));
  following.forEach((f) => add(f.following_id));
  followers.forEach((f) => add(f.follower_id));

  const filter: Record<string, unknown> = { _id: { $in: order }, status: 'active', is_verified: true };
  const term = q.trim().replace(/^@/, '');
  if (term) {
    const pattern = escapeRegex(term);
    filter.$or = [
      { username: { $regex: `^${pattern.toLowerCase()}` } },
      { display_name: { $regex: pattern, $options: 'i' } },
    ];
  }
  const users = await User.find(filter).select(PUBLIC_USER_FIELDS).lean<PublicUserSource[]>();
  const rank = new Map(order.map((id, i) => [id, i]));
  users.sort((a, b) => rank.get(a._id.toString())! - rank.get(b._id.toString())!);
  return { data: (await withAvatarUrls(users.slice(0, limit))).map(toPublicUserDto) };
}

/**
 * Sends the post or reel to each person's chat as a card, followed by the note
 * as its own message. Blocked people are skipped.
 */
export async function shareToPeople(
  viewer: UserDoc,
  input: {
    kind: 'post' | 'reel' | 'profile';
    id: string;
    user_ids: string[];
    body: string;
    media_index?: number;
  },
) {
  let index = 0;
  if (input.kind === 'post') {
    const post = await getPost(viewer, input.id);
    index = Math.min(input.media_index ?? 0, Math.max(0, post.media.length - 1));
  } else if (input.kind === 'reel') {
    await getReel(viewer, input.id);
  } else {
    const account = await findVisibleUser(input.id);
    if (await isBlockedEither(viewer._id, account._id)) throw ApiError.notFound('User not found.');
  }
  const viewerId = viewer.id as string;
  const share = { kind: input.kind, id: new Types.ObjectId(input.id), index };
  const conversationIds: string[] = [];
  for (const userId of new Set(input.user_ids)) {
    if (userId === viewerId) continue;
    if (await isBlockedEither(viewer._id, new Types.ObjectId(userId))) continue;
    const { conversation } = await openDirectConversation(viewerId, userId);
    await sendMessage(viewerId, conversation.id, { body: '', client_message_id: randomUUID() }, { share });
    if (input.body) {
      await sendMessage(viewerId, conversation.id, { body: input.body, client_message_id: randomUUID() });
    }
    conversationIds.push(conversation.id);
  }
  return { conversation_ids: conversationIds };
}
