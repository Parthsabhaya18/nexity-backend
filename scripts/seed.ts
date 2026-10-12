/**
 * Demo accounts, profile photos, posts, reels and stories for end-to-end testing.
 * Re-running replaces only @seed.nexity.app accounts. Other users are left as they are.
 *
 * Also fills TARGET_EMAIL (the account must already exist) with posts, reels and
 * saved posts, mutual follows, and a story tray of the people they follow.
 * Re-running replaces only that account's seed posts and reels
 * (`client_upload_id` starting with `seed-account-`).
 *
 * Usage: npm run seed
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import bcrypt from 'bcryptjs';
import mongoose, { type Types } from 'mongoose';

import { connectDatabase } from '../src/config/database';
import { env, isMediaConfigured } from '../src/config/env';
import { Follow } from '../src/modules/follows/follow.model';
import { KEY_FOLDERS, type MediaPurpose } from '../src/modules/media/media.rules';
import { Media } from '../src/modules/media/media.model';
import { deleteObjects } from '../src/modules/media/media.storage';
import { Comment, PostLike, PostSave } from '../src/modules/posts/post.engage.model';
import { Post } from '../src/modules/posts/post.model';
import { Reel, ReelLike } from '../src/modules/reels/reel.model';
import { Story, StoryView } from '../src/modules/stories/story.model';
import { GENDERS, User, type UserDoc } from '../src/modules/users/user.model';

const PASSWORD = 'Test@123';
const EMAIL_DOMAIN = 'seed.nexity.app';
const TARGET_EMAIL = 'gohilchirag90994@gmail.com';
const BCRYPT_COST = 12;

type Gender = (typeof GENDERS)[number];
type Theme = 'system' | 'light' | 'dark';
type Mood =
  | 'happy'
  | 'calm'
  | 'romantic'
  | 'sad'
  | 'angry'
  | 'cool'
  | 'relaxed'
  | 'excited'
  | 'tired'
  | 'motivated'
  | null;

type Person = {
  username: string;
  displayName: string;
  gender: Gender;
  bio: string;
  website: string;
  isPrivate: boolean;
  theme: Theme;
  mood: Mood;
  /** https://i.pravatar.cc face id, so the profile photo is a real picture. */
  face: number;
  born: string;
};

const PEOPLE: Person[] = [
  {
    username: 'aarav',
    displayName: 'Aarav Shah',
    gender: 'man',
    bio: 'Ahmedabad. Photos, reels and late coffee.',
    website: 'https://aarav.example.com',
    isPrivate: false,
    theme: 'dark',
    mood: null,
    face: 12,
    born: '1998-04-12',
  },
  {
    username: 'meera',
    displayName: 'Meera Patel',
    gender: 'woman',
    bio: 'Shooting light around Gujarat. #gujarat',
    website: 'https://meera.example.com',
    isPrivate: false,
    theme: 'light',
    mood: null,
    face: 47,
    born: '1999-11-03',
  },
  {
    username: 'riya',
    displayName: 'Riya Desai',
    gender: 'woman',
    bio: 'Private account. Accept a request to see posts.',
    website: '',
    isPrivate: true,
    theme: 'system',
    mood: null,
    face: 45,
    born: '2001-02-18',
  },
  {
    username: 'nisha',
    displayName: 'Nisha Rao',
    gender: 'woman',
    bio: 'Private, but friends can see the grid.',
    website: '',
    isPrivate: true,
    theme: 'system',
    mood: 'calm',
    face: 44,
    born: '1997-07-22',
  },
  {
    username: 'kabir',
    displayName: 'Kabir Joshi',
    gender: 'man',
    bio: 'Reels from the road.',
    website: '',
    isPrivate: false,
    theme: 'system',
    mood: null,
    face: 32,
    born: '1996-09-09',
  },
  {
    username: 'anaya',
    displayName: 'Anaya Mehta',
    gender: 'woman',
    bio: 'Stories first. Then coffee.',
    website: 'https://anaya.example.com',
    isPrivate: false,
    theme: 'system',
    mood: 'happy',
    face: 25,
    born: '2000-01-30',
  },
  {
    username: 'dev',
    displayName: 'Dev Trivedi',
    gender: 'man',
    bio: 'Quiet Sundays.',
    website: '',
    isPrivate: false,
    theme: 'system',
    mood: 'relaxed',
    face: 15,
    born: '1995-12-01',
  },
  {
    username: 'om',
    displayName: 'Om Kapoor',
    gender: 'man',
    bio: '',
    website: '',
    isPrivate: false,
    theme: 'system',
    mood: null,
    face: 51,
    born: '2002-06-14',
  },
  {
    username: 'sara',
    displayName: 'Sara Khan',
    gender: 'woman',
    bio: 'Two cities, one camera.',
    website: 'https://sara.example.com',
    isPrivate: false,
    theme: 'light',
    mood: null,
    face: 5,
    born: '1994-03-08',
  },
  {
    username: 'jay',
    displayName: 'Jay Solanki',
    gender: 'non_binary',
    bio: 'New here.',
    website: '',
    isPrivate: false,
    theme: 'system',
    mood: null,
    face: 60,
    born: '2003-08-19',
  },
  {
    username: 'diya',
    displayName: 'Diya Iyer',
    gender: 'prefer_not_to_say',
    bio: 'I leave comments.',
    website: '',
    isPrivate: false,
    theme: 'system',
    mood: 'motivated',
    face: 9,
    born: '1998-10-27',
  },
];

