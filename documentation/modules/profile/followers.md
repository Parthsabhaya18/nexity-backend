# Followers and following

**Screen:** `Followers` (top tabs **Followers** | **Following**, swipeable)  
**Deep link:** `nexity://u/:username/followers` · `nexity://u/:username/following`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)

## UI

- Header: username; tabs show counts ("1,204 followers", "310 following").
- Search field at the top of each list.
- Row: avatar, username, display name, **Follow / Following / Requested** button; own followers list also shows **Remove**.
- Tap row → `UserProfile`. Infinite scroll.

## API

### `GET /api/v1/users/:userId/followers`

### `GET /api/v1/users/:userId/following`

Cursor list with `username`, `avatar_url`, `is_following` (viewer context). **Query:** `q` for in-list search.

### `POST /api/v1/users/:userId/follow`

**Success:** `{ "status": "accepted" | "pending" }` depending on target privacy.

### `DELETE /api/v1/users/:userId/follow`

Unfollow; **204**. Unfollow asks for confirmation (action sheet) when the target is private.

## Acceptance criteria

- [ ] Private account follow creates `pending` until accepted.
- [ ] Private account lists are hidden from non-followers.
