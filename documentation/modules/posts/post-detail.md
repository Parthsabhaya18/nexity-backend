# Post detail

**Screen:** `PostDetail` (pushed in any tab stack)  
**Deep link:** `nexity://posts/:postId` · `https://nexity.com/posts/:postId`  
**Theme:** Dark & light (media never tinted; fullscreen lightbox always dark) — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**UX reference:** [INSTAGRAM_CONTENT_UX.md](../../architecture/INSTAGRAM_CONTENT_UX.md) — View

## Purpose

Instagram-style single post: carousel or video, engagement, caption, comments.

## UI

### Layout

- Native header: back, title "Post".
- Media full width (aspect ratio from API `width`/`height`), then action row, likes, caption, comments preview.
- "View all N comments" opens the **Comments** bottom sheet ([comments.md](comments.md)); the deep link `posts/:postId/comments` opens it automatically.

### Media

- **Carousel:** horizontal paging swipe with dot indicator and "1/5" counter.
- **Pinch to zoom:** image scales over the screen and springs back on release.
- **Tap image:** opens `MediaLightbox` (fullscreen, always dark, swipe down to close).
- **Video:** autoplay muted when visible, tap toggles sound, loop; pauses on blur/background.
- Images use Cloudinary `delivery_url` sized to screen width × pixel ratio.

### Interactions

- Double-tap media → like + heart overlay animation + light haptic.
- Heart / Comment / Share / Save in action row.
  - **Share** → in-app share sheet (send in DM) with **Share to…** option that opens the native share sheet with `https://nexity.com/posts/:postId`.
- Tap **like count** → Likers bottom sheet (`GET /posts/:id/likers`).
- Caption: `@username` bold, "more" expands long text; `@user` → `UserProfile`. Hashtags are plain text.
- **•••** → bottom sheet: owner → **Hide / Show like count**, **Turn comments off / on** (both apply at once and update every list showing the post), **Edit description** (with @mention suggestions), **Delete** (destructive confirm `Alert`); viewer → Report / Block.

### Implementation status

- Likes use `PUT` / `DELETE /posts/:id/like` (idempotent). The heart and count change at once; quick taps are merged so the last tap wins, and a failure puts back the last confirmed state. Double tap shows a heart burst.
- When `hide_like_count` is on, the count is hidden for everyone, owner included (the API returns `likes_count: null`).
- When comments are off, the comment button is hidden and the comments sheet says comments are turned off.
- Tagged people: a person icon on the media shows the tagged usernames.
- Likes, saves, comment counts, edits and deletes are shared between Home, profile grids, `PostViewer` and `PostDetail` through post events.

## API

### `GET /api/v1/posts/:postId`

Returns post with:

- `media[]`: `{ media_id, type, delivery_url, secure_url, width, height, duration_ms, alt_text }`
- `tagged_users[]`, `location_name`, `hide_like_count`, `comments_disabled`
- `liked_by_me`, `saved_by_me`, `like_count`, `comment_count`
- `permissions`: `{ can_edit, can_delete }`
- `is_edited`: boolean
- `share_url`: `https://nexity.com/posts/:postId`

### `DELETE /api/v1/posts/:postId`

Soft delete; schedule Cloudinary cleanup; **204**. App pops back and removes the post from feed/profile caches.

### `POST /api/v1/posts/:postId/like`

Toggle; **200** `{ "liked", "like_count" }`

### `POST /api/v1/posts/:postId/save`

Toggle save; **200** `{ "saved" }`

### `GET /api/v1/posts/:postId/likers`

Cursor list for likes sheet.

## Acceptance criteria

- [ ] Carousel and video behavior matches home feed card.
- [ ] Hide like count when `hide_like_count` true (show "Liked by …" only if IG-style allowed).
- [ ] Comments disabled hides input and shows label.
- [ ] Deleted or unauthorized private post shows a "Post unavailable" screen (not a crash) when opened from a link or push.
- [ ] Shared link opens this screen in the app on iOS and Android.
