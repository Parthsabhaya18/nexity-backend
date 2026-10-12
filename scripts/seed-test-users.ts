/**
 * Four login accounts (test1–test4@gmail.com / Test@123) plus a crowd of real
 * Nexity users so follower lists, posts, reels, stories, likes and comments
 * are actual records. Does not set a paid plan.
 *
 * Re-running wipes user-owned data (posts, chat, follows, …) and rebuilds it.
 * Plans are left as they are.
 *
 * Usage: npm run seed:users
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import bcrypt from 'bcryptjs';
import mongoose, { type Model, type Types } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { env, isMediaConfigured } from '../src/config/env';
import { OtpCode } from '../src/modules/auth/otpCode.model';
import { RefreshToken } from '../src/modules/auth/refreshToken.model';
import { Follow } from '../src/modules/follows/follow.model';
import { KEY_FOLDERS, type MediaPurpose } from '../src/modules/media/media.rules';
import { Media } from '../src/modules/media/media.model';
import { deleteObjects } from '../src/modules/media/media.storage';
import { Conversation } from '../src/modules/messages/conversation.model';
import { Message } from '../src/modules/messages/message.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { Encounter, NearbyLocationPing, NearbyNotification } from '../src/modules/nearby/nearby.models';
import {
  CouponRedemption,
  Payment,
  PaymentCheckout,
  PaymentWebhookEvent,
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
import { User, type UserDoc } from '../src/modules/users/user.model';

const PASSWORD = 'Test@123';
const BCRYPT_COST = 12;
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

const TEST_ACCOUNTS = [
  {
    email: 'test1@gmail.com',
    username: 'test1',
    display_name: 'Test 1',
    gender: 'man' as const,
    bio: 'Ahmedabad. Coffee, photos and late walks along the river. #gujarat',
    website: 'https://nexity.app',
    face: 'men/11',
    followers: 30,
    following: 40,
  },
  {
    email: 'test2@gmail.com',
    username: 'test2',
    display_name: 'Test 2',
    gender: 'woman' as const,
    bio: 'Mumbai weekends and a camera that never stays in the bag. #photography',
    website: 'https://nexity.app',
    face: 'women/22',
    followers: 50,
    following: 30,
  },
  {
    email: 'test3@gmail.com',
    username: 'test3',
    display_name: 'Test 3',
    gender: 'man' as const,
    bio: 'Surat stories. Food first, then the skyline. #surat',
    website: '',
    face: 'men/33',
    followers: 40,
    following: 50,
  },
  {
    email: 'test4@gmail.com',
    username: 'test4',
    display_name: 'Test 4',
    gender: 'woman' as const,
    bio: 'Bengaluru most days, Goa when the week allows. #travel',
    website: 'https://nexity.app',
    face: 'women/44',
    followers: 50,
    following: 40,
  },
];

/** Extra accounts that show up as real people in follower and following lists. */
const EXTRAS: { username: string; display_name: string; gender: 'man' | 'woman'; bio: string }[] = [
  ['aisha', 'Aisha Khan', 'woman', 'Delhi. Books and late metro rides.'],
  ['kabir', 'Kabir Joshi', 'man', 'Reels from the road.'],
  ['meera', 'Meera Patel', 'woman', 'Shooting light around Gujarat.'],
  ['aarav', 'Aarav Shah', 'man', 'Ahmedabad. Photos and coffee.'],
  ['riya', 'Riya Desai', 'woman', 'Quiet mornings, loud playlists.'],
  ['nisha', 'Nisha Rao', 'woman', 'Home cook. Weekend markets.'],
  ['dev', 'Dev Trivedi', 'man', 'Sunday rides around the city.'],
  ['anaya', 'Anaya Mehta', 'woman', 'Stories first. Then coffee.'],
  ['om', 'Om Kapoor', 'man', 'Jaipur lanes and old doors.'],
  ['sara', 'Sara D’Souza', 'woman', 'Between two cities this month.'],
  ['diya', 'Diya Iyer', 'woman', 'I always leave a comment.'],
  ['jay', 'Jay Kulkarni', 'man', 'Pune. New here.'],
  ['vivaan', 'Vivaan Shah', 'man', 'Cricket, then whatever the city is doing.'],
  ['isha', 'Isha Bhatt', 'woman', 'Chai and sketchbooks.'],
  ['arjun', 'Arjun Nair', 'man', 'Kochi backwaters whenever I can.'],
  ['kiara', 'Kiara Sen', 'woman', 'Kolkata evenings.'],
  ['harsh', 'Harsh Gupta', 'man', 'Lucknow food trail.'],
  ['pooja', 'Pooja Reddy', 'woman', 'Hyderabad. Biryani is a personality.'],
  ['neil', 'Neil D’Souza', 'man', 'Goa sunsets, badly photographed.'],
  ['tanya', 'Tanya Kapoor', 'woman', 'Chandigarh winters.'],
  ['rohan', 'Rohan Das', 'man', 'Kolkata trams and rain.'],
  ['sneha', 'Sneha Iyer', 'woman', 'Chennai filter coffee.'],
  ['yash', 'Yash Patel', 'man', 'Vadodara. Night drives.'],
  ['aditi', 'Aditi Joshi', 'woman', 'Pune hills on Saturday.'],
  ['kunal', 'Kunal Mehta', 'man', 'Mumbai local, window seat.'],
  ['lavanya', 'Lavanya Rao', 'woman', 'Bengaluru cafes.'],
  ['manav', 'Manav Singh', 'man', 'Jaipur. Pink city walks.'],
  ['neha', 'Neha Kapoor', 'woman', 'Delhi bookstores.'],
  ['parth', 'Parth Shah', 'man', 'Rajkot. Still learning the camera.'],
  ['quinn', 'Myra Fernandes', 'woman', 'Panaji. Salt in the air.'],
  ['rhea', 'Rhea Banerjee', 'woman', 'Kolkata. Poetry in the margins.'],
  ['sahil', 'Sahil Khan', 'man', 'Bhopal lakes.'],
  ['tara', 'Tara Menon', 'woman', 'Thiruvananthapuram rain.'],
  ['uday', 'Uday Chopra', 'man', 'Amritsar mornings.'],
  ['vani', 'Vani Krishnan', 'woman', 'Madurai temples and filter coffee.'],
  ['zara', 'Zara Qureshi', 'woman', 'Hyderabad old city.'],
  ['aman', 'Aman Verma', 'man', 'Indore street food.'],
  ['bhavya', 'Bhavya Jain', 'woman', 'Udaipur lakes, once a year.'],
  ['chirag', 'Chirag Dave', 'man', 'Ahmedabad. Always late, always hungry.'],
  ['divya', 'Divya Nair', 'woman', 'Calicut beaches.'],
  ['esha', 'Esha Malhotra', 'woman', 'Shimla when it snows.'],
  ['farhan', 'Farhan Ali', 'man', 'Lucknow galis.'],
  ['gitanjali', 'Gitanjali Das', 'woman', 'Bhubaneswar. Temple bells.'],
  ['heer', 'Heer Solanki', 'woman', 'Bhuj. White desert, one day.'],
  ['imran', 'Imran Sheikh', 'man', 'Srinagar houseboats, from photos so far.'],
  ['jaya', 'Jaya Pillai', 'woman', 'Trivandrum. Sea on the left.'],
  ['karan', 'Karan Bose', 'man', 'Darjeeling tea, seriously.'],
  ['leela', 'Leela Iyer', 'woman', 'Mysuru palaces.'],
].map(([username, display_name, gender, bio]) => ({
  username: username!,
  display_name: display_name!,
  gender: gender as 'man' | 'woman',
  bio: bio!,
}));

