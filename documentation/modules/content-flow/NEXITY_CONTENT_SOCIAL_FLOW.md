# Nexity — Story, Reels, Post, Account Privacy, Block, Permissions (Full Spec + Cursor Prompts)

Put this file at `D:\Nexity\backend\documentation\modules\content-flow\NEXITY_CONTENT_SOCIAL_FLOW.md`.
In Cursor, always start with: `@documentation/AGENTS.md @documentation/architecture/MOBILE_APP.md @documentation/architecture/THEMING.md @documentation/architecture/MEDIA_STORAGE.md @documentation/modules/content-flow/NEXITY_CONTENT_SOCIAL_FLOW.md`

> **Prototype reference rule (say this in every prompt):** The web prototype (`index.html`, `css/*.css`, `js/*.js`: `home.js`, `create.js`, `reels.js`, `user.js`, `chat.js`, `safety.js`, `modals.js`, `settings.js`) is a **visual and behavior reference only**. Reuse its colors, spacing, copy and flow. Do NOT copy its code into React Native. Everything must use theme tokens (Light, Dark, every mood), never hard-coded colors. Buttons keep their design.

---

## 0. Global rules (apply to every feature below)

1. **Reusable components first.** Build once in `frontend/src/components/`, use everywhere:
   - `Avatar` (with `storyRing` prop: none / unseen / seen / closeFriends)
   - `StoryRing`, `StoryProgressBar`, `StoryViewer`, `StoryEditor`
   - `MediaPicker` (gallery + camera), `MediaFit` (auto-fit logic)
   - `PermissionGate` + `usePermission(type)` hook
   - `useMediaUpload()` (already exists: S3 presigned POST)
   - `ActionSheet` (bottom sheet menu), `ConfirmDialog`, `Toast`
   - `PostCard`, `ReelItem`, `ProfileGrid`, `ProfilePostsFeed`
   - `FollowButton` (handles Follow / Requested / Following / Message states)
   - `EmptyState`, `SkeletonLoader`
