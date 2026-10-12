/**
 * Fresh stories for today, so the story tray and profile rings can be checked.
 * Needs the demo accounts from `npm run seed` and an existing TARGET account.
 *
 * Stories only show between people who follow each other, so this also sets:
 * - mutual follows between the target and most demo accounts (they show in the tray)
 * - @jay and @om: the target follows them, they don't follow back (their stories stay hidden)
 * - @riya: follow request still pending (hidden)
 *
 * Re-running replaces the demo accounts' stories and the target's seeded story.
 *
 * Usage: npm run seed:stories [-- email@example.com]
 */
import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import mongoose, { type Types } from 'mongoose';

import { connectDatabase } from '../src/config/database';
import { env, isMediaConfigured } from '../src/config/env';
import { Follow } from '../src/modules/follows/follow.model';
import { Media } from '../src/modules/media/media.model';
import { KEY_FOLDERS } from '../src/modules/media/media.rules';
import { deleteObjects } from '../src/modules/media/media.storage';
import { Post } from '../src/modules/posts/post.model';
import {
  Story,
  STORY_TTL_MS,
  StoryLike,
  StoryMessage,
  StoryView,
} from '../src/modules/stories/story.model';
import type { StoryOverlay } from '../src/modules/stories/story.schema';
import { User, type UserDoc } from '../src/modules/users/user.model';

const EMAIL_DOMAIN = 'seed.nexity.app';
const TARGET_EMAIL = process.argv[2] ?? 'gohilchirag90994@gmail.com';
const SEED_PREFIX = 'seed-';
const HOUR = 60 * 60 * 1000;

const MUTUAL = ['aarav', 'meera', 'kabir', 'anaya', 'dev', 'sara', 'diya', 'nisha'];
const ONE_WAY = ['jay', 'om'];

type Look = Partial<Pick<Extract<StoryOverlay, { type: 'text' }>, 'background' | 'font' | 'align'>>;

type Frame = {
  picsum: number;
  hoursAgo: number;
  text?: string;
  color?: string;
  look?: Look;
  y?: number;
  location?: string;
  /** Demo accounts (or `account`) who already watched it. */
  seenBy?: string[];
};

const STORIES: Record<string, Frame[]> = {
  aarav: [
    { picsum: 1067, hoursAgo: 9, text: 'Morning run done', color: '#FFFFFF', look: { font: 'strong' } },
    { picsum: 1039, hoursAgo: 2, location: 'Sabarmati Riverfront', text: 'Golden hour', color: '#FFD60A', y: 0.3 },
  ],
  meera: [
    { picsum: 1069, hoursAgo: 7, text: 'New edit coming soon', color: '#000000', look: { background: '#FFFFFF', font: 'modern' } },
    { picsum: 1047, hoursAgo: 4, location: 'Ahmedabad' },
    { picsum: 1074, hoursAgo: 1, text: 'Chai time', color: '#FFFFFF', look: { font: 'script' }, y: 0.62 },
  ],
  kabir: [{ picsum: 1062, hoursAgo: 5, location: 'Marine Drive, Mumbai', text: 'Rain again', color: '#FFFFFF', y: 0.3 }],
  anaya: [
    { picsum: 1068, hoursAgo: 11, text: 'Coffee first', color: '#FFFFFF', look: { background: '#C2185B', font: 'serif' } },
    { picsum: 1060, hoursAgo: 3, text: 'Weekend plans?', color: '#FFFFFF', look: { font: 'typewriter', align: 'left' } },
  ],
  dev: [{ picsum: 1070, hoursAgo: 8, text: 'Quiet Sunday', color: '#FFFFFF', look: { font: 'serif' }, seenBy: ['account', 'aarav'] }],
  sara: [{ picsum: 1063, hoursAgo: 6, location: 'Marina Bay, Singapore' }],
  diya: [{ picsum: 1064, hoursAgo: 0.5, text: 'Garden mornings', color: '#30D158', look: { font: 'modern' } }],
  nisha: [{ picsum: 1071, hoursAgo: 10, location: 'Jaipur', text: 'Only friends see this', color: '#FFFFFF', y: 0.65 }],
  jay: [{ picsum: 1066, hoursAgo: 2, text: "You won't see this: I don't follow back", color: '#FFFFFF' }],
  om: [{ picsum: 1065, hoursAgo: 3, text: 'Hidden from one-way followers', color: '#FFFFFF' }],
  riya: [{ picsum: 1072, hoursAgo: 4, text: 'Private, request pending', color: '#FFFFFF' }],
};

