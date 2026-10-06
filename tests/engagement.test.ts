import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { OtpCode } from '../src/modules/auth/otpCode.model';
import { RefreshToken } from '../src/modules/auth/refreshToken.model';
import { Follow } from '../src/modules/follows/follow.model';
import { Media } from '../src/modules/media/media.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { Comment, PostLike, PostSave } from '../src/modules/posts/post.engage.model';
import { Post } from '../src/modules/posts/post.model';
import { Reel, ReelLike } from '../src/modules/reels/reel.model';
import { Block } from '../src/modules/safety/block.model';
import { SearchHistory } from '../src/modules/search/searchHistory.model';
import { Story, StoryLike, StoryMessage } from '../src/modules/stories/story.model';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();

type Account = { auth: string; id: string; username: string };

async function signUp(username: string): Promise<Account> {
  const email = `${username.replace(/\./g, '')}@example.com`;
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

const api = (a: Account) => {
  const call = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: object) => {
    const req = request(app)[method](`/api/v1${path}`).set('Authorization', a.auth);
    return body === undefined ? req : req.send(body);
  };
  return {
    get: (path: string) => call('get', path),
    post: (path: string, body: object = {}) => call('post', path, body),
    put: (path: string) => call('put', path),
    patch: (path: string, body: object) => call('patch', path, body),
    del: (path: string) => call('delete', path),
  };
};

let counter = 0;
async function readyMedia(
  owner: Account,
  overrides: Record<string, unknown> = {},
) {
  const media = await Media.create({
    owner_id: owner.id,
    purpose: 'post',
    kind: 'image',
    key: `posts/${owner.id}/${++counter}.jpg`,
    content_type: 'image/jpeg',
    bytes: 1000,
    width: 1080,
    height: 1350,
    status: 'ready',
    upload_expires_at: new Date(Date.now() + 60_000),
    ...overrides,
  });
  return media.id as string;
}

const reelMedia = (owner: Account) =>
  readyMedia(owner, {
    purpose: 'reel',
    kind: 'video',
    key: `reels/${owner.id}/${++counter}.mp4`,
    content_type: 'video/mp4',
    duration_ms: 8000,
    width: 720,
    height: 1280,
  });

const MODELS = [
  User,
  OtpCode,
  RefreshToken,
  Follow,
  Media,
  Post,
  PostLike,
  PostSave,
  Comment,
  Reel,
  ReelLike,
  Story,
  StoryLike,
  StoryMessage,
  Block,
  SearchHistory,
  Notification,
] as unknown as mongoose.Model<unknown>[];

let alice: Account;
let bob: Account;
let cara: Account;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Promise.all(MODELS.map((m) => m.init()));
}, 120_000);

afterAll(async () => {
  await disconnectDatabase();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all(MODELS.map((m) => m.deleteMany({})));
  alice = await signUp('alice');
  bob = await signUp('bob.smith');
  cara = await signUp('cara');
});

