# Create story

**Screen:** `CreateStory` (fullscreen modal; opens straight into the camera)  
**Deep link:** `nexity://create/story`  
**Theme:** Always dark (camera + story editor) — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**UX reference:** [INSTAGRAM_CONTENT_UX.md](../../architecture/INSTAGRAM_CONTENT_UX.md) — Stories  
**Media:** [CLOUDINARY.md](../../architecture/CLOUDINARY.md) · **Platform:** [MOBILE_APP.md](../../architecture/MOBILE_APP.md#media-capture-pick-play)

## Purpose

Instagram-style story: capture or upload one image/video, optional simple overlays, share for 24h.

Opened from the **Create (+)** sheet → **Story**, or the **Your story** "+" in the tray.

## UI

1. **Camera** (`react-native-vision-camera`) — tap shutter for photo, **hold** to record video (max 60 s, progress ring), flip camera (double-tap the preview also flips), flash toggle. Bottom-left thumbnail opens the gallery (last 24h items first).
   - Permissions: camera on open; microphone when recording starts; photos when the gallery is opened. Denied → dark explainer with **Open Settings**; gallery still usable if camera is denied.
2. **Editor** — fullscreen preview; tools: Text, Stickers, Draw (Phase 2 OK to stub); **Discard** (✕ with confirm) / **Your story** (share).
3. No multi-slide story album required in v3 (one asset per publish action; user can post again for the next segment).

Constraints:

- Image or video; video max **60 seconds / 50 MB** (checked on device).
- Upload via Cloudinary sign → upload → confirm (`purpose: "story"`).
- Status bar hidden; controls respect top/bottom safe areas.
- Android back: editor → camera → close.

## API

### `POST /api/v1/stories`

**Body:**

```json
{
  "media_id": "uuid",
  "media_type": "image"
}
```

Server sets `expires_at = now + 24 hours`.

**Success `201`:** modal closes immediately after **Your story**; upload continues with a progress ring on your tray avatar; then the tray refreshes with your ring active.

## Edit policy

Instagram does **not** allow editing a live story. Do **not** implement an edit screen or `PATCH /stories/:id`. Delete only ([view-story.md](view-story.md)).

## Acceptance criteria

- [ ] Photo and video capture work on iOS and Android (front + back camera).
- [ ] Story appears in followers' tray with unseen ring.
- [ ] Asset served from Cloudinary with story fullscreen transform.
- [ ] Expired stories removed from API within 1 minute of expiry.
