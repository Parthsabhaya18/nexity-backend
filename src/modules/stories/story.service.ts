import mongoose from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import { canViewContent, findVisibleUser, toUserSummaries } from '../follows/follow.service';
import { audienceIds, isBlockedEither } from '../safety/block.service';
import { Follow } from '../follows/follow.model';
import { Media } from '../media/media.model';
import { viewUrl } from '../media/media.storage';
import { User, type UserDoc } from '../users/user.model';
import { Story, STORY_TTL_MS, StoryPollVote, StoryQuestionReply, StoryView, type StoryDoc } from './story.model';
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
    music_title: story.music_title ?? '',
    location_name: story.location_name ?? '',
    location_lat: story.location_lat ?? null,
    location_lng: story.location_lng ?? null,
    filter: story.filter || 'normal',
    overlays: withVotes((story.overlays ?? []) as StoryOverlay[], counts),
    created_at: (story.get('created_at') as Date).toISOString(),
    expires_at: story.expires_at.toISOString(),
  };
}

export async function createStory(
  author: UserDoc,
  input: {
    media_id: string;
    music_title: string;
    location_name: string;
    location_lat?: number | null;
    location_lng?: number | null;
    filter: string;
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
  if (!media || media.status !== 'ready' || media.purpose !== 'story') {
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
    music_title: input.music_title,
    location_name: input.location_name,
    location_lat: input.location_lat ?? null,
    location_lng: input.location_lng ?? null,
    filter: input.filter,
    overlays: input.overlays,
    expires_at: new Date(Date.now() + STORY_TTL_MS),
  });
  return storyMedia(story);
}

/** Your story first, then people you follow. `seen` is false while any item is unseen. */
export async function storyTray(viewer: UserDoc) {
  const follows = await Follow.find({ follower_id: viewer._id, status: 'accepted' })
    .select('following_id')
    .lean();
  const authorIds = await audienceIds(
    viewer._id,
    follows.map((f) => f.following_id),
  );
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
  const author = await findVisibleUser(story.author_id.toHexString());
  if (await isBlockedEither(viewer._id, author._id)) {
    throw ApiError.notFound('This story is no longer available.');
  }
  if (!(await canViewContent(viewer, author))) {
    throw ApiError.forbidden('This account is private.', 'PRIVATE_ACCOUNT');
  }
  await StoryView.updateOne(
    { story_id: story._id, viewer_id: viewer._id },
    { $setOnInsert: { story_id: story._id, viewer_id: viewer._id } },
    { upsert: true },
  );
}

export async function deleteStory(viewer: UserDoc, storyId: string) {
  const story = await Story.findOne({ _id: storyId, author_id: viewer._id });
  if (!story) throw ApiError.notFound('This story is no longer available.');
  await story.deleteOne();
  await StoryView.deleteMany({ story_id: story._id });
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

/** Who viewed the viewer's own story, newest first. */
export async function storyViewers(viewer: UserDoc, storyId: string) {
  const story = await Story.findOne({ _id: storyId, author_id: viewer._id });
  if (!story) throw ApiError.notFound('This story is no longer available.');
  const views = await StoryView.find({ story_id: story._id }).sort({ _id: -1 }).limit(200).lean();
  const users = await User.find({ _id: { $in: views.map((v) => v.viewer_id) }, status: 'active' });
  const summaries = new Map((await toUserSummaries(viewer, users)).map((u) => [u.id, u]));
  return {
    items: views.flatMap((v) => {
      const user = summaries.get(v.viewer_id.toHexString());
      return user ? [user] : [];
    }),
  };
}
