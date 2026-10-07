# Data models (logical)

Physical schema may differ; fields and relationships must remain equivalent.

## User

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| email | string | unique, not public |
| password_hash | string | |
| username | string | unique, public |
| display_name | string | |
| bio | text | max 150 (Instagram) |
| website | string | max 200, full `http(s)` URL or empty |
| avatar_media_id | ObjectId → Media | nullable; old avatar is deleted from S3 when replaced |
| avatar_key | string | nullable; S3 key of the avatar. APIs return `avatar_url` built from it per response (CDN or presigned URL) |
| is_private | boolean | default false |
| posts_count / followers_count / following_count | int | default 0, denormalised; kept in sync by the post and follow modules |
| is_verified | boolean | email verified |
| role | enum | `user`, `moderator`, `admin` |
| theme_preference | enum | `system` (default), `light`, `dark` — see [THEMING.md](THEMING.md) |
| mood | enum | nullable, default `null`: `happy`, `calm`, `romantic`, `sad`, `angry`, `cool`, `relaxed`, `excited`, `tired`, `motivated`. When set, it replaces `theme_preference` for the whole app — see [THEMING.md](THEMING.md) |
| created_at | datetime | |

## Follow

| Field | Type |
|-------|------|
| id | UUID |
| follower_id | UUID |
| following_id | UUID |
| status | `pending` \| `accepted` |
| created_at | datetime |

Unique: `(follower_id, following_id)`.

> Implementation note: stored in the `follows` collection with ObjectId ids (exposed as 24-char hex strings). Also indexed on `(following_id, status, _id)` and `(follower_id, status, _id)` for the lists. Accepting a request or following a public account increments `User.followers_count` / `following_count`; unfollowing or removing an accepted follower decrements them (never below 0).

## MediaAsset (S3) — collection `media_assets`

Created as `pending` by `POST /media/uploads`, becomes `ready` after `POST /media/:id/complete`. See [MEDIA_STORAGE.md](MEDIA_STORAGE.md).

| Field | Type |
|-------|------|
| id | ObjectId (string in APIs) |
| owner_id | ObjectId → User |
| purpose | `post` \| `reel` \| `story` \| `avatar` \| `message` |
| kind | `image` \| `video` |
| key | string, unique — S3 object key |
| content_type | string |
| bytes | int — declared while pending, actual once ready |
| width, height | int, nullable |
| duration_ms | int, nullable (videos) |
| status | `pending` \| `ready` |
| upload_expires_at | datetime — pending rows past this (+10 min) are purged |
| created_at, updated_at | datetime |

The public `url` is computed at read time from `MEDIA_PUBLIC_BASE_URL` + `key`, not stored.

## Post

| Field | Type |
|-------|------|
| id | UUID |
| author_id | UUID |
| caption | text, max 2200 |
| media | ordered join to MediaAsset + `alt_text` per slide |
| visibility | `public` \| `followers` \| `close_friends` |
| location_name | string, optional |
| tagged_user_ids | UUID[] |
| hide_like_count | boolean |
| comments_disabled | boolean |
| is_edited | boolean |
| is_deleted | boolean |
| created_at, updated_at | datetime |

> Implementation note (collection `posts`, ObjectId ids): `media` is an embedded ordered array `{ media_id, key, kind, width, height, alt_text }` (alt text max 100). Also stored: `mention_ids` + `mentions` (usernames that existed when shared, max 20), `aspect_ratio` (width / height of the carousel frame, 0.8–1.91), `location_lat` / `location_lng` (nullable), `adjustments` (brightness, contrast, saturation, warmth, fade, sharpen, blur, vignette), `likes_count`, `comments_count`, `client_upload_id` (unique per author when set). There is no `visibility` field yet: a post follows its author's account privacy. `tagged_ids` (max 20, sent as `tagged_user_ids`, returned as `tagged_users`). Hashtags are not stored. Media used by a post can't be deleted through `DELETE /media/:id` (`409 MEDIA_IN_USE`). `User.posts_count` is incremented on create.

## PostLike, PostSave, Comment

- **PostLike**: user_id, post_id, unique pair.
- **PostSave**: user_id, post_id.
- **Comment**: id, post_id, author_id, body (max 1000), parent_id (nullable for threads), created_at.

## Reel

| Field | Type |
|-------|------|
| id | UUID |
| author_id | UUID |
| video_media_id | UUID → MediaAsset |
| thumbnail_media_id | UUID → MediaAsset |
| caption | text |
| audio_track_id | string, optional |
| duration_ms | int |
| trim_start_ms, trim_end_ms | int, nullable — applied as Cloudinary `so_` / `eo_` on delivery |
| view_count | int |
| visibility | same as post |
| tagged_user_ids | UUID[] |
| location_name | string, optional |
| is_edited | boolean |
| created_at | datetime |

> Implementation: also `location_lat` / `location_lng`, `audio_muted`, `hide_like_count`, `comments_disabled`, `cover_time_ms`, and `cover_key` (optional uploaded cover photo). Trim is a playback window, not a re-encoded file.

## Story

| Field | Type |
|-------|------|
| id | UUID |
| author_id | UUID |
| media_id | UUID → MediaAsset |
| media_type | `image` \| `video` |
| expires_at | datetime | now + 24h |
| view_count | int |

No `is_edited` — stories are not editable after publish (Instagram parity).

> Implementation: also `location_name`, `location_lat` / `location_lng`, and `overlays` (up to 12: text, sticker, draw, poll, question, quiz, countdown, link, mention; old stories may still hold a hashtag overlay). Overlays are drawn in the viewer; they are not baked into the media file. Poll votes live in `story_poll_votes`. Question answers live in `story_question_replies`.

## Conversation, Message

- **Conversation**: id, type `direct` \| `group`, participant ids.
- **Message**: id, conversation_id, sender_id, body, media_id optional (→ MediaAsset), story_id optional (story reply), client_message_id (UUID generated on the device for de-duplication / optimistic UI), read_by[], created_at.

Physical schema (MongoDB, `backend/src/modules/messages/`):

**`conversations`**

| Field | Notes |
|-------|-------|
| type | `direct` \| `group` |
| direct_key | sorted participant ids joined by `:`; unique (partial index) → one direct chat per pair |
| participant_ids | ObjectId[]; index `{ participant_ids, last_message_at: -1, _id: -1 }` serves the inbox |
| members[] | per participant: `user_id`, `role`, `joined_at`, `last_read_message_id`, `last_read_at`, `unread_count`, `muted_until`, `cleared_at`, `hidden` |
| last_message | denormalised preview `{ id, sender_id, type, body (≤200), created_at }` so the inbox never reads `messages` |
| last_message_at, message_count, created_by, created_at, updated_at | |

**`messages`**

| Field | Notes |
|-------|-------|
| conversation_id, sender_id | index `{ conversation_id, _id: -1 }` — ObjectIds are time-ordered, so `_id` is the page cursor |
| type | `text` \| `image` \| `system` |
| body | trimmed, max 2000 |
| media | `{ media_id, url, width, height }` or null (filled once Cloudinary uploads ship) |
| reply_to_id | optional |
| client_message_id | unique per sender `{ sender_id, client_message_id }` — idempotent retries |
| deleted_at | unsend keeps the row, hides the content |

`read_by[]` is represented by `members[].last_read_message_id`: a message is read by a member when its id ≤ their marker. This keeps read receipts O(1) per read instead of one write per message.

**`users.last_active_at`** is set when a user's last chat socket disconnects (activity status).

## Device (push notifications)

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| user_id | UUID | |
| push_token | string | unique (FCM token) |
| platform | `ios` \| `android` | |
| app_version | string | |
| os_version | string | |
| device_model | string | |
| locale | string | |
| last_seen_at | datetime | |
| created_at | datetime | |

See [PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md).

## RefreshSession (one per signed-in device)

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | token family id |
| user_id | UUID | |
| current_jti | string | latest refresh token id; older ones are rejected |
| platform | `ios` \| `android` | from `X-Platform` |
| device_model, app_version | string | |
| last_used_at, created_at, revoked_at | datetime | |

## NotificationPreference

One row per user. Booleans default `true` unless noted.

| Field | Type |
|-------|------|
| user_id | UUID (PK) |
| push_enabled | boolean (master switch) |
| likes | `off` \| `following` \| `everyone` (default `everyone`) |
| comments | `off` \| `following` \| `everyone` (default `everyone`) |
| new_followers | boolean |
| follow_requests | boolean |
| mentions | boolean |
| messages | boolean |
| show_message_previews | boolean |
| updated_at | datetime |

## Notification

| Field | Type |
|-------|------|
| id | UUID |
| user_id | UUID |
| type | enum (see notifications doc) |
| actor_id | UUID, nullable |
| entity_type | string |
| entity_id | UUID |
| is_read | boolean |
| created_at | datetime |

## Report

| Field | Type |
|-------|------|
| id | UUID |
| reporter_id | UUID |
| target_type | `post` \| `reel` \| `story` \| `user` \| `message` \| `comment` |
| target_id | UUID |
| reason | enum |
| details | text |
| status | `open` \| `resolved` |

## Plans & subscriptions

Module `backend/src/modules/subscriptions/` — [plans-and-billing.md](../modules/premium/plans-and-billing.md).

**`plans`** — `_id` = `free` | `plus` | `premium`

| Field | Notes |
|-------|-------|
| name, description, features[] | Shown on the paywall |
| rank | 0 free, 1 plus, 2 premium (highest entitled plan wins) |
| mrp_inr, price_inr | Display only; real prices come from the store |
| active | Inactive plans are hidden from `GET /plans` (existing subscribers keep them) |
| limits | `{ secret_messages_per_month (-1 = unlimited), secret_messages_per_day_fair_use, crush_spots, read_secret, nearby, badge }` |
| products | `{ ios: { monthly, quarterly, yearly }, android: { subscription_id, base_plans } }` |

**`subscriptions`**