type Photo = { picsum: number; width: number; height: number; alt?: string };

const PORTRAIT = { width: 1080, height: 1350 };
const SQUARE = { width: 1080, height: 1080 };
const LANDSCAPE = { width: 1080, height: 566 };

type PostSeed = {
  author: string;
  photos: Photo[];
  caption: string;
  location: string;
  aspect: number;
  hideLikes?: boolean;
  commentsOff?: boolean;
};

const POSTS: PostSeed[] = [
  {
    author: 'meera',
    photos: [
      { picsum: 1015, ...PORTRAIT, alt: 'River in the morning' },
      { picsum: 1016, ...PORTRAIT, alt: 'Bridge over the river' },
      { picsum: 1018, ...PORTRAIT, alt: 'City path' },
    ],
    caption: 'Sabarmati this morning. #ahmedabad #gujarat #ગુજરાત @aarav',
    location: 'Ahmedabad',
    aspect: 0.8,
  },
  {
    author: 'meera',
    photos: [{ picsum: 1025, ...SQUARE, alt: 'Beach' }],
    caption: 'Slow days by the water. #goa',
    location: 'Goa',
    aspect: 1,
  },
  {
    author: 'aarav',
    photos: [{ picsum: 1035, ...PORTRAIT, alt: 'Night street' }],
    caption: 'Night market lights. #surat @meera',
    location: 'Surat',
    aspect: 0.8,
  },
  {
    author: 'aarav',
    photos: [{ picsum: 1036, ...SQUARE, alt: 'Studio wall' }],
    caption: 'Studio afternoon. #photography',
    location: '',
    aspect: 1,
  },
  {
    author: 'kabir',
    photos: [{ picsum: 1040, ...LANDSCAPE, alt: 'Sea wall' }],
    caption: 'Marine Drive after rain. #mumbai',
    location: 'Mumbai',
    aspect: 1.91,
  },
  {
    author: 'anaya',
    photos: [{ picsum: 1043, ...PORTRAIT, alt: 'Lake palace' }],
    caption: 'Lakeside evening. #udaipur #rajasthan',
    location: 'Udaipur',
    aspect: 0.8,
  },
  {
    author: 'anaya',
    photos: [{ picsum: 1044, ...SQUARE }],
    caption: 'Coffee and a full roll of film. #ahmedabad',
    location: 'Ahmedabad',
    aspect: 1,
  },
  {
    author: 'dev',
    photos: [{ picsum: 1049, ...SQUARE, alt: 'Quiet room' }],
    caption: 'Quiet Sunday. Like count stays hidden. #calm',
    location: '',
    aspect: 1,
    hideLikes: true,
  },
  {
    author: 'nisha',
    photos: [{ picsum: 1050, ...PORTRAIT, alt: 'Pink city street' }],
    caption: 'Visible once you follow. #jaipur',
    location: 'Jaipur',
    aspect: 0.8,
  },
  {
    author: 'nisha',
    photos: [{ picsum: 1051, ...SQUARE }],
    caption: 'Second frame from the same trip.',
    location: 'Jaipur',
    aspect: 1,
  },
  {
    author: 'riya',
    photos: [{ picsum: 1052, ...PORTRAIT, alt: 'City lane' }],
    caption: 'Only followers can see this. #vadodara',
    location: 'Vadodara',
    aspect: 0.8,
  },
  {
    author: 'om',
    photos: [{ picsum: 1055, ...SQUARE }],
    caption: 'Comments are off on this one. #delhi',
    location: 'Delhi',
    aspect: 1,
    commentsOff: true,
  },
  {
    author: 'sara',
    photos: [
      { picsum: 1056, ...LANDSCAPE, alt: 'Harbour' },
      { picsum: 1057, ...LANDSCAPE, alt: 'Skyline' },
    ],
    caption: 'Weekend between two cities. #singapore @meera',
    location: 'Singapore',
    aspect: 1.91,
  },
  {
    author: 'diya',
    photos: [{ picsum: 1058, ...PORTRAIT, alt: 'Garden path' }],
    caption: 'Garden city mornings. #bengaluru',
    location: 'Bengaluru',
    aspect: 0.8,
  },
  {
    author: 'jay',
    photos: [{ picsum: 1060, ...SQUARE }],
    caption: 'Hello Nexity. #nexity',
    location: '',
    aspect: 1,
  },
];

