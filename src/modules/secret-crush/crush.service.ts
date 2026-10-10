import { randomInt, randomUUID } from 'node:crypto';

import mongoose, { isValidObjectId, type Types } from 'mongoose';

import { env } from '../../config/env';
import { emitToUser } from '../../realtime/io';
import { ApiError } from '../../utils/ApiError';
import { openMatchConversation } from '../messages/messages.service';
import { hintsFor, type NearbyHint } from '../nearby/nearby.hints';
import { notifySystem } from '../notifications/notification.service';
import { Block } from '../safety/block.model';
import { isBlockedEither } from '../safety/block.service';
import { SecretBlock } from '../secret-messages/secret.models';
import { dayStartsAt, entitlementOf, planRequired } from '../subscriptions/entitlement.service';
import {
  PUBLIC_USER_FIELDS,
  type PublicUserSource,
  toPublicUserDto,
  User,
  type UserDoc,
  withAvatarUrls,
} from '../users/user.model';
import {
  Crush,
  CrushAdmirerCount,
  type CrushAttrs,
  CrushMatch,
  type CrushMatchAttrs,
} from './crush.models';

const MONGO_DUPLICATE_KEY = 11000;
const HOUR_MS = 3_600_000;
const COOLDOWN_MS = 24 * HOUR_MS;
const NOTICE_GAP_MS = 30 * 24 * HOUR_MS;
export const DAILY_ADDS = 10;

export const ADDED_NOTICE = 'Someone added you as a Secret Crush 👀';

const isDuplicateKey = (err: unknown) =>
  err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY;

/** Random 30–120 s, so the notice can't be matched to the adder's activity. */
const noticeDelayMs = () => (env.NODE_ENV === 'test' ? 0 : randomInt(30_000, 120_001));

function later(ms: number, task: () => void) {
  if (ms <= 0) {
    task();
    return;
  }
  setTimeout(task, ms).unref();
}

const cannotAdd = () =>
  ApiError.forbidden("You can't add this person as a Secret Crush.", 'CANNOT_ADD_CRUSH');
const alreadyCrush = () =>
  ApiError.conflict("They're already in your Secret Crushes.", 'ALREADY_CRUSH');
const matchNotFound = () => ApiError.notFound('This match is no longer available.');

const spotsOf = (user: Pick<UserDoc, 'entitlement'>) => entitlementOf(user).limits.crush_spots;
const pairKeyOf = (a: Types.ObjectId, b: Types.ObjectId) =>
  [a.toString(), b.toString()].sort().join(':');

type UserLite = PublicUserSource & { status?: string };

async function loadUsers(ids: readonly Types.ObjectId[]) {
  if (!ids.length) return new Map<string, UserLite>();
  const users = await withAvatarUrls(
    await User.find({ _id: { $in: ids } })
      .select(`${PUBLIC_USER_FIELDS} status`)
      .lean<UserLite[]>(),
  );
  return new Map(users.map((u) => [u._id.toString(), u]));
}

const publicUser = (u: PublicUserSource) => {
  const dto = toPublicUserDto(u);
  return {
    id: dto.id,
    username: dto.username,
    display_name: dto.display_name,
    avatar_url: dto.avatar_url,
  };
};

function emitSummary(userId: Types.ObjectId, event: string, payload: Record<string, unknown>, delay = 0) {
  later(delay, () => {
    emitToUser(userId.toString(), event, payload);
    emitToUser(userId.toString(), 'crush.summary', {});
  });
}

/** Ids the viewer has any block with (normal block either way, or an anonymous block either way). */
async function blockedWith(viewerId: Types.ObjectId, ids: readonly Types.ObjectId[]) {
  if (!ids.length) return new Set<string>();
  const either = {
    $or: [
      { blocker_id: viewerId, blocked_id: { $in: ids } },
      { blocker_id: { $in: ids }, blocked_id: viewerId },
    ],
  };
  const [blocks, secretBlocks] = await Promise.all([
    Block.find(either).select('blocker_id blocked_id').lean(),
    SecretBlock.find(either).select('blocker_id blocked_id').lean(),
  ]);
  return new Set(
    [...blocks, ...secretBlocks].map((b) =>
      (b.blocker_id.equals(viewerId) ? b.blocked_id : b.blocker_id).toString(),
    ),
  );
}

