import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import { openDirectConversation, sendMessage } from '../messages/messages.service';
import { canViewContent, findVisibleUser, toUserSummaries } from '../follows/follow.service';
import { audienceIds, isBlockedEither } from '../safety/block.service';
import { Follow } from '../follows/follow.model';
import { Media } from '../media/media.model';
import { deleteObjects, viewUrl } from '../media/media.storage';
import { User, type UserDoc } from '../users/user.model';
import { Notification } from '../notifications/notification.model';
import {
  Story,
  STORY_TTL_MS,
  StoryLike,
  StoryMessage,
  StoryPollVote,
  StoryQuestionReply,
  StoryView,
  type StoryDoc,
} from './story.model';
import type { StoryOverlay } from './story.schema';

type VoteCounts = Map<string, number[]>;

async function voteCounts(stories: StoryDoc[]): Promise<Map<string, VoteCounts>> {
  if (!stories.length) return new Map();
  const rows = await StoryPollVote.aggregate<{ _id: { story: mongoose.Types.ObjectId; overlay: string; option: number }; n: number }>([
    { $match: { story_id: { $in: stories.map((s) => s._id) } } },
    { $group: { _id: { story: '$story_id', overlay: '$overlay_id', option: '$option' }, n: { $sum: 1 } } },
  ]);
  const byStory = new Map<string, VoteCounts>();
  for (const row of rows) {
    const storyId = row._id.story.toHexString();
    const counts = byStory.get(storyId) ?? new Map<string, number[]>();
    const list = counts.get(row._id.overlay) ?? [];
    list[row._id.option] = row.n;
    counts.set(row._id.overlay, list);
    byStory.set(storyId, counts);
  }
  return byStory;
}

function withVotes(overlays: StoryOverlay[], counts?: VoteCounts) {
  return overlays.map((overlay) => {
    if (overlay.type !== 'poll') return overlay;
    const votes = overlay.options.map((_, i) => counts?.get(overlay.id)?.[i] ?? 0);
    return { ...overlay, votes };
  });
}

async function storyMedia(story: StoryDoc, counts?: VoteCounts) {
  return {
    id: story.id as string,
    kind: story.kind,
    url: await viewUrl(story.key),
    width: story.width,
    height: story.height,
    duration_ms: story.duration_ms,
    location_name: story.location_name ?? '',
    location_lat: story.location_lat ?? null,
    location_lng: story.location_lng ?? null,
    overlays: withVotes((story.overlays ?? []) as StoryOverlay[], counts),
    created_at: (story.get('created_at') as Date).toISOString(),
    expires_at: story.expires_at.toISOString(),
  };
}

export async function createStory(
  author: UserDoc,
  input: {
    media_id: string;
    location_name: string;
    location_lat?: number | null;
    location_lng?: number | null;
    overlays: StoryOverlay[];
  },
) {
  for (const overlay of input.overlays) {
    if (overlay.type === 'quiz' && overlay.answer >= overlay.options.length) {
      throw ApiError.badRequest('Pick a quiz answer that exists.', { field: 'overlays' }, 'INVALID_OVERLAY');
    }
    if (overlay.type === 'link' && !/^https?:\/\//i.test(overlay.url)) {
      throw ApiError.badRequest('Links have to start with http:// or https://.', { field: 'overlays' }, 'INVALID_OVERLAY');
    }
  }
  const media = await Media.findOne({ _id: input.media_id, owner_id: author._id });
  if (!media || media.status !== 'ready' || media.purpose !== 'story' || media.kind === 'audio') {
    throw ApiError.badRequest(
      "That story didn't finish uploading. Please try again.",
      { field: 'media_id' },
      'INVALID_MEDIA',
    );
  }
  const story = await Story.create({
    author_id: author._id,
    media_id: media._id,
    key: media.key,
    kind: media.kind,
    width: media.width,
    height: media.height,
    duration_ms: media.duration_ms,
    location_name: input.location_name,
    location_lat: input.location_lat ?? null,
    location_lng: input.location_lng ?? null,
    overlays: input.overlays,
    expires_at: new Date(Date.now() + STORY_TTL_MS),
  });
  return storyMedia(story);
}

/** People who follow the viewer and whom the viewer follows back (both accepted). */
async function mutualIds(viewerId: mongoose.Types.ObjectId) {
  const following = await Follow.find({ follower_id: viewerId, status: 'accepted' })
    .select('following_id')
    .lean();
  const back = await Follow.find({
    follower_id: { $in: following.map((f) => f.following_id) },
    following_id: viewerId,
    status: 'accepted',
  })
    .select('follower_id')
    .lean();
  return back.map((f) => f.follower_id);
}

async function isMutual(a: mongoose.Types.ObjectId, b: mongoose.Types.ObjectId) {
  const n = await Follow.countDocuments({
    status: 'accepted',
    $or: [
      { follower_id: a, following_id: b },
      { follower_id: b, following_id: a },
    ],
  });
  return n === 2;
}

/**
 * Your story first, then people you and they both follow. Someone you follow
 * who doesn't follow you back is left out. `seen` is false while any item is unseen.
 */