const REELS: {
  author: string;
  url: string;
  caption: string;
  location: string;
  durationMs: number;
}[] = [
  {
    author: 'kabir',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    caption: 'A few seconds of flowers. #mumbai @aarav',
    location: 'Mumbai',
    durationMs: 12_000,
  },
  {
    author: 'anaya',
    url: 'https://www.w3schools.com/html/mov_bbb.mp4',
    caption: 'Short clip for the reel tab. #ahmedabad',
    location: 'Ahmedabad',
    durationMs: 10_000,
  },
  {
    author: 'aarav',
    url: 'https://download.samplelib.com/mp4/sample-5s.mp4',
    caption: 'Five seconds out of the city. #goa @meera',
    location: 'Goa',
    durationMs: 5_000,
  },
];

/** Home tray for anyone who follows these accounts. dev is already seen by aarav. */
const STORIES: { author: string; picsum: number; seenBy: string[] }[] = [
  { author: 'aarav', picsum: 1067, seenBy: [] },
  { author: 'anaya', picsum: 1068, seenBy: [] },
  { author: 'meera', picsum: 1069, seenBy: [] },
  { author: 'dev', picsum: 1070, seenBy: ['aarav'] },
  { author: 'kabir', picsum: 1062, seenBy: [] },
  { author: 'sara', picsum: 1063, seenBy: [] },
  { author: 'diya', picsum: 1064, seenBy: [] },
  { author: 'om', picsum: 1065, seenBy: [] },
  { author: 'jay', picsum: 1066, seenBy: [] },
  { author: 'nisha', picsum: 1071, seenBy: [] },
];

/** Public seed accounts, plus private nisha, follow the target account both ways. */
const MUTUAL_WITH_TARGET = [
  'aarav',
  'meera',
  'kabir',
  'anaya',
  'dev',
  'om',
  'sara',
  'diya',
  'jay',
  'nisha',
];

const ACCOUNT_POSTS: PostSeed[] = [
  {
    author: 'account',
    photos: [
      { picsum: 1074, ...PORTRAIT, alt: 'Riverfront evening' },
      { picsum: 1076, ...PORTRAIT, alt: 'Bridge lights' },
    ],
    caption: 'Riverfront after work. #ahmedabad #gujarat @meera',
    location: 'Ahmedabad',
    aspect: 0.8,
  },
  {
    author: 'account',
    photos: [{ picsum: 1078, ...SQUARE, alt: 'Coffee cup' }],
    caption: 'One more coffee. #ahmedabad @aarav',
    location: 'Ahmedabad',
    aspect: 1,
  },
  {
    author: 'account',
    photos: [{ picsum: 1080, ...PORTRAIT, alt: 'Old city lane' }],
    caption: 'Old city, late light. #surat',
    location: 'Surat',
    aspect: 0.8,
  },
  {
    author: 'account',
    photos: [{ picsum: 1081, ...LANDSCAPE, alt: 'Sea road' }],
    caption: 'Sea road on the way home. #mumbai',
    location: 'Mumbai',
    aspect: 1.91,
  },
  {
    author: 'account',
    photos: [{ picsum: 1082, ...SQUARE, alt: 'Studio table' }],
    caption: 'Desk before the week starts. #photography',
    location: '',
    aspect: 1,
  },
];

const ACCOUNT_REELS: {
  url: string;
  caption: string;
  location: string;
  durationMs: number;
}[] = [
  {
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    caption: 'A short clip from the weekend. #ahmedabad @anaya',
    location: 'Ahmedabad',
    durationMs: 12_000,
  },
  {
    url: 'https://download.samplelib.com/mp4/sample-5s.mp4',
    caption: 'Five seconds by the water. #goa @kabir',
    location: 'Goa',
    durationMs: 5_000,
  },
];

