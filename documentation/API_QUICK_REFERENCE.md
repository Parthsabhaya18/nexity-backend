# API quick reference (`/api/v1`)

Compact index; details live in each module doc. Called by the iOS and Android app with `Authorization: Bearer`, `X-Platform`, and `X-App-Version` headers ([ROUTING_CONVENTIONS.md](architecture/ROUTING_CONVENTIONS.md)).

## App

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Already implemented |
| GET | `/health/ready` | `503` until MongoDB is connected |
| POST / GET / DELETE | `/health/db-test` | Dev/test only (`404` in production). Inserts, lists or clears documents in the `health_checks` collection to verify MongoDB writes and reads |
| GET | `/app/config` | No auth. `{ "ios": { "min_supported_version": "1.0.0", "store_url": "..." }, "android": { ... }, "features": {} }` — force-update check at launch ([MOBILE_APP.md](architecture/MOBILE_APP.md#app-lifecycle)) |

## Auth

Implemented. Email verification and password reset use 6-digit email codes (OTP). Errors use `{ "error": { "code", "message", "details" } }`.

| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/register` | `201` `{ user, resend_available_in }` — sends a verification code |
| POST | `/auth/login` | `{ identifier, password }` → session. `403 EMAIL_NOT_VERIFIED` sends a new code |
| POST | `/auth/refresh` | `{ refresh_token }` → rotated pair |
| POST | `/auth/logout` | `{ refresh_token }` → `204` |
| POST | `/auth/verify-email` | `{ email, code }` → session |
| POST | `/auth/resend-verification` | `{ email }` → `{ resend_available_in }` |
| POST | `/auth/forgot-password` | `{ email }` → `{ resend_available_in }` (same for unknown emails) |
| POST | `/auth/verify-reset-code` | `{ email, code }` → `{ reset_token, expires_in }` |
| POST | `/auth/reset-password` | `{ reset_token, password }` → `204`, logs out all devices |
| GET | `/auth/username-available` | `?username=` → `{ available, reason? }` |

In development without SMTP, code-sending responses also include `dev_code`.

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
| POST | `/users/:id/mute` (`204`, idempotent; `400 CANNOT_MUTE_SELF`, `404` unknown user; the profile returns `muted`. Feeds filtering muted accounts via `mutedIdsFor()` comes with the feed work) |
| DELETE | `/users/:id/mute` (`204`) |
| GET | `/users/me/follow-requests` |
| DELETE | `/users/me/followers/:userId` (remove follower) |
| GET | `/users/search` (planned for New message; app search uses `/search?type=users`) |

## Feed & explore

| Method | Path |
|--------|------|
| GET | `/feed` |
| GET | `/explore` |
| GET | `/search` (`type=users` or `places`; blocked users never appear) |
| GET | `/search/history` (recent profiles opened from Search) |
| POST | `/search/history` (`{ user_id }`) |
| DELETE | `/search/history` (clear all) |
| DELETE | `/search/history/:userId` |

## Posts

| Method | Path |
|--------|------|
| POST | `/posts` (implemented; `201`, or `200` when `client_upload_id` repeats) |
| GET | `/posts/:id` (implemented) |
| PATCH | `/posts/:id` (caption, location, alt text, like/comment settings) |
| DELETE | `/posts/:id` (soft delete) |
| POST | `/posts/:id/like` (toggle) |
| PUT | `/posts/:id/like` (like, idempotent; returns `{ liked, likes_count, post }`) |
| DELETE | `/posts/:id/like` (unlike, idempotent) |
| POST | `/posts/:id/save` (toggle) |
| GET | `/posts/:id/comments` |
| POST | `/posts/:id/comments` |
| DELETE | `/comments/:id` |
| GET | `/feed` |
| GET | `/users/me/saved-posts` |
| GET | `/users/:id/posts` |
| POST | `/stories` |
| GET | `/stories/tray` |
| POST | `/stories/:id/view` |
| POST | `/stories/:id/vote` |
| POST | `/stories/:id/reply` |
| PUT | `/stories/:id/like` |
| DELETE | `/stories/:id/like` |
| POST | `/stories/:id/message` (private reply to the author, sent as a DM with `story_id`; returns `{ id, conversation_id }`) |
| GET | `/stories/:id/viewers` (owner only; `liked` per row, likers first) |
| DELETE | `/stories/:id` |
| POST | `/reels` |
| GET | `/reels` |
| GET | `/users/:id/reels` |
| POST | `/reels/:id/like` |
| PUT | `/reels/:id/like` (idempotent, returns the reel) |
| DELETE | `/reels/:id/like` |
| PATCH | `/reels/:id` (caption, `hide_like_count`, `comments_disabled`) |
| DELETE | `/reels/:id` |
| PATCH | `/users/me/preferences` (`theme`, `mood`) |
| PATCH | `/posts/:id` |
| DELETE | `/posts/:id` |
| POST | `/posts/:id/like` |
| POST | `/posts/:id/save` |
| GET | `/posts/:id/comments` |
| POST | `/posts/:id/comments` |
| GET | `/users/me/saved-posts` |

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
| POST | `/stories/:id/vote` |
| POST | `/stories/:id/reply` |

## Messages

Implemented ([chat-thread.md](modules/messages/chat-thread.md)). `GET /users/search?q=` is implemented too (people picker; empty `q` returns suggestions).

| Method | Path |
|--------|------|
| GET | `/conversations` |
| POST | `/conversations` |
| GET | `/conversations/:id` |
| GET | `/conversations/:id/messages` |
| POST | `/conversations/:id/messages` |
| POST | `/conversations/:id/read` |
| DELETE | `/conversations/:id/messages/:messageId` (unsend) |
| POST | `/conversations/:id/mute` |
| DELETE | `/conversations/:id` (delete for me) |
| GET | `/gifs/trending` |
| GET | `/gifs/search?q=` |

## Notifications & reports

| Method | Path |
|--------|------|
| GET | `/notifications` |
| GET | `/notifications/unread-count` |
| POST | `/notifications/read-all` |
| POST | `/notifications/:id/read` |
| POST | `/reports` |

## Plans & subscriptions

Planned ([plans-and-billing.md](modules/premium/plans-and-billing.md)). Gated routes return `403 PLAN_REQUIRED` / `PLAN_LIMIT_REACHED`.

| Method | Path |
|--------|------|
| GET | `/plans` |
| GET | `/subscriptions/me` (plan, status, limits, usage) |
| POST | `/subscriptions/billing-token` |
| POST | `/subscriptions/purchases` (verify StoreKit 2 JWS / Play purchase token) |
| POST | `/subscriptions/restore` |
| GET | `/subscriptions/me/transactions` |
| POST | `/webhooks/apple` (no bearer; App Store Server Notifications V2, JWS-verified) |
| POST | `/webhooks/google` (no bearer; Pub/Sub push, OIDC-verified) |
| GET / PATCH | `/admin/plans`, `/admin/plans/:id` |
| POST / DELETE | `/admin/users/:id/plan-gift` |
| GET | `/admin/billing-events` |

## Secret Messages

Planned ([secret-messages.md](modules/premium/secret-messages.md)). Thread ids are UUID v4.

| Method | Path |
|--------|------|
| POST | `/secret-messages` (start; Plus / Premium) |
| GET | `/secret-messages/summary` (all plans) |
| GET | `/secret-messages/inbox` (Plus / Premium; sealed items have no sender or body) |
| GET | `/secret-messages/sent` |
| GET | `/secret-messages/:threadId` |
| GET | `/secret-messages/:threadId/messages` |
| POST | `/secret-messages/:threadId/messages` (follow-up or reply; recipient's 2nd reply reveals) |
| POST | `/secret-messages/:threadId/read` |
| POST | `/secret-messages/:threadId/report` (all plans) |
| POST | `/secret-messages/:threadId/block-sender` (all plans) |
| DELETE | `/secret-messages/:threadId` (hide / withdraw) |
| GET | `/users/me/secret-blocks` |
| DELETE | `/users/me/secret-blocks/:blockId` |

## Secret Crush

Planned ([secret-crush.md](modules/premium/secret-crush.md)).

| Method | Path |
|--------|------|
| GET | `/secret-crushes/summary` (all plans) |
| GET | `/secret-crushes` |
| POST | `/secret-crushes` (Plus 3 / Premium 10 spots; returns `matched`) |
| DELETE | `/secret-crushes/:userId` |
| GET | `/secret-crushes/matches` |
| GET | `/secret-crushes/matches/:matchId` |
| POST | `/secret-crushes/matches/:matchId/celebrated` |

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

## Media (S3 — [MEDIA_STORAGE.md](architecture/MEDIA_STORAGE.md))

| Method | Path |
|--------|------|
| POST | `/media/uploads` (optional `client_upload_id`: same id + same file returns the same media with `resumed: true` and a fresh POST, the same multipart upload, or `upload.method: "complete"`) |
| POST | `/media/:id/parts` |
| GET | `/media/:id/parts` |
| POST | `/media/:id/complete` |
| GET | `/media/:id` |
| DELETE | `/media/:id` |

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
| `/ws/v1/chat` | Socket.IO path; access token in the handshake `auth: { token }`; events in [chat-thread.md](modules/messages/chat-thread.md) |