export async function storyTray(viewer: UserDoc) {
  const authorIds = await audienceIds(viewer._id, await mutualIds(viewer._id));
  const stories = await Story.find({
    author_id: { $in: authorIds },
    expires_at: { $gt: new Date() },
  }).sort({ _id: 1 });
  if (!stories.length) return { items: [] };

  const seenRows = await StoryView.find({
    viewer_id: viewer._id,
    story_id: { $in: stories.map((s) => s._id) },
  })
    .select('story_id')
    .lean();
  const seen = new Set(seenRows.map((r) => r.story_id.toHexString()));
  const counts = await voteCounts(stories);
  const likeRows = await StoryLike.find({
    user_id: viewer._id,
    story_id: { $in: stories.map((s) => s._id) },
  })
    .select('story_id')
    .lean();
  const liked = new Set(likeRows.map((r) => r.story_id.toHexString()));
  const users = await User.find({ _id: { $in: authorIds } });
  const summaries = new Map((await toUserSummaries(viewer, users)).map((u) => [u.id, u]));

  const groups = new Map<string, StoryDoc[]>();
  for (const story of stories) {
    const id = story.author_id.toHexString();
    groups.set(id, [...(groups.get(id) ?? []), story]);
  }

  const items = await Promise.all(
    [...groups.entries()].map(async ([id, list]) => ({
      user: summaries.get(id)!,
      seen: list.every((s) => seen.has(s.id as string) || s.author_id.equals(viewer._id)),
      stories: await Promise.all(
        list.map(async (s) => ({
          ...(await storyMedia(s, counts.get(s.id as string))),
          seen: seen.has(s.id as string) || s.author_id.equals(viewer._id),
          liked_by_me: liked.has(s.id as string),
        })),
      ),
    })),
  );
  items.sort((a, b) => Number(b.user.is_self) - Number(a.user.is_self) || Number(a.seen) - Number(b.seen));
  return { items };
}

export async function markViewed(viewer: UserDoc, storyId: string) {
  const story = await Story.findById(storyId);
  if (!story || story.expires_at <= new Date()) {
    throw ApiError.notFound('This story is no longer available.');
  }
  if (story.author_id.equals(viewer._id)) return;
  await visibleStory(viewer, storyId);
  await StoryView.updateOne(
    { story_id: story._id, viewer_id: viewer._id },
    { $setOnInsert: { story_id: story._id, viewer_id: viewer._id } },
    { upsert: true },
  );
}

export async function deleteStory(viewer: UserDoc, storyId: string) {
  const story = await Story.findOne({ _id: storyId, author_id: viewer._id });
  if (!story) throw ApiError.notFound('This story is no longer available.');
  await removeStories([story]);
}

type StoryFiles = { _id: mongoose.Types.ObjectId; key: string; media_id: mongoose.Types.ObjectId };

/**
 * Deletes the files from S3 first, then everything attached to the stories, and
 * the stories last, so a failure part-way is retried by the next purge.
 */
async function removeStories(stories: StoryFiles[]) {
  if (!stories.length) return;
  const ids = stories.map((s) => s._id);
  await deleteObjects(stories.map((s) => s.key));
  await Promise.all([
    Media.deleteMany({ _id: { $in: stories.map((s) => s.media_id) } }),
    StoryView.deleteMany({ story_id: { $in: ids } }),
    StoryLike.deleteMany({ story_id: { $in: ids } }),
    StoryPollVote.deleteMany({ story_id: { $in: ids } }),
    StoryQuestionReply.deleteMany({ story_id: { $in: ids } }),
    StoryMessage.deleteMany({ story_id: { $in: ids } }),
  ]);
  await Story.deleteMany({ _id: { $in: ids } });
}

const PURGE_BATCH = 200;

/**
 * Removes stories older than 24 hours from S3 and the database, plus story
 * uploads that never became a story. Returns how many of each were removed.
 */
export async function purgeExpiredStories(now = new Date()) {
  let stories = 0;
  for (;;) {
    const batch = await Story.find({ expires_at: { $lte: now } })
      .select('_id key media_id')
      .limit(PURGE_BATCH)
      .lean<StoryFiles[]>();
    if (!batch.length) break;
    await removeStories(batch);
    stories += batch.length;
    if (batch.length < PURGE_BATCH) break;
  }

  let orphans = 0;
  const cutoff = new Date(now.getTime() - STORY_TTL_MS);
  let lastId: mongoose.Types.ObjectId | undefined;
  for (;;) {
    const candidates = await Media.find({
      purpose: 'story',
      status: 'ready',
      created_at: { $lt: cutoff },
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    })
      .sort({ _id: 1 })
      .select('_id key')
      .limit(PURGE_BATCH)
      .lean();
    if (!candidates.length) break;
    lastId = candidates[candidates.length - 1]!._id;
    const used = await Story.find({ media_id: { $in: candidates.map((m) => m._id) } })
      .select('media_id')
      .lean();
    const usedIds = new Set(used.map((s) => s.media_id.toHexString()));
    const unused = candidates.filter((m) => !usedIds.has(m._id.toHexString()));
    if (unused.length) {
      await deleteObjects(unused.map((m) => m.key));
      await Media.deleteMany({ _id: { $in: unused.map((m) => m._id) } });
      orphans += unused.length;
    }
    if (candidates.length < PURGE_BATCH) break;
  }
  return { stories, orphans };
}

