# Edit reel

**Screen:** `EditReel` (modal, from reel ••• → Edit)  
**Deep link:** none  
**Theme:** Dark & light form; video preview area always dark — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes (author only)  
**UX reference:** [INSTAGRAM_CONTENT_UX.md](../../architecture/INSTAGRAM_CONTENT_UX.md) — Reels edit

## Purpose

Match Instagram reel edit: caption, cover thumbnail, tags, location — **not** replace video.

## UI

- Header: **Cancel**, "Edit reel", **Save**.
- Read-only looping video preview (`react-native-video`, muted).
- **Edit cover** — scrub the video for a frame OR pick a new cover image from the gallery (Cloudinary sign → upload → confirm → new `thumbnail_media_id`).
- Caption, tag people, location fields same as `CreateReelDetails`.
- Cancel with changes → "Discard changes?".

## API

### `PATCH /api/v1/reels/:reelId`

**Body:**

```json
{
  "caption": "Updated",
  "thumbnail_media_id": "uuid",
  "cover_frame_ms": null,
  "tagged_user_ids": ["uuid"],
  "location_name": "Mumbai"
}
```

**Rejected:** `video_media_id` change → `400 MEDIA_CHANGE_NOT_ALLOWED`

**Success `200`:** updated reel with `is_edited: true`

## Acceptance criteria

- [ ] Profile grid cover updates after cover change (cache invalidated).
- [ ] Non-owner 403.
