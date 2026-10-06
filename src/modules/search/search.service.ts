import { escapeRegex, userSearchFilter } from '../../utils/regex';
import { Follow } from '../follows/follow.model';
import { toUserSummaries } from '../follows/follow.service';
import { blockIdsFor } from '../safety/block.service';
import { Post } from '../posts/post.model';
import { User, type UserDoc } from '../users/user.model';
import { lookUpPlaces } from './placeLookup';

/** Most-followed matches first; an exact username always leads. */
export async function searchUsers(viewer: UserDoc, rawQuery: string, limit: number) {
  const term = rawQuery.trim().replace(/^@/, '');
  if (!term) return [];
  const hidden = await blockIdsFor(viewer._id);
  const users = await User.find({
    _id: { $ne: viewer._id, $nin: hidden },
    is_verified: true,
    status: 'active',
    ...userSearchFilter(term),
  })
    .sort({ followers_count: -1, _id: 1 })
    .limit(limit);
  const exact = term.toLowerCase();
  users.sort((a, b) => Number(b.username === exact) - Number(a.username === exact));
  return toUserSummaries(viewer, users);
}

/** People to discover when the search box is empty. Already-followed accounts stay out. */
export async function suggestUsers(viewer: UserDoc, limit: number) {
  const [hidden, following] = await Promise.all([
    blockIdsFor(viewer._id),
    Follow.find({ follower_id: viewer._id, status: 'accepted' }).select('following_id').lean(),
  ]);
  const users = await User.find({
    _id: {
      $nin: [viewer._id, ...hidden, ...following.map((row) => row.following_id)],
    },
    is_verified: true,
    status: 'active',
  })
    .sort({ followers_count: -1, username: 1 })
    .limit(limit);
  return toUserSummaries(viewer, users);
}

/** Candidates looked at before ranking a typed `@name`. */
const MENTION_POOL = 50;

/**
 * People for the `@` picker in captions. Just `@`: people you follow (latest
 * first), topped up with popular accounts. While typing: usernames starting
 * with the text first, then names starting with it, then any other match;
 * people you follow lead within each group. Blocked accounts never appear.
 */
export async function mentionUsers(viewer: UserDoc, rawQuery: string, limit: number) {
  const term = rawQuery.trim().replace(/^@/, '').toLowerCase();
  const [hidden, followingRows] = await Promise.all([
    blockIdsFor(viewer._id),
    Follow.find({ follower_id: viewer._id, status: 'accepted' })
      .sort({ _id: -1 })
      .select('following_id')
      .lean(),
  ]);
  const followingIds = followingRows.map((row) => row.following_id);
  const visible = { is_verified: true, status: 'active' } as const;

  if (!term) {
    const followed = await User.find({
      _id: { $in: followingIds, $nin: hidden },
      ...visible,
    });
    const byId = new Map(followed.map((u) => [u.id as string, u]));
    const picked = followingIds
      .flatMap((id) => byId.get(id.toHexString()) ?? [])
      .slice(0, limit);
    if (picked.length < limit) {
      const more = await User.find({
        _id: { $nin: [viewer._id, ...hidden, ...picked.map((u) => u._id)] },
        ...visible,
      })
        .sort({ followers_count: -1, username: 1 })
        .limit(limit - picked.length);
      picked.push(...more);
    }
    return toUserSummaries(viewer, picked);
  }

  const users = await User.find({
    _id: { $ne: viewer._id, $nin: hidden },
    ...visible,
    ...userSearchFilter(term),
  })
    .sort({ followers_count: -1, _id: 1 })
    .limit(MENTION_POOL);
  const followed = new Set(followingIds.map((id) => id.toHexString()));
  const rank = (u: UserDoc) => {
    if (u.username.startsWith(term)) return 0;
    const name = u.display_name.toLowerCase();
    if (name.startsWith(term) || name.includes(` ${term}`)) return 1;
    return 2;
  };
  const ranked = users
    .map((u, i) => ({ u, i, r: rank(u), f: followed.has(u.id as string) ? 0 : 1 }))
    .sort((a, b) => a.r - b.r || a.f - b.f || a.u.username.length - b.u.username.length || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.u);
  return toUserSummaries(viewer, ranked);
}

/** Big places offered even when the map search is down. */
const PLACE_CATALOG = [
  'Ahmedabad',
  'Surat',
  'Vadodara',
  'Rajkot',
  'Gandhinagar',
  'Mumbai',
  'Delhi',
  'Goa',
  'Jaipur',
  'Udaipur',
  'Bengaluru',
  'Hyderabad',
  'Chennai',
  'Kolkata',
  'Pune',
  'Dubai',
  'London',
  'New York',
  'Singapore',
];

/**
 * Places used on posts first (only public accounts and the viewer's own, so a
 * private account's places never leak), then the catalog, then any real place
 * from OpenStreetMap with its coordinates.
 */
export async function searchPlaces(viewer: UserDoc, rawQuery: string, limit: number) {
  const term = rawQuery.trim();
  if (!term) return [];
  const rows = await Post.aggregate<{ _id: string; post_count: number }>([
    { $match: { location_name: new RegExp(`(^|\\s)${escapeRegex(term)}`, 'i') } },
    { $sort: { _id: -1 } },
    { $limit: 2000 },
    { $lookup: { from: 'users', localField: 'author_id', foreignField: '_id', as: 'author' } },
    { $match: { $or: [{ 'author.is_private': false }, { author_id: viewer._id }] } },
    { $group: { _id: '$location_name', post_count: { $sum: 1 } } },
    { $sort: { post_count: -1, _id: 1 } },
    { $limit: limit },
  ]);
  const used: PlaceResult[] = rows.map((r) => ({ name: r._id, post_count: r.post_count }));
  const needle = term.toLowerCase();
  const catalog: PlaceResult[] = PLACE_CATALOG.filter((name) =>
    name.toLowerCase().includes(needle),
  ).map((name) => ({ name, post_count: 0 }));
  const world: PlaceResult[] = (await lookUpPlaces(term, limit)).map((p) => ({
    name: p.area ? `${p.name}, ${p.area}` : p.name,
    post_count: 0,
    area: p.area,
    latitude: p.latitude,
    longitude: p.longitude,
  }));
  const seen = new Set<string>();
  return [...used, ...catalog, ...world]
    .filter((p) => {
      const key = p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

type PlaceResult = {
  name: string;
  post_count: number;
  area?: string;
  latitude?: number;
  longitude?: number;
};