async function visibleStory(viewer: UserDoc, storyId: string) {
  const story = await Story.findById(storyId);
  if (!story || story.expires_at <= new Date()) {
    throw ApiError.notFound('This story is no longer available.');
  }
  if (story.author_id.equals(viewer._id)) return story;
  const author = await findVisibleUser(story.author_id.toHexString());
  if (await isBlockedEither(viewer._id, author._id)) {
    throw ApiError.notFound('This story is no longer available.');
  }
  if (!(await canViewContent(viewer, author))) {
    throw ApiError.forbidden('This account is private.', 'PRIVATE_ACCOUNT');
  }
  if (!(await isMutual(viewer._id, author._id))) {
    throw ApiError.notFound('This story is no longer available.');
  }
  return story;
}

export async function votePoll(viewer: UserDoc, storyId: string, overlayId: string, option: number) {
  const story = await visibleStory(viewer, storyId);
  const overlay = ((story.overlays ?? []) as StoryOverlay[]).find((item) => item.id === overlayId);
  if (!overlay || overlay.type !== 'poll' || option >= overlay.options.length) {
    throw ApiError.badRequest('That poll choice is not available.', { field: 'option' }, 'INVALID_VOTE');
  }
  await StoryPollVote.updateOne(
    { story_id: story._id, overlay_id: overlayId, user_id: viewer._id },
    { $set: { option } },
    { upsert: true },
  );
  const counts = await voteCounts([story]);
  return storyMedia(story, counts.get(story.id as string));
}

export async function replyQuestion(viewer: UserDoc, storyId: string, overlayId: string, body: string) {
  const story = await visibleStory(viewer, storyId);
  const overlay = ((story.overlays ?? []) as StoryOverlay[]).find((item) => item.id === overlayId);
  if (!overlay || overlay.type !== 'question') {
    throw ApiError.badRequest('That question is not on this story.', { field: 'overlay_id' }, 'INVALID_REPLY');
  }
  await StoryQuestionReply.updateOne(
    { story_id: story._id, overlay_id: overlayId, user_id: viewer._id },
    { $set: { body } },
    { upsert: true },
  );
  return { ok: true };
}

/** Who viewed the viewer's own story: people who liked it first, then newest first. */
export async function storyViewers(viewer: UserDoc, storyId: string) {
  const story = await Story.findOne({
    _id: storyId,
    author_id: viewer._id,
    expires_at: { $gt: new Date() },
  });
  if (!story) throw ApiError.notFound('This story is no longer available.');
  const views = await StoryView.find({ story_id: story._id }).sort({ _id: -1 }).limit(200).lean();
  const likeRows = await StoryLike.find({ story_id: story._id }).select('user_id').lean();
  const likers = new Set(likeRows.map((r) => r.user_id.toHexString()));
  const users = await User.find({ _id: { $in: views.map((v) => v.viewer_id) }, status: 'active' });
  const summaries = new Map((await toUserSummaries(viewer, users)).map((u) => [u.id, u]));
  const items = views.flatMap((v) => {
    const user = summaries.get(v.viewer_id.toHexString());
    return user ? [{ ...user, liked: likers.has(user.id) }] : [];
  });
  items.sort((a, b) => Number(b.liked) - Number(a.liked));
  return { items };
}

/** Sets the like on a story. Repeating the same request changes nothing. */
export async function setStoryLike(viewer: UserDoc, storyId: string, want: boolean) {
  const story = await visibleStory(viewer, storyId);
  if (want) {
    const res = await StoryLike.updateOne(
      { story_id: story._id, user_id: viewer._id },
      { $setOnInsert: { story_id: story._id, user_id: viewer._id } },
      { upsert: true },
    );
    if (res.upsertedCount > 0 && !story.author_id.equals(viewer._id)) {
      await Notification.create({
        recipient_id: story.author_id,
        actor_id: viewer._id,
        type: 'story_like',
        text: ` liked your story`,
      });
    }
  } else {
    await StoryLike.deleteOne({ story_id: story._id, user_id: viewer._id });
  }
  return { liked: want };
}

/** A private reply to a story, sent as a DM to the owner with the story shown above it. */
export async function messageStory(viewer: UserDoc, storyId: string, body: string) {
  const story = await visibleStory(viewer, storyId);
  if (story.author_id.equals(viewer._id)) {
    throw ApiError.badRequest("You can't reply to your own story.", undefined, 'CANNOT_REPLY_SELF');
  }
  const viewerId = viewer.id as string;
  const { conversation } = await openDirectConversation(viewerId, story.author_id.toHexString());
  const message = await sendMessage(
    viewerId,
    conversation.id,
    { body, client_message_id: randomUUID() },
    { storyId: story._id },
  );
  return { id: message.id, conversation_id: conversation.id };
}