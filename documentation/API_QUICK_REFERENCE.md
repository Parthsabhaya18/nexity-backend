# API quick reference (`/api/v1`)

Compact index; details live in each module doc. Called by the iOS and Android app with `Authorization: Bearer`, `X-Platform`, and `X-App-Version` headers ([ROUTING_CONVENTIONS.md](architecture/ROUTING_CONVENTIONS.md)).

## App

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Already implemented |
| GET | `/app/config` | No auth. `{ "ios": { "min_supported_version": "1.0.0", "store_url": "..." }, "android": { ... }, "features": {} }` — force-update check at launch ([MOBILE_APP.md](architecture/MOBILE_APP.md#app-lifecycle)) |

## Auth

| Method | Path |
|--------|------|
| POST | `/auth/register` |
| POST | `/auth/login` |
| POST | `/auth/refresh` |
| POST | `/auth/logout` |
| POST | `/auth/verify-email` |
| POST | `/auth/resend-verification` |
| POST | `/auth/forgot-password` |
| POST | `/auth/reset-password` |
| GET | `/auth/username-available` |

## Users & social

| Method | Path |
|--------|------|
| GET | `/users/by-username/:username` |
| GET | `/users/me` |
| PATCH | `/users/me` |
| POST | `/users/me/change-password` |
| POST | `/users/me/delete` |
| PATCH | `/users/me/privacy` |
| GET | `/users/me/notification-preferences` |
| PATCH | `/users/me/notification-preferences` |
| GET | `/users/me/blocked` |
| GET | `/users/:id/posts` |
| GET | `/users/:id/reels` |
| POST | `/follow-requests/:id/accept` |
| POST | `/follow-requests/:id/decline` |
| PATCH | `/users/me/onboarding` |
| GET | `/users/me/preferences` (theme) |
| PATCH | `/users/me/preferences` (theme) |
| GET | `/users/suggestions` |
| GET | `/users/:id/followers` |
| GET | `/users/:id/following` |
| POST | `/users/:id/follow` |
| DELETE | `/users/:id/follow` |
| POST | `/users/:id/block` |
| DELETE | `/users/:id/block` |
| GET | `/users/me/follow-requests` |
| GET | `/users/search` |

## Feed & explore

| Method | Path |
|--------|------|
| GET | `/feed` |
| GET | `/explore` |
| GET | `/search` |

## Posts

| Method | Path |
|--------|------|
| POST | `/posts` |
| GET | `/posts/:id` |
| PATCH | `/posts/:id` |
| DELETE | `/posts/:id` |
| POST | `/posts/:id/like` |
| POST | `/posts/:id/save` |
| GET | `/posts/:id/comments` |
| POST | `/posts/:id/comments` |
| GET | `/users/me/saved-posts` |
| GET | `/tags/:tag/posts` |

## Reels

| Method | Path |
|--------|------|
| GET | `/reels/feed` |
| GET | `/reels/:id` |
| POST | `/reels` |
| POST | `/reels/:id/view` |
| POST | `/reels/:id/like` |
| GET | `/reels/:id/comments` |
| POST | `/reels/:id/comments` |

## Stories

| Method | Path |
|--------|------|
| GET | `/stories/tray` |
| POST | `/stories` |
| GET | `/users/:id/stories` |
| POST | `/stories/:id/view` |

## Messages

| Method | Path |
|--------|------|
| GET | `/conversations` |
| POST | `/conversations` |
| GET | `/conversations/:id/messages` |
| POST | `/conversations/:id/messages` |
| POST | `/conversations/:id/read` |

## Notifications & reports

| Method | Path |
|--------|------|
| GET | `/notifications` |
| GET | `/notifications/unread-count` |
| POST | `/notifications/read-all` |
| POST | `/notifications/:id/read` |
| POST | `/reports` |

## Push devices

| Method | Path |
|--------|------|
| POST | `/devices` |
| DELETE | `/devices/:deviceId` |

See [PUSH_NOTIFICATIONS.md](architecture/PUSH_NOTIFICATIONS.md).

## Groups (optional v3)

| Method | Path |
|--------|------|
| GET | `/groups` |
| POST | `/groups` |
| GET | `/groups/:id` |
| GET | `/groups/:id/posts` |
| POST | `/groups/:id/join` |
| POST | `/groups/:id/leave` |

## Media (Cloudinary)

| Method | Path |
|--------|------|
| POST | `/media/cloudinary-sign` |
| POST | `/media/confirm` |
| GET | `/media/:mediaId` |

## Posts (extra)

| Method | Path |
|--------|------|
| GET | `/posts/:id/likers` |

## Reels (extra)

| Method | Path |
|--------|------|
| PATCH | `/reels/:id` |
| POST | `/reels/:id/save` |

## Stories (extra)

| Method | Path |
|--------|------|
| DELETE | `/stories/:id` |

## Admin

| Method | Path |
|--------|------|
| GET | `/admin/reports` |
| POST | `/admin/reports/:id/resolve` |

## Comments (shared)

| Method | Path |
|--------|------|
| DELETE | `/comments/:id` |

## WebSocket

| URL | Notes |
|-----|-------|
| `/ws/v1/chat` | First frame `{ "type": "auth", "token": "..." }`; events in [chat-thread.md](modules/messages/chat-thread.md) |
