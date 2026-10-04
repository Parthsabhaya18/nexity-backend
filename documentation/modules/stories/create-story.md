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

The screen opens on the live camera with a strip of recent photos and videos and a gallery button. Share can include one song name (`music_title`), a place (`location_name` plus `location_lat` / `location_lng` when the map search returns coordinates), a colour look (`filter`, default `normal`), and up to 12 overlays. Text and mention stickers can be dragged. Overlays are text, emoji stickers, drawing, poll, question, quiz, countdown, link, hashtag and mention. They are stored with the story and drawn again for every viewer. They are not burned into the image file. A poll vote is `POST /stories/:id/vote`. A question answer is `POST /stories/:id/reply`. It disappears after 24 hours.

## UI

1. **Camera** (`react-native-vision-camera`) — tap shutter for photo, **hold** to record video (max 60 s, progress ring), flip camera (double-tap the preview also flips), flash toggle. Bottom-left thumbnail opens the gallery (last 24h items first).
   - Permissions: the phone’s own dialogs on open — camera, then microphone, then photos for the strip. Denied once → **Try again** (shows the dialog again). Denied permanently → **Open Settings**, which opens the Camera switch. Gallery still usable if camera is denied.
2. **Editor** — fullscreen preview; tools: Text, Stickers, Draw (Phase 2 OK to stub); **Discard** (✕ with confirm) / **Your story** (share).
3. No multi-slide story album required in v3 (one asset per publish action; user can post again for the next segment).

Constraints:

- Image or video, up to 10 at once; video max **60 seconds** (checked on device and by the API). Size is never a limit; the device compresses first.
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