async function newPost(owner: Account, extra: Record<string, unknown> = {}) {
  const res = await api(owner).post('/posts', { media_ids: [await readyMedia(owner)], ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: string } & Record<string, unknown>;
}

describe('tagging people', () => {
  it('stores tagged people and shows them to viewers', async () => {
    const post = await newPost(alice, { tagged_user_ids: [bob.id, cara.id, bob.id] });
    expect((post.tagged_users as { username: string }[]).map((u) => u.username)).toEqual([
      'bob.smith',
      'cara',
    ]);
    const seen = await api(cara).get(`/posts/${post.id}`);
    expect(seen.body.tagged_users).toHaveLength(2);
  });

  it('refuses unknown or blocked people', async () => {
    await api(alice).post(`/users/${bob.id}/block`);
    const blocked = await api(alice).post('/posts', {
      media_ids: [await readyMedia(alice)],
      tagged_user_ids: [bob.id],
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe('INVALID_TAG');
    const unknown = await api(alice).post('/posts', {
      media_ids: [await readyMedia(alice)],
      tagged_user_ids: [new mongoose.Types.ObjectId().toHexString()],
    });
    expect(unknown.status).toBe(400);
  });

  it('hides a tagged account once they are blocked', async () => {
    const post = await newPost(alice, { tagged_user_ids: [bob.id] });
    await api(cara).post(`/users/${bob.id}/block`);
    const seen = await api(cara).get(`/posts/${post.id}`);
    expect(seen.body.tagged_users).toEqual([]);
  });
});

describe('likes and the hidden count', () => {
  it('sets likes idempotently', async () => {
    const post = await newPost(alice);
    const path = `/posts/${post.id}/like`;
    const first = await api(bob).put(path);
    const again = await api(bob).put(path);
    expect(first.body).toMatchObject({ liked: true, likes_count: 1 });
    expect(again.body).toMatchObject({ liked: true, likes_count: 1 });
    const off = await api(bob).del(path);
    const offAgain = await api(bob).del(path);
    expect(off.body).toMatchObject({ liked: false, likes_count: 0 });
    expect(offAgain.body).toMatchObject({ liked: false, likes_count: 0 });
  });

  it('hides the count from everyone, including the owner, until it is shown again', async () => {
    const post = await newPost(alice);
    await api(bob).put(`/posts/${post.id}/like`);
    expect((await api(alice).get(`/posts/${post.id}`)).body.likes_count).toBe(1);

    const hidden = await api(alice).patch(`/posts/${post.id}`, { hide_like_count: true });
    expect(hidden.body).toMatchObject({ hide_like_count: true, likes_count: null });
    expect((await api(bob).get(`/posts/${post.id}`)).body.likes_count).toBeNull();
    const liked = await api(cara).put(`/posts/${post.id}/like`);
    expect(liked.body.likes_count).toBeNull();
    expect(liked.body.post.hide_like_count).toBe(true);

    const shown = await api(alice).patch(`/posts/${post.id}`, { hide_like_count: false });
    expect(shown.body.likes_count).toBe(2);
  });

  it('turns commenting off and on', async () => {
    const post = await newPost(alice);
    await api(alice).patch(`/posts/${post.id}`, { comments_disabled: true });
    const blocked = await api(bob).post(`/posts/${post.id}/comments`, { body: 'hi' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('COMMENTS_DISABLED');
    await api(alice).patch(`/posts/${post.id}`, { comments_disabled: false });
    expect((await api(bob).post(`/posts/${post.id}/comments`, { body: 'hi' })).status).toBe(201);
  });

  it('edits the description and re-reads the mentions', async () => {
    const post = await newPost(alice, { caption: 'first' });
    const edited = await api(alice).patch(`/posts/${post.id}`, { caption: 'with @bob.smith' });
    expect(edited.body).toMatchObject({ caption: 'with @bob.smith', mentions: ['bob.smith'] });
    expect((await api(bob).patch(`/posts/${post.id}`, { caption: 'mine now' })).status).toBe(404);
  });
});

describe('search history', () => {
  it('keeps recent people, newest first, and lets each be removed', async () => {
    expect((await api(alice).get('/search/history')).body.users).toEqual([]);
    await api(alice).post('/search/history', { user_id: bob.id });
    await api(alice).post('/search/history', { user_id: cara.id });
    await api(alice).post('/search/history', { user_id: bob.id });
    const list = await api(alice).get('/search/history');
    expect(list.body.users.map((u: { username: string }) => u.username)).toEqual([
      'bob.smith',
      'cara',
    ]);
    expect((await api(alice).del(`/search/history/${bob.id}`)).status).toBe(204);
    const after = await api(alice).get('/search/history');
    expect(after.body.users.map((u: { username: string }) => u.username)).toEqual(['cara']);
    expect((await api(alice).del('/search/history')).status).toBe(204);
    expect((await api(alice).get('/search/history')).body.users).toEqual([]);
  });

  it('never shows blocked people in history or search, whoever blocked', async () => {
    await api(alice).post('/search/history', { user_id: bob.id });
    await api(alice).post('/search/history', { user_id: cara.id });
    await api(alice).post(`/users/${bob.id}/block`);
    await api(cara).post(`/users/${alice.id}/block`);

    const history = await api(alice).get('/search/history');
    expect(history.body.users).toEqual([]);
    expect((await api(alice).get('/search?type=users&q=bob')).body.users).toEqual([]);
    expect((await api(alice).get('/search?type=users&q=cara')).body.users).toEqual([]);
    expect((await api(bob).get('/search?type=users&q=alice')).body.users).toEqual([]);

    await api(alice).del(`/users/${bob.id}/block`);
    expect((await api(alice).get('/search?type=users&q=bob')).body.users).toHaveLength(1);
  });
});

describe('reels', () => {
  async function newReel(owner: Account, extra: Record<string, unknown> = {}) {
    const res = await api(owner).post('/reels', {
      video_media_id: await reelMedia(owner),
      caption: 'hello @bob.smith',
      ...extra,
    });
    expect(res.status).toBe(201);
    return res.body as { id: string } & Record<string, unknown>;
  }

  it('hides the like count and turns commenting off', async () => {
    const reel = await newReel(alice, { hide_like_count: true, comments_disabled: true });
    expect(reel).toMatchObject({ likes_count: null, hide_like_count: true, mentions: ['bob.smith'] });
    const liked = await api(bob).put(`/reels/${reel.id}/like`);
    expect(liked.body).toMatchObject({ liked_by_me: true, likes_count: null });
    const blocked = await api(bob).post(`/reels/${reel.id}/comments`, { body: 'hey' });
    expect(blocked.status).toBe(403);

    const shown = await api(alice).patch(`/reels/${reel.id}`, {
      hide_like_count: false,
      comments_disabled: false,
      caption: 'edited',
    });
    expect(shown.body).toMatchObject({ likes_count: 1, caption: 'edited', mentions: [] });
  });

  it('likes idempotently and comments like posts do', async () => {
    const reel = await newReel(alice);
    await api(bob).put(`/reels/${reel.id}/like`);
    expect((await api(bob).put(`/reels/${reel.id}/like`)).body.likes_count).toBe(1);
    expect((await api(bob).del(`/reels/${reel.id}/like`)).body.likes_count).toBe(0);

    const comment = await api(bob).post(`/reels/${reel.id}/comments`, { body: 'nice' });
    expect(comment.status).toBe(201);
    expect(comment.body).toMatchObject({ body: 'nice', replies: [], author: { username: 'bob.smith' } });
    const list = await api(cara).get(`/reels/${reel.id}/comments`);
    expect(list.body.items).toHaveLength(1);
    expect((await api(alice).get(`/reels/${reel.id}`)).body.comments_count).toBe(1);

    expect((await api(cara).del(`/comments/${comment.body.id as string}`)).status).toBe(403);
    expect((await api(bob).del(`/comments/${comment.body.id as string}`)).status).toBe(204);
    expect((await api(alice).get(`/reels/${reel.id}`)).body.comments_count).toBe(0);
  });

  it('only the owner can edit or delete', async () => {
    const reel = await newReel(alice);
    expect((await api(bob).patch(`/reels/${reel.id}`, { caption: 'x' })).status).toBe(404);
    expect((await api(alice).del(`/reels/${reel.id}`)).status).toBe(204);
    expect((await api(alice).get(`/reels/${reel.id}`)).status).toBe(404);
  });
});

describe('stories', () => {
  async function newStory(owner: Account) {
    const res = await api(owner).post('/stories', {
      media_id: await readyMedia(owner, { purpose: 'story', key: `stories/${owner.id}/${++counter}.jpg` }),
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it('likes a story once and tells the owner', async () => {
    await api(bob).post(`/users/${alice.id}/follow`);
    await api(alice).post(`/users/${bob.id}/follow`);
    const story = await newStory(alice);
    expect((await api(bob).put(`/stories/${story.id}/like`)).body).toEqual({ liked: true });
    await api(bob).put(`/stories/${story.id}/like`);
    expect(await StoryLike.countDocuments()).toBe(1);
    expect(await Notification.countDocuments({ type: 'story_like' })).toBe(1);

    const tray = await api(bob).get('/stories/tray');
    expect(tray.body.items[0].stories[0].liked_by_me).toBe(true);

    expect((await api(bob).del(`/stories/${story.id}/like`)).body).toEqual({ liked: false });
    const after = await api(bob).get('/stories/tray');
    expect(after.body.items[0].stories[0].liked_by_me).toBe(false);
  });

  it('sends a private reply and refuses replying to yourself', async () => {
    await api(bob).post(`/users/${alice.id}/follow`);
    await api(alice).post(`/users/${bob.id}/follow`);
    const story = await newStory(alice);
    const sent = await api(bob).post(`/stories/${story.id}/message`, { body: 'love this' });
    expect(sent.status).toBe(201);
    expect(await StoryMessage.countDocuments({ body: 'love this' })).toBe(1);
    expect(await Notification.countDocuments({ type: 'story_reply' })).toBe(1);
    expect((await api(alice).post(`/stories/${story.id}/message`, { body: 'me' })).status).toBe(400);
    expect((await api(bob).post(`/stories/${story.id}/message`, { body: '  ' })).status).toBe(400);
  });

  it('blocks non-followers of private accounts from liking', async () => {
    await api(alice).patch('/users/me', { is_private: true });
    const story = await newStory(alice);
    expect((await api(cara).put(`/stories/${story.id}/like`)).status).toBe(403);
  });
});