/* ---------- Matching ---------- */

/** Creates the match once per pair, opens the love chat and tells both people. Safe to repeat. */
async function createMatch(a: Types.ObjectId, b: Types.ObjectId) {
  const pairKey = pairKeyOf(a, b);
  const sorted = (a.toString() < b.toString() ? [a, b] : [b, a]) as [Types.ObjectId, Types.ObjectId];
  const now = new Date();
  let match: CrushMatchAttrs | null;
  let created = false;
  try {
    const doc = await CrushMatch.create({
      public_id: randomUUID(),
      pair_key: pairKey,
      user_ids: sorted,
      matched_at: now,
    });
    match = doc.toObject() as CrushMatchAttrs;
    created = true;
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    match = await CrushMatch.findOne({ pair_key: pairKey }).lean<CrushMatchAttrs>();
    if (!match) throw err;
  }

  const conversationId =
    match.conversation_id ??
    (await openMatchConversation({ userIds: sorted, matchPublicId: match.public_id }));
  if (!match.conversation_id) {
    await CrushMatch.updateOne({ _id: match._id }, { $set: { conversation_id: conversationId } });
    match = { ...match, conversation_id: conversationId };
  }
  await Crush.updateMany(
    {
      $or: [
        { from_user_id: a, to_user_id: b },
        { from_user_id: b, to_user_id: a },
      ],
      status: { $in: ['active', 'paused'] },
    },
    { $set: { status: 'matched', match_id: match._id } },
  );

  if (created) {
    const users = await User.find({ _id: { $in: sorted } }).select('username').lean();
    const name = (id: Types.ObjectId) =>
      users.find((u) => u._id.equals(id))?.username ?? 'someone';
    const payload = { match_id: match.public_id, conversation_id: conversationId.toString() };
    for (const [me, other] of [
      [a, b],
      [b, a],
    ] as const) {
      await notifySystem({
        recipientId: me,
        actorId: other,
        type: 'crush_match',
        text: `Congratulations! 🎉 You and ${name(other)} are a match 💘`,
        crushMatchId: match.public_id,
        conversationId,
      });
      emitSummary(me, 'crush.matched', payload);
    }
  }
  return match;
}

/** A match needs both crushes active and both adders on a plan with spots. */
async function checkMatch(me: Types.ObjectId, otherId: Types.ObjectId) {
  const [mine, reverse] = await Promise.all([
    Crush.exists({ from_user_id: me, to_user_id: otherId, status: 'active' }),
    Crush.findOne({ from_user_id: otherId, to_user_id: me, status: 'active' }).lean<CrushAttrs>(),
  ]);
  if (!mine || !reverse) return null;
  const other = await User.findOne({ _id: otherId, status: 'active' })
    .select('entitlement')
    .lean<Pick<UserDoc, 'entitlement'>>();
  if (!other) return null;
  if (spotsOf(other) === 0) {
    // Their plan ended without a sync; pause now so it can't match.
    await Crush.updateMany(
      { from_user_id: otherId, status: 'active' },
      { $set: { status: 'paused' } },
    );
    return null;
  }
  if (await isBlockedEither(me, otherId)) return null;
  return createMatch(me, otherId);
}

/**
 * Pauses crushes beyond the plan's spots (all of them on Free) and reactivates paused ones, oldest
 * first, when spots are back. Reactivated crushes run the match check.
 */
export async function syncCrushes(user: UserDoc) {
  const limit = spotsOf(user);
  const rows = await Crush.find({ from_user_id: user._id, status: { $in: ['active', 'paused'] } })
    .sort({ added_at: 1, _id: 1 })
    .select('_id to_user_id status')
    .lean<Pick<CrushAttrs, '_id' | 'to_user_id' | 'status'>[]>();
  const keep = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const toActivate = keep.filter((r) => r.status === 'paused');
  const toPause = rest.filter((r) => r.status === 'active');
  if (toPause.length) {
    await Crush.updateMany(
      { _id: { $in: toPause.map((r) => r._id) }, status: 'active' },
      { $set: { status: 'paused' } },
    );
  }
  if (toActivate.length) {
    await Crush.updateMany(
      { _id: { $in: toActivate.map((r) => r._id) }, status: 'paused' },
      { $set: { status: 'active' } },
    );
    for (const r of toActivate) await checkMatch(user._id, r.to_user_id);
  }
  if (toPause.length || toActivate.length) {
    emitToUser(user.id as string, 'crush.summary', {});
  }
}

/* ---------- Reads ---------- */

/** Rises live, falls only after 00:00 IST. New crushes count once their notice could have arrived. */
async function admirersCount(viewer: UserDoc, now = new Date()) {
  const visibleBefore = new Date(now.getTime() - (env.NODE_ENV === 'test' ? 0 : 120_000));
  const rows = await Crush.find({
    to_user_id: viewer._id,
    status: 'active',
    added_at: { $lte: visibleBefore },
  })
    .select('from_user_id')
    .lean();
  const fromIds = rows.map((r) => r.from_user_id);
  const [blocked, active] = await Promise.all([
    blockedWith(viewer._id, fromIds),
    User.find({ _id: { $in: fromIds }, status: 'active' }).select('_id').lean(),
  ]);
  const ok = new Set(active.map((u) => u._id.toString()));
  const live = fromIds.filter((id) => ok.has(id.toString()) && !blocked.has(id.toString())).length;

  const stored = await CrushAdmirerCount.findOne({ user_id: viewer._id }).lean();
  if (!stored || stored.recomputed_at < dayStartsAt(now) || live > stored.count) {
    await CrushAdmirerCount.updateOne(
      { user_id: viewer._id },
      { $set: { count: live, recomputed_at: now } },
      { upsert: true },
    );
    return live;
  }
  return stored.count;
}

type CrushDto = {
  user: ReturnType<typeof publicUser>;
  status: 'active' | 'paused' | 'matched';
  added_at: string;
  nearby_hint: NearbyHint | null;
};

export async function listCrushes(viewer: UserDoc) {
  await syncCrushes(viewer);
  const rows = await Crush.find({
    from_user_id: viewer._id,
    status: { $in: ['active', 'paused'] },
  })
    .sort({ added_at: -1, _id: -1 })
    .limit(50)
    .lean<CrushAttrs[]>();
  const ids = rows.map((r) => r.to_user_id);
  const [users, hints] = await Promise.all([loadUsers(ids), hintsFor(viewer, ids)]);
  const data: CrushDto[] = rows.flatMap((r) => {
    const u = users.get(r.to_user_id.toString());
    if (!u || u.status !== 'active') return [];
    return [
      {
        user: publicUser(u),
        status: r.status === 'paused' ? ('paused' as const) : ('active' as const),
        added_at: r.added_at.toISOString(),
        nearby_hint: hints.get(r.to_user_id.toString()) ?? null,
      },
    ];
  });
  return { data, pagination: { next_cursor: null, has_more: false } };
}

const otherOf = (m: CrushMatchAttrs, me: Types.ObjectId) =>
  m.user_ids.find((id) => !id.equals(me)) ?? m.user_ids[0]!;

function matchDto(
  m: CrushMatchAttrs,
  viewer: UserDoc,
  user: UserLite,
  hint: NearbyHint | null,
) {
  return {
    id: m.public_id,
    user: publicUser(user),
    conversation_id: m.conversation_id ? m.conversation_id.toString() : null,
    matched_at: m.matched_at.toISOString(),
    celebrated: m.celebrated_by.some((id) => id.equals(viewer._id)),
    nearby_hint: hint,
  };
}

/** Matches with people who are still active and not blocked either way. */
async function visibleMatches(viewer: UserDoc, rows: CrushMatchAttrs[]) {
  const others = rows.map((m) => otherOf(m, viewer._id));
  const [users, blocked, hints] = await Promise.all([
    loadUsers(others),
    blockedWith(viewer._id, others),
    hintsFor(viewer, others),
  ]);
  return rows.flatMap((m) => {
    const other = otherOf(m, viewer._id).toString();
    const u = users.get(other);
    if (!u || u.status !== 'active' || blocked.has(other)) return [];
    return [matchDto(m, viewer, u, hints.get(other) ?? null)];
  });
}

export async function listMatches(viewer: UserDoc) {
  const rows = await CrushMatch.find({ user_ids: viewer._id })
    .sort({ matched_at: -1, _id: -1 })
    .limit(100)
    .lean<CrushMatchAttrs[]>();
  return {
    data: await visibleMatches(viewer, rows),
    pagination: { next_cursor: null, has_more: false },
  };
}