| Field | Notes |
|-------|-------|
| user_id | ObjectId → User; index `{ user_id, status }` |
| plan_id | `plus` \| `premium` |
| source | `app_store` \| `google_play` \| `gift` |
| period | `monthly` \| `quarterly` \| `yearly` \| `null` (gift) |
| store_product_id | |
| original_transaction_id | iOS; unique `{ source, original_transaction_id }` (partial) |
| purchase_token, linked_purchase_token | Android; unique `{ source, purchase_token }` (partial) |
| environment | `production` \| `sandbox` |
| status | `active` \| `canceled` \| `in_grace` \| `on_hold` \| `paused` \| `expired` \| `revoked` |
| auto_renew | boolean |
| current_period_start, current_period_end | datetime |
| grace_ends_at | nullable |
| acknowledged | Android |
| gift | `{ admin_id, note }` for `source: gift` |
| last_event_at | Newest store event applied (out-of-order guard) |
| transferred_from_user_id, transferred_at | Restore on another account |
| created_at, updated_at | |

**`billing_events`** — raw store notifications and verification results: `store`, `store_event_id` (unique), `type`, `subtype`, `user_id` (nullable), `subscription_id`, `payload` (verified, decoded), `status` (`processed` \| `ignored` \| `orphan` \| `failed`), `amount_inr`, `store_order_id`, `created_at`. Kept 2 years. Also powers billing history.

**Razorpay collections** (`payment_checkouts`, `payments`, `payment_webhook_events`, `coupons`, `coupon_redemptions`) and the Razorpay fields on `subscriptions` (`source: 'razorpay'`, `razorpay_subscription_id`, `razorpay_plan_id`, `price_paise`, `next_charge_at`, `payment_method_display`) are defined in [razorpay-payments.md §7](../modules/premium/razorpay-payments.md#7-data-mongodb). Money is always integer paise; card / UPI / bank details are never stored.

**`secret_usage`** — `user_id`, `month` (`2026-10`, Asia/Kolkata), `count`, `day` + `day_count` (fair use). Unique `{ user_id, month }`.

**User additions:** `entitlement { plan, expires_at, source, updated_at }` (cache, recomputed on every subscription change), `billing_account_token` (UUID v4, unique, sparse), `secret_suspended_until` (moderation), privacy `allow_secret_messages` / `allow_secret_crush` (`everyone` default \| `following` \| `off`).

## Secret Messages

Module `backend/src/modules/secret-messages/` — [secret-messages.md](../modules/premium/secret-messages.md). Public ids are random UUID v4 (never ObjectIds — they contain the exact creation time).

**`secret_threads`**

| Field | Notes |
|-------|-------|
| public_id | UUID v4, unique — used in APIs and deep links |
| sender_id, recipient_id | ObjectId → User |
| status | `sealed` \| `revealed` \| `archived` \| `withdrawn` |
| replies_used | 0–2 (recipient replies); reply 2 reveals |
| sender_followups_unanswered | 0–3; reset when the recipient replies |
| conversation_id | Direct conversation after the reveal |
| revealed_at, archived_at | |
| members | `{ sender: { last_read_at, hidden }, recipient: { last_read_at, hidden } }` |
| last_activity_at, created_at | |

Indexes: partial unique `{ sender_id, recipient_id }` where `status: 'sealed'`; `{ recipient_id, status, last_activity_at: -1 }` (inbox); `{ sender_id, last_activity_at: -1 }` (sent).

**`secret_thread_messages`**: `public_id`, `thread_id`, `author` (`sender` \| `recipient`), `author_id`, `body_enc` `{ ct, iv, tag, key_version }` (AES-256-GCM), `client_message_id` (unique per `author_id`), `created_at`. Index `{ thread_id, _id: -1 }`.

**`secret_blocks`**: `public_id`, `blocker_id`, `blocked_id`, `created_at`. Unique `{ blocker_id, blocked_id }`. `blocked_id` is never returned to the blocker.

## Secret Crush

Module `backend/src/modules/secret-crush/` — [secret-crush.md](../modules/premium/secret-crush.md).

**`crushes`**

| Field | Notes |
|-------|-------|
| from_user_id, to_user_id | Unique `{ from_user_id, to_user_id }`; index `{ to_user_id, status }` |
| status | `active` \| `paused` \| `matched` \| `removed` |
| match_id | → `crush_matches` |
| notified_at | Last "Someone added you" sent (30-day window) |
| removed_at | 24 h re-add cooldown; hard-deleted 30 days later |
| created_at, updated_at | |

**`crush_matches`**: `public_id` (UUID), `pair_key` (sorted ids joined by `:`, **unique**), `user_ids[2]`, `conversation_id`, `matched_at`, `celebrated_at` `{ <userId>: datetime }`.

**`crush_admirer_counts`**: `user_id` (unique), `count`, `recomputed_at`.

**Conversation additions:** `origin` (`null` \| `secret_message` \| `secret_crush_match`), `theme` (`null` \| `love`). Messages copied in from a revealed thread carry `meta { origin: 'secret_message', sent_at }`.

**Notification additions:** `actor_id` becomes **nullable**; it is always `null` for anonymous types (`secret_message_received`, `secret_message_followup`, `crush_added`). New field `entity_id` (thread / match public id).

## Hashtag

Removed. Captions are not parsed for hashtags, and there is no tag search and no hashtag feed.
