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
import { Conversation } from '../src/modules/messages/conversation.model';
import { Message } from '../src/modules/messages/message.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { Comment, PostLike, PostSave } from '../src/modules/posts/post.engage.model';
import { Post } from '../src/modules/posts/post.model';
import { Reel, ReelLike, ReelSave } from '../src/modules/reels/reel.model';
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
  ReelSave,
  Story,
  StoryLike,
  StoryMessage,
  Block,
  SearchHistory,
  Notification,
  Conversation,
  Message,
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

  it('sends a story reply into the direct chat and refuses replying to yourself', async () => {
    await api(bob).post(`/users/${alice.id}/follow`);
    await api(alice).post(`/users/${bob.id}/follow`);
    const story = await newStory(alice);
    const sent = await api(bob).post(`/stories/${story.id}/message`, { body: 'love this' });
    expect(sent.status).toBe(201);
    expect(sent.body.conversation_id).toEqual(expect.any(String));

    // Both people see it in Chats, with the story above the text.
    const inbox = await api(alice).get('/conversations');
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0]).toMatchObject({
      id: sent.body.conversation_id,
      unread_count: 1,
      last_message: { body: 'love this' },
    });
    const thread = await api(alice).get(`/conversations/${sent.body.conversation_id as string}/messages`);
    expect(thread.body.data[0]).toMatchObject({
      id: sent.body.id,
      body: 'love this',
      sender_id: bob.id,
      story: { id: story.id, author_id: alice.id, kind: 'image', url: expect.stringContaining('stories/') },
    });

    // A second reply reuses the same chat.
    const again = await api(bob).post(`/stories/${story.id}/message`, { body: 'again' });
    expect(again.body.conversation_id).toBe(sent.body.conversation_id);
    expect(await Conversation.countDocuments()).toBe(1);
    expect(await StoryMessage.countDocuments()).toBe(0);

    // Once the story expires the message stays, the preview says it's gone.
    await Story.updateOne({ _id: story.id }, { expires_at: new Date(Date.now() - 1000) });
    const later = await api(bob).get(`/conversations/${sent.body.conversation_id as string}/messages`);
    expect(later.body.data.map((m: { body: string }) => m.body)).toEqual(['again', 'love this']);
    expect(later.body.data[1].story).toEqual({ id: story.id, author_id: null, kind: null, url: null });

    const fresh = await newStory(alice);
    expect((await api(alice).post(`/stories/${fresh.id}/message`, { body: 'me' })).status).toBe(400);
    expect((await api(bob).post(`/stories/${fresh.id}/message`, { body: '  ' })).status).toBe(400);
    // Normal messages carry no story.
    const plain = await api(bob).post(`/conversations/${sent.body.conversation_id as string}/messages`, {
      body: 'hi',
      client_message_id: '9b2f4c1e-7a0d-4e5b-8c3f-1d2e3f4a5b6c',
    });
    expect(plain.status).toBe(201);
    expect(plain.body.story).toBeNull();
  });

  it('lists people who liked a story first in the viewers sheet', async () => {
    for (const viewer of [bob, cara]) {
      await api(viewer).post(`/users/${alice.id}/follow`);
      await api(alice).post(`/users/${viewer.id}/follow`);
    }
    const story = await newStory(alice);
    await api(bob).post(`/stories/${story.id}/view`);
    await api(cara).post(`/stories/${story.id}/view`);
    // Newest first, so cara leads until bob likes it.
    const before = await api(alice).get(`/stories/${story.id}/viewers`);
    expect(before.body.items.map((u: { username: string; liked: boolean }) => [u.username, u.liked])).toEqual([
      ['cara', false],
      ['bob.smith', false],
    ]);
    await api(bob).put(`/stories/${story.id}/like`);
    const after = await api(alice).get(`/stories/${story.id}/viewers`);
    expect(after.body.items.map((u: { username: string; liked: boolean }) => [u.username, u.liked])).toEqual([
      ['bob.smith', true],
      ['cara', false],
    ]);
    expect((await api(bob).get(`/stories/${story.id}/viewers`)).status).toBe(404);
  });

  it('blocks non-followers of private accounts from liking', async () => {
    await api(alice).patch('/users/me', { is_private: true });
    const story = await newStory(alice);
    expect((await api(cara).put(`/stories/${story.id}/like`)).status).toBe(403);
  });
});

