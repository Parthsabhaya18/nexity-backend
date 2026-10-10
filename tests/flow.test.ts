/**
 * One signed-in journey through the screens: search → profile → follow →
 * post → story → reel → settings → block. If a step breaks, this test fails.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
import { Notification } from '../src/modules/notifications/notification.model';
import { Comment, PostLike, PostSave } from '../src/modules/posts/post.engage.model';
import { Post } from '../src/modules/posts/post.model';
import { Reel, ReelLike } from '../src/modules/reels/reel.model';
import { Block } from '../src/modules/safety/block.model';
import { Report } from '../src/modules/safety/report.model';
import { Story, StoryView } from '../src/modules/stories/story.model';
import { User } from '../src/modules/users/user.model';

const app = createApp();
let mongo: MongoMemoryServer;
let n = 0;

type Account = { auth: string; id: string; username: string };

async function signUp(username: string, displayName = username): Promise<Account> {
  const email = `${username}@example.com`;
  const reg = await request(app).post('/api/v1/auth/register').send({
    display_name: displayName,
    username,
    email,
    password: 'secretPass1',
    gender: 'woman',
    date_of_birth: '1998-04-12',
    accept_terms: true,
  });
  expect(reg.status).toBe(201);
  const verified = await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ email, code: reg.body.dev_code });
  expect(verified.status).toBe(200);
  return {
    auth: `Bearer ${verified.body.access_token as string}`,
    id: verified.body.user.id as string,
    username,
  };
}

const api = (a: Account) => ({
  get: (path: string) => request(app).get(`/api/v1${path}`).set('Authorization', a.auth),
  post: (path: string, body?: object) =>
    request(app)
      .post(`/api/v1${path}`)
      .set('Authorization', a.auth)
      .send(body ?? {}),
  patch: (path: string, body: object) =>
    request(app).patch(`/api/v1${path}`).set('Authorization', a.auth).send(body),
  put: (path: string) => request(app).put(`/api/v1${path}`).set('Authorization', a.auth),
  del: (path: string) => request(app).delete(`/api/v1${path}`).set('Authorization', a.auth),
});

async function readyMedia(
  owner: Account,
  purpose: 'avatar' | 'post' | 'story' | 'reel',
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
    height: kind === 'video' ? 1920 : 1350,
    duration_ms: kind === 'video' ? 20_000 : undefined,
    status: 'ready',
    upload_expires_at: new Date(Date.now() + 60_000),
  });
  return row.id as string;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  await Promise.all(
    [
      User,
      OtpCode,
      RefreshToken,
      Follow,
      Media,
      Post,
      PostLike,
      PostSave,
      Comment,
      Story,
      StoryView,
      Reel,
      ReelLike,
      Block,
      Report,
      Notification,
    ].map((m) => m.init()),
  );
}, 120_000);

afterAll(async () => {
  await disconnectDatabase();
  await mongo.stop();
});

describe('app journey', () => {
  it('search, profile, post, story, reel, settings and block stay consistent', async () => {
    const meera = await signUp('meera', 'Meera Patel');
    const aarav = await signUp('aarav', 'Aarav Shah');

    const profileUpdate = await api(meera).patch('/users/me', {
      bio: 'Shooting light around Gujarat',
      website: 'https://meera.example.com',
      avatar_media_id: await readyMedia(meera, 'avatar'),
    });
    expect(profileUpdate.status).toBe(200);
    expect(profileUpdate.body).toMatchObject({
      username: 'meera',
      bio: 'Shooting light around Gujarat',
      website: 'https://meera.example.com',
    });
    expect(profileUpdate.body.avatar_url).toContain('https://cdn.test/avatar/');

    const theme = await api(meera).patch('/users/me/preferences', { theme: 'dark' });
    expect(theme.status).toBe(200);
    expect((await api(meera).get('/users/me')).body.preferences).toEqual({
      theme: 'dark',
      mood: null,
    });

    const search = await api(aarav).get('/search?q=meera&type=users');
    expect(search.status).toBe(200);
    expect(search.body.users).toEqual([
      expect.objectContaining({
        username: 'meera',
        display_name: 'Meera Patel',
        follow_status: 'none',
      }),
    ]);
    expect(search.body.users[0].avatar_url).toContain('https://cdn.test/avatar/');

    const opened = await api(aarav).get('/users/by-username/meera');
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({
      username: 'meera',
      is_self: false,
      can_view_content: true,
      posts_count: 0,
      follow_status: 'none',
    });

    expect((await api(aarav).post(`/users/${meera.id}/follow`)).body.status).toBe('accepted');
    expect((await api(aarav).get('/users/by-username/meera')).body).toMatchObject({
      follow_status: 'accepted',
      followers_count: 1,
    });
    expect((await api(meera).get('/users/me')).body.followers_count).toBe(1);

    const post = await api(meera).post('/posts', {
      media_ids: [await readyMedia(meera, 'post'), await readyMedia(meera, 'post')],
      caption: 'Sabarmati this morning. #ahmedabad #gujarat @aarav',
      location_name: 'Ahmedabad',
      aspect_ratio: 0.8,
      client_upload_id: 'flow-post-meera-1',
    });
    expect(post.status).toBe(201);
    expect(post.body.media).toHaveLength(2);
    expect(post.body.media[0].url).toContain('https://cdn.test/post/');
    expect(post.body).toMatchObject({
      mentions: ['aarav'],
      location_name: 'Ahmedabad',
      likes_count: 0,
    });

    const postId = post.body.id as string;
    expect((await api(aarav).get('/feed')).body.items.map((p: { id: string }) => p.id)).toEqual([
      postId,
    ]);
    expect((await api(aarav).get(`/users/${meera.id}/posts`)).body.items).toHaveLength(1);
    expect((await api(meera).get('/users/me')).body.posts_count).toBe(1);

    const liked = await api(aarav).put(`/posts/${postId}/like`);
    expect(liked.body.liked).toBe(true);
    expect((await api(aarav).post(`/posts/${postId}/save`)).body.saved).toBe(true);
    expect((await api(aarav).get('/users/me/saved-posts')).body.items[0].id).toBe(postId);

    const comment = await api(aarav).post(`/posts/${postId}/comments`, {
      body: 'This light is beautiful.',
    });
    expect(comment.status).toBe(201);
    const reply = await api(meera).post(`/posts/${postId}/comments`, {
      body: 'Shot it this morning.',
      parent_id: comment.body.id,
    });
    expect(reply.status).toBe(201);
    const thread = await api(aarav).get(`/posts/${postId}/comments`);
    expect(thread.body.items).toHaveLength(1);
    expect(thread.body.items[0].replies).toHaveLength(1);

    const inbox = await api(meera).get('/notifications');
    expect(inbox.body.items[0]).toMatchObject({
      type: 'comment_post',
      post_id: postId,
      read: false,
    });
    expect((await api(meera).get('/notifications/unread-count')).body.notifications).toBe(1);

    const story = await api(meera).post('/stories', {
      media_id: await readyMedia(meera, 'story'),
    });
    expect(story.status).toBe(201);
    expect(story.body.url).toContain('https://cdn.test/story/');
    const tray = await api(aarav).get('/stories/tray');
    expect(tray.body.items[0]).toMatchObject({
      seen: false,
      user: expect.objectContaining({ username: 'meera' }),
    });
    const storyId = tray.body.items[0].stories[0].id as string;
    expect((await api(aarav).post(`/stories/${storyId}/view`)).status).toBe(204);
    expect((await api(aarav).get('/stories/tray')).body.items[0].seen).toBe(true);

    const reel = await api(meera).post('/reels', {
      video_media_id: await readyMedia(meera, 'reel', 'video'),
      caption: 'Evening ride. #mumbai',
      location_name: 'Mumbai',
      client_upload_id: 'flow-reel-meera-1',
      trim_start_ms: 2000,
      trim_end_ms: 8000,
    });
    expect(reel.status).toBe(201);
    expect(reel.body).toMatchObject({
      location_name: 'Mumbai',
      trim_start_ms: 2000,
      trim_end_ms: 8000,
      video_url: expect.stringContaining('https://cdn.test/reel/'),
    });
    expect((await api(aarav).get('/reels')).body.items).toHaveLength(1);
    expect((await api(aarav).get(`/users/${meera.id}/reels`)).body.items).toHaveLength(1);
    const reelComment = await api(aarav).post(`/reels/${reel.body.id as string}/comments`, {
      body: 'Take me next time.',
    });
    expect(reelComment.status).toBe(201);
    const notes = await api(meera).get('/notifications');
    expect(notes.body.items.map((item: { type: string }) => item.type)).toContain('comment_reel');

    await api(meera).patch('/users/me', { is_private: true });
    const riya = await signUp('riya', 'Riya Desai');
    expect((await api(riya).get('/users/by-username/meera')).body).toMatchObject({
      is_private: true,
      can_view_content: false,
    });
    expect((await api(riya).get(`/users/${meera.id}/posts`)).status).toBe(403);
    expect((await api(riya).get('/stories/tray')).body.items).toEqual([]);
    expect((await api(riya).post(`/users/${meera.id}/follow`)).body.status).toBe('pending');
    expect((await api(meera).get('/users/me')).body.follow_requests_count).toBe(1);

    expect((await api(aarav).post(`/users/${meera.id}/block`)).status).toBe(204);
    expect((await api(aarav).get('/search?q=meera&type=users')).body.users).toEqual([]);
    expect((await api(aarav).get('/users/by-username/meera')).status).toBe(404);
    expect((await api(aarav).get('/feed')).body.items).toEqual([]);
    expect((await api(aarav).get('/stories/tray')).body.items).toEqual([]);
    expect((await api(aarav).get('/reels')).body.items).toEqual([]);
    expect((await api(meera).get('/users/me')).body.followers_count).toBe(0);
    expect((await api(aarav).get('/users/me/blocked')).body.items[0].username).toBe('meera');

    const report = await api(riya).post('/reports', {
      target_type: 'user',
      target_id: meera.id,
      reason: 'spam',
    });
    expect(report.status).toBe(201);
    expect(await Report.countDocuments({ reporter_id: riya.id })).toBe(1);

    expect((await api(aarav).del(`/users/${meera.id}/block`)).status).toBe(204);
    const restored = await api(aarav).get('/users/by-username/meera');
    expect(restored.status).toBe(200);
    expect(restored.body.follow_status).toBe('none');
  }, 30_000);
});
