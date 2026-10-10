import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
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
import { Follow } from '../src/modules/follows/follow.model';
import { Media } from '../src/modules/media/media.model';
import { Comment, PostLike, PostSave } from '../src/modules/posts/post.engage.model';
import { Post } from '../src/modules/posts/post.model';
import { Reel, ReelLike } from '../src/modules/reels/reel.model';
import * as storage from '../src/modules/media/media.storage';
import {
  Story,
  StoryLike,
  StoryMessage,
  StoryPollVote,
  StoryQuestionReply,
  StoryView,
} from '../src/modules/stories/story.model';
import { purgeExpiredStories } from '../src/modules/stories/story.service';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();
let n = 0;

type Account = { auth: string; id: string };

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
  return { auth: `Bearer ${verified.body.access_token as string}`, id: verified.body.user.id as string };
}

const api = (a: Account) => ({
  get: (path: string) => request(app).get(`/api/v1${path}`).set('Authorization', a.auth),
  post: (path: string, body?: object) =>
    request(app).post(`/api/v1${path}`).set('Authorization', a.auth).send(body ?? {}),
  patch: (path: string, body: object) =>
    request(app).patch(`/api/v1${path}`).set('Authorization', a.auth).send(body),
  put: (path: string) => request(app).put(`/api/v1${path}`).set('Authorization', a.auth),
  del: (path: string) => request(app).delete(`/api/v1${path}`).set('Authorization', a.auth),
});

async function media(
  owner: Account,
  purpose: 'post' | 'story' | 'reel',
  kind: 'image' | 'video' = 'image',
) {
  const row = await Media.create({
    owner_id: owner.id,
    purpose,
    kind,
    key: `${purpose}/${++n}.bin`,
    content_type: kind === 'video' ? 'video/mp4' : 'image/jpeg',
    bytes: 1000,
    width: 1080,
    height: kind === 'video' ? 1920 : 1080,
    duration_ms: kind === 'video' ? 8000 : undefined,
    status: 'ready',
    upload_expires_at: new Date(Date.now() + 60_000),
  });
  return row.id as string;
}

let alice: Account;
let bob: Account;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Promise.all(
    [User, OtpCode, RefreshToken, Follow, Media, Post, PostLike, PostSave, Comment, Story, StoryView, StoryLike, StoryMessage, StoryPollVote, StoryQuestionReply, Reel, ReelLike].map(
      (m) => m.init(),
    ),
  );
}, 120_000);