/** follower -> following. Pending only lands on private accounts. */
const FOLLOWS: { follower: string; following: string; status: 'accepted' | 'pending' }[] = [
  { follower: 'aarav', following: 'meera', status: 'accepted' },
  { follower: 'aarav', following: 'kabir', status: 'accepted' },
  { follower: 'aarav', following: 'anaya', status: 'accepted' },
  { follower: 'aarav', following: 'dev', status: 'accepted' },
  { follower: 'aarav', following: 'nisha', status: 'accepted' },
  { follower: 'aarav', following: 'sara', status: 'accepted' },
  { follower: 'aarav', following: 'diya', status: 'accepted' },
  { follower: 'aarav', following: 'jay', status: 'accepted' },
  { follower: 'aarav', following: 'om', status: 'accepted' },
  { follower: 'aarav', following: 'riya', status: 'pending' },
  { follower: 'meera', following: 'aarav', status: 'accepted' },
  { follower: 'meera', following: 'anaya', status: 'accepted' },
  { follower: 'meera', following: 'sara', status: 'accepted' },
  { follower: 'kabir', following: 'aarav', status: 'accepted' },
  { follower: 'kabir', following: 'meera', status: 'accepted' },
  { follower: 'kabir', following: 'riya', status: 'pending' },
  { follower: 'anaya', following: 'aarav', status: 'accepted' },
  { follower: 'anaya', following: 'meera', status: 'accepted' },
  { follower: 'anaya', following: 'riya', status: 'pending' },
  { follower: 'dev', following: 'aarav', status: 'accepted' },
  { follower: 'dev', following: 'riya', status: 'pending' },
  { follower: 'nisha', following: 'aarav', status: 'accepted' },
  { follower: 'om', following: 'aarav', status: 'accepted' },
  { follower: 'om', following: 'meera', status: 'accepted' },
  { follower: 'om', following: 'riya', status: 'pending' },
  { follower: 'sara', following: 'meera', status: 'accepted' },
  { follower: 'sara', following: 'aarav', status: 'accepted' },
  { follower: 'diya', following: 'aarav', status: 'accepted' },
  { follower: 'diya', following: 'meera', status: 'accepted' },
  { follower: 'diya', following: 'anaya', status: 'accepted' },
  { follower: 'jay', following: 'aarav', status: 'accepted' },
  { follower: 'riya', following: 'aarav', status: 'accepted' },
];

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

function sniff(buf: Buffer) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return { contentType: 'image/jpeg', ext: 'jpg' };
  if (buf[0] === 0x89 && buf[1] === 0x50) return { contentType: 'image/png', ext: 'png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { contentType: 'image/webp', ext: 'webp' };
  }
  if (buf.toString('ascii', 4, 8) === 'ftyp') return { contentType: 'video/mp4', ext: 'mp4' };
  throw new Error('Downloaded file is not a jpeg, png, webp or mp4');
}

