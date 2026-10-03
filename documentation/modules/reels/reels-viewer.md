# Reels viewer

**Screens:** `Reels` (ReelsTab root) · `ReelDetail` (pushed from grids, links, pushes)  
**Deep link:** `nexity://reels` · `nexity://reels/:reelId` · `https://nexity.com/reels/:reelId`  
**Theme:** Always dark (immersive media); sheets and ••• menu use current theme — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**UX reference:** [INSTAGRAM_CONTENT_UX.md](../../architecture/INSTAGRAM_CONTENT_UX.md) — Reels view

## Purpose

Full-screen Instagram Reels tab experience (vertical feed).

## UI

- **Edge-to-edge 9:16** video under a transparent status bar (light icons); `resizeMode="cover"` on tall phones, black letterbox on wider screens.
- Vertical paging list (`FlashList`/`FlatList` with `pagingEnabled`, one reel per screen height minus the tab bar): **swipe up** → next, **swipe down** → previous.
- On the `Reels` tab the **tab bar turns dark**; on `ReelDetail` the tab bar is hidden and a back arrow is shown top-left.
- **Right column:** Like, Comment, Share, Save (stacked icons + counts), •••, and spinning audio disc.
- **Bottom:** author avatar + username (tap → `UserProfile`) + Follow button, caption with "more", audio label marquee.
- **Top:** "Reels" title + camera icon → `CreateReelStack`.
- Double-tap → like animation + light haptic. Single tap → mute/unmute (IG); **press and hold** → pause.
- **•••** owner: Edit (`EditReel` modal), Delete; viewer: Report, Not interested, Copy link.
- Comments: bottom sheet ([reel-comments.md](reel-comments.md)); video keeps playing muted behind the sheet (or pauses — pick one and keep consistent).
- Respect safe areas: bottom text and right rail must not sit under the home indicator / Android nav bar.

Video URLs: Cloudinary adaptive streaming (`sp_hd` → HLS), played with `react-native-video` (AVPlayer on iOS, ExoPlayer on Android). Show the `thumbnail_url` poster until the first frame renders.

## API

### `GET /api/v1/reels/feed`

**Query:** `cursor`, `seed`

Returns reels with `video_delivery_url`, `thumbnail_url`, `width`, `height`, counts, `liked_by_me`, `saved_by_me`.

### `GET /api/v1/reels/:reelId`

Deep link; optional `suggested_next_ids[]` for continuity.

### `POST /api/v1/reels/:reelId/view`

**Body:** `{ "watch_ms": 4200 }` — one counted view per user per reel per 24h. Send when the user swipes away or after a full loop; batch if offline.

### `POST /api/v1/reels/:reelId/like`

Toggle like.

### `POST /api/v1/reels/:reelId/save`

Toggle save (IG "Save reel" parity).

## Performance

- Only the visible reel plays; preload (buffer) the next 1–2 reels, keep at most 3 player instances mounted.
- Pause when the screen loses focus (switching tabs, opening a modal) and when the app goes to background (`AppState`); resume when back.
- Release players that are more than 2 positions away to save memory on low-end Android.
- Keep the screen awake while a reel plays (`react-native-video` `preventsDisplaySleepDuringVideoPlayback` / keep-awake).

## Acceptance criteria

- [ ] Behavior indistinguishable from the IG Reels tab for navigation and actions on iOS and Android.
- [ ] A shared link `https://nexity.com/reels/:id` opens `ReelDetail`, then continues algorithmic feed order.
- [ ] Mute preference persisted in AsyncStorage; starts muted if the iOS silent switch is on.
- [ ] Audio stops immediately when leaving the tab or backgrounding the app.
- [ ] No dropped frames when swiping on a mid-range Android device.