const ACCOUNT_STORY: Frame = {
  picsum: 1084,
  hoursAgo: 1.5,
  text: 'My story from today',
  color: '#FFFFFF',
  look: { background: '#000000', font: 'strong' },
  location: 'Ahmedabad',
  seenBy: ['aarav', 'meera', 'anaya', 'diya'],
};

function s3() {
  return new S3Client({
    region: env.AWS_REGION,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
}

const uploadedKeys: string[] = [];

async function storeStoryImage(ownerId: string, picsum: number) {
  const res = await fetch(`https://picsum.photos/id/${picsum}/1080/1920.jpg`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download picsum ${picsum} (HTTP ${res.status})`);
  const body = Buffer.from(await res.arrayBuffer());
  const id = new mongoose.Types.ObjectId();
  const key = `media/${KEY_FOLDERS.story}/${ownerId}/${id.toHexString()}.jpg`;
  await s3().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  uploadedKeys.push(key);
  return Media.create({
    _id: id,
    owner_id: ownerId,
    purpose: 'story',
    kind: 'image',
    key,
    content_type: 'image/jpeg',
    bytes: body.length,
    width: 1080,
    height: 1920,
    duration_ms: null,
    status: 'ready',
    upload_expires_at: new Date(),
  });
}

function overlaysFor(frame: Frame): StoryOverlay[] {
  const list: StoryOverlay[] = [];
  const id = () => `${SEED_PREFIX}${randomUUID().slice(0, 12)}`;
  if (frame.text) {
    list.push({
      id: id(),
      type: 'text',
      x: frame.look?.align === 'left' ? 0.06 : 0.5,
      y: frame.y ?? 0.45,
      scale: 1,
      rotation: 0,
      text: frame.text,
      color: frame.color ?? '#FFFFFF',
      background: frame.look?.background ?? null,
      font: frame.look?.font ?? 'classic',
      align: frame.look?.align ?? 'center',
    });
  }
  if (frame.location) {
    list.push({
      id: id(),
      type: 'location',
      x: 0.5,
      y: frame.text ? 0.58 : 0.5,
      scale: 1,
      rotation: -4,
      name: frame.location,
    });
  }
  // Every seeded story carries at least one seed- overlay so a re-run can find it.
  if (!list.length) {
    list.push({ id: id(), type: 'text', x: 0.5, y: 0.82, scale: 0.8, rotation: 0, text: 'Today', color: '#FFFFFF', background: null, font: 'classic', align: 'center' });
  }
  return list;
}

async function removeStories(filter: Record<string, unknown>) {
  const stories = await Story.find(filter).select('_id key media_id').lean();
  if (!stories.length) return 0;
  const ids = stories.map((s) => s._id);
  await deleteObjects(stories.map((s) => s.key));
  await Promise.all([
    Media.deleteMany({ _id: { $in: stories.map((s) => s.media_id) } }),
    StoryView.deleteMany({ story_id: { $in: ids } }),
    StoryLike.deleteMany({ story_id: { $in: ids } }),
    StoryMessage.deleteMany({ story_id: { $in: ids } }),
  ]);
  await Story.deleteMany({ _id: { $in: ids } });
  return stories.length;
}

async function setFollow(follower: Types.ObjectId, following: Types.ObjectId, status: 'accepted' | 'pending' | null) {
  if (status === null) {
    await Follow.deleteOne({ follower_id: follower, following_id: following });
    return;
  }
  await Follow.updateOne(
    { follower_id: follower, following_id: following },
    { $set: { status }, $setOnInsert: { follower_id: follower, following_id: following } },
    { upsert: true },
  );
}

async function recount(userId: Types.ObjectId) {
  const [followers, following, posts] = await Promise.all([
    Follow.countDocuments({ following_id: userId, status: 'accepted' }),
    Follow.countDocuments({ follower_id: userId, status: 'accepted' }),
    Post.countDocuments({ author_id: userId, deleted_at: null }),
  ]);
  await User.updateOne(
    { _id: userId },
    { $set: { followers_count: followers, following_count: following, posts_count: posts } },
  );
}

async function createStory(author: UserDoc, frame: Frame, viewers: Map<string, UserDoc>) {
  const media = await storeStoryImage(author.id as string, frame.picsum);
  const createdAt = new Date(Date.now() - frame.hoursAgo * HOUR);
  const story = await Story.create({
    author_id: author._id,
    media_id: media._id,
    key: media.key,
    kind: 'image',
    width: 1080,
    height: 1920,
    location_name: frame.location ?? '',
    overlays: overlaysFor(frame),
    expires_at: new Date(createdAt.getTime() + STORY_TTL_MS),
    created_at: createdAt,
  });
  const seen = (frame.seenBy ?? []).flatMap((name) => {
    const user = viewers.get(name);
    return user ? [{ story_id: story._id, viewer_id: user._id }] : [];
  });
  if (seen.length) await StoryView.insertMany(seen);
  return story;
}

async function main() {
  if (!isMediaConfigured || !env.S3_BUCKET) {
    throw new Error('Set AWS_REGION and S3_BUCKET in backend/.env before seeding stories.');
  }
  await connectDatabase();
  console.log(`Connected to database "${env.MONGODB_DB_NAME}".`);

  const account = await User.findOne({ email: TARGET_EMAIL });
  if (!account) throw new Error(`No account with email ${TARGET_EMAIL}. Sign up first or pass an email.`);

  const demo = await User.find({ email: new RegExp(`@${EMAIL_DOMAIN}$`, 'i') });
  const users = new Map(demo.map((u) => [u.username, u]));
  const missing = Object.keys(STORIES).filter((name) => !users.has(name));
  if (missing.length) {
    throw new Error(`Missing demo accounts (${missing.join(', ')}). Run npm run seed first.`);
  }
  const userOf = (name: string) => users.get(name)!;

  const removed =
    (await removeStories({ author_id: { $in: demo.map((u) => u._id) } })) +
    (await removeStories({ author_id: account._id, 'overlays.id': new RegExp(`^${SEED_PREFIX}`) }));
  if (removed) console.log(`Removed ${removed} earlier seed stor${removed === 1 ? 'y' : 'ies'}.`);

  for (const name of MUTUAL) {
    await setFollow(account._id, userOf(name)._id, 'accepted');
    await setFollow(userOf(name)._id, account._id, 'accepted');
  }
  for (const name of ONE_WAY) {
    await setFollow(account._id, userOf(name)._id, 'accepted');
    await setFollow(userOf(name)._id, account._id, null);
  }
  await setFollow(account._id, userOf('riya')._id, 'pending');
  await Promise.all([account._id, ...demo.map((u) => u._id)].map(recount));

  const viewers = new Map(users);
  viewers.set('account', account);
  let count = 0;
  for (const [name, frames] of Object.entries(STORIES)) {
    for (const frame of frames) {
      await createStory(userOf(name), frame, viewers);
      count += 1;
      console.log(`Story ${count} by @${name} (${frame.hoursAgo} h ago)`);
    }
  }
  await createStory(account, ACCOUNT_STORY, viewers);
  console.log(`Story by @${account.username} (yours, seen by ${ACCOUNT_STORY.seenBy!.length})`);

  console.log('');
  console.log(`Stories ready for ${TARGET_EMAIL} (@${account.username}). Each one ends 24 h after it was posted.`);
  console.log(`  In your tray (you follow each other): ${MUTUAL.map((n) => '@' + n).join(', ')}`);
  console.log('  @dev is already seen (grey ring).');
  console.log(`  Not in your tray (they don't follow you back): ${ONE_WAY.map((n) => '@' + n).join(', ')}`);
  console.log('  Not in your tray (request pending): @riya');
}

let committed = false;

main()
  .then(() => {
    committed = true;
  })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    if (!committed && uploadedKeys.length) {
      await deleteObjects(uploadedKeys).catch(() => {});
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