async function download(url: string) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download ${url} (HTTP ${res.status})`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length < 32) throw new Error(`Download was empty: ${url}`);
  return body;
}

const uploadedKeys: string[] = [];

async function storeFile(opts: {
  ownerId: string;
  purpose: MediaPurpose;
  url: string;
  width: number | null;
  height: number | null;
  durationMs?: number | null;
}) {
  const body = await download(opts.url);
  const { contentType, ext } = sniff(body);
  const kind = ext === 'mp4' ? 'video' : 'image';
  const id = new mongoose.Types.ObjectId();
  const key = `media/${KEY_FOLDERS[opts.purpose]}/${opts.ownerId}/${id.toHexString()}.${ext}`;
  await s3().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  uploadedKeys.push(key);
  const media = await Media.create({
    _id: id,
    owner_id: opts.ownerId,
    purpose: opts.purpose,
    kind,
    key,
    content_type: contentType,
    bytes: body.length,
    width: opts.width,
    height: opts.height,
    duration_ms: opts.durationMs ?? null,
    status: 'ready',
    upload_expires_at: new Date(),
  });
  return media;
}

async function removePreviousSeed() {
  const previous = await User.find({ email: new RegExp(`@${EMAIL_DOMAIN}$`, 'i') }).select('_id');
  const ids = previous.map((u) => u._id);
  if (!ids.length) return;

  const [media, posts, reels, stories, links] = await Promise.all([
    Media.find({ owner_id: { $in: ids } }).select('key'),
    Post.find({ author_id: { $in: ids } }).select('_id'),
    Reel.find({ author_id: { $in: ids } }).select('_id'),
    Story.find({ author_id: { $in: ids } }).select('_id'),
    Follow.find({
      $or: [{ follower_id: { $in: ids } }, { following_id: { $in: ids } }],
    }).select('follower_id following_id'),
  ]);

  const outsiderIds = new Set<string>();
  for (const link of links) {
    for (const id of [link.follower_id, link.following_id]) {
      const hex = id.toHexString();
      if (!ids.some((seedId) => seedId.equals(id))) outsiderIds.add(hex);
    }
  }

  const postIds = posts.map((p) => p._id);
  const reelIds = reels.map((r) => r._id);
  const storyIds = stories.map((s) => s._id);
  const keys = media.map((m) => m.key);

  await Promise.all([
    PostLike.deleteMany({ $or: [{ user_id: { $in: ids } }, { post_id: { $in: postIds } }] }),
    PostSave.deleteMany({ $or: [{ user_id: { $in: ids } }, { post_id: { $in: postIds } }] }),
    Comment.deleteMany({
      $or: [
        { author_id: { $in: ids } },
        { post_id: { $in: postIds } },
        { reel_id: { $in: reelIds } },
      ],
    }),
    ReelLike.deleteMany({ $or: [{ user_id: { $in: ids } }, { reel_id: { $in: reelIds } }] }),
    StoryView.deleteMany({
      $or: [{ viewer_id: { $in: ids } }, { story_id: { $in: storyIds } }],
    }),
    Post.deleteMany({ author_id: { $in: ids } }),
    Reel.deleteMany({ author_id: { $in: ids } }),
    Story.deleteMany({ author_id: { $in: ids } }),
    Media.deleteMany({ owner_id: { $in: ids } }),
    Follow.deleteMany({ $or: [{ follower_id: { $in: ids } }, { following_id: { $in: ids } }] }),
    User.deleteMany({ _id: { $in: ids } }),
  ]);
  if (keys.length) await deleteObjects(keys);

  await Promise.all([...outsiderIds].map((id) => recountFollows(new mongoose.Types.ObjectId(id))));
  console.log(`Removed ${ids.length} previous seed account(s).`);
}

async function recountFollows(userId: Types.ObjectId) {
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

function mentionsIn(caption: string, author: string) {
  const names = [...caption.matchAll(/@([a-z0-9._]{3,30})/gi)].map((match) =>
    match[1]!.toLowerCase(),
  );
  return [...new Set(names.filter((name) => name !== author))];
}

async function clearAccountSeed(userId: Types.ObjectId) {
  const [posts, reels] = await Promise.all([
    Post.find({ author_id: userId, client_upload_id: /^seed-account-post-/ }).select('_id media'),
    Reel.find({ author_id: userId, client_upload_id: /^seed-account-reel-/ }).select(
      '_id video_media_id',
    ),
  ]);
  const postIds = posts.map((post) => post._id);
  const reelIds = reels.map((reel) => reel._id);
  const mediaIds = [
    ...posts.flatMap((post) => post.media.map((item) => item.media_id)),
    ...reels.map((reel) => reel.video_media_id),
  ];
  const media = mediaIds.length ? await Media.find({ _id: { $in: mediaIds } }).select('key') : [];

  await Promise.all([
    PostLike.deleteMany({ post_id: { $in: postIds } }),
    PostSave.deleteMany({ post_id: { $in: postIds } }),
    Comment.deleteMany({ $or: [{ post_id: { $in: postIds } }, { reel_id: { $in: reelIds } }] }),
    ReelLike.deleteMany({ reel_id: { $in: reelIds } }),
    Post.deleteMany({ _id: { $in: postIds } }),
    Reel.deleteMany({ _id: { $in: reelIds } }),
    Media.deleteMany({ _id: { $in: mediaIds } }),
  ]);
  const keys = media.map((file) => file.key);
  if (keys.length) await deleteObjects(keys);
  if (posts.length || reels.length) {
    console.log(`Removed previous seed posts and reels for ${TARGET_EMAIL}.`);
  }
}

async function fillAccount(
  account: UserDoc,
  users: Map<string, UserDoc>,
  postsByAuthor: Map<string, { _id: Types.ObjectId }[]>,
) {
  await clearAccountSeed(account._id);

  const mentionUsers = (caption: string) => {
    const names = mentionsIn(caption, account.username);
    return names.flatMap((name) => {
      const user = users.get(name);
      return user ? [user] : [];
    });
  };

  const accountPosts: { _id: Types.ObjectId }[] = [];
  let postNumber = 0;
  for (const seed of ACCOUNT_POSTS) {
    postNumber += 1;
    const media = [];
    for (const photo of seed.photos) {
      const file = await storeFile({
        ownerId: account.id as string,
        purpose: 'post',
        url: `https://picsum.photos/id/${photo.picsum}/${photo.width}/${photo.height}.jpg`,
        width: photo.width,
        height: photo.height,
      });
      media.push({
        media_id: file._id,
        key: file.key,
        kind: 'image' as const,
        width: photo.width,
        height: photo.height,
        alt_text: photo.alt ?? '',
        duration_ms: null,
      });
    }
    const mentioned = mentionUsers(seed.caption);
    const post = await Post.create({
      author_id: account._id,
      media,
      caption: seed.caption,
      mention_ids: mentioned.map((user) => user._id),
      mentions: mentioned.map((user) => user.username),
      location_name: seed.location,
      aspect_ratio: seed.aspect,
      hide_like_count: false,
      comments_disabled: false,
      client_upload_id: `seed-account-post-${postNumber}`,
    });
    accountPosts.push(post);
    console.log(`Post ${postNumber}/${ACCOUNT_POSTS.length} by @${account.username}`);
  }

  const accountReels: { _id: Types.ObjectId }[] = [];
  let reelNumber = 0;
  for (const seed of ACCOUNT_REELS) {
    reelNumber += 1;
    const file = await storeFile({
      ownerId: account.id as string,
      purpose: 'reel',
      url: seed.url,
      width: 1280,
      height: 720,
      durationMs: seed.durationMs,
    });
    const mentioned = mentionUsers(seed.caption);
    const reel = await Reel.create({
      author_id: account._id,
      video_media_id: file._id,
      video_key: file.key,
      width: 1280,
      height: 720,
      duration_ms: seed.durationMs,
      caption: seed.caption,
      mentions: mentioned.map((user) => user.username),
      location_name: seed.location,
      client_upload_id: `seed-account-reel-${reelNumber}`,
    });
    accountReels.push(reel);
    console.log(`Reel ${reelNumber}/${ACCOUNT_REELS.length} by @${account.username}`);
  }

  const userOf = (username: string) => {
    const user = users.get(username);
    if (!user) throw new Error(`Missing seed user @${username}`);
    return user;
  };

  await Follow.insertMany([
    ...MUTUAL_WITH_TARGET.flatMap((name) => {
      const other = userOf(name);
      return [
        { follower_id: account._id, following_id: other._id, status: 'accepted' as const },
        { follower_id: other._id, following_id: account._id, status: 'accepted' as const },
      ];
    }),
    { follower_id: account._id, following_id: userOf('riya')._id, status: 'pending' as const },
  ]);

  const saved = [
    'meera',
    'aarav',
    'kabir',
    'anaya',
    'dev',
    'sara',
    'diya',
    'jay',
    'om',
    'nisha',
  ].flatMap((name) => postsByAuthor.get(name) ?? []);
  await PostSave.insertMany(saved.map((post) => ({ user_id: account._id, post_id: post._id })));

  const first = accountPosts[0];
  const second = accountPosts[1];
  const firstReel = accountReels[0];
  const secondReel = accountReels[1];
  if (!first || !second || !firstReel || !secondReel) {
    throw new Error('Account posts were not created');
  }

  await PostLike.insertMany([
    { user_id: userOf('meera')._id, post_id: first._id },
    { user_id: userOf('aarav')._id, post_id: first._id },
    { user_id: userOf('diya')._id, post_id: first._id },
    { user_id: userOf('kabir')._id, post_id: second._id },
    { user_id: userOf('anaya')._id, post_id: second._id },
  ]);
  await Post.updateOne({ _id: first._id }, { $set: { likes_count: 3, comments_count: 1 } });
  await Post.updateOne({ _id: second._id }, { $set: { likes_count: 2, comments_count: 0 } });
  await Comment.create({
    post_id: first._id,
    author_id: userOf('meera')._id,
    body: 'Ahmedabad looks good from here.',
  });

  await ReelLike.insertMany([
    { user_id: userOf('anaya')._id, reel_id: firstReel._id },
    { user_id: userOf('kabir')._id, reel_id: firstReel._id },
    { user_id: userOf('meera')._id, reel_id: secondReel._id },
  ]);
  await Reel.updateOne({ _id: firstReel._id }, { $set: { likes_count: 2 } });
  await Reel.updateOne({ _id: secondReel._id }, { $set: { likes_count: 1 } });

  console.log(`Saved ${saved.length} posts for @${account.username}.`);
}

