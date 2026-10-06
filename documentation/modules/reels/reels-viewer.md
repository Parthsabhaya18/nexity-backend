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

## Implementation status

- `Reels` tab: vertical full-screen paging (`FlatList`, one reel per page sized to the tab's own height, snapping, `getItemLayout`, at most 3 pages mounted). Only the visible reel plays; it pauses when the tab loses focus or a sheet is open, and restarts playing when you come back to it.
- **Opening a reel from a profile grid** (or a notification) switches to the Reels tab with that reel first and playing; it stays first when the random feed page arrives and is never repeated further down. Pull to refresh drops it and starts a new random order. A notification only has the id, so the app loads it with `GET /reels/:id`.
- **Order:** random, like the home feed. The newest 500 reels you can see are shuffled with a seed carried in `next_cursor` (`<seed>_<key>`), so paging never repeats a reel and every fresh load or pull to refresh gives a new order.
- **Single tap** → pause / play (this app uses tap-to-pause rather than tap-to-mute). The tap shows two round buttons in the middle of the video: **sound on / off** on top (not shown if the author muted the audio) and **Play / Pause** below it. Both can be tapped. While paused they stay visible; while playing they fade after 1.5 s. **Double tap** → like with a heart burst. The cover photo shows until the first frame; a spinner shows while buffering; a playback error offers **Try again**.
- **Right column:** Like (with count, hidden when `hide_like_count` is on), Comment (hidden when comments are off), Share (native share sheet with `https://nexity.com/reels/:id`), and •••.
- **•••** owner: bottom sheet with **Hide / Show like count**, **Turn comments off / on**, **Edit description**, **Delete** (with confirmation), using `PATCH` / `DELETE /reels/:id`. Others: Report / Block.
- **Bottom:** author avatar and username (tap → profile), caption (tap to expand), location.
- Likes use `PUT` / `DELETE /reels/:id/like`; quick taps are merged so the final state always matches the last tap. Comments use the shared comments sheet with a send icon and loader ([reel-comments.md](reel-comments.md)).
- Empty feed shows **No reels yet** with **Create a reel**; a load error shows **Try again**. Pull to refresh.
- Not yet: Save reel, view counting (`POST /reels/:id/view`), Follow button on the reel, audio label.

## API

### `GET /api/v1/reels/feed`

**Query:** `cursor` (opaque `<seed>_<key>` from the previous page; omit for a new random order), `limit`

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
