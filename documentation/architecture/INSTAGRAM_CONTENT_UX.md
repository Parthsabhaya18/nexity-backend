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
3. **Adjust** — brightness, contrast, saturation, warmth, fade, sharpen, blur and vignette sliders. Nexity has no named filters.
4. **Compose** — caption with @mentions (no hashtags), **Tag people**, **Add location**, advanced: hide like count, turn off commenting. Nexity has no music and no audience picker.
5. **Share** — upload each file to Cloudinary, confirm media, `POST /posts`, then land on feed with success toast.

**Screens:** `CreatePostStack` (fullscreen modal) → `CreatePostSelect` → `CreatePostCrop` → `CreatePostDetails`. Deep link `nexity://create/post`.

### View (match Instagram)

| Surface | Behavior |
|---------|----------|
| **Home feed** | Card: carousel swipe, dots indicator, inline video mute icon, audio off by default in feed |
| **Post detail** | `PostDetail` screen — media full width on top, caption and comments below; comments also open as a bottom sheet from the feed |
| **Profile grid** | Square thumbnails; video small reel icon overlay; carousel corner icon |
| **From grid tap** | `PostViewer`: the tapped post, swipe left / right for the other posts in the grid |

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
3. **Audio** — keep or mute the original sound (no music library).
4. **Share** — caption, cover, location, hide like count, turn off commenting.
5. Upload video + cover image to Cloudinary → `POST /reels`.

**Screens:** `CreateReelStack` (fullscreen modal) → `CreateReelVideo` → `CreateReelEdit` → `CreateReelDetails`. Deep link `nexity://create/reel`.

Max length **2 minutes** for reels, post videos and story videos (product decision; enforced in the gallery, before upload, and by the API).

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
2. **Story editor** — text, stickers, draw (Phase 2); minimum: preview + discard/Share. The photo stays clean: only a small icon column at the top right (Text, Location, Draw). Text is typed in place, centered over the photo, with no box around it by default and a color row above the keyboard (scrollable presets, plus a rainbow button that opens a custom picker: hue bar and shade bar). Above the colors is a font row (Classic, Modern, Strong, Typewriter, Serif, Script; `font` on the text overlay), and an "A" toggle at the top left adds a background box. While the box is on, a "Text / Background" switch picks which of the two the color row changes, so text and background can each be any color. Tap a text to edit it again. Text and location can be pinched with two fingers to resize (`scale` 0.4–3) and rotated (`rotation`). Location opens the place search and adds a movable location sticker, placed exactly in the center (overlay type `location`; removing it clears `location_name`). The text editor (like Instagram) has a vertical text-size slider on the left, a row of font names shown in their own font, and an icon toolbar: font, color wheel, alignment (`align`: center / left / right), and the background box. Draw (squiggle icon in the rail) has one top row: Undo, Pen, Arrow, Marker, Neon (`brush`), Eraser (removes whole strokes it touches), and ✓; a vertical thickness slider on the left (`width`, 0.4–6 % of the story width); and paged color swatches with dots at the bottom. After sharing, the Home stories tray reloads right away; stories expire 24 hours after posting. To delete text or location, drag it onto the trash icon that appears at the bottom while dragging; it turns red when the item is over it. Polls, questions, quizzes, countdowns, links, emoji stickers and people tags are not offered in the editor (old stories that have them still render). Max 30 overlays per story.
3. Upload to Cloudinary folder `secret/stories/…` → `POST /stories`.
4. **24-hour expiry** — auto-remove from tray when expired.

**Screen:** `CreateStory` (fullscreen modal, opens straight into the camera). Deep link `nexity://create/story`. Also reachable by swiping right from Home (Phase 2).

### View (match Instagram Stories)

- Fullscreen `StoryViewer` modal (deep link `nexity://stories/:userId/:storyId`); swipe left/right moves between users with a cube transition.
- **Progress segments** across top for each story in bundle.
- Tap **right** next, **left** previous, **hold** pause.
- **Who sees a story**: only people who follow each other (both follows accepted). Following someone who doesn't follow back hides their stories from your tray, and `view` / `like` / `message` on them return `404`. Demo data for today: `npm run seed:stories` in the backend.
- Swipe down (a long drag or a quick flick) to close. Swipe up: on your own story it opens the viewers sheet; on someone else's it focuses the reply box.
- Reply bar sends **DM** to author (Instagram-style story reply).
- Own story bottom bar: left, a ^ hint with viewer faces (up to 3) and the count (tap or swipe up for the list); right, a round trash icon to delete.
- **Profile ring**: on `MyProfile` and `UserProfile` the avatar has a ring while that person has a live story (primary color if unseen or your own, border color once seen). Tap opens the story; long press shows the profile photo. The Home tray's "Your story" also gets a ring when you have one. Rings drop on their own when the last story's 24 hours end.

### Edit (match Instagram)

Instagram **does not** edit published stories. Match that:

- **No edit route** for published stories.
- Owner bottom bar: **Delete** only; optional “Highlight” (Phase 2).

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
| Story ring | tray or profile avatar → `StoryViewer` |

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
