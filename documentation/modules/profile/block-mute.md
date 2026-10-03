# Block and mute

**Screen:** `BlockedAccounts` (Settings → Privacy → Blocked accounts); block/mute actions also live in profile, post, and chat ••• menus  
**Deep link:** none  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)

## Purpose

Block removes all interaction; mute hides posts/stories in feed only (optional v3 — implement block first). Block is required by the App Store and Google Play for apps with user-generated content.

## UI

- Block from a ••• menu → native confirm `Alert` ("Block jane_doe? They won't be able to find your profile, posts or story.") → toast "Blocked".
- `BlockedAccounts` list: avatar, username, **Unblock** button (confirm).

## API

### `POST /api/v1/users/:userId/block`

### `DELETE /api/v1/users/:userId/block`

### `GET /api/v1/users/me/blocked`

## Acceptance criteria

- [ ] Blocked user cannot DM or comment on your content.
- [ ] After blocking, their content disappears from your feed, tray, and search without restarting the app (cache invalidated).
- [ ] Unblock restores ability to interact but not auto-follow.