afterAll(async () => {
  await disconnectDatabase();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all(
    [User, OtpCode, RefreshToken, Follow, Media, Post, PostLike, PostSave, Comment, Story, StoryView, StoryLike, StoryMessage, StoryPollVote, StoryQuestionReply, Reel, ReelLike].map(
      (m) => (m as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
  alice = await signUp('alice');
  bob = await signUp('bob');
});

describe('feed, likes, saves, comments', () => {
  it('mixes public posts into the feed, toggles like and save, and threads a reply', async () => {
    const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((p) => p.id).sort();
    const mine = await api(alice).post('/posts', { media_ids: [await media(alice, 'post')] });
    const theirs = await api(bob).post('/posts', {
      media_ids: [await media(bob, 'post')],
      caption: 'Hello #goa',
    });
    // Public accounts show up without following; private ones don't.
    expect(ids(await api(alice).get('/feed'))).toEqual([mine.body.id, theirs.body.id].sort());
    await api(bob).patch('/users/me', { is_private: true });
    expect(ids(await api(alice).get('/feed'))).toEqual([mine.body.id]);
    await api(bob).patch('/users/me', { is_private: false });

    // Paging one at a time reaches every post exactly once.
    const first = await api(alice).get('/feed?limit=1');
    const second = await api(alice).get(`/feed?limit=1&cursor=${first.body.next_cursor as string}`);
    expect(second.body.next_cursor).toBeNull();
    expect([...ids(first), ...ids(second)].sort()).toEqual([mine.body.id, theirs.body.id].sort());

    await api(alice).post(`/users/${bob.id}/follow`);

    const liked = await api(alice).put(`/posts/${theirs.body.id as string}/like`);
    expect(liked.body).toMatchObject({ liked: true, likes_count: 1 });
    expect(liked.body.post.liked_by_me).toBe(true);
    const unliked = await api(alice).del(`/posts/${theirs.body.id as string}/like`);
    expect(unliked.body).toMatchObject({ liked: false, likes_count: 0 });

    const saved = await api(alice).post(`/posts/${theirs.body.id as string}/save`);
    expect(saved.body.saved).toBe(true);
    const list = await api(alice).get('/users/me/saved-posts');
    expect(list.body.items).toHaveLength(1);

    const comment = await api(alice).post(`/posts/${theirs.body.id as string}/comments`, {
      body: 'Nice!',
    });
    expect(comment.status).toBe(201);
    const reply = await api(bob).post(`/posts/${theirs.body.id as string}/comments`, {
      body: 'Thanks',
      parent_id: comment.body.id,
    });
    expect(reply.status).toBe(201);
    const comments = await api(alice).get(`/posts/${theirs.body.id as string}/comments`);
    expect(comments.body.items[0].replies).toHaveLength(1);
    expect((await api(bob).get(`/posts/${theirs.body.id as string}`)).body.comments_count).toBe(2);

    expect((await api(bob).del(`/comments/${reply.body.id as string}`)).status).toBe(204);
    expect((await api(alice).get(`/posts/${theirs.body.id as string}`)).body.comments_count).toBe(1);

    const another = await api(bob).post(`/posts/${theirs.body.id as string}/comments`, {
      body: 'Again',
      parent_id: comment.body.id,
    });
    expect(another.status).toBe(201);
    expect((await api(bob).get(`/posts/${theirs.body.id as string}`)).body.comments_count).toBe(2);

    expect((await api(bob).del(`/comments/${comment.body.id as string}`)).status).toBe(204);
    expect((await api(alice).get(`/posts/${theirs.body.id as string}`)).body.comments_count).toBe(0);
  });

  it('lets the owner edit and delete, and hides private posts', async () => {
    const created = await api(alice).post('/posts', {
      media_ids: [await media(alice, 'post')],
      caption: '#one',
    });
    const id = created.body.id as string;
    const edited = await api(alice).patch(`/posts/${id}`, { caption: 'two', location_name: 'Goa' });
    expect(edited.body).toMatchObject({ caption: 'two', location_name: 'Goa' });
    expect((await api(alice).del(`/posts/${id}`)).status).toBe(204);
    expect((await api(alice).get(`/posts/${id}`)).status).toBe(404);
    expect((await api(alice).get('/users/me')).body.posts_count).toBe(0);

    await api(bob).patch('/users/me', { is_private: true });
    const hidden = await api(bob).post('/posts', { media_ids: [await media(bob, 'post')] });
    expect((await api(alice).get(`/users/${bob.id}/posts`)).status).toBe(403);
    expect((await api(alice).get(`/posts/${hidden.body.id as string}`)).status).toBe(403);
  });
});

describe('stories and reels', () => {
  it('remembers when the author watches their own story, without listing them as a viewer', async () => {
    const created = await api(alice).post('/stories', { media_id: await media(alice, 'story') });
    const id = created.body.id as string;
    expect((await api(alice).get('/stories/tray')).body.items[0].seen).toBe(false);
    expect((await api(alice).post(`/stories/${id}/view`)).status).toBe(204);
    const tray = (await api(alice).get('/stories/tray')).body.items[0];
    expect(tray.seen).toBe(true);
    expect(tray.stories[0].seen).toBe(true);
    expect((await api(alice).get(`/stories/${id}/viewers`)).body.items).toEqual([]);
  });

  it('publishes a story for followers and marks it seen', async () => {
    const created = await api(alice).post('/stories', { media_id: await media(alice, 'story') });
    expect(created.status).toBe(201);
    expect(created.body.liked_by_me).toBeUndefined();
    expect((await api(bob).get('/stories/tray')).body.items).toEqual([]);
    await api(bob).post(`/users/${alice.id}/follow`);
    // Like Instagram: following is enough, no follow-back needed.
    const tray = await api(bob).get('/stories/tray');
    expect(tray.body.items[0].seen).toBe(false);
    const storyId = tray.body.items[0].stories[0].id as string;
    expect((await api(bob).post(`/stories/${storyId}/view`)).status).toBe(204);
    expect((await api(bob).get('/stories/tray')).body.items[0].seen).toBe(true);
    expect((await api(alice).get(`/stories/${storyId}/viewers`)).body.items[0].username).toBe('bob');
    expect((await api(alice).del(`/stories/${storyId}`)).status).toBe(204);
    expect(vi.mocked(storage.deleteObjects)).toHaveBeenCalledWith([expect.stringMatching(/^story\//)]);
    expect(await Media.countDocuments({ purpose: 'story' })).toBe(0);
  });

  it('removes a story and its S3 file once 24 hours have passed', async () => {
    const mediaId = await media(alice, 'story');
    const created = await api(alice).post('/stories', { media_id: mediaId });
    const storyId = created.body.id as string;
    await api(bob).post(`/users/${alice.id}/follow`);
    await api(alice).post(`/users/${bob.id}/follow`);
    await api(bob).post(`/stories/${storyId}/view`);
    expect((await request(app).put(`/api/v1/stories/${storyId}/like`).set('Authorization', bob.auth)).status).toBe(200);
    expect((await api(bob).post(`/stories/${storyId}/message`, { body: 'Nice' })).status).toBe(201);
    const key = (await Media.findById(mediaId))!.key;

    const fresh = await media(alice, 'story');
    const unused = await media(alice, 'story');
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Media.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(unused) },
      { $set: { created_at: dayAgo } },
    );

    await Story.updateOne({ _id: storyId }, { expires_at: new Date(Date.now() - 1000) });
    expect((await api(bob).get('/stories/tray')).body.items).toEqual([]);
    expect((await api(bob).post(`/stories/${storyId}/view`)).status).toBe(404);
    expect((await api(alice).get(`/stories/${storyId}/viewers`)).status).toBe(404);

    vi.mocked(storage.deleteObjects).mockClear();
    expect(await purgeExpiredStories()).toEqual({ stories: 1, orphans: 1 });
    const deleted = vi.mocked(storage.deleteObjects).mock.calls.flat(2);
    expect(deleted).toContain(key);
    expect(deleted).toHaveLength(2);
    expect(await Story.countDocuments()).toBe(0);
    expect(await StoryView.countDocuments()).toBe(0);
    expect(await StoryLike.countDocuments()).toBe(0);
    expect(await StoryMessage.countDocuments()).toBe(0);
    expect(await Media.exists({ _id: mediaId })).toBeNull();
    expect(await Media.exists({ _id: unused })).toBeNull();
    expect(await Media.exists({ _id: fresh })).not.toBeNull();

    expect(await purgeExpiredStories()).toEqual({ stories: 0, orphans: 0 });
  });

  it('saves story text, a poll vote and a question answer', async () => {
    const created = await api(alice).post('/stories', {
      media_id: await media(alice, 'story'),
      location_name: 'Ahmedabad',
      location_lat: 23.03,
      location_lng: 72.58,
      overlays: [
        {
          id: 'text-1',
          type: 'text',
          x: 0.5,
          y: 0.2,
          scale: 1,
          rotation: 0,
          text: 'Hello',
          color: '#FFFFFF',
          background: '#000000',
        },
        {
          id: 'poll-1',
          type: 'poll',
          x: 0.5,
          y: 0.4,
          scale: 1,
          rotation: 0,
          question: 'Coming?',
          options: ['Yes', 'No'],
        },
        {
          id: 'ask-1',
          type: 'question',
          x: 0.5,
          y: 0.6,
          scale: 1,
          rotation: 0,
          prompt: 'Where?',
        },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.location_lat).toBe(23.03);
    expect(created.body.overlays).toHaveLength(3);

    await api(bob).post(`/users/${alice.id}/follow`);
    await api(alice).post(`/users/${bob.id}/follow`);
    const vote = await api(bob).post(`/stories/${created.body.id as string}/vote`, {
      overlay_id: 'poll-1',
      option: 0,
    });
    expect(vote.status).toBe(200);
    const poll = (vote.body.overlays as { type: string; votes?: number[] }[]).find(o => o.type === 'poll');
    expect(poll?.votes).toEqual([1, 0]);

    const reply = await api(bob).post(`/stories/${created.body.id as string}/reply`, {
      overlay_id: 'ask-1',
      body: 'The cafe',
    });
    expect(reply.status).toBe(201);
  });

  it('publishes a reel with a caption and a like', async () => {
    const created = await api(alice).post('/reels', {
      video_media_id: await media(alice, 'reel', 'video'),
      caption: 'Dance #reels',
      location_name: 'Ahmedabad',
      client_upload_id: 'reel-upload1',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      location_name: 'Ahmedabad',
      location_lat: null,
      duration_ms: 8000,
      audio_muted: false,
      cover_time_ms: 0,
      cover_url: null,
    });
    const again = await api(alice).post('/reels', {
      video_media_id: await media(alice, 'reel', 'video'),
      client_upload_id: 'reel-upload1',
    });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(created.body.id);

    await api(bob).post(`/users/${alice.id}/follow`);
    const feed = await api(bob).get('/reels');
    expect(feed.body.items).toHaveLength(1);
    const liked = await api(bob).post(`/reels/${created.body.id as string}/like`);
    expect(liked.body.liked_by_me).toBe(true);
    expect(liked.body.likes_count).toBe(1);
    const grid = await api(bob).get(`/users/${alice.id}/reels`);
    expect(grid.body.items).toHaveLength(1);
  });
});

describe('theme preferences', () => {
  it('stores a mood and lets a theme clear it', async () => {
    const mood = await api(alice).patch('/users/me/preferences', { mood: 'romantic' });
    expect(mood.body).toMatchObject({ theme: 'system', mood: 'romantic' });
    expect((await api(alice).get('/users/me')).body.preferences).toMatchObject({
      theme: 'system',
      mood: 'romantic',
    });
    const theme = await api(alice).patch('/users/me/preferences', { theme: 'dark' });
    expect(theme.body).toMatchObject({ theme: 'dark', mood: null });
    expect((await api(alice).patch('/users/me/preferences', {})).status).toBe(400);
    expect((await api(alice).patch('/users/me/preferences', { mood: 'nope' })).status).toBe(400);
  });
});