export async function getMatch(viewer: UserDoc, matchId: string) {
  const m = await CrushMatch.findOne({ public_id: matchId, user_ids: viewer._id }).lean<CrushMatchAttrs>();
  if (!m) throw matchNotFound();
  const [dto] = await visibleMatches(viewer, [m]);
  if (!dto) throw matchNotFound();
  const [me] = await withAvatarUrls(
    await User.find({ _id: viewer._id }).select(PUBLIC_USER_FIELDS).lean<PublicUserSource[]>(),
  );
  return { ...dto, me: publicUser(me!) };
}

export async function markCelebrated(viewer: UserDoc, matchId: string) {
  const res = await CrushMatch.updateOne(
    { public_id: matchId, user_ids: viewer._id },
    { $addToSet: { celebrated_by: viewer._id } },
  );
  if (!res.matchedCount) throw matchNotFound();
  emitToUser(viewer.id as string, 'crush.summary', {});
}

export async function summary(viewer: UserDoc) {
  await syncCrushes(viewer);
  const limit = spotsOf(viewer);
  const [used, admirers, matches] = await Promise.all([
    Crush.countDocuments({ from_user_id: viewer._id, status: { $in: ['active', 'paused'] } }),
    admirersCount(viewer),
    listMatches(viewer),
  ]);
  const pending = matches.data.find((m) => !m.celebrated);
  return {
    admirers_count: admirers,
    can_add: limit > 0,
    plan: entitlementOf(viewer).plan,
    spots: { limit, used, left: Math.max(0, limit - used) },
    matches_count: matches.data.length,
    pending_celebration_match_id: pending?.id ?? null,
  };
}

/** For the heart on a profile: is this person on my list, and are we matched? */
export async function crushStatus(viewer: UserDoc, userId: string) {
  if (!isValidObjectId(userId)) return { state: 'none' as const, match_id: null, conversation_id: null };
  const row = await Crush.findOne({ from_user_id: viewer._id, to_user_id: userId }).lean<CrushAttrs>();
  if (!row || row.status === 'removed') {
    return { state: 'none' as const, match_id: null, conversation_id: null };
  }
  if (row.status === 'matched' && row.match_id) {
    const m = await CrushMatch.findById(row.match_id).lean<CrushMatchAttrs>();
    return {
      state: 'matched' as const,
      match_id: m?.public_id ?? null,
      conversation_id: m?.conversation_id ? m.conversation_id.toString() : null,
    };
  }
  return {
    state: row.status === 'paused' ? ('paused' as const) : ('active' as const),
    match_id: null,
    conversation_id: null,
  };
}

/* ---------- Writes ---------- */

async function addableTarget(viewer: UserDoc, userId: string) {
  if (!isValidObjectId(userId)) throw cannotAdd();
  if (viewer._id.equals(userId)) {
    throw ApiError.badRequest("You can't add yourself.", undefined, 'CANNOT_CRUSH_SELF');
  }
  const target = await User.findOne({ _id: userId, status: 'active', is_verified: true })
    .select(PUBLIC_USER_FIELDS)
    .lean<PublicUserSource>();
  if (!target) throw cannotAdd();
  const [blocked, secretBlocked] = await Promise.all([
    isBlockedEither(viewer._id, target._id),
    SecretBlock.exists({ blocker_id: target._id, blocked_id: viewer._id }),
  ]);
  if (blocked || secretBlocked) throw cannotAdd();
  return target;
}