describe('reels feed order', () => {
  it('pages through a random order without repeating, then loops forever, and reshuffles on a fresh load', async () => {
    await api(bob).post(`/users/${alice.id}/follow`);
    const created: string[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await api(alice).post('/reels', { video_media_id: await reelMedia(alice) });
      created.push(res.body.id as string);
    }
    const walk = async (pages = 3) => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let p = 0; p < pages; p++) {
        const res = await api(bob).get(`/reels?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
        expect(res.status).toBe(200);
        seen.push(...res.body.items.map((r: { id: string }) => r.id));
        cursor = res.body.next_cursor as string | null;
        expect(cursor).toMatch(/^[0-9a-f]{8}_[0-9a-f]{16}$/);
      }
      return seen;
    };
    // 3 + 3 + 2: one full round, each reel once.
    const first = await walk();
    expect(first).toHaveLength(8);
    expect([...first].sort()).toEqual([...created].sort());

    // The feed never ends: after the round it starts over with every reel again.
    const looped = await walk(6);
    expect(looped).toHaveLength(16);
    expect([...looped.slice(8)].sort()).toEqual([...created].sort());

    const orders = new Set([first.join()]);
    for (let i = 0; i < 6; i++) orders.add((await walk()).join());
    expect(orders.size).toBeGreaterThan(1);

    // A broken cursor starts a new order instead of failing.
    expect((await api(bob).get('/reels?cursor=nope')).status).toBe(200);
  });

  it('keeps blocked people and private accounts out of the reels feed', async () => {
    await api(cara).patch('/users/me', { is_private: true });
    await api(cara).post('/reels', { video_media_id: await reelMedia(cara) });
    const mine = await api(alice).post('/reels', { video_media_id: await reelMedia(alice) });
    await api(bob).post(`/users/${alice.id}/follow`);
    const feed = await api(bob).get('/reels');
    expect(feed.body.items.map((r: { id: string }) => r.id)).toEqual([mine.body.id]);
    await api(bob).post(`/users/${alice.id}/block`);
    expect((await api(bob).get('/reels')).body.items).toEqual([]);
  });

  it("leaves the viewer's own reels out of the feed but keeps them on their profile", async () => {
    const own = await api(alice).post('/reels', { video_media_id: await reelMedia(alice) });
    expect((await api(alice).get('/reels')).body.items).toEqual([]);
    const grid = await api(alice).get(`/users/${alice.id}/reels`);
    expect(grid.body.items.map((r: { id: string }) => r.id)).toEqual([own.body.id]);
  });

  it('saves and unsaves a reel, listed with saved posts newest save first', async () => {
    const reel = await api(alice).post('/reels', { video_media_id: await reelMedia(alice) });
    const id = reel.body.id as string;
    const post = await newPost(alice);
    await api(bob).post(`/posts/${post.id}/save`);
    const saved = await api(bob).post(`/reels/${id}/save`);
    expect(saved.body).toMatchObject({ saved: true, reel: { saved_by_me: true } });
    expect((await api(bob).get(`/reels/${id}`)).body.saved_by_me).toBe(true);
    const list = await api(bob).get('/users/me/saved');
    expect(
      list.body.items.map((e: { kind: string; post?: { id: string }; reel?: { id: string } }) => [
        e.kind,
        (e.post ?? e.reel)!.id,
      ]),
    ).toEqual([
      ['reel', id],
      ['post', post.id],
    ]);
    const first = await api(bob).get('/users/me/saved?limit=1');
    expect(first.body.items).toHaveLength(1);
    const second = await api(bob).get(`/users/me/saved?limit=1&cursor=${first.body.next_cursor}`);
    expect(second.body.items[0].kind).toBe('post');
    expect(second.body.next_cursor).toBeNull();
    expect((await api(bob).post(`/reels/${id}/save`)).body.saved).toBe(false);
    expect((await api(bob).get('/users/me/saved')).body.items.map((e: { kind: string }) => e.kind)).toEqual([
      'post',
    ]);
  });
});

describe('@mention suggestions', () => {
  const names = (res: { body: { users: { username: string }[] } }) =>
    res.body.users.map((u) => u.username);

  it('lists people you follow first for a bare @, then others', async () => {
    const dan = await signUp('dan');
    await api(alice).post(`/users/${cara.id}/follow`);
    await api(alice).post(`/users/${dan.id}/follow`);
    const res = await api(alice).get('/users/mention-suggestions?q=&limit=5');
    expect(res.status).toBe(200);
    // Latest follow first, then everyone else; never yourself.
    expect(names(res)).toEqual(['dan', 'cara', 'bob.smith']);
    expect(names(await api(alice).get('/users/mention-suggestions?limit=2'))).toEqual(['dan', 'cara']);
  });

  it('puts usernames starting with the text first and narrows as you type', async () => {
    await signUp('rabo');
    await signUp('bobby');
    const b = await api(alice).get('/users/mention-suggestions?q=b');
    expect(names(b).slice(0, 2)).toEqual(['bobby', 'bob.smith']);
    expect(names(b)).toContain('rabo');
    expect(names(await api(alice).get('/users/mention-suggestions?q=@bob.'))).toEqual(['bob.smith']);
    expect(names(await api(alice).get('/users/mention-suggestions?q=zzz'))).toEqual([]);
  });

  it('never suggests blocked people', async () => {
    await api(cara).post(`/users/${alice.id}/block`);
    expect(names(await api(alice).get('/users/mention-suggestions?q=ca'))).toEqual([]);
    expect(names(await api(alice).get('/users/mention-suggestions'))).not.toContain('cara');
    expect((await request(app).get('/api/v1/users/mention-suggestions')).status).toBe(401);
  });

  it('only counts @name at the start, after a space or a bracket', async () => {
    const post = await newPost(alice, {
      caption: 'wow...@bob.smith wow…@cara mail@cara (@cara) and @bob.smith',
    });
    expect([...(post.mentions as string[])].sort()).toEqual(['bob.smith', 'cara']);
    const none = await newPost(alice, { caption: 'great…@bob.smith' });
    expect(none.mentions).toEqual([]);
  });
});

describe('sharing posts and reels', () => {
  const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((u) => u.id);

  it('offers people you chat with, follow or who follow you, never blocked ones', async () => {
    const dan = await signUp('dan');
    await signUp('stranger');
    await api(alice).post(`/users/${bob.id}/follow`);
    await api(cara).post(`/users/${alice.id}/follow`);
    const { body } = await api(alice).post('/conversations', { participant_ids: [dan.id] });
    await api(alice).post(`/conversations/${body.id as string}/messages`, {
      body: 'hi',
      client_message_id: crypto.randomUUID(),
    });
    const targets = await api(alice).get('/shares/targets');
    expect(targets.status).toBe(200);
    expect(ids(targets)).toEqual([dan.id, bob.id, cara.id]);
    expect(ids(await api(alice).get('/shares/targets?q=ca'))).toEqual([cara.id]);
    await api(alice).post(`/users/${bob.id}/block`);
    expect(ids(await api(alice).get('/shares/targets'))).not.toContain(bob.id);
  });

  it("sends a post card and the note to each person's chat", async () => {
    const post = await newPost(bob);
    const sent = await api(alice).post('/shares', {
      kind: 'post',
      id: post.id,
      user_ids: [bob.id, cara.id],
      body: 'Look at this',
    });
    expect(sent.status).toBe(201);
    expect(sent.body.conversation_ids).toHaveLength(2);
    const messages = await api(cara).get(`/conversations/${sent.body.conversation_ids[1] as string}/messages`);
    expect(messages.body.data[0]).toMatchObject({ type: 'text', body: 'Look at this' });
    expect(messages.body.data[1]).toMatchObject({
      type: 'share_post',
      shared: { kind: 'post', id: post.id, available: true, author: { username: 'bob.smith' } },
    });
    await api(bob).del(`/posts/${post.id}`);
    const after = await api(cara).get(`/conversations/${sent.body.conversation_ids[1] as string}/messages`);
    expect(after.body.data[1].shared).toMatchObject({ kind: 'post', available: false });
  });

  it('adds a reel to your story and keeps its video when the story is deleted', async () => {
    const reel = await api(bob).post('/reels', { video_media_id: await reelMedia(bob) });
    const story = await api(alice).post('/stories/share', { kind: 'reel', id: reel.body.id });
    expect(story.status).toBe(201);
    expect(story.body).toMatchObject({ kind: 'video', shared: { kind: 'reel', username: 'bob.smith' } });
    const tray = await api(alice).get('/stories/tray');
    expect(tray.body.items[0].stories[0].shared.id).toBe(reel.body.id);
    expect((await api(alice).del(`/stories/${story.body.id as string}`)).status).toBe(204);
    const stored = await Reel.findById(reel.body.id);
    expect(await Media.exists({ _id: stored!.video_media_id })).toBeTruthy();
  });

  it('keeps the placement, post card style and stickers of a shared post', async () => {
    const post = await newPost(bob, { caption: 'Sunset' });
    const story = await api(alice).post('/stories/share', {
      kind: 'post',
      id: post.id,
      layout: { x: 0.4, y: 0.6, scale: 1.3, style: 'card' },
      overlays: [
        { id: 'text-1', type: 'text', x: 0.5, y: 0.2, scale: 1, rotation: 0, text: 'Look', color: '#FFFFFF' },
      ],
    });
    expect(story.status).toBe(201);
    expect(story.body.shared).toMatchObject({
      kind: 'post',
      caption: 'Sunset',
      layout: { x: 0.4, y: 0.6, scale: 1.3, style: 'card' },
    });
    expect(story.body.overlays).toHaveLength(1);
  });

  it('uses the photo that was on screen for a post with several photos', async () => {
    const post = await newPost(bob, { media_ids: [await readyMedia(bob), await readyMedia(bob)] });
    const stored = await Post.findById(post.id);
    const second = stored!.media[1]!;
    const story = await api(alice).post('/stories/share', { kind: 'post', id: post.id, media_index: 1 });
    expect(story.status).toBe(201);
    expect((await Story.findById(story.body.id))!.key).toBe(second.key);
    const sent = await api(alice).post('/shares', { kind: 'post', id: post.id, user_ids: [bob.id], media_index: 1 });
    expect(sent.status).toBe(201);
    const thread = await api(bob).get(`/conversations/${sent.body.conversation_ids[0] as string}/messages`);
    const card = (thread.body.data as { shared: { image_url: string } | null }[]).find((m) => m.shared);
    expect(card!.shared!.image_url).toContain(second.key);
  });

  it('sends a profile as a card with the latest posts', async () => {
    await newPost(bob);
    const sent = await api(alice).post('/shares', { kind: 'profile', id: bob.id, user_ids: [cara.id], body: 'follow' });
    expect(sent.status).toBe(201);
    const thread = await api(cara).get(`/conversations/${sent.body.conversation_ids[0] as string}/messages`);
    expect(thread.body.data[1]).toMatchObject({
      type: 'share_profile',
      shared: {
        kind: 'profile',
        id: bob.id,
        available: true,
        author: { username: 'bob.smith' },
        profile: { is_private: false },
      },
    });
    expect(thread.body.data[1].shared.profile.grid).toHaveLength(1);
    expect(thread.body.data[0]).toMatchObject({ type: 'text', body: 'follow' });
  });
});
