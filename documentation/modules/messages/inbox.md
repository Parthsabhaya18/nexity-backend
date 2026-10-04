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
- Row: avatar (green online dot), name, last message preview ("Sent a GIF", "You unsent a message", …), **"Active now"** with a green dot while the person is online, timestamp, unread count (grey when muted), muted bell icon.
- Long-press a row: Mute / Unmute messages, Delete chat (confirm; deletes for you only). Muted chats don't count toward the Home header badge.
- Pull-to-refresh; infinite scroll.

## API

In the app this screen is `Chats` (opened from the Home header chat icon). Conversations without messages are not listed. Rows use the conversation shape from [chat-thread.md](chat-thread.md#get-apiv1conversationsid); pagination follows the standard list response.

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