export async function addCrush(viewer: UserDoc, userId: string) {
  const limit = spotsOf(viewer);
  if (limit === 0) throw planRequired('crush');
  await syncCrushes(viewer);
  const target = await addableTarget(viewer, userId);
  const now = new Date();

  const existing = await Crush.findOne({
    from_user_id: viewer._id,
    to_user_id: target._id,
  }).lean<CrushAttrs>();
  if (existing && existing.status !== 'removed') throw alreadyCrush();
  if (existing?.removed_at && existing.removed_at.getTime() > now.getTime() - COOLDOWN_MS) {
    const retryAt = new Date(existing.removed_at.getTime() + COOLDOWN_MS);
    throw ApiError.tooMany(
      'You removed them recently. You can add them again tomorrow.',
      { retry_at: retryAt.toISOString() },
      'CRUSH_COOLDOWN',
    );
  }

  const addedToday = await Crush.countDocuments({
    from_user_id: viewer._id,
    added_at: { $gte: dayStartsAt(now) },
  });
  if (addedToday >= DAILY_ADDS) {
    throw ApiError.tooMany(
      `You can add up to ${DAILY_ADDS} Secret Crushes a day. Try again tomorrow.`,
      undefined,
      'CRUSH_DAILY_LIMIT',
    );
  }

  const spotsFull = () =>
    ApiError.forbidden(`You've used all ${limit} Secret Crush spots.`, 'PLAN_LIMIT_REACHED', {
      limit,
      scope: 'crush_spots',
    });
  const used = () =>
    Crush.countDocuments({ from_user_id: viewer._id, status: { $in: ['active', 'paused'] } });
  if ((await used()) >= limit) throw spotsFull();

  let row: CrushAttrs;
  if (existing) {
    const revived = await Crush.findOneAndUpdate(
      { _id: existing._id, status: 'removed' },
      { $set: { status: 'active', added_at: now, removed_at: null, match_id: null } },
      { returnDocument: 'after' },
    ).lean<CrushAttrs>();
    if (!revived) throw alreadyCrush();
    row = revived;
  } else {
    try {
      const doc = await Crush.create({
        from_user_id: viewer._id,
        to_user_id: target._id,
        added_at: now,
      });
      row = doc.toObject() as CrushAttrs;
    } catch (err) {
      if (isDuplicateKey(err)) throw alreadyCrush();
      throw err;
    }
  }

  // Two adds at once could both pass the spot check; the later one gives its spot back.
  if ((await used()) > limit) {
    if (existing) {
      await Crush.updateOne(
        { _id: row._id },
        { $set: { status: 'removed', removed_at: existing.removed_at, added_at: existing.added_at } },
      );
    } else {
      await Crush.deleteOne({ _id: row._id });
    }
    throw spotsFull();
  }

  const user = publicUser((await withAvatarUrls([target]))[0]!);
  const match = await checkMatch(viewer._id, target._id);
  if (match) {
    const [dto] = await visibleMatches(viewer, [
      (await CrushMatch.findById(match._id).lean<CrushMatchAttrs>()) ?? match,
    ]);
    return {
      crush: { user, status: 'matched' as const, added_at: now.toISOString(), nearby_hint: null },
      matched: true as const,
      match: dto ?? null,
    };
  }

  const notice = await Crush.findOneAndUpdate(
    {
      _id: row._id,
      $or: [{ notified_at: null }, { notified_at: { $lt: new Date(now.getTime() - NOTICE_GAP_MS) } }],
    },
    { $set: { notified_at: now } },
  );
  const delay = noticeDelayMs();
  if (notice) {
    await notifySystem({
      recipientId: target._id,
      type: 'crush_added',
      text: ADDED_NOTICE,
      deliverAt: new Date(now.getTime() + delay),
    });
  }
  emitSummary(target._id, 'crush.added', {}, delay);
  emitToUser(viewer.id as string, 'crush.summary', {});

  const hints = await hintsFor(viewer, [target._id]);
  return {
    crush: {
      user,
      status: 'active' as const,
      added_at: now.toISOString(),
      nearby_hint: hints.get(target._id.toString()) ?? null,
    },
    matched: false as const,
    match: null,
  };
}

/** Never tells anyone. A match can't be removed (delete the chat or block instead). */
export async function removeCrush(viewer: UserDoc, userId: string) {
  if (!isValidObjectId(userId)) return;
  const row = await Crush.findOne({ from_user_id: viewer._id, to_user_id: userId }).lean<CrushAttrs>();
  if (!row || row.status === 'removed') return;
  if (row.status === 'matched') {
    throw ApiError.conflict(
      "You're matched 💘 To end it, delete the chat or block them.",
      'CRUSH_MATCHED',
    );
  }
  await Crush.updateOne(
    { _id: row._id, status: { $in: ['active', 'paused'] } },
    { $set: { status: 'removed', removed_at: new Date() } },
  );
  emitToUser(viewer.id as string, 'crush.summary', {});
}
