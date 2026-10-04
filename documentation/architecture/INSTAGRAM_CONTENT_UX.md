# Instagram-style UX — Posts, Reels, Stories

Posts, Reels, and Stories must **look and behave like Instagram** for create, view, edit, and delete. Implementation details differ by type; shared patterns are defined here.

**Media:** all assets via [MEDIA_STORAGE.md](MEDIA_STORAGE.md) (AWS S3).

## Shared patterns (all three types)

| Pattern | Instagram behavior to match |
|---------|------------------------------|
| Author row | Avatar, username, optional location, ••• menu |
| ••• menu (owner) | Edit (where IG allows), Delete, Copy link, Turn off commenting (posts/reels optional v3) |
| ••• menu (viewer) | Report, Unfollow, Copy link |
| Engagement row | Like (heart), Comment, Share, Save (posts/reels); stories: reply DM only |
| Likes | Tap count → sheet/list of users who liked |
| Captions | Username bold + text; “more” expand after ~2 lines |
| Timestamps | Relative time; optional “Edited” label |
| Double-tap | Like + heart animation on media |
| Privacy | Respect visibility and private account rules |
| Theme | Feed, grid, detail, and edit screens follow dark / light theme; reels and story viewers/editors are always dark ([THEMING.md](THEMING.md)) |

## Posts (feed / profile grid)

### Create flow (match Instagram)

Multi-step — same mental model as IG “New post”:

1. **Select** — in-app gallery grid (recent photos/videos, album switcher, camera shortcut); up to **10 images** OR **1 video** (no mixing).
2. **Crop / aspect** — per item: Original, 1:1, 4:5, 16:9; pinch-zoom and pan; carousel reorder (long-press and drag thumbnails).
3. **Filter / edit** (optional v3) — lux, structure sliders; can ship as “Phase 2” UI shell with Normal only at first.
4. **Compose** — caption, **Tag people**, **Add location**, **Add music** (optional off in v3), **Alt text** per image, advanced: hide like/view counts, turn off commenting.
5. **Share** — upload each file to Cloudinary, confirm media, `POST /posts`, then land on feed with success toast.

**Screens:** `CreatePostStack` (fullscreen modal) → `CreatePostSelect` → `CreatePostCrop` → `CreatePostDetails`. Deep link `nexity://create/post`.

### View (match Instagram)

| Surface | Behavior |
|---------|----------|
| **Home feed** | Card: carousel swipe, dots indicator, inline video mute icon, audio off by default in feed |
| **Post detail** | `PostDetail` screen — media full width on top, caption and comments below; comments also open as a bottom sheet from the feed |
| **Profile grid** | Square thumbnails; video small reel icon overlay; carousel corner icon |
| **From grid tap** | Open post detail or **modal viewer** (lightbox) with same carousel behavior |

### Edit (match Instagram)

**Allowed after publish** (same as IG):

- Caption
- Tag people (add/remove tags)
- Location (add/change/remove)
- Alt text per carousel item
- Hide like count / turn off comments (if enabled in product)

**Not allowed after publish** (same as IG):

- Replace, add, or remove carousel media
- Change filter on published media

**Screen:** `EditPost` (modal) — same fields as compose step 4, no media step.

Show **Edited** under timestamp when caption or tags changed.

### Delete

Confirm dialog → soft delete → remove from feed/profile grid; purge Cloudinary on schedule.

---

## Reels

### Create flow (match Instagram Reels)

1. **Clips** — upload video or record segments (single clip OK for v3).
2. **Edit** — trim timeline, cover frame scrubber, optional text/stickers (stickers Phase 2).
3. **Audio** — display track name if provided (library optional v3).
4. **Share** — caption, cover thumbnail, tag people, location, audience (public/followers).
5. Upload video + cover image to Cloudinary → `POST /reels`.

**Screens:** `CreateReelStack` (fullscreen modal) → `CreateReelVideo` → `CreateReelEdit` → `CreateReelDetails`. Deep link `nexity://create/reel`.

