# Create reel

**Screens:** `CreateReelStack` (fullscreen modal) → `CreateReelVideo` → `CreateReelEdit` → `CreateReelDetails`  
**Deep link:** `nexity://create/reel`  
**Theme:** Video/trim/cover steps always dark; details step follows dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**UX reference:** [INSTAGRAM_CONTENT_UX.md](../../architecture/INSTAGRAM_CONTENT_UX.md) — Reels  
**Media:** [CLOUDINARY.md](../../architecture/CLOUDINARY.md) · **Platform:** [MOBILE_APP.md](../../architecture/MOBILE_APP.md#media-capture-pick-play)

## Purpose

Instagram-style Reels publish flow: video → trim/cover → caption & tags → share.

Opened from the **Create (+)** tab sheet → **Reel**, or the camera icon on the Reels tab.

## UI steps (IG order)

1. **Video (`CreateReelVideo`)** — fullscreen camera (`react-native-vision-camera`) with record button (hold or tap), front/back flip, flash, 15 / 30 / 60 / 90 s length selector; gallery thumbnail bottom-left opens videos-only picker. Max **90 seconds**.
   - Permissions: camera + microphone requested when this screen opens; photo library when the gallery is opened. Denied → explainer with **Open Settings**.
2. **Edit (`CreateReelEdit`)** — trim timeline with frame thumbnails; scrub **cover photo** (frame) or pick a cover image from the gallery. Preview loops.
3. **Details (`CreateReelDetails`)** — cover preview, caption, tag people, location, visibility.
4. **Share** — dismiss the modal, show "Posting…" progress on Home / Reels, upload in the foreground, then create the reel.

Leaving with a recorded/selected video → **Save draft** / **Discard** (draft in AsyncStorage `nexity.draft.reel`).

## Cloudinary

1. Check duration (≤ 90 s) and size (≤ 100 MB) on the device.
2. Sign + upload **main video** (`purpose: "reel"`, `resource_type: "video"`) — chunked upload for files > 20 MB.
3. Confirm → `video_media_id`.
4. Cover: either a frame offset (server generates thumbnail with `so_<seconds>`) OR upload cover image (`purpose: "reel"`, image) → `thumbnail_media_id`.

Wait for `media.status === "ready"` if video processing is async (poll `GET /media/:mediaId`).

## API

### `POST /api/v1/reels`

**Body:**

```json
{
  "video_media_id": "uuid",
  "thumbnail_media_id": "uuid",
  "cover_frame_ms": null,
  "trim_start_ms": 0,
  "trim_end_ms": 15000,
  "caption": "Dance #reels",
  "visibility": "public",
  "duration_ms": 15000,
  "tagged_user_ids": [],
  "location_name": null,
  "client_upload_id": "uuid-generated-on-device"
}
```

**Success `201`:** toast "Your reel has been shared" with **View** → `ReelDetail`.

## Acceptance criteria

- [ ] Reject video > 90 s before upload.
- [ ] Recording works with front and back camera on iOS and Android; audio is recorded.
- [ ] Cover visible on profile reels grid (3-column).
- [ ] Viewer uses Cloudinary streaming URL for playback.
- [ ] Killing the app mid-upload keeps the draft for retry.

## Cursor checklist

- [ ] Reuse `useCloudinaryUpload()` from posts with `purpose: reel`
- [ ] Processing state on the "Posting…" bar until video ready
