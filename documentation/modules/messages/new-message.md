# New message

**Screen:** `NewMessage` (modal from the `Inbox` header)  
**Deep link:** none  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)

## Purpose

Start a DM by searching users.

## UI

- Header: **Cancel**, "New message", **Chat** (enabled when a user is selected).
- "To:" search input autofocused; suggested accounts below when empty.
- Results list with radio selection.

## API

### `GET /api/v1/users/search?q=`

For picker.

### `POST /api/v1/conversations`

**Body:** `{ "participant_ids": ["uuid"], "type": "direct" }`

Returns existing direct conversation if already present.

## Acceptance criteria

- [ ] On success, dismiss the modal and open `ChatThread` for the conversation.
- [ ] Users who block you or disallow DMs are not selectable.