2. **No glitch rules:** 60fps animations (Reanimated), no layout jump while loading (skeletons + fixed aspect ratios), preload next story/reel media, cancel in-flight requests on unmount, optimistic UI for like/follow with rollback on error.
3. **Every screen:** safe areas, keyboard handling, Android hardware back, accessibility labels, offline/error state with Retry, Light/Dark/Mood theme tokens.
4. **Media never goes through the API.** Device -> AWS S3 (presigned POST) -> `POST /media/:id/complete` -> create entity with `media_id`. Compress images on device before upload (max 1080px wide, JPEG q=0.8; video max 60s story / 90s reel, H.264).
5. **Test on Android + iOS** (say clearly if iOS wasn't tested).

---

## 1. Permissions (Camera, Gallery, Microphone, Notifications)

**Flow (same on every feature):**
1. User taps an action that needs a permission (e.g. Story camera).
2. App first shows **our own pre-permission sheet** (icon, title, one-line reason, `Allow` button, `Not now`). Do not trigger the OS popup cold.
3. `Allow` -> OS system popup appears (Allow / Allow while using app / Don't allow).
4. If **granted** -> continue the action immediately (open camera / gallery).
5. If **denied (can ask again)** -> show friendly empty state with `Try again`.
6. If **blocked / never ask again** -> show sheet "Permission needed" + `Open Settings` button (`Linking.openSettings()`), and re-check on app foreground.
7. Gallery on Android 13+: use `READ_MEDIA_IMAGES/VIDEO`; support iOS **Limited Photos** (show "Manage" link).

| Permission | When asked | Why text |
|---|---|---|
| Camera | Story/Reel/Post camera | "Take photos and videos to share" |
| Photos / Media | Opening gallery picker | "Choose photos and videos to post" |
| Microphone | Recording video/reel | "Record sound with your videos" |
| Notifications | After onboarding / first like or follow | "Get notified about likes, follows and messages" |

Implement with `react-native-permissions`. Add `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSMicrophoneUsageDescription` (iOS) and manifest entries (Android).

### Shared building blocks (implemented)

| Piece | File (frontend `src/`) | Use |
|---|---|---|
| `usePermission(type)` | `features/permissions/usePermission.ts` | `status`, `request(action)` (sheet → OS popup → continue / Try again / Open Settings), `requestNow()`, `openSettings()`, `manage()` |
| Flow + status store | `features/permissions/permissionFlow.ts`, `permissions.ts` | One pending request at a time; foreground re-check; session memory of Android "don't ask again" |
| `PermissionSheet` / `PermissionHost` | `components/permissions/` | Pre-permission / denied / blocked sheet; host rendered once in `App.tsx` |
| `PermissionGate` | `components/permissions/PermissionGate.tsx` | Inline gate for an area (camera preview, gallery); Limited Photos **Manage** bar |
| `ActionSheet` | `components/ui/ActionSheet.tsx` | Icon + label rows, `destructive`, optional `title` / `message`, Cancel |
| `ConfirmDialog` | `components/ui/ConfirmDialog.tsx` | Title, message, confirm / cancel, `destructive`, `loading` |
| `Toast` | `components/ui/Toast.tsx` | `useToast().success/error/info(msg)`; above the bottom nav; `ToastHost` in `App.tsx` |
| `EmptyState` | `components/ui/EmptyState.tsx` | Icon, title, subtitle (`text`), optional `actionLabel` + `onAction` |
| `SkeletonLoader` | `components/ui/SkeletonLoader.tsx` | `rect` / `circle` / `line` (`lines`), synced shimmer, off with Reduce Motion |
| Component gallery | `screens/dev/ComponentGalleryScreen.tsx` | `DevComponents`, Settings → Developer (debug builds only); every piece in Light / Dark / any mood |
| Entity cache | `features/entities/entityCache.ts` | TanStack Query `queryClient` (provider in `App.tsx`). One entry per user: `relationship` (`none` · `following` · `requested` · `blocked_by_me` · `blocked_me`), `follows_you`, `is_private`, `muted`; one per post / reel / story: `liked_by_me`, `likes_count`, `saved_by_me`, `comments_count`. Read with `useRelation(id)` / `useEngagement(kind, id, fallback)`; seed with `primeUsers` / `primeEngagement`; `canMessage(rel)`. Cleared on sign-out |
| Optimistic actions | `features/entities/entityActions.ts`, `optimistic.ts` | `followUser`, `unfollowUser`, `cancelFollowRequest`, `blockUser`, `unblockUser`, `setMuted`, `toggleLike`, `toggleSave`, `adjustCommentCount`. Applied at once; on failure rolled back (unless a newer change happened) with an error toast. `followStore`, `postEvents` and `likeSync` write the same cache, so older screens stay in sync |
| `FollowButton` | `components/follows/FollowButton.tsx` | `variant`: `full` (profile, optional Message button beside it), `compact` (pill for Reel / Story headers over media), `row` (lists). Follow (primary) → Following / Requested (outlined). Following → sheet Unfollow / Mute / Cancel (private accounts confirm the unfollow). Requested → "Cancel follow request?". `onMessage` shows Message only when `canMessage`. Hidden when blocked either way |
| `MediaFit` | `components/media/MediaFit.tsx`, `features/media/mediaFit.ts` | Canvas ratio (Stories 9:16, posts any). Within 5% of the ratio → fill; otherwise fit over a blurred copy of the same photo (no black bars, never stretched). Pinch to zoom (1–4×), drag, Fit/Fill toggle; `onChange` gives the transform for export. EXIF-aware size via `useOrientedSize` |
| `FilterEngine` | `features/media/filterEngine.ts` | Skia colour matrices: Normal, Vivid, Warm, Cool, Fade, Noir, Sepia, Dream, Dramatic with intensity 0–100, plus brightness / contrast / saturation / warmth / fade. `lookMatrix(filter, intensity, adjustments)` drives preview and export |
| `FilterStrip` / `FilteredImage` | `components/media/` | Live thumbnails of the current photo per filter; Skia image with a live matrix |
| `bakeImage` | `features/media/bakeImage.ts` | Export: upright JPEG copy (HEIC, EXIF), Skia offscreen render of canvas + blur + transform + matrix, ≤ 1080 px wide, JPEG 0.8, temp file ready for `useMediaUpload()` |
| Uploads | `features/media/useMediaUpload.ts` | S3 presigned POST / multipart with progress, backoff retries, `client_upload_id`, on-disk journal + `resumePending()` after a restart, cancel. See [MEDIA_STORAGE.md](../../architecture/MEDIA_STORAGE.md) |

Animations use React Native `Animated` with the native driver (transform / opacity on the UI thread), like the existing sheets; `react-native-reanimated` is not installed yet.

---

## 2. STORY

### 2.1 Viewer behaviour (Instagram logic) — points 1, 3, 4, 7

**Layout (fullscreen, dark background, 9:16):**
```
┌────────────────────────────┐
│ ▬▬▬▬ ▬▬▬▬ ▬▬▬▬ ▬▬▬▬        │  <- progress bars (top, one per story)
│ (avatar) username · 3h  ⋯ ✕│  <- header
│                            │
│   [ left 30% ] [right 70%] │  <- tap zones
│          MEDIA             │
│                            │
│ [ Send message...   ] ♡  ➤ │  <- bottom: reply, like, share (others)
│ 👁 Views  ♡ Likes     ⋯    │  <- bottom for OWNER only (swipe up = viewers)
└────────────────────────────┘
```

**Progress bars (point 7):** One thin bar per story of that user at the very top. Active bar fills 0->100% over: image = 5s, video = real duration (max 60s). Past bars full, future bars empty. The bar shows exactly when the story ends. Pause the fill while the user holds the screen.

**Tap zones (Instagram logic, point 1):**
- Tap **right 70%** -> next story of the same user; after the last story -> next user's first story; after the last user -> close viewer.
- Tap **left 30%** -> previous story; on the first story of a user -> previous user's last story; on the very first -> restart / stay.
- **Long press** (hold) -> pause story + hide UI; release -> resume.
- **Swipe down** -> close. **Swipe left/right** -> next/previous user (card flip/slide animation).
- Start the viewer on the user's **first unseen** story.
- Mark story as seen when it is shown (`POST /stories/:id/view`, debounced, once per story).
- Preload next 2 media items. Never show a blank frame: show blurred thumbnail then crossfade.

**24-hour rule (point 3):**
- Backend sets `expires_at = created_at + 24h`.
- `GET /stories/tray` and `GET /users/:id/stories` return only `expires_at > now` and not deleted.
- Hourly cron/worker hard-deletes expired stories (soft-delete DB row, delete S3 object after 24h+grace; also add an S3 lifecycle rule on the `stories/` prefix to expire at 2 days as a safety net).
- Client also hides a story locally when `expires_at` passes while viewing (move to next).
- Owner can see expired stories later in **Archive** (optional; only if `archive_stories` is on).
- Post header label: "3h", "23h"; never show "24h+".

**Views, likes, share (point 4):**
- **Like (non-owner):** heart button on bottom bar; tap = like (optimistic, heart pop animation), tap again = unlike. `POST /stories/:id/like` (toggle). Owner gets a notification.
- **Reply:** text input at bottom; sending creates a DM in the conversation (reply card showing the story thumbnail). Keyboard open = story paused.
- **Share (paper-plane):** opens ActionSheet: "Send to…" (multi-select users/conversations -> sends story link card in chat), "Copy link", "Share to…" (system share sheet). Respect `allow_story_sharing` setting of owner; hide share if off. Private account stories can be shared only as an in-app message, not as a public link.
- **Owner view:** bottom shows `👁 N` and `♡ N`. Swipe up or tap opens **Viewers sheet**: list of viewers (avatar, username, time, ♡ if they liked), search, total counts, `Delete`, `Save`, `Share`. Blocked users never appear in viewers.
- Endpoints: `GET /stories/:id/viewers?cursor=`, `POST /stories/:id/like`, `POST /stories/:id/share`.

**Profile page story (point 8):**
- If a user has an active story, profile avatar shows the **gradient ring** (unseen) or **grey ring** (seen). Tapping the avatar opens `StoryViewer` for that user. If no active story, tapping avatar opens profile photo preview.
- Own profile avatar: if no story -> blue `+` badge opens Create Story; if story -> ring + opens viewer.
- Respect privacy: private account stories only for approved followers; blocked users see no ring.
- Stories tray on Home: first item = "Your story" with `+`; then unseen first, seen last.

### 2.2 Create Story — final perfect UI (points 2, 5, 6)

**Step A — Capture / Pick** (`CreateStory` fullscreen)
```
┌────────────────────────────┐
│ ✕                  ⚡  🔄  │  <- close, flash, flip camera
│                            │
│        CAMERA PREVIEW      │
│                            │
│ [Text][Boomerang?]  (modes)│
│ [🖼 gallery]  (◯ shutter)  │  <- tap = photo, hold = video (progress ring, max 60s)
└────────────────────────────┘
```
- Gallery thumbnail (latest photo) bottom-left opens `MediaPicker` grid (Recents, albums, multi-select up to 10 for multiple stories).
- "Text" mode: plain colored/gradient background story with text only.

**Step B — Editor** (`StoryEditor`)
```
┌────────────────────────────┐
│ ✕                          │
│                      Aa    │  <- right-side tool column
│                      ☺     │
│     MEDIA CANVAS     ✎     │
│     (9:16)           ✦     │
│                      ♪     │
│                      ⋯     │
│ [Your story ▾] [Close Friends] [Share ➤] │
└────────────────────────────┘
```
Tools (every button must open something real; list for Cursor):
| Button | Function |
|---|---|
| **Aa Text** | Add text. Keyboard opens, top has: font styles (Classic, Modern, Neon, Typewriter, Strong), text alignment (left/center/right), text background toggle (none / solid / semi-transparent), color row (swatches + eyedropper), size slider on the left side. Drag to move, pinch to scale, two-finger rotate, tap to re-edit. Drag item to trash icon (appears bottom-center) to delete. Texts can be placed anywhere; snap guides at center and safe margins; keep text out of the top 14% and bottom 20% (UI-safe zone) by showing a faint guide. |
| **☺ Stickers** | Sheet with search + tabs: **Mention @user**, **Location**, **Poll**, **Question**, **Emoji slider**, **Time/Date**, **Emoji**, **GIF**. Same drag/pinch/rotate/delete behavior as text. Mention sends a notification and tapping it opens that profile. Poll results visible to owner in viewers sheet; viewers vote with `POST /stories/:id/vote`. |
| **✎ Draw** | Pen, marker, neon, eraser; color row; size slider; undo/redo. |
| **✦ Filters** | Horizontal strip under the canvas with live thumbnails: Normal, Clarendon-like Vivid, Warm, Cool, Fade, Noir (B&W), Sepia, Dream, Dramatic. Swipe left/right on canvas also switches filter. Intensity slider (0–100) on tap of the selected filter. Implement with `react-native-skia` color matrices (apply to both preview and exported image). |
| **♪ Music / Mute** | Mute video audio toggle (music optional later). |
| **⋯ More** | Save to device, Allow sharing on/off, Allow replies (Everyone / Followers / Off), Hide story from (users), Alt text. |
| **Fit / Fill toggle** (tap on the canvas corner icon) | See auto-fit below. |
| **Audience** | "Your story" (everyone who can view) or "Close Friends". |
| **Share ➤** | Exports (burn text/stickers/filters into final JPEG/MP4), uploads to S3 with a progress ring, then `POST /stories`. Show "Sharing…" in the tray with a progress ring and retry on failure; user can leave the screen while it uploads. |

**Auto fit (point 5):** Canvas is always 9:16 (1080×1920).
- Image ratio ≈ 9:16 (±5%) -> fill.
- Otherwise default **Fit (contain)** over a **blurred, scaled copy of the same image** as background (no black bars, nothing cropped).
- User can pinch/drag to zoom/crop manually, or tap the Fit/Fill icon to switch to **Fill (cover)** with center-focused crop.
- Respect EXIF orientation. Large images are downscaled on device before upload. Videos longer than 60s are auto-split into 60s parts.
- Landscape / portrait / square all must look correct without stretching.

**No-glitch checklist for the editor:** keyboard does not shift the canvas; gestures don't conflict with scroll; undo works for drawing; unsaved-changes confirm dialog on ✕ ("Discard story?" Discard / Keep editing); Android back = same dialog; works in Light/Dark/Mood.

### 2.3 Story API summary
`POST /stories` (media_id, type, duration, overlays JSON, audience, settings), `GET /stories/tray`, `GET /users/:id/stories`, `POST /stories/:id/view`, `POST /stories/:id/like`, `POST /stories/:id/vote`, `POST /stories/:id/reply`, `POST /stories/:id/share`, `GET /stories/:id/viewers`, `DELETE /stories/:id`.

---

## 3. REELS (points 8, 9)

**Viewer (fullscreen vertical pager):**
```
┌────────────────────────────┐
│ Reels                  📷  │
│                            │
│          VIDEO             │  ♡ 12.3K
│                            │  💬 340
│ (avatar) username [Follow] │  ➤ Share
│ caption… more              │  🔖 Save
│ ♪ original audio           │  ⋯ More
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ │  <- bottom progress/seek line
└────────────────────────────┘
```
- **Feed:** `GET /reels/feed` returns **randomized public-account reels from all users** (exclude private accounts unless I follow them, exclude blocked/muted users, exclude already-seen where possible, weighted shuffle, cursor paginated). Autoplay the visible reel, preload next one.
- **Play/Pause:** tap on video toggles pause with a brief big play/pause icon; hold = pause; autoplay when 60% visible; pause when app goes background or screen loses focus.
- **Mute:** tap speaker icon (global mute remembered).
- **Bottom progress line (point 8):** thin line at the very bottom showing current time / total duration; drag it (scrub) to seek with time labels `0:12 / 0:45` appearing while scrubbing. Loops at the end.
- **Like:** heart icon + **double-tap anywhere** shows big heart animation and likes (never un-likes on double-tap). Count formatting 1.2K / 3.4M. Optimistic.
- **Comment:** opens comments bottom sheet (pagination, reply, delete own, like comment). Hidden if owner turned off comments (icon shows "Comments are turned off").
- **Share:** ActionSheet: Send in chat (multi-select), Copy link, Share via…, Add to story (optional).
- **Follow icon:** small `Follow` pill next to username (not shown for own reels or already following). Tap -> follows (private account -> becomes `Requested`). Updates everywhere instantly via shared cache.
- **Save reel:** `POST /reels/:id/save` toggle; list under Profile -> Saved.
- **More (⋯) menu** — non-owner: Report (reasons sheet), Not interested, Hide, Mute user, Block user, Copy link. **Owner:** Edit caption, **Hide like count**, **Turn off commenting**, Delete, Share, Copy link, Save.
- **Hide like count:** owner toggle; others see no count (just "Liked by …" hidden); owner still sees real count.
- **Turn off comments:** owner toggle; comment icon disabled for others.
- **Report:** `POST /reports` with reason (Spam, Nudity, Hate, Violence, Self-harm, Scam, False info, Other) -> toast "Thanks for letting us know", content hidden for that user.

**Reels in profile (point 9):**
- Profile -> Reels tab shows a **grid (3 columns, 9:16 thumbnails with play count)** of only that user's reels, newest first.
- Tapping a reel opens a **vertical pager scoped to that user's reels** (`GET /users/:id/reels?cursor=`), starting at the tapped reel, then **continuing linearly (next older reel)**. **No random reels** in this mode. Back returns to the same grid scroll position.
- Reel respects privacy: private account's reels visible only to approved followers.

---

## 4. POST (points 10, 11, 17)

### 4.1 Create Post — new clean UI (point 10)
Flow: **Pick -> Crop/Edit -> Details -> Share** (matches INSTAGRAM_CONTENT_UX.md).

**Step 1 Pick** (permission gate first)
```
┌────────────────────────────┐
│ ✕   New post          Next │
│ ┌────────────────────────┐ │
│ │     PREVIEW (1:1/4:5)  │ │
│ └────────────────────────┘ │
│ Recents ▾        [▣ multi] │
│ ▢ ▢ ▢ ▢   (gallery grid)   │
└────────────────────────────┘
```
- Select up to 10 (multi-select shows numbered badges). Aspect toggle: Original / 1:1 / 4:5 / 16:9 with pinch-zoom and drag; **auto-fit** like the story rule (never stretch).
- Camera tile at the start of the grid.

**Step 2 Edit:** Filters strip (same filter engine as stories) + Adjust (brightness, contrast, saturation, warmth, crop/rotate). Thumbnails of all images at the bottom for multi-image posts; reorder by drag.

**Step 3 Details**
```
┌────────────────────────────┐
│ ←   New post         Share │
│ [thumb] Write a caption…   │
│ ────────────────────────── │
│ 🏷 Tag people              │
│ 📍 Add location            │
│ 🎵 Add music (optional)    │
│ ────────────────────────── │
│ Advanced settings ›        │  <- Hide like count, Turn off commenting, Alt text
└────────────────────────────┘
```
- Caption (2200 chars, @mention and #hashtag suggestions, counter), location search, tag people, alt text per image, **Hide like count** toggle, **Turn off commenting** toggle.
- **Share** uploads all images to S3 in parallel with one progress bar, then `POST /posts` with `client_upload_id` (idempotent). Posting continues in the background; show an "Uploading…" banner on Home/Profile; retry on failure. Discard dialog on back.

### 4.2 Post feed on profile (point 11)
- Profile -> Posts grid (3 columns, square thumbnails, multi-image icon).
- Tap a post -> opens `ProfilePostsFeed`: a **vertical scrolling list of the same user's posts (PostCard), scrolled to the tapped post**, and the user can **keep scrolling down to older posts and up to newer posts** (Instagram behavior). Not a single-post screen. Header says "Posts" + username. Cursor pagination both directions, scroll position restored on back.
- Same for Saved posts and Hashtag feed (scoped lists).

### 4.3 Post three-dot menu (point 17)
**Owner menu:**
1. Edit (caption, location, tagged people, alt text)
2. **Turn off commenting / Turn on commenting**
3. **Hide like count / Show like count**
4. Pin to profile (optional)
5. Archive / Unarchive (hide from profile without deleting)
6. Share, Copy link
7. Delete (confirm dialog; soft delete)

**Other user's menu:** Save/Unsave, Share, Copy link, Follow/Unfollow, Mute user, **Report**, **Block**, Not interested.
Menu is one reusable `PostActionSheet` driven by `isOwner` + settings. Changes are optimistic and update feed, profile and detail instantly. `PATCH /posts/:id` accepts `caption, location, alt_text, comments_disabled, hide_like_count, archived`.

> Note: point 17 said "Blocked user ne…". I interpreted it as the post **owner's** menu. If you meant something different, tell the agent before implementing.

---

## 5. PUBLIC vs PRIVATE ACCOUNT — complete flow (points 12–15)

**Relationship states between viewer V and target T:** `none`, `following`, `requested`, `blocked_by_me`, `blocked_me`. Compute on the server and return as `relationship` in every user payload. Follower counts are **only incremented when a follow becomes active** (never on a pending request).

| Action | Public account | Private account |
|---|---|---|
| View profile header (avatar, bio, counts) | Yes | Yes (basic info only) |
| View posts / reels / stories | Yes | **Only if `following` (accepted)**; otherwise "This account is private" lock screen + Follow button |
| Follow button | Tap -> instantly `Following`, follower count +1 | Tap -> `Requested`, **count does not change**; T gets a notification + entry in Follow Requests |
| Unfollow | Instant | Instant; must request again |
| Cancel request | n/a | Tap `Requested` -> confirm -> back to `Follow` |
| Message | **Anyone can open chat** (unless blocked) | Allowed **only if either user follows the other** (accepted). Otherwise the Message button is hidden/disabled with hint "Follow to message" |
| Appears in followers/following lists | Yes | Only visible to approved followers |
| Reels in global feed | Yes | **No** (only to approved followers in their own feed) |
| Hashtag / Explore / Search results content | Yes | No content (user may appear in search as a name) |
| Tagging / mention | Anyone | Anyone (notification only) |

**Accept / Decline (T side):**
- `Follow Requests` screen: Confirm / Delete. **Confirm** -> relationship becomes `following`, V's following +1, T's followers +1, notification to V ("T accepted your request"). **Delete** -> request removed, no notification.
- Until accepted, V is **not** in T's followers list and counts stay unchanged (point 14).
- Switching account **private -> public:** all pending requests auto-accept (confirm dialog first). **public -> private:** existing followers stay; new followers need approval; content stops appearing in public feeds/Explore/global reels immediately.
- "Remove follower" available on T's followers list.

**Message rules enforced on the server (not only UI):** `POST /conversations` returns `403 MESSAGING_NOT_ALLOWED` when T is private and no follow relation exists either way, or when blocked. Existing conversations stay but the composer is disabled if a block happens.

**Single source of truth:** one `relationship` field + a shared `FollowButton` component with state machine: `Follow -> (public) Following | (private) Requested`, `Following -> Follow`, `Requested -> Follow`.

---

## 6. BLOCK USER (point 16)
When A blocks B, **neither sees anything of the other**:
- Profile of the other shows "User not found" (deep link also).
- Hidden from: feed, explore, search, suggestions, hashtag feeds, reels feed, stories tray, story viewers, comments (hidden both ways), likes list, followers/following lists, mentions, tags, notifications, DM inbox (conversation hidden; composer disabled if opened via old link).
- Existing follow relationships are removed in both directions; pending requests cancelled.
- Block/Unblock from profile ⋯ menu and Settings -> Blocked accounts. Unblocking does **not** restore follows.
- Server filters via one reusable `excludeBlocked(viewerId)` helper used in **every** query (feed, search, comments, reels, stories, notifications, conversations). Add tests.

---

## 7. AWS S3 media (all features)
- Prefixes: `posts/`, `reels/`, `stories/`, `avatars/`, `thumbs/`.
- Flow: `POST /media/uploads` (type, size, content_type) -> presigned POST -> upload from device with progress -> `POST /media/:id/complete` (server verifies object exists, size, mime) -> entity created with `media_id`.
- Generate thumbnails (images: 320/640/1080 widths; videos: poster frame) via Lambda or a server worker; serve through CloudFront with signed URLs for private accounts' media.
- Limits: image ≤ 10 MB after compression, video ≤ 100 MB; allowed types jpeg/png/webp/heic->jpeg, mp4/mov.
- Stories get an S3 lifecycle rule (expire 2 days). Deleted entities delete S3 objects asynchronously.
- Retry with exponential backoff, resume on app restart (`client_upload_id`).

---

## 8. CURSOR PROMPTS (give them in this exact order, one per message)

Each prompt below starts with this common header, which you paste once at the start of the chat:

```
Read @documentation/AGENTS.md, @documentation/architecture/MOBILE_APP.md, @documentation/architecture/THEMING.md, @documentation/architecture/MEDIA_STORAGE.md and @documentation/modules/content-flow/NEXITY_CONTENT_SOCIAL_FLOW.md fully before coding. The web prototype in D:\Nexity\prototype (index.html, css/, js/) is a visual/behavior reference only: match its colors, spacing, copy and flow but write native React Native code. Use only theme tokens (Light, Dark and all mood themes), no hard-coded colors, buttons keep their design. Build reusable components, follow the module docs, work on both Android and iOS, and update the docs in the same change if anything diverges. When finished, list what you tested and any gaps.
```

**Prompt 1 — Foundations**
```
1. Create the reusable PermissionGate component and usePermission(type) hook (camera, photos, microphone, notifications) using react-native-permissions, exactly as section 1 of the content-flow doc: our pre-permission sheet first, then the OS popup, then granted/denied/blocked states with an "Open Settings" button, re-check on app foreground, iOS Limited Photos and Android 13+ media permissions. Add the iOS Info.plist strings and Android manifest entries.
2. Create reusable ActionSheet, ConfirmDialog, Toast, EmptyState and SkeletonLoader components that use theme tokens.
3. Create a shared relationship cache (TanStack Query) so follow/like/save/block changes update every screen instantly with optimistic updates and rollback.
4. Create the reusable FollowButton with the state machine Follow / Requested / Following and a Message button rule from section 5.
5. Confirm useMediaUpload() uploads to S3 with progress, retry and client_upload_id; create MediaFit (auto-fit: contain over blurred background, fill, pinch/drag crop, EXIF orientation, downscale to 1080px) and a shared FilterEngine (react-native-skia color matrices: Normal, Vivid, Warm, Cool, Fade, Noir, Sepia, Dream, Dramatic with intensity slider).
```

**Prompt 2 — Backend privacy + block**
```
In D:\Nexity\backend implement section 5 and 6 of the content-flow doc:
1. A relationship service returning none/following/requested/blocked_by_me/blocked_me and include `relationship` in every user payload.
2. Follow logic: public = instant follow, private = pending request; follower/following counts change only when a follow becomes active. Accept/Decline endpoints, cancel request, remove follower, private<->public switch behavior (auto-accept pending when going public).
3. Enforce messaging rules on the server: POST /conversations returns 403 MESSAGING_NOT_ALLOWED for private accounts without a follow relation either way, and when blocked.
4. Enforce content visibility: private account posts/reels/stories only for approved followers; excluded from Explore, hashtag feeds and global reels feed.
5. Implement the reusable excludeBlocked(viewerId) helper and apply it to feed, explore, search, suggestions, hashtags, reels, stories tray, story viewers, comments, likes, followers/following, mentions, notifications and conversations. Block removes follows both ways. Add Zod validation and automated tests for every rule.
```

**Prompt 3 — Story viewer**
```
Implement the StoryViewer exactly per section 2.1: fullscreen modal, one progress bar per story at the very top (image 5s, video real duration, pause on hold), tap right 70% = next story/next user/close, tap left 30% = previous story/previous user, long press = pause + hide UI, swipe down = close, swipe left/right = switch user with a smooth animation, start at the first unseen story, mark seen once per story, preload the next 2 items with blurred thumbnail placeholders (no blank frames). Header: avatar, username, time ago (never above 23h), ⋯ menu, close. Bottom for others: reply input (pauses story, creates a DM with story card), like heart (optimistic, POST /stories/:id/like), share (send to chat multi-select, copy link, system share; respect owner's allow-sharing). Bottom for owner: views count + likes count, swipe-up Viewers sheet (GET /stories/:id/viewers with likes, no blocked users), delete/save/share. Backend: add expires_at = created_at + 24h, filter expired stories in every query, hourly cleanup job, S3 lifecycle rule for stories/ prefix, and the like/viewers/share endpoints. Also show the story ring on Avatar everywhere (Home tray, profile, search): gradient unseen, grey seen, tapping a profile avatar with an active story opens the viewer, own profile shows a + badge when no story. Respect private-account and block rules.
```

**Prompt 4 — Story creator**
```
Implement CreateStory (fullscreen) and StoryEditor per section 2.2 with final polished UI: camera screen (tap = photo, hold = video with progress ring up to 60s, flash, flip, gallery thumbnail, text-only mode), gallery MediaPicker with multi-select up to 10, and the editor with a right-side tool column: Aa Text (font styles Classic/Modern/Neon/Typewriter/Strong, alignment, background toggle, color swatches + eyedropper, size slider on the left, drag/pinch/rotate, tap to edit, drag to trash, snap guides, UI-safe zones), Stickers sheet (Mention, Location, Poll, Question, Emoji slider, Time, Emoji, GIF), Draw (pen/marker/neon/eraser, colors, size, undo/redo), Filters strip with live thumbnails and intensity slider (swipe canvas also changes filter), Mute, More (save to device, allow sharing, allow replies, hide from, alt text), Fit/Fill toggle, audience (Your story / Close Friends) and Share. Use MediaFit so every image/video auto-fits 9:16 without stretching or black bars. Export burns overlays + filters into the final media, upload to S3 with a progress ring, create via POST /stories, continue uploading in the background with an "Uploading…" ring in the tray and retry on failure. Add a discard confirm dialog for ✕ and Android back. Mention each button and what it does in the PR description with screenshots.
```

**Prompt 5 — Reels**
```
Implement the Reels tab, ReelItem and the reel creation flow per section 3: vertical pager with autoplay at 60% visibility, preload next reel, pause on background/blur, tap = play/pause with big icon, hold = pause, mute toggle remembered, thin seekable progress line at the very bottom with current/total time while scrubbing and loop at end, like button + double-tap big heart (never un-likes), comments bottom sheet, share action sheet (send in chat, copy link, share via), Follow pill next to username (hidden for own/already following, respects private -> Requested), save toggle, ⋯ menu (non-owner: Report with reasons, Not interested, Hide, Mute, Block, Copy link; owner: Edit caption, Hide like count, Turn off commenting, Delete, Share, Copy link). Backend: GET /reels/feed returns randomized (weighted shuffle, cursor-paged) reels from public accounts of all users, excluding blocked/muted users and private accounts the viewer doesn't follow; implement hide-like-count and comments-disabled flags, POST /reels/:id/save, POST /reports. Profile Reels tab: 3-column 9:16 grid of that user's reels only; tapping opens a vertical pager scoped to that user via GET /users/:id/reels, starting at the tapped reel and continuing linearly with no random reels; back restores the grid scroll position.
```

**Prompt 6 — Post create + profile feed + menu**
```
Redesign Create Post with a clean, attractive UI per section 4.1: Pick (gallery grid with camera tile, big preview, 1:1 / 4:5 / 16:9 / Original, multi-select up to 10 with numbered badges, pinch/drag, auto-fit via MediaFit), Edit (shared FilterEngine + brightness/contrast/saturation/warmth/crop/rotate, reorder thumbnails by drag), Details (caption 2200 with @ and # suggestions, tag people, location, alt text, Hide like count, Turn off commenting), Share with parallel S3 uploads and one progress bar, background upload banner, retry, idempotent client_upload_id and a discard dialog. Then implement ProfilePostsFeed per section 4.2: tapping a profile grid post opens a vertical scrolling list of that user's posts positioned at the tapped post, scrollable up and down with cursor pagination both directions and restored scroll position (same for Saved and Hashtag feeds). Then build one reusable PostActionSheet per section 4.3 driven by isOwner and settings: owner = Edit, Turn on/off commenting, Show/Hide like count, Pin, Archive, Share, Copy link, Delete; others = Save, Share, Copy link, Follow/Unfollow, Mute, Report, Block, Not interested. Support PATCH /posts/:id for caption, location, alt_text, comments_disabled, hide_like_count, archived with optimistic UI everywhere.
```

**Prompt 7 — Public/private end-to-end wiring**
```
Wire the public/private flow end to end on the frontend per section 5 using the shared FollowButton and relationship cache: profile screen states (public full view; private lock screen "This account is private" until accepted), Follow -> Requested for private with no follower count change, cancel request, Follow Requests screen (Confirm/Delete with count badges and notifications), Message button visible only if allowed (public, or either follows the other), disabled composer if blocked, private->public auto-accept dialog, remove follower, and block behavior from section 6 (blocked profile = "User not found", hidden everywhere). Then write an end-to-end test checklist covering every row of the section 5 table and run it on Android and iOS.
```

**Prompt 8 — Final audit**
```
Audit the whole implementation against NEXITY_CONTENT_SOCIAL_FLOW.md and the acceptance criteria in MOBILE_APP.md. List every gap (safe areas, keyboard, Android back, permissions, offline, accessibility, theme tokens in Light/Dark/every mood, performance, glitches) and fix them. Update INDEX.md, API_QUICK_REFERENCE.md and the module docs for any new screen, deep link or endpoint in the same change.
```

---

## 9. Final QA checklist (tick everything before release)
- [ ] Story: right tap next, left tap previous, hold pause, swipe down close, progress bars exact, auto-advance across users
- [ ] Story disappears after 24h everywhere (tray, profile, viewer) and S3 object removed
- [ ] Story views, likes, viewers list, share to chat work; blocked users hidden
- [ ] Story editor: every tool works, text positioning/pinch/rotate, filters, fit/fill, no glitches, background upload
- [ ] Profile avatar ring + opening story works (own and others)
- [ ] Reels: random public feed, double-tap like, follow pill, comment, share, save, hide like, turn off comments, report, bottom progress seek
- [ ] Profile Reels: only that user's reels, linear order
- [ ] Profile Posts: tapped post opens scrollable list, not a single post
- [ ] Post menu differs correctly for owner vs others, edits update instantly
- [ ] Public: follow instant, chat allowed; Private: request pending, count unchanged, chat only with follow relation, content locked until accepted
- [ ] Block: nothing of the blocked user visible anywhere, both directions
- [ ] Permission flow: pre-sheet -> OS popup -> granted/denied/blocked -> Open Settings
- [ ] All media via S3 presigned upload, thumbnails served via CDN
- [ ] Light, Dark and every mood theme pass on all new screens