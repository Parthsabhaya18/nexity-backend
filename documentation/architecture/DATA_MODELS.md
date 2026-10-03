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
| bio | text | max 500 |
| avatar_url | string | nullable |
| is_private | boolean | default false |
| is_verified | boolean | email verified |
| role | enum | `user`, `moderator`, `admin` |
| theme_preference | enum | `system` (default), `light`, `dark` — see [THEMING.md](THEMING.md) |
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

## MediaAsset (Cloudinary)

Stored in DB after `POST /media/confirm`.

| Field | Type |
|-------|------|
| id | UUID |
| owner_id | UUID |
| public_id | string |
| resource_type | `image` \| `video` |
| secure_url | string |
| bytes | int |
| width, height | int |
| duration_ms | int, nullable |
| format | string |
| purpose | `post` \| `reel` \| `story` \| `avatar` \| `message` |
| status | `processing` \| `ready` \| `failed` |
| created_at | datetime |

Delivery URLs with transforms are computed at read time, not stored as canonical.

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

## Conversation, Message

- **Conversation**: id, type `direct` \| `group`, participant ids.
- **Message**: id, conversation_id, sender_id, body, media_id optional (→ MediaAsset), story_id optional (story reply), client_message_id (UUID generated on the device for de-duplication / optimistic UI), read_by[], created_at.

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