async function main() {
  if (!isMediaConfigured || !env.S3_BUCKET) {
    throw new Error('Set AWS_REGION and S3_BUCKET in backend/.env before seeding images.');
  }

  await connectDatabase();
  console.log(`Connected to database "${env.MONGODB_DB_NAME}".`);

  const account = await User.findOne({ email: TARGET_EMAIL });
  if (!account) {
    throw new Error(
      `Sign up and log in once as ${TARGET_EMAIL}, then run npm run seed again.`,
    );
  }

  const usernames = PEOPLE.map((p) => p.username);
  const taken = await User.find({
    username: { $in: usernames },
    email: { $not: new RegExp(`@${EMAIL_DOMAIN}$`, 'i') },
  }).select('username');
  if (taken.length) {
    throw new Error(
      `These usernames already belong to other accounts: ${taken.map((u) => u.username).join(', ')}. Rename them or remove them, then run the seed again.`,
    );
  }

  await removePreviousSeed();

  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_COST);
  const users = new Map<string, UserDoc>();

  for (const person of PEOPLE) {
    const user = await User.create({
      email: `${person.username}@${EMAIL_DOMAIN}`,
      username: person.username,
      display_name: person.displayName,
      password_hash: passwordHash,
      gender: person.gender,
      date_of_birth: new Date(person.born),
      bio: person.bio,
      website: person.website,
      is_private: person.isPrivate,
      is_verified: true,
      status: 'active',
      theme_preference: person.theme,
      mood: person.mood,
      onboarding_completed_at: new Date(),
      password_changed_at: new Date(),
    });
    console.log(`Account @${person.username}`);
    const avatar = await storeFile({
      ownerId: user.id as string,
      purpose: 'avatar',
      url: `https://i.pravatar.cc/400?img=${person.face}`,
      width: 400,
      height: 400,
    });
    user.avatar_media_id = avatar._id;
    user.avatar_key = avatar.key;
    await user.save();
    users.set(person.username, user);
  }

  const userOf = (username: string) => {
    const user = users.get(username);
    if (!user) throw new Error(`Missing seed user @${username}`);
    return user;
  };

  const postsByAuthor = new Map<string, { _id: Types.ObjectId }[]>();
  let postNumber = 0;
  for (const seed of POSTS) {
    postNumber += 1;
    const author = userOf(seed.author);
    const media = [];
    for (const photo of seed.photos) {
      const file = await storeFile({
        ownerId: author.id as string,
        purpose: 'post',
        url: `https://picsum.photos/id/${photo.picsum}/${photo.width}/${photo.height}.jpg`,
        width: photo.width,
        height: photo.height,
      });
      media.push({
        media_id: file._id,
        key: file.key,
        kind: 'image' as const,
        width: photo.width,
        height: photo.height,
        alt_text: photo.alt ?? '',
        duration_ms: null,
      });
    }
    const names = mentionsIn(seed.caption, seed.author);
    const mentionUsers = names.map((name) => userOf(name));
    const post = await Post.create({
      author_id: author._id,
      media,
      caption: seed.caption,
      mention_ids: mentionUsers.map((u) => u._id),
      mentions: mentionUsers.map((u) => u.username),
      location_name: seed.location,
      aspect_ratio: seed.aspect,
      hide_like_count: seed.hideLikes ?? false,
      comments_disabled: seed.commentsOff ?? false,
      client_upload_id: `seed-${seed.author}-post-${postNumber}`,
    });
    const list = postsByAuthor.get(seed.author) ?? [];
    list.push(post);
    postsByAuthor.set(seed.author, list);
    console.log(`Post ${postNumber}/${POSTS.length} by @${seed.author}`);
  }

  const reels = new Map<string, { _id: Types.ObjectId }>();
  for (const seed of REELS) {
    const author = userOf(seed.author);
    const file = await storeFile({
      ownerId: author.id as string,
      purpose: 'reel',
      url: seed.url,
      width: 1280,
      height: 720,
      durationMs: seed.durationMs,
    });
    const names = mentionsIn(seed.caption, seed.author);
    const reel = await Reel.create({
      author_id: author._id,
      video_media_id: file._id,
      video_key: file.key,
      width: 1280,
      height: 720,
      duration_ms: seed.durationMs,
      caption: seed.caption,
      mentions: names,
      location_name: seed.location,
      client_upload_id: `seed-${seed.author}-reel`,
    });
    reels.set(seed.author, reel);
    console.log(`Reel by @${seed.author}`);
  }

  const storyDocs = new Map<string, { _id: Types.ObjectId }>();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  for (const seed of STORIES) {
    const author = userOf(seed.author);
    const file = await storeFile({
      ownerId: author.id as string,
      purpose: 'story',
      url: `https://picsum.photos/id/${seed.picsum}/1080/1920.jpg`,
      width: 1080,
      height: 1920,
    });
    const story = await Story.create({
      author_id: author._id,
      media_id: file._id,
      key: file.key,
      kind: 'image',
      width: 1080,
      height: 1920,
      expires_at: expiresAt,
    });
    storyDocs.set(seed.author, story);
    if (seed.seenBy.length) {
      await StoryView.insertMany(
        seed.seenBy.map((name) => ({ story_id: story._id, viewer_id: userOf(name)._id })),
      );
    }
    console.log(`Story by @${seed.author}`);
  }

  await Follow.insertMany(
    FOLLOWS.map((row) => ({
      follower_id: userOf(row.follower)._id,
      following_id: userOf(row.following)._id,
      status: row.status,
    })),
  );

  const meeraFirst = postsByAuthor.get('meera')?.[0];
  const aaravFirst = postsByAuthor.get('aarav')?.[0];
  const kabirPost = postsByAuthor.get('kabir')?.[0];
  if (!meeraFirst || !aaravFirst || !kabirPost) throw new Error('Expected posts were not created');

  const like = (username: string, postId: Types.ObjectId) => ({
    user_id: userOf(username)._id,
    post_id: postId,
  });
  await PostLike.insertMany([
    like('aarav', meeraFirst._id),
    like('diya', meeraFirst._id),
    like('kabir', meeraFirst._id),
    like('meera', aaravFirst._id),
    like('diya', aaravFirst._id),
    like('aarav', kabirPost._id),
  ]);
  await PostSave.insertMany([
    { user_id: userOf('aarav')._id, post_id: meeraFirst._id },
    { user_id: userOf('aarav')._id, post_id: kabirPost._id },
  ]);

  const topComment = await Comment.create({
    post_id: meeraFirst._id,
    author_id: userOf('diya')._id,
    body: 'This light is beautiful.',
  });
  await Comment.create({
    post_id: meeraFirst._id,
    author_id: userOf('aarav')._id,
    parent_id: topComment._id,
    body: 'Shot this morning in Ahmedabad.',
  });
  await Comment.create({
    post_id: aaravFirst._id,
    author_id: userOf('meera')._id,
    body: 'Surat looks good on you.',
  });

  const kabirReel = reels.get('kabir');
  if (kabirReel) {
    await ReelLike.insertMany([
      { user_id: userOf('aarav')._id, reel_id: kabirReel._id },
      { user_id: userOf('meera')._id, reel_id: kabirReel._id },
    ]);
    await Comment.create({
      reel_id: kabirReel._id,
      author_id: userOf('diya')._id,
      body: 'Take me with you next time.',
    });
    await Reel.updateOne({ _id: kabirReel._id }, { $set: { likes_count: 2, comments_count: 1 } });
  }

  await Post.updateOne({ _id: meeraFirst._id }, { $set: { likes_count: 3, comments_count: 1 } });
  await Post.updateOne({ _id: aaravFirst._id }, { $set: { likes_count: 2, comments_count: 1 } });
  await Post.updateOne({ _id: kabirPost._id }, { $set: { likes_count: 1, comments_count: 0 } });

  await fillAccount(account, users, postsByAuthor);
  await Promise.all([
    ...[...users.values()].map((user) => recountFollows(user._id)),
    recountFollows(account._id),
  ]);

  console.log('');
  console.log(`Filled ${TARGET_EMAIL} (@${account.username})`);
  console.log('  posts, reels and saved posts');
  console.log('  mutual follows with the public seed accounts and nisha');
  console.log('  story tray shows the people they follow');
  console.log('  follow request still pending for private @riya');
  console.log('');
  console.log('Seed ready. Password for every demo account: Test@123');
  console.log('Log in with the username or the email.');
  console.log('');
  console.log('  aarav   public   home feed, stories, saved posts, dark theme');
  console.log('  riya    private  follow requests waiting, including the filled account');
  console.log('  nisha   private  accepted follows, so her story and posts are visible');
  console.log('  meera   public   carousel post, profile photo, website');
  console.log('  kabir   public   reel + landscape post');
  console.log('  anaya   public   unseen story + reel');
  console.log('  dev     public   story already seen by aarav, hidden like count');
  console.log('  om      public   comments turned off');
  console.log('');
  for (const person of PEOPLE) {
    const kind = person.isPrivate ? 'private' : 'public ';
    console.log(`  ${person.username.padEnd(8)} ${kind}  ${person.username}@${EMAIL_DOMAIN}`);
  }
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
