# Create post

**Screens:** `CreatePostCrop` (fullscreen modal; opens on the in-app camera with a recent-photos strip and Post / Reel tabs, like the prototype) → `CreatePostDetails`  
**Deep link:** `nexity://create/post`  
**Theme:** Dark & light on all steps; crop canvas background uses `background` token — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**UX reference:** [INSTAGRAM_CONTENT_UX.md](../../architecture/INSTAGRAM_CONTENT_UX.md) — Posts  
**Media:** [MEDIA_STORAGE.md](../../architecture/MEDIA_STORAGE.md) · **Platform:** [MOBILE_APP.md](../../architecture/MOBILE_APP.md#media-capture-pick-play)

## Purpose

Instagram-style new post: select media → crop/aspect, adjust and carousel order → description, tagged people, location → share.

Opened from the **Create (+)** tab sheet → **Post**.

## Implementation status

What the app does today:

- **Entry:** Create (+) sheet → **Post**, or **Create a post** on the empty Home feed. It opens on a **full-screen camera** (close, flash, switch camera, shutter, Post / Reel tabs). The camera and photo permissions show the phone's own dialog directly; only a permanently blocked permission shows an Open Settings prompt.
- **Gallery:** the thumbnail button in the camera opens the in-app **recent media** grid (`@react-native-camera-roll/camera-roll`, newest first, paged). Multi-select, up to **20** photos or videos (`MAX_ITEMS.post`). Videos show their length; videos over **2 minutes** are dimmed and tapping one explains the limit. The device and the API both refuse longer videos.
- **`CreatePostCrop`:** full-width preview at the top in the chosen frame (**1:1 · 4:5 · 16:9 · Original**), pinch / drag to crop photos, `n/total` counter. Below it a horizontally scrolling strip of selected items that fits the screen width: tap to view, **✕** to remove, long-press to reorder, **+** to add more from the gallery. **Adjust** has icon chips (brightness, contrast, saturation, warmth, fade, sharpen, blur, vignette), one slider, and **Reset all**; values are saved on the post as `adjustments` and replayed in the feed. There are no named filters.
- **`CreatePostDetails`:** full-width preview of the post at the top (swipe for a carousel). Description with `@mention` autocomplete: typing `@` lists up to **5** people. There are no hashtags. **Location** shows the chosen place under the row with edit and remove. **Tag people** opens a multi-select list (max 20); tagged people show as chips with **✕**. **Hide like count** and **Turn off commenting** are labelled ON / OFF switches. There is no music and no audience picker (a post follows the account's privacy).
- **Share:** the flow closes at once and Home shows a **Posting…** bar with progress. Media goes straight from the device to **AWS S3** through `uploadMedia` (3 at a time, resumable), then `POST /posts` with a `client_upload_id`. Failure → **Retry** or **Discard**.
- **Drafts:** leaving the flow offers **Save draft**; it is offered again as **Continue your draft**.
- **After sharing:** the owner's ••• sheet on the post has **Hide / Show like count**, **Turn comments off / on**, **Edit description** and **Delete** (with confirmation). See [post-detail.md](post-detail.md).
## UI (Instagram parity)

### Step 1 — Select (`CreatePostSelect`)

- Top half: large preview of the selected item. Bottom half: device gallery grid (`@react-native-camera-roll/camera-roll`), newest first, album switcher ("Recents ▾").
- **Select multiple** toggle: up to **10 images** OR **1 video** (never mixed); numbered badges show carousel order.
- Camera tile/button → capture a photo in-app (`react-native-vision-camera`).
- **Permissions:** request photo library access on first open.
  - iOS **Limited** access: show "Manage" banner to pick more photos (`openLimitedPhotoLibraryPicker`).
  - Denied: empty state with **Open Settings**.
  - Android 14+: partial access ("Selected photos") handled the same way.
- iCloud-only photos (iOS) download with a spinner before preview.
- Header: ✕ (close, confirm discard if anything selected) and **Next**.

### Step 2 — Crop / carousel (`CreatePostCrop`)

- Per-item aspect: Original, 1:1, 4:5, 16:9; pinch-zoom and pan inside the crop frame (gesture handler + Reanimated).
- Carousel filmstrip: long-press and drag thumbnails to reorder.
- Video: trim start/end (optional v3; store `trim_start_ms` / `trim_end_ms`, applied by Cloudinary).

### Step 3 — Details (`CreatePostDetails`)

- Caption (2200 max) with `@mention` highlighting and an autocomplete list of up to 5 people. No hashtags.
- **Tag people** (search followers/usernames, pin on image optional Phase 2).
- **Add location** opens with suggested places. Search filters that list and places already used on posts. A name that matches nothing can still be used as typed.
- **Alt text** per image (accessibility — IG parity; read by VoiceOver/TalkBack).
- Advanced (optional): hide like count, turn off commenting.
- Primary: **Share** (header right).

### Drafts

- Leaving the flow with media selected → action sheet **Save draft** / **Discard**.
- Drafts saved to AsyncStorage key `nexity.draft.post` (local media URIs, crop, caption). Reopening Create Post offers "Continue draft".

## Cloudinary upload (from the device)

On **Share**, close the modal immediately, return to Home, and show the "Posting…" progress bar at the top of the feed. For each local file (in parallel, max 3 at a time):

1. Resize/compress images on device (max 1440 px, JPEG, HEIC → JPEG). Up to **20** photos/videos per post; each video up to **2 minutes**. See the limits table in [MEDIA_STORAGE.md](../../architecture/MEDIA_STORAGE.md).
2. `POST /api/v1/media/cloudinary-sign` with `{ "purpose": "post", "resource_type": "image"|"video" }`.
3. Upload the file URI to Cloudinary with the returned signature (chunked for large video).
4. `POST /api/v1/media/confirm` with Cloudinary response fields → collect `media_id`s **in carousel order**.
5. `POST /api/v1/posts`.

Failure: progress bar shows **Retry** / **Discard**; the draft is kept until success.

## API

### `POST /api/v1/posts`

**Body:**

```json
{
  "caption": "Sunset with @ann",
  "media_ids": ["uuid-1", "uuid-2"],
  "visibility": "public",
  "location_name": "Goa",
  "alt_texts": ["Sunset over beach", "Friends at shore"],
  "tagged_user_ids": ["uuid-a"],
  "hide_like_count": false,
  "comments_disabled": false,
  "client_upload_id": "uuid-generated-on-device"
}
```

`client_upload_id` makes the request idempotent: a retry after a timeout returns the same post instead of creating a duplicate.

> Implemented body: `media_ids` (1–20 ready `post` uploads owned by the author, carousel order, no duplicates), `caption` (≤ 2200, trimmed), `alt_texts` (by index, ≤ 100 each), `location_name` (≤ 100), `aspect_ratio` (0.8–1.91, default 1), `hide_like_count`, `comments_disabled`, `client_upload_id` (`[\w-]{8,64}`). `location_lat` / `location_lng`, `adjustments`, `tagged_user_ids` (max 20, existing accounts). `visibility` is not accepted. Mentions are parsed from the caption on the server and keep only existing accounts; hashtags are not parsed.
>
> **Errors:** `400 VALIDATION_ERROR`, `400 INVALID_MEDIA` (missing, not ready, not yours or not a post upload), `400 TOO_MANY_MENTIONS` (> 20), `409 MEDIA_IN_USE` (already in a post). Rate limit: 60 posts / 15 min per account.
>
> **Response** (`201`, or `200` for a repeated `client_upload_id`): `{ id, author: UserSummary, media: [{ id, kind, url, width, height, alt_text }], caption, mentions, tagged_users, location_name, aspect_ratio, likes_count (null for everyone, owner included, when hidden), comments_count, hide_like_count, comments_disabled, is_owner, created_at, updated_at }`. `GET /posts/:id` returns the same shape; private authors return `403 PRIVATE_ACCOUNT` to non-followers.

**Success `201`:** full post → insert at the top of Home feed and the profile grid, toast "Your post has been shared" (IG lands on feed).

## Validation

- At least one confirmed Cloudinary `media_id`.
- Photos up to **10 MB** and videos up to **200 MB** and **2 minutes**. Images are resized and videos compressed on the device first; the size is checked on the compressed file before upload and again by the API and S3 (`MEDIA_TOO_LARGE`). See [TECH_STACK.md](../../architecture/TECH_STACK.md#media-limits-default).

## Acceptance criteria

- [ ] Flow matches IG step order and cannot skip crop with invalid aspect.
- [ ] Carousel order in API matches UI filmstrip order.
- [ ] Failed Cloudinary upload aborts share; no orphan post row; draft kept for retry.
- [ ] Alt text stored per carousel index.
- [ ] Works with iOS Limited Photos access and Android 14 partial access.
- [ ] Android back steps back through the wizard; on step 1 it asks to discard.
- [ ] HEIC photos from iPhone upload and display correctly on Android.

## Cursor checklist

- [ ] `CreatePostStack` screens + shared `useCloudinaryUpload()` hook
- [ ] Gallery grid component reusable for reels, stories, avatar
- [ ] Feed card uses `delivery_url` transformations from API