Max length **3 minutes**, like Instagram.

### View (match Instagram Reels)

- Fullscreen **9:16** player on the `Reels` tab and `ReelDetail` (edge-to-edge, under the status bar).
- Vertical paging swipe **up/down** for next/previous reel.
- Right rail: Like, Comment, Share, Save (if IG save reel — include save).
- Bottom-left: author, caption (expand), audio marquee.
- Tap once: mute/unmute; press and hold: pause; double-tap: like.
- Comments: bottom sheet ~70% height, video pauses or mutes.

### Edit (match Instagram)

**Allowed:**

- Caption
- Cover photo (choose frame or upload cover to Cloudinary)
- Tag people / location (same as IG reel edit)

**Not allowed:**

- Replace video file after publish

**Screen:** `EditReel` (modal)

### Profile

- **Reels tab** on profile: 3-column grid of covers, like IG.

---

## Stories

### Create flow (match Instagram Stories)

1. **Camera / upload** — single image or video (max **60s** video).
2. **Story editor** — text, stickers, draw (Phase 2); minimum: preview + discard/Share.
3. Upload to Cloudinary folder `secret/stories/…` → `POST /stories`.
4. **24-hour expiry** — auto-remove from tray when expired.

**Screen:** `CreateStory` (fullscreen modal, opens straight into the camera). Deep link `nexity://create/story`. Also reachable by swiping right from Home (Phase 2).

### View (match Instagram Stories)

- Fullscreen `StoryViewer` modal (deep link `nexity://stories/:userId/:storyId`); swipe left/right moves between users with a cube transition.
- **Progress segments** across top for each story in bundle.
- Tap **right** next, **left** previous, **hold** pause.
- Swipe down to close.
- Reply bar sends **DM** to author (Instagram-style story reply).

### Edit (match Instagram)

Instagram **does not** edit published stories. Match that:

- **No edit route** for published stories.
- Owner ••• menu: **Delete** only; optional “Highlight” (Phase 2).

---

## Navigation parity (iOS & Android)

| Instagram | This app |
|-----------|----------|
| Home tab | `HomeTab` → `Home` (stories tray + feed) |
| Search & explore tab | `SearchTab` → `Explore` |
| Create (+) tab | Round + button right of the tab pill → sheet: Post / Reel / Story |
| — | `PremiumTab` → `Premium` (between Search and Reels) |
| Reels tab | `ReelsTab` → `Reels` (dark tab bar) |
| Profile tab | No tab — avatar in Home header → `MyProfile` (tabs Posts / Reels / Tagged) |
| Heart / Messenger icons in Home header | `Notifications`, `Inbox` |
| Story ring | tray → `StoryViewer` |

## Mobile gestures & feedback

| Gesture | Where | Result |
|---------|-------|--------|
| Double-tap | Post media, reel | Like + heart burst + light haptic |
| Long-press | Grid thumbnail | Peek preview (Phase 2) |
| Long-press | Comment, message | Action sheet (Reply, Copy, Report, Delete) |
| Pinch | Feed / detail image | Zoom overlay, snaps back on release |
| Swipe down | Story viewer, lightbox, comments sheet | Close |
| Swipe left on comment (iOS) / long-press (Android) | Own comment | Delete |
| Hold | Story | Pause |

Use `react-native-gesture-handler` + Reanimated for these; never rely on web-style hover or right-click.

## Module docs

Detailed API and checklists:

- [create-post.md](../modules/posts/create-post.md), [post-detail.md](../modules/posts/post-detail.md), [edit-post.md](../modules/posts/edit-post.md)
- [create-reel.md](../modules/reels/create-reel.md), [reels-viewer.md](../modules/reels/reels-viewer.md), [edit-reel.md](../modules/reels/edit-reel.md)
- [create-story.md](../modules/stories/create-story.md), [view-story.md](../modules/stories/view-story.md)
