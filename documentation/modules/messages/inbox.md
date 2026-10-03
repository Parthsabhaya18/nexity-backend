# Messages inbox

**Screen:** `Inbox` (pushed from the Messages icon in the Home header)  
**Deep link:** `nexity://messages`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Purpose

List direct conversations sorted by latest message.

## UI

- Header: your username, **New message** icon → `NewMessage` modal.
- Search conversations at top.
- Row: avatar (online dot if activity status allowed), name, last message preview, timestamp, unread dot/bold.
- Swipe actions (iOS) / long-press (Android): Mute, Delete conversation.
- Pull-to-refresh; infinite scroll.

## API

### `GET /api/v1/conversations`

```json
{
  "data": [
    {
      "id": "uuid",
      "participants": [{ "username", "avatar_url" }],
      "last_message": { "body", "created_at", "sender_id" },
      "unread_count": 2
    }
  ]
}
```

## Acceptance criteria

- [ ] Real-time update when a new message arrives (socket event `conversation.updated`) while the app is open.
- [ ] Refreshes on app foreground and when a `message_new` push is received.
- [ ] Unread count shows on the Home header Messages icon and contributes to the app icon badge.
