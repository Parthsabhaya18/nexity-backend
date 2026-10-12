# User profile

**Screens:** `MyProfile` (own profile, pushed from the avatar in the Home header; not a bottom tab) · `UserProfile` (pushed in any tab for other users)  
**Deep link:** `nexity://u/:username` · `https://nexity.com/u/:username`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes (guest optional later)

## Purpose

Show avatar, bio, stats, posts grid, reels tab.

## UI

- **Header bar:** username (+ lock icon if private). Own profile: **+** (create sheet) and **☰** menu (bottom sheet: Settings, Saved, Follow requests, Groups, Log out shortcut). Other user: back, •••.
- **Profile header:** avatar (story ring if active story — tap opens `StoryViewer`), stats (posts, followers, following — tap → `Followers`), display name, bio, website link (opens in-app browser).
- **Actions:** Follow / Requested / Following ▾ / Message; own profile: **Edit profile** (`EditProfile` modal) and **Share profile** (native share sheet with `https://nexity.com/u/:username`).
- **Tabs** (sticky material top tabs, swipeable): Posts | Reels | Saved (own profile only) | Tagged (tagged optional v3). Swiping left or right on the tab content switches to the next or previous tab; a swipe counts only when it is clearly sideways (≥ 60 dp or a fast fling), so vertical scrolling and taps on tiles still work.
- **Posts tab:** 3-column square grid; carousel icon on multi-image posts; video icon on video posts (IG grid). Tap → `PostDetail`.
- **Reels tab:** 3-column 9:16 grid of reel covers with view counts. Tap → opens that reel first in the Reels feed (`popTo('Main', { screen: 'Reels' })`, because the profile screens sit above the bottom tabs in the root stack).
- Header collapses as the grid scrolls; pull-to-refresh at the top.
- **•••** (other user): Block, Restrict (Phase 2), Report, Copy profile link, Share profile.

## API

### `GET /api/v1/users/by-username/:username`

Profile (`id`, `username`, `display_name`, `avatar_url`, `bio`, `website`, `is_private`, `is_verified`, counts) + relationship `is_self`, `follow_status` (`none | pending | accepted`), `follows_you`, `can_view_content` (false for a private account the viewer doesn't follow). `has_active_story` comes with Stories. Inactive or unverified accounts return `404 NOT_FOUND`.

> Implementation note: `UserProfile` takes `{ username }`; opening your own username replaces it with `Profile`. Actions are Follow / Follow back / Requested / Following ▾ (action sheet with Unfollow) and Share profile; **Message** waits for chat. The ••• menu has Share profile only until Block / Report (safety step). The own profile shows a **Follow requests** row when `follow_requests_count > 0`.

**Implemented** (`src/modules/users/user.profile.ts`): `{ id, username, display_name, avatar_url, bio, is_private, is_self, stats: { posts, followers, following }, is_following, is_followed_by, follow_status, has_active_story, presence: { online, last_active_at }, created_at }`. Username lookup is case-insensitive; unknown or disabled accounts return `404`. Stats and relationship fields are placeholders (`0` / `false` / `"none"`) until the follows, posts and stories modules ship. The app opens it from the chat header, a message avatar, and "View profile" in the thread intro.

### `GET /api/v1/users/me`

Own profile (used by `Profile` and to refresh the auth context; refetched on focus and pull-to-refresh). Includes `bio`, `website` (full URL or `""`), `avatar_url`, `is_private`, `posts_count`, `followers_count`, `following_count`. Edits go through `PATCH /users/me` — see [edit-profile.md](edit-profile.md).

> Implementation note: the own-profile screen is registered as `Profile` in the app today. The website shows without `https://` and opens in the system browser; Share profile uses the native share sheet with `https://nexity.com/u/:username`.

### `GET /api/v1/users/:userId/posts`

Grid pagination for profile posts.

### `GET /api/v1/users/:userId/reels`

Reels tab.

## Private accounts

- Non-followers see limited header + "This account is private — Follow to see their photos and videos" without media.

## Acceptance criteria

- [ ] Blocked users see "User not found" (no crash) when opening the profile from a link.
- [ ] Own profile shows Edit profile and Share profile buttons.
- [ ] Tapping the avatar in the Home header opens `MyProfile`; back returns to Home.
- [x] Follow button state updates optimistically.
