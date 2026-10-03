# User profile

**Screens:** `MyProfile` (ProfileTab root, own profile) · `UserProfile` (pushed in any tab for other users)  
**Deep link:** `nexity://u/:username` · `https://nexity.com/u/:username`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes (guest optional later)

## Purpose

Show avatar, bio, stats, posts grid, reels tab.

## UI

- **Header bar:** username (+ lock icon if private). Own profile: **+** (create sheet) and **☰** menu (bottom sheet: Settings, Saved, Follow requests, Groups, Log out shortcut). Other user: back, •••.
- **Profile header:** avatar (story ring if active story — tap opens `StoryViewer`), stats (posts, followers, following — tap → `Followers`), display name, bio, website link (opens in-app browser).
- **Actions:** Follow / Requested / Following ▾ / Message; own profile: **Edit profile** (`EditProfile` modal) and **Share profile** (native share sheet with `https://nexity.com/u/:username`).
- **Tabs** (sticky material top tabs, swipeable): Posts | Reels | Tagged (tagged optional v3).
- **Posts tab:** 3-column square grid; carousel icon on multi-image posts; video icon on video posts (IG grid). Tap → `PostDetail`.
- **Reels tab:** 3-column 9:16 grid of reel covers with view counts. Tap → `ReelDetail`.
- Header collapses as the grid scrolls; pull-to-refresh at the top.
- **•••** (other user): Block, Restrict (Phase 2), Report, Copy profile link, Share profile.

## API

### `GET /api/v1/users/by-username/:username`

Profile + relationship `is_following`, `is_followed_by`, `follow_status`, `has_active_story`.

### `GET /api/v1/users/me`

Own profile (used by `MyProfile` and to refresh the auth context).

### `GET /api/v1/users/:userId/posts`

Grid pagination for profile posts.

### `GET /api/v1/users/:userId/reels`

Reels tab.

## Private accounts

- Non-followers see limited header + "This account is private — Follow to see their photos and videos" without media.

## Acceptance criteria

- [ ] Blocked users see "User not found" (no crash) when opening the profile from a link.
- [ ] Own profile shows Edit profile and Share profile buttons.
- [ ] Tapping the Profile tab again scrolls to top.
- [ ] Follow button state updates optimistically.
