# Chat thread

**Screen:** `ChatThread` (pushed; tab bar hidden)  
**Deep link:** `nexity://messages/:conversationId`  
**Theme:** Dark & light (bubbles use `bubbleOutgoing` / `bubbleIncoming`, composer uses `inputBackground`) — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Purpose

Real-time 1:1 (or group) messaging with text and image attachments.

## UI

- Header: avatar + name (tap → `UserProfile`), activity status.
- **Inverted** list (newest at bottom); load older on scroll up.
- Message bubbles, read receipts ("Seen"), typing indicator.
- **Composer** pinned to the bottom, moves with the keyboard (`react-native-keyboard-controller`), respects home indicator / nav bar. Camera and gallery buttons for images; multiline input grows to 5 lines.
- Long-press bubble → action sheet: Reply, Copy, Unsend (own), Report. Light haptic on long-press.
- Tap image → `MediaLightbox`.
- Sending is optimistic: bubble appears instantly with a clock icon, turns to sent; failed shows "Not delivered — Tap to retry".
- Opening this screen clears its push notifications and suppresses foreground banners for this conversation.

## REST API

### `GET /api/v1/conversations/:id/messages`

Cursor pagination (newest first; app renders inverted).

### `POST /api/v1/conversations/:id/messages`

**Body:** `{ "body": "Hi", "media_id": null, "client_message_id": "uuid" }` — `client_message_id` prevents duplicates when the app retries.

Image attachments upload via Cloudinary (`purpose: "message"`) first.

### `POST /api/v1/conversations/:id/read`

Mark messages read up to id.

## WebSocket events

Connection: [ROUTING_CONVENTIONS.md — WebSocket](../../architecture/ROUTING_CONVENTIONS.md#websocket-messages).

| Event | Direction | Payload |
|-------|-----------|---------|
| `auth` | client → server | `{ token }` (first frame) |
| `message.new` | server → client | full message (incl. `client_message_id`) |
| `message.read` | server → client | `{ conversation_id, user_id, last_read_message_id }` |
| `typing.start` | both | `{ conversation_id, user_id }` |
| `typing.stop` | both | same |
| `conversation.updated` | server → client | conversation summary for inbox |

When the app is in background, the socket is closed and new messages arrive as **push notifications** (`messages` channel on Android).

## Privacy

- DMs from strangers: respect setting `allow_dm_from`: `everyone` | `followers` | `none`.

## Acceptance criteria

- [ ] Cannot message blocked user.
- [ ] Reconnect (network change, app foreground) fetches missed messages since last id.
- [ ] Keyboard never covers the composer or the last message on iOS or Android.
- [ ] Tapping a message push opens this thread.
