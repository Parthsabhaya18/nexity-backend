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

> Implementation note (collection `posts`, ObjectId ids): `media` is an embedded ordered array `{ media_id, key, kind, width, height, alt_text }` (alt text max 100). Also stored: `hashtags` (lowercase, max 30), `mention_ids` + `mentions` (usernames that existed when shared, max 20), `aspect_ratio` (width / height of the carousel frame, 0.8–1.91), `location_lat` / `location_lng` (nullable), `adjustments` (brightness, contrast, saturation, warmth, fade, sharpen, blur, vignette), `likes_count`, `comments_count`, `client_upload_id` (unique per author when set). There is no `visibility` field yet: a post follows its author's account privacy. `tagged_user_ids`, `is_edited` and soft delete arrive with edit/delete. Media used by a post can't be deleted through `DELETE /media/:id` (`409 MEDIA_IN_USE`). `User.posts_count` is incremented on create.

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

> Implementation: also `music_title`, `location_lat` / `location_lng`, `audio_muted`, `cover_time_ms`, and `cover_key` (optional uploaded cover photo). Trim is a playback window, not a re-encoded file.

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

> Implementation: also `music_title`, `location_name`, `location_lat` / `location_lng`, and `overlays` (up to 12: text, sticker, draw, poll, question, quiz, countdown, link, hashtag, mention). Overlays are drawn in the viewer; they are not baked into the media file. Poll votes live in `story_poll_votes`. Question answers live in `story_question_replies`.

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

## Hashtag

Extract `#word` from captions; store normalized tag (lowercase) and link table `post_hashtags`.

> Implementation note: tags are stored on the post (`Post.hashtags`, indexed) instead of a link table, and collection `hashtags` keeps `{ name, post_count }` for autocomplete (`GET /search?type=tags`). Letters of any script (with vowel signs), digits and `_`; all-digit tags are ignored.
