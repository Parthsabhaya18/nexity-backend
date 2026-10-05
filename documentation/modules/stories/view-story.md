# View story

**Screen:** `StoryViewer` (fullscreen modal, transparent background)  
**Deep link:** `nexity://stories/:userId/:storyId` · `https://nexity.com/stories/:userId/:storyId`  
**Theme:** Always dark (immersive media); ••• menu and reply sheet use current theme — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**UX reference:** [INSTAGRAM_CONTENT_UX.md](../../architecture/INSTAGRAM_CONTENT_UX.md) — Stories view

## Purpose

Fullscreen Instagram-style story viewer for one user's active story bundle, continuing to the next users in the tray.

## UI

- Black fullscreen, edge-to-edge; media `resizeMode="cover"` (Cloudinary 1080×1920 transform). Status bar hidden.
- **Progress bars** along the top (below the safe-area inset) — one segment per story in the bundle; fill left-to-right over viewing time.
- **Tap right ~66%** → next story / next user; **tap left ~33%** → previous.
- **Press and hold** → pause progress and video; hides overlays.
- **Swipe left/right** → next/previous user (cube transition).
- **Swipe down** (or Android back) → close and return to the tray with the ring updated.
- **Header:** author avatar, username, time ago, ✕, **•••** (owner: Delete, Save to gallery; viewer: Report, Mute).
- **Footer:** "Send message" reply input + quick reactions; focusing it pauses the story and lifts the input above the keyboard. Sending creates/opens a DM with story reply context (IG story reply).
- Owner footer: **Activity** (viewer list, Phase 2).

Image default display **5 seconds**; video plays its own duration (max 2 minutes). Auto-advance pauses while the app is in background or a sheet is open.

## Implementation status

- Opened from the Home tray as a full-screen modal (your own story first). Animated progress bars: photos 5 s, videos follow their playback. A spinner shows and progress waits while media loads; a load error offers retry or skip.
- Tap left third → previous, right → next; **hold** → pause; **swipe down** or Android back → close; **swipe sideways** → previous / next person.
- **Viewer footer:** heart (`PUT` / `DELETE /stories/:id/like`, optimistic) and a **Send message** field. A message goes privately to the author (`POST /stories/:id/message`, stored with the story). Question stickers send `POST /stories/:id/reply`; polls `POST /stories/:id/vote`.
- **Owner footer:** **Viewers** (bottom sheet, `GET /stories/:id/viewers`, shows who liked) and **Delete** (with confirmation, `DELETE /stories/:id`).
- Status bar hidden; overlays (text, stickers, mentions, polls, questions) drawn over the media.

## API

### `GET /api/v1/users/:userId/stories`

Ordered active stories (`expires_at > now`) with `delivery_url`, `media_type`, `duration_ms`.

### `POST /api/v1/stories/:storyId/view`

Record view; increment once per viewer per story.

### `DELETE /api/v1/stories/:storyId`

Owner only; remove segment; destroy Cloudinary asset async; **204**.

## Performance

- Preload the next story's image/video while the current one is shown.
- If media is still loading, pause the progress bar and show a spinner.

## Acceptance criteria

- [ ] No edit action in menu (IG parity).
- [ ] Tap zones, hold-to-pause, swipe-down close, and swipe between users match IG on iOS and Android.
- [ ] Reply sends DM with optional `story_id` reference on message.
- [ ] Expired story opened from an old link shows "This story is no longer available".
