# Chat thread

**Screen:** `ChatThread` (pushed; tab bar hidden)  
**Deep link:** `nexity://messages/:conversationId`  
**Theme:** Dark & light (bubbles use `bubbleOutgoing` / `bubbleIncoming`, composer uses `inputBackground`) — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Purpose

Real-time 1:1 (or group) messaging with text and image attachments.

## UI

- Header: avatar + name (tap → `UserProfile`), activity status: **"Active now"** + green dot while online, otherwise "Active 5m ago" (hidden after 7 days). The server keeps a user online for 15 s after their last socket drops so quick reconnects don't flicker.
- **Inverted** list (newest at bottom); load older on scroll up.
- Message bubbles, read receipts ("Seen"), typing indicator. GIFs render without a bubble; replies show a quoted preview above the bubble; unsent messages show "Message unsent".
- **Composer** pinned to the bottom, respects home indicator / nav bar. One pill: camera button (coming soon), multiline input (grows to 5 lines), then **Mic · Photo · GIF** while empty, or Send once there is text.
  - **Mic** → recording bar: discard, stop/resume, live waveform, timer (max 60 s), send. *UI only until S3 upload ships; send shows "coming soon".*
  - **Photo** → album picker (device albums, 3-column grid, up to 10 photos, numbered selection, limited-access banner). *Sending ships with S3 upload.*
  - **GIF** → GIPHY search sheet (trending when empty, masonry grid, "Powered by GIPHY"); tap sends immediately.
- Long-press bubble → action sheet: Reply, Copy (text), Unsend (own). Report comes with moderation.
- Tap image → `MediaLightbox`.
- Sending is optimistic: bubble appears instantly with a clock icon, turns to sent; failed shows "Not delivered — Tap to retry".
- Opening this screen clears its push notifications and suppresses foreground banners for this conversation.

## REST API

Implemented in `backend/src/modules/messages/`. Every route requires auth and returns `404` for conversations you are not a member of.

### `GET /api/v1/conversations/:id`

Conversation as seen by the caller (used by the thread header):

```json
{
  "id": "…", "type": "direct",
  "peer": { "id", "username", "display_name", "avatar_url", "last_active_at", "is_online" },
  "participants": [ /* same shape */ ],
  "last_message": { "id", "sender_id", "type", "body", "is_deleted", "created_at" },
  "unread_count": 0,
  "last_read_message_id": "…",
  "peer_last_read_message_id": "…",
  "is_muted": false, "created_at": "…", "updated_at": "…"
}
```

"Seen" under my last message = `peer_last_read_message_id >= that message id`.

### `GET /api/v1/conversations/:id/messages`

- `?cursor=<message id>&limit=` — older page, **newest first** (app renders inverted).
- `?after=<message id>&limit=` — catch-up after a reconnect, **oldest first**.

Message:

```json
{
  "id", "conversation_id", "sender_id",
  "type": "text" | "image" | "gif" | "voice" | "system",
  "body",
  "media": { "provider": "giphy" | "upload", "provider_id", "media_id", "url", "preview_url", "width", "height", "duration_ms" } | null,
  "reply_to_id",
  "reply_to": { "id", "sender_id", "type", "body", "is_deleted" } | null,
  "client_message_id", "is_deleted", "created_at"
}
```

`reply_to` is a short preview of the quoted message (batch-loaded), so bubbles render without extra requests.

### `POST /api/v1/conversations/:id/messages`

**Body:** `{ "body"?: "Hi", "gif"?: { id, url, preview_url, width, height }, "reply_to_id"?: "…", "client_message_id": "uuid" }` — needs `body` or `gif`. `client_message_id` (UUID v4) makes retries idempotent: re-sending the same id returns the stored message instead of a duplicate. `body` is trimmed, max 2000 characters. `gif.url` must be a GIPHY CDN URL (`https://media*.giphy.com/…`), so clients can't make others load arbitrary URLs. Rate limit: 60 messages / minute / user (`429 TOO_MANY_REQUESTS`). Returns `201` with the message.

Photos and voice notes upload to S3 first, then send `media_id`. **Not live yet:** the picker and recorder UIs exist, and a non-null `media_id` returns `400 MEDIA_NOT_SUPPORTED` until the media module ships.

### `DELETE /api/v1/conversations/:id/messages/:messageId`

Unsend (own messages only, else `403 NOT_MESSAGE_OWNER`). Sets `deleted_at` (content hidden for everyone; row kept), fixes the inbox preview and the other member's `unread_count`, emits `message.deleted` and `conversation.updated`. Returns the message with `is_deleted: true`.

### `POST /api/v1/conversations/:id/mute`

**Body:** `{ "muted": true }`. Per member; returns the conversation (`is_muted`). Push notifications will respect it.

### `DELETE /api/v1/conversations/:id`

"Delete chat" for the caller only: hides the conversation and its history from them (`cleared_at`), unread → 0. A new message brings it back, starting from that message. `204`; emits `conversation.deleted` to the caller's other devices.

### GIFs — `GET /api/v1/gifs/trending` · `GET /api/v1/gifs/search?q=`

Server-side GIPHY proxy (the API key never ships in the app). `?limit=` (≤ 50), `?cursor=` (offset from `pagination.next_cursor`). Returns `{ data: [{ id, title, url, preview_url, width, height }], pagination }`. Trending is cached for 10 minutes. Needs `GIPHY_API_KEY` in the backend env; without it both return `503 GIFS_NOT_CONFIGURED`. Content rating: `GIPHY_RATING` (default `pg-13`).

### `POST /api/v1/conversations/:id/read`

**Body:** `{ "message_id"?: "…" }` (default: latest). Moves the caller's read marker forward (never backwards), recomputes `unread_count`, and emits `message.read` to the other participants.

## Realtime (Socket.IO)

Connection: [ROUTING_CONVENTIONS.md — WebSocket](../../architecture/ROUTING_CONVENTIONS.md#websocket-messages). Messages are **sent over REST**; the socket delivers events. Each socket joins the room `user:<id>`, so every device of a user receives the events.

| Event | Direction | Payload |
|-------|-----------|---------|
| handshake `auth` | client → server | `{ token }` — access token; rejected with `connect_error` `data.code` (`UNAUTHORIZED`, `TOKEN_EXPIRED`, …) |
| `message.new` | server → client | full message (incl. `client_message_id`), also echoed to the sender's devices |
| `message.read` | server → client | `{ conversation_id, user_id, last_read_message_id, read_at }` |
| `message.deleted` | server → client | `{ conversation_id, message_id }` (unsend) |
| `conversation.deleted` | server → client | `{ conversation_id }` — the caller deleted the chat on another device |
| `typing.start` | both | client sends `{ conversation_id }`; others receive `{ conversation_id, user_id }` |
| `typing.stop` | both | same |
| `conversation.updated` | server → client | the conversation (shape above) as seen by the receiver, for the inbox |
| `presence.subscribe` | client → server | `{ user_ids }`; ack `{ data: [{ user_id, is_online, last_active_at }] }` |
| `presence.update` | server → client | `{ user_id, is_online, last_active_at }` for subscribed users |

When the app is in background, the socket is closed and new messages arrive as **push notifications** (`messages` channel on Android).

## Privacy

- DMs from strangers: respect setting `allow_dm_from`: `everyone` | `followers` | `none`.

## Acceptance criteria

- [ ] Cannot message blocked user.
- [ ] Reconnect (network change, app foreground) fetches missed messages since last id.
- [ ] Keyboard never covers the composer or the last message on iOS or Android.
- [ ] Tapping a message push opens this thread.