const COMMENT_LINES = [
  'This frame is so good.',
  'Need this view on a Sunday.',
  'The light here is unreal.',
  'Saving this for later.',
  'Ahmedabad looks different from here.',
  'Take me with you next time.',
  'That colour is perfect.',
  'Came back to watch this again.',
];

const POST_PHOTOS = [1015, 1016, 1018, 1025, 1035, 1036, 1040, 1043, 1044, 1049, 1050, 1051, 1052, 1055, 1056, 1057];
const STORY_PHOTOS = [1062, 1063, 1064, 1065, 1066, 1067, 1068, 1069];
const REEL_CLIPS = [
  { url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', durationMs: 12_000 },
  { url: 'https://download.samplelib.com/mp4/sample-5s.mp4', durationMs: 5_000 },
];

const USER_DATA: Model<unknown>[] = [
  Follow,
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
  Media,
  Conversation,
  Message,
  Notification,
  SearchHistory,
  Block,
  Mute,
  Report,
  SecretThread,
  SecretMessage,
  SecretBlock,
  Crush,
  CrushMatch,
  CrushAdmirerCount,
  NearbyLocationPing,
  Encounter,
  NearbyNotification,
  SecretUsage,
  PaymentCheckout,
  Payment,
  PaymentWebhookEvent,
  CouponRedemption,
  RefreshToken,
  OtpCode,
  User,
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
  width: number | null;
  height: number | null;
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

async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function sample<T>(items: T[], count: number) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, count);
}

