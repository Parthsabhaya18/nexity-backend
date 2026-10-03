# Create post

**Screens:** `CreatePostStack` (fullscreen modal) → `CreatePostSelect` → `CreatePostCrop` → `CreatePostDetails`  
**Deep link:** `nexity://create/post`  
**Theme:** Dark & light on all steps; crop canvas background uses `background` token — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**UX reference:** [INSTAGRAM_CONTENT_UX.md](../../architecture/INSTAGRAM_CONTENT_UX.md) — Posts  
**Media:** [CLOUDINARY.md](../../architecture/CLOUDINARY.md) · **Platform:** [MOBILE_APP.md](../../architecture/MOBILE_APP.md#media-capture-pick-play)

## Purpose

Instagram-style new post: select media → crop/aspect & carousel order → caption, tags, location, alt text → share.

Opened from the **Create (+)** tab sheet → **Post**.

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

- Caption (2200 max) with `#hashtag` and `@mention` highlighting and autocomplete list above the keyboard.
- **Tag people** (search followers/usernames, pin on image optional Phase 2).
- **Add location** (search by name; optional "Use current location" asks location permission).
- **Alt text** per image (accessibility — IG parity; read by VoiceOver/TalkBack).
- Audience: Public / Followers / Close friends.
- Advanced (optional): hide like count, turn off commenting.
- Primary: **Share** (header right).

### Drafts

- Leaving the flow with media selected → action sheet **Save draft** / **Discard**.
- Drafts saved to AsyncStorage key `nexity.draft.post` (local media URIs, crop, caption). Reopening Create Post offers "Continue draft".

## Cloudinary upload (from the device)

On **Share**, close the modal immediately, return to Home, and show the "Posting…" progress bar at the top of the feed. For each local file (in parallel, max 3 at a time):

1. Resize/compress images on device (max 2048 px, JPEG, HEIC → JPEG).
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
  "caption": "Sunset #travel",
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

**Success `201`:** full post → insert at the top of Home feed and the profile grid, toast "Your post has been shared" (IG lands on feed).

## Validation

- At least one confirmed Cloudinary `media_id`.
- Video max **10 min / 100 MB**; images max **10 MB** each — check on device before upload, and enforce at sign.

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
