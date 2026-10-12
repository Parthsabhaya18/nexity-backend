# Followers and following

**Screen:** `Followers` (params `{ userId, username, tab: 'followers' | 'following' }`; tabs **Followers** | **Following**)  
**Deep link:** `nexity://u/:username/followers` · `nexity://u/:username/following`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)

## UI

- Header: username; tabs show counts ("1,204 followers", "310 following"). Tabs are tappable (not swipeable yet; that needs a native pager).
- Search field at the top of each list (debounced 300 ms, server-side `q`).
- Row: avatar, username, display name, **Follow / Follow back / Requested / Following** button; the viewer's own followers list shows **Remove** (with confirmation) instead.
- Tap row → `UserProfile`. Pull-to-refresh, infinite scroll.
- A private account the viewer doesn't follow shows a lock empty state instead of the list.

## API

All ids are 24-char hex ObjectId strings.

### `GET /api/v1/users/:userId/followers`

### `GET /api/v1/users/:userId/following`

**Query:** `cursor`, `limit` (default 20, max 50), `q` (username prefix or a display-name word prefix).

**Success:**

```json
{
  "items": [
    {
      "id": "…",
      "username": "aarav",
      "display_name": "Aarav",
      "avatar_url": "https://…",
      "is_private": false,
      "is_self": false,
      "follow_status": "none | pending | accepted"
    }
  ],
  "next_cursor": "… | null"
}
```

**Errors:** `403 PRIVATE_ACCOUNT` (private, viewer not an accepted follower), `404 NOT_FOUND`.

### `POST /api/v1/users/:userId/follow`

**Success:** `{ "status": "accepted" | "pending" }` depending on target privacy. Idempotent.  
**Errors:** `400 CANNOT_FOLLOW_SELF`, `404 NOT_FOUND`.

### `DELETE /api/v1/users/:userId/follow`

Unfollow or cancel a pending request; **204**. The app asks for confirmation when the target is private.

### `DELETE /api/v1/users/me/followers/:userId`

Remove a follower; **204**.

Follow endpoints are rate limited per account (`followLimiter`, 200 / 15 min).

## Acceptance criteria

- [x] Private account follow creates `pending` until accepted.
- [x] Private account lists are hidden from non-followers.
- [x] `followers_count` / `following_count` stay in sync on follow, unfollow, accept and remove.
- [x] Follow state is optimistic and shared across screens; failures revert with an alert.
