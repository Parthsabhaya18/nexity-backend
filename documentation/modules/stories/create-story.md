# Create story

**Screen:** `CreateStory` (fullscreen; opens on the in-app camera, like the prototype)  
**Deep link:** `nexity://create/story`  
**Theme:** Always dark (camera + story editor) — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**UX reference:** [INSTAGRAM_CONTENT_UX.md](../../architecture/INSTAGRAM_CONTENT_UX.md) — Stories  
**Media:** [MEDIA_STORAGE.md](../../architecture/MEDIA_STORAGE.md) · **Platform:** [MOBILE_APP.md](../../architecture/MOBILE_APP.md#media-capture-pick-play)

## Purpose

Instagram-style story: capture or upload one image/video, optional simple overlays, share for 24h.

Opened from the **Create (+)** sheet → **Story**, or the **Your story** "+" in the tray.

The screen opens on a **full-screen camera** (tap for a photo, hold to record, flash, switch camera) with a gallery button that opens the in-app recent media grid. Permission requests show the phone's own dialog directly. After picking, a full-screen preview offers the overlay tools, **Location** (a pill on the story, removable) and **Tag people** (adds mention stickers). **Your story** uploads straight to S3 with a progress percentage and can be cancelled; leaving mid-upload asks first. Share can include a place (`location_name` plus `location_lat` / `location_lng` when the map search returns coordinates) and up to 12 overlays. There is no music and no named colour filter. Text and mention stickers can be dragged. Overlays are text, emoji stickers, drawing, poll, question, quiz, countdown, link and mention (old stories may still carry a hashtag overlay, which is drawn as text). They are stored with the story and drawn again for every viewer. They are not burned into the image file. A poll vote is `POST /stories/:id/vote`. A question answer is `POST /stories/:id/reply`. It disappears after 24 hours.

## UI

1. **Camera** (`react-native-vision-camera`) — tap shutter for photo, **hold** to record video (max 60 s, progress ring), flip camera (double-tap the preview also flips), flash toggle. Bottom-left thumbnail opens the gallery (last 24h items first).
   - Permissions: the phone’s own dialogs on open — camera, then microphone, then photos for the strip. Denied once → **Try again** (shows the dialog again). Denied permanently → **Open Settings**, which opens the Camera switch. Gallery still usable if camera is denied.
2. **Editor** — fullscreen preview; tools: Text, Stickers, Draw (Phase 2 OK to stub); **Discard** (✕ with confirm) / **Your story** (share).
3. No multi-slide story album required in v3 (one asset per publish action; user can post again for the next segment).

Constraints:

- Image or video, up to 10 at once; video max **2 minutes** (checked in the gallery, on device before upload, and by the API). Photos and videos up to **200 MB** each, checked after on-device compression and again by the API and S3 (`MEDIA_TOO_LARGE`).
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
- [x] Expired stories are hidden by every story endpoint from the moment they expire, and their files are deleted from S3 within 5 minutes (see [MEDIA_STORAGE.md](../../architecture/MEDIA_STORAGE.md#story-expiry)).