async function main() {
  if (!isMediaConfigured || !env.S3_BUCKET) {
    throw new Error('Set AWS_REGION and S3_BUCKET in backend/.env before seeding photos and reels.');
  }
  if (EXTRAS.length < 48) throw new Error('Need at least 48 extra users for follower counts up to 50.');

  await connectDatabase();
  console.log(`Connected to database "${env.MONGODB_DB_NAME}".`);

  const oldMedia = await Media.find().select('key').lean();
  if (oldMedia.length) {
    await deleteObjects(oldMedia.map((row) => row.key)).catch((err) => {
      console.warn('Could not delete old media files from storage:', (err as Error).message);
    });
  }
  for (const model of USER_DATA) {
    const result = await model.deleteMany({});
    console.log(`Cleared ${model.collection.name}: ${result.deletedCount}`);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_COST);
  const now = new Date();
  const tests = await User.create(
    TEST_ACCOUNTS.map((account, index) => ({
      email: account.email,
      username: account.username,
      display_name: account.display_name,
      password_hash: passwordHash,
      gender: account.gender,
      date_of_birth: new Date(`199${index + 1}-0${index + 1}-15T00:00:00.000Z`),
      bio: account.bio,
      website: account.website,
      is_verified: true,
      status: 'active',
      onboarding_completed_at: now,
      password_changed_at: now,
      last_active_at: new Date(now.getTime() - index * 60_000),
    })),
  );

  const extras = await User.create(
    EXTRAS.map((person, index) => ({
      email: `${person.username}@seed.nexity.app`,
      username: person.username,
      display_name: person.display_name,
      password_hash: passwordHash,
      gender: person.gender,
      date_of_birth: new Date(Date.UTC(1994 + (index % 8), index % 12, (index % 27) + 1)),
      bio: person.bio,
      is_verified: true,
      status: 'active',
      onboarding_completed_at: now,
      password_changed_at: now,
    })),
  );
  console.log(`Created ${tests.length} test accounts and ${extras.length} people.`);

  const faces = [
    ...TEST_ACCOUNTS.map((account) => account.face),
    ...EXTRAS.map((_, index) => `${index % 2 === 0 ? 'men' : 'women'}/${(index % 90) + 1}`),
  ];
  const everyone = [...tests, ...extras];
  console.log('Uploading profile photos…');
  await pool(everyone, 6, async (user, index) => {
    const avatar = await storeFile({
      ownerId: user._id,
      purpose: 'avatar',
      url: `https://randomuser.me/api/portraits/${faces[index]}.jpg`,
      width: 256,
      height: 256,
    });
    user.avatar_media_id = avatar._id;
    user.avatar_key = avatar.key;
    await user.save();
  });

  const extraIds = extras.map((user) => user._id);
  const followPairs = new Map<string, { follower_id: Types.ObjectId; following_id: Types.ObjectId; status: 'accepted' }>();
  const addFollow = (follower: Types.ObjectId, following: Types.ObjectId) => {
    if (follower.equals(following)) return;
    followPairs.set(`${follower.toHexString()}:${following.toHexString()}`, {
      follower_id: follower,
      following_id: following,
      status: 'accepted',
    });
  };

  tests.forEach((user, index) => {
    const account = TEST_ACCOUNTS[index]!;
    const others = tests.filter((other) => !other._id.equals(user._id));
    for (const other of others) addFollow(user._id, other._id);
    for (const id of sample(extraIds, account.following - others.length)) addFollow(user._id, id);
    for (const id of sample(extraIds, account.followers - others.length)) addFollow(id, user._id);
    for (const other of others) addFollow(other._id, user._id);
  });
  await Follow.insertMany([...followPairs.values()]);

  const followerCounts = new Map<string, number>();
  const followingCounts = new Map<string, number>();
  for (const pair of followPairs.values()) {
    const follower = pair.follower_id.toHexString();
    const following = pair.following_id.toHexString();
    followingCounts.set(follower, (followingCounts.get(follower) ?? 0) + 1);
    followerCounts.set(following, (followerCounts.get(following) ?? 0) + 1);
  }
  await Promise.all(
    everyone.map((user) =>
      User.updateOne(
        { _id: user._id },
        {
          $set: {
            followers_count: followerCounts.get(user._id.toHexString()) ?? 0,
            following_count: followingCounts.get(user._id.toHexString()) ?? 0,
          },
        },
      ),
    ),
  );

  const captions = [
    'Riverfront after the rain. #ahmedabad',
    'One more coffee before the day starts.',
    'Old city, late light. #gujarat',
    'The long way home. #weekend',
  ];
  const locations = ['Ahmedabad', 'Mumbai', 'Surat', 'Bengaluru'];
  console.log('Uploading posts, reels and stories…');

  for (const [index, user] of tests.entries()) {
    const mention = tests[(index + 1) % tests.length]!;
    for (let postIndex = 0; postIndex < 4; postIndex += 1) {
      const photoId = POST_PHOTOS[(index * 4 + postIndex) % POST_PHOTOS.length]!;
      const portrait = postIndex % 2 === 0;
      const width = portrait ? 1080 : 1080;
      const height = portrait ? 1350 : 1080;
      const file = await storeFile({
        ownerId: user._id,
        purpose: 'post',
        url: `https://picsum.photos/id/${photoId}/${width}/${height}.jpg`,
        width,
        height,
      });
      const createdAt = new Date(now.getTime() - (index * 4 + postIndex + 1) * 86_400_000);
      const post = await Post.create({
        author_id: user._id,
        media: [
          {
            media_id: file._id,
            key: file.key,
            kind: 'image',
            width,
            height,
            alt_text: captions[postIndex],
          },
        ],
        caption: `${captions[postIndex]} @${mention.username}`,
        mention_ids: [mention._id],
        mentions: [mention.username],
        location_name: locations[index],
        aspect_ratio: portrait ? 0.8 : 1,
        client_upload_id: `seed-test-${user.username}-post-${postIndex}`,
        created_at: createdAt,
        updated_at: createdAt,
      });

      const likers = sample(
        everyone.filter((person) => !person._id.equals(user._id)),
        12 + postIndex * 3,
      );
      await PostLike.insertMany(likers.map((person) => ({ user_id: person._id, post_id: post._id })));
      const commenters = sample(likers, 4);
      await Comment.insertMany(
        commenters.map((person, commentIndex) => ({
          post_id: post._id,
          author_id: person._id,
          body: COMMENT_LINES[(postIndex + commentIndex) % COMMENT_LINES.length],
        })),
      );
      await Post.updateOne(
        { _id: post._id },
        { $set: { likes_count: likers.length, comments_count: commenters.length } },
      );
    }

    for (let reelIndex = 0; reelIndex < 2; reelIndex += 1) {
      const clip = REEL_CLIPS[reelIndex]!;
      const file = await storeFile({
        ownerId: user._id,
        purpose: 'reel',
        url: clip.url,
        width: 720,
        height: 1280,
        durationMs: clip.durationMs,
      });
      const reel = await Reel.create({
        author_id: user._id,
        video_media_id: file._id,
        video_key: file.key,
        width: 720,
        height: 1280,
        duration_ms: clip.durationMs,
        caption: reelIndex === 0 ? `A few seconds from ${locations[index]}. #nexity` : 'Short clip for the reel tab.',
        location_name: locations[index],
        client_upload_id: `seed-test-${user.username}-reel-${reelIndex}`,
      });
      const likers = sample(
        everyone.filter((person) => !person._id.equals(user._id)),
        10 + reelIndex * 4,
      );
      await ReelLike.insertMany(likers.map((person) => ({ user_id: person._id, reel_id: reel._id })));
      const commenters = sample(likers, 3);
      await Comment.insertMany(
        commenters.map((person, commentIndex) => ({
          reel_id: reel._id,
          author_id: person._id,
          body: COMMENT_LINES[(reelIndex + commentIndex + 2) % COMMENT_LINES.length],
        })),
      );
      await Reel.updateOne(
        { _id: reel._id },
        { $set: { likes_count: likers.length, comments_count: commenters.length } },
      );
    }

    for (let storyIndex = 0; storyIndex < 2; storyIndex += 1) {
      const photoId = STORY_PHOTOS[(index * 2 + storyIndex) % STORY_PHOTOS.length]!;
      const file = await storeFile({
        ownerId: user._id,
        purpose: 'story',
        url: `https://picsum.photos/id/${photoId}/720/1280.jpg`,
        width: 720,
        height: 1280,
      });
      const story = await Story.create({
        author_id: user._id,
        media_id: file._id,
        key: file.key,
        kind: 'image',
        width: 720,
        height: 1280,
        location_name: locations[index],
        expires_at: new Date(now.getTime() + STORY_TTL_MS),
      });
      const viewers = sample(
        tests.filter((person) => !person._id.equals(user._id)),
        2,
      );
      await StoryView.insertMany(viewers.map((person) => ({ story_id: story._id, viewer_id: person._id })));
    }

    await User.updateOne({ _id: user._id }, { $set: { posts_count: 4 } });
    console.log(
      `@${user.username}: ${accountFollowers(user)} followers, ${accountFollowing(user)} following, 4 posts, 2 reels, 2 stories`,
    );
  }

  const passwordOk = await bcrypt.compare(PASSWORD, (await User.findOne({ email: 'test1@gmail.com' }).select('+password_hash'))!.password_hash);
  if (!passwordOk) throw new Error('test1 password did not match Test@123');

  console.log('Done. Log in as test1@gmail.com … test4@gmail.com with Test@123.');
  await disconnectDatabase();

  function accountFollowers(user: UserDoc) {
    return followerCounts.get(user._id.toHexString()) ?? 0;
  }
  function accountFollowing(user: UserDoc) {
    return followingCounts.get(user._id.toHexString()) ?? 0;
  }
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
