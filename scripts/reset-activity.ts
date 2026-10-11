/**
 * Keeps every account and every follow. Removes chats, secret crush, secret
 * messages, plans, posts, reels, stories and nearby activity, then gives each
 * active user 4 posts and 10 reels.
 *
 * Usage: npx tsx scripts/reset-activity.ts
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import mongoose, { type Types } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { env, isMediaConfigured } from '../src/config/env';
import { Follow } from '../src/modules/follows/follow.model';
import { KEY_FOLDERS, type MediaPurpose } from '../src/modules/media/media.rules';
import { Media } from '../src/modules/media/media.model';
import { deleteObjects } from '../src/modules/media/media.storage';
import { Conversation } from '../src/modules/messages/conversation.model';
import { Message } from '../src/modules/messages/message.model';
import { Notification } from '../src/modules/notifications/notification.model';
import {
  Encounter,
  NearbyBleSighting,
  NearbyBleToken,
  NearbyLocationPing,
  NearbyNotification,
  NearbyPresence,
} from '../src/modules/nearby/nearby.models';
import {
  BillingAdjustment,
  CouponRedemption,
  Payment,
  PaymentCheckout,
  PaymentWebhookEvent,
  Refund,
} from '../src/modules/payments/payment.models';
import { Comment, PostLike, PostSave } from '../src/modules/posts/post.engage.model';
import { Post } from '../src/modules/posts/post.model';
import { Reel, ReelLike, ReelSave } from '../src/modules/reels/reel.model';
import { Block } from '../src/modules/safety/block.model';
import { Mute } from '../src/modules/safety/mute.model';
import { Report } from '../src/modules/safety/report.model';
import { SearchHistory } from '../src/modules/search/searchHistory.model';
import { Crush, CrushAdmirerCount, CrushMatch } from '../src/modules/secret-crush/crush.models';
import { SecretBlock, SecretMessage, SecretThread } from '../src/modules/secret-messages/secret.models';
import {
  Story,
  StoryLike,
  StoryMessage,
  StoryPollVote,
  StoryQuestionReply,
  StoryView,
} from '../src/modules/stories/story.model';
import { SecretUsage } from '../src/modules/subscriptions/usage.model';
import { SupportTicket } from '../src/modules/support/supportTicket.model';
import { User } from '../src/modules/users/user.model';

const POSTS_PER_USER = 4;
const REELS_PER_USER = 10;
const POST_PHOTOS = [1015, 1016, 1018, 1025, 1035, 1036, 1040, 1043, 1044, 1049, 1050, 1051, 1052, 1055, 1056, 1057];
const REEL_CLIPS = [
  { url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', durationMs: 12_000 },
  { url: 'https://download.samplelib.com/mp4/sample-5s.mp4', durationMs: 5_000 },
];
const CAPTIONS = [
  'Riverfront after the rain.',
  'One more coffee before the day starts.',
  'Old city, late light.',
  'The long way home.',
];

const CLEAR = [
  Conversation,
  Message,
  Crush,
  CrushMatch,
  CrushAdmirerCount,
  SecretThread,
  SecretMessage,
  SecretBlock,
  Post,
  PostLike,
  PostSave,
  Comment,
  Reel,
  ReelLike,
  ReelSave,
  Story,
  StoryView,
  StoryPollVote,
  StoryQuestionReply,
  StoryLike,
  StoryMessage,
  Notification,
  SearchHistory,
  Block,
  Mute,
  Report,
  NearbyLocationPing,
  Encounter,
  NearbyNotification,
  NearbyBleToken,
  NearbyBleSighting,
  NearbyPresence,
  SecretUsage,
  PaymentCheckout,
  Payment,
  PaymentWebhookEvent,
  CouponRedemption,
  BillingAdjustment,
  Refund,
  SupportTicket,
];

function s3() {
  return new S3Client({
    region: env.AWS_REGION,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY } }
      : {}),
  });
}

function sniff(buf: Buffer) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return { contentType: 'image/jpeg', ext: 'jpg' };
  if (buf[0] === 0x89 && buf[1] === 0x50) return { contentType: 'image/png', ext: 'png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { contentType: 'image/webp', ext: 'webp' };
  }
  if (buf.toString('ascii', 4, 8) === 'ftyp') return { contentType: 'video/mp4', ext: 'mp4' };
  throw new Error('Downloaded file is not a jpeg, png, webp or mp4');
}

const downloadCache = new Map<string, Buffer>();

async function download(url: string) {
  const cached = downloadCache.get(url);
  if (cached) return cached;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download ${url} (HTTP ${res.status})`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length < 32) throw new Error(`Download was empty: ${url}`);
  downloadCache.set(url, body);
  return body;
}

async function storeFile(opts: {
  ownerId: Types.ObjectId;
  purpose: MediaPurpose;
  url: string;
  width: number;
  height: number;
  durationMs?: number | null;
}) {
  const body = await download(opts.url);
  const { contentType, ext } = sniff(body);
  const id = new mongoose.Types.ObjectId();
  const key = `media/${KEY_FOLDERS[opts.purpose]}/${opts.ownerId.toHexString()}/${id.toHexString()}.${ext}`;
  await s3().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return Media.create({
    _id: id,
    owner_id: opts.ownerId,
    purpose: opts.purpose,
    kind: ext === 'mp4' ? 'video' : 'image',
    key,
    content_type: contentType,
    bytes: body.length,
    width: opts.width,
    height: opts.height,
    duration_ms: opts.durationMs ?? null,
    status: 'ready',
    upload_expires_at: new Date(),
  });
}

async function pool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function main() {
  if (!isMediaConfigured || !env.S3_BUCKET) {
    throw new Error('Set AWS_REGION and S3_BUCKET in backend/.env before seeding photos and reels.');
  }
  await connectDatabase();
  console.log(`Connected to database "${env.MONGODB_DB_NAME}".`);

  const users = await User.find({ status: 'active' }).select('_id username');
  console.log(`Active accounts kept: ${users.length}. Follows kept: ${await Follow.countDocuments()}.`);

  for (const model of CLEAR) {
    const result = await model.deleteMany({});
    console.log(`Cleared ${model.collection.name}: ${result.deletedCount}`);
  }

  const oldMedia = await Media.find({ purpose: { $ne: 'avatar' } }).select('key').lean();
  if (oldMedia.length) {
    await deleteObjects(oldMedia.map((row) => row.key)).catch((err) => {
      console.warn('Could not delete old media files from storage:', (err as Error).message);
    });
    const removed = await Media.deleteMany({ purpose: { $ne: 'avatar' } });
    console.log(`Cleared non-avatar media: ${removed.deletedCount}`);
  }

  const now = new Date();
  await User.updateMany(
    {},
    {
      $set: {
        posts_count: 0,
        entitlement: {
          plan: 'free',
          expires_at: null,
          source: null,
          updated_at: now,
          period: null,
          autopay: false,
          razorpay_subscription_id: null,
          price_paise: null,
          paid_paise: null,
          period_started_at: null,
          next_charge_at: null,
          cancel_at_period_end: false,
          billing_status: null,
          method_display: null,
          reminded: null,
          credit_hold: null,
          billing_generation: 0,
        },
      },
    },
  );
  console.log('Plans reset to Free.');

  console.log(`Uploading ${POSTS_PER_USER} posts and ${REELS_PER_USER} reels for each account…`);
  await pool(users, 4, async (user, userIndex) => {
    for (let postIndex = 0; postIndex < POSTS_PER_USER; postIndex += 1) {
      const photoId = POST_PHOTOS[(userIndex * POSTS_PER_USER + postIndex) % POST_PHOTOS.length]!;
      const portrait = postIndex % 2 === 0;
      const width = 1080;
      const height = portrait ? 1350 : 1080;
      const file = await storeFile({
        ownerId: user._id,
        purpose: 'post',
        url: `https://picsum.photos/id/${photoId}/${width}/${height}.jpg`,
        width,
        height,
      });
      const createdAt = new Date(now.getTime() - (userIndex * POSTS_PER_USER + postIndex + 1) * 3_600_000);
      await Post.create({
        author_id: user._id,
        media: [
          {
            media_id: file._id,
            key: file.key,
            kind: 'image',
            width,
            height,
            alt_text: CAPTIONS[postIndex],
          },
        ],
        caption: CAPTIONS[postIndex]!,
        aspect_ratio: portrait ? 0.8 : 1,
        client_upload_id: `reset-${user.username}-post-${postIndex}`,
        created_at: createdAt,
        updated_at: createdAt,
      });
    }

    for (let reelIndex = 0; reelIndex < REELS_PER_USER; reelIndex += 1) {
      const clip = REEL_CLIPS[reelIndex % REEL_CLIPS.length]!;
      const file = await storeFile({
        ownerId: user._id,
        purpose: 'reel',
        url: clip.url,
        width: 720,
        height: 1280,
        durationMs: clip.durationMs,
      });
      const createdAt = new Date(now.getTime() - reelIndex * 60_000);
      await Reel.create({
        author_id: user._id,
        video_media_id: file._id,
        video_key: file.key,
        width: 720,
        height: 1280,
        duration_ms: clip.durationMs,
        caption: `Reel ${reelIndex + 1}`,
        client_upload_id: `reset-${user.username}-reel-${reelIndex}`,
        created_at: createdAt,
        updated_at: createdAt,
      });
    }

    await User.updateOne({ _id: user._id }, { $set: { posts_count: POSTS_PER_USER } });
    console.log(`@${user.username}: ${POSTS_PER_USER} posts, ${REELS_PER_USER} reels`);
  });

  console.log('Done. Accounts and follows are unchanged. Plans are Free. Chats and Secret Crush are empty.');
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
