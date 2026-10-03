# Home feed

**Screen:** `Home` (HomeTab root)  
**Deep link:** `nexity://feed`  
**Theme:** Dark & light (header logo has light and dark variants) — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Purpose

Show a scrollable timeline of posts from followed users and recommended content.

## UI

- **Header:** Nexity logo (left); **Notifications** heart → `Notifications` and **Messages** icon → `Inbox` (right), each with unread badge. Header hides on scroll down and reappears on scroll up (Instagram behavior).
- **Stories tray** as the list header (see [stories-tray.md](../stories/stories-tray.md)).
- **Post cards** (Instagram home feed parity): author header + location, carousel (horizontal paging + dots) or video, double-tap like with heart burst + light haptic, action row, caption "more", "View all N comments" (opens Comments bottom sheet), timestamp. Media via Cloudinary `delivery_url` sized to screen width × pixel ratio.
- **Video:** autoplays muted when ≥ 50% visible, only one at a time; tap toggles sound. Pauses when scrolled away, when the tab loses focus, and when the app goes to background.
- **Upload progress bar** at the top while a new post/reel is uploading ("Posting…" with thumbnail and Retry on failure).
- Native **pull-to-refresh** (`RefreshControl`); infinite scroll (`FlashList` `onEndReached`) with cursor pagination.
- Tapping the Home tab while on Home scrolls to top; a second tap refreshes.
- Empty state: suggestions to follow + button **Explore** → `Explore`.
- Offline: show the last cached page with "No internet connection" banner.

## API

### `GET /api/v1/feed`

**Query:** `cursor`, `limit` (default 20)

**Success `200`:**

```json
{
  "data": [
    {
      "type": "post",
      "post": {
        "id": "uuid",
        "author": { "username": "jane", "avatar_url": null },
        "caption": "Hello",
        "media": [{ "type": "image", "delivery_url": "https://...", "width": 1080, "height": 1350 }],
        "like_count": 12,
        "comment_count": 3,
        "liked_by_me": false,
        "saved_by_me": false,
        "created_at": "2026-01-01T12:00:00Z"
      }
    }
  ],
  "pagination": { "next_cursor": "...", "has_more": true }
}
```

`width` / `height` let the app reserve the correct aspect ratio before the image loads (no layout jump).

### Ranking (v3 default)

1. Posts from followed users (reverse chronological).
2. Insert 1 suggested post every 8 items from explore pool (logged).

## Business rules

- Respect `visibility` and private account rules.
- Hide posts from blocked users.
- Soft-deleted posts never appear.

## Acceptance criteria

- [ ] Smooth 60 fps scrolling on a mid-range Android phone (FlashList, cached images, no inline functions in item render).
- [ ] Infinite scroll loads next page without duplicate keys.
- [ ] Like/save optimistic UI with rollback on error.
- [ ] Feed updates after following someone (invalidate query).
- [ ] Videos never play with sound unexpectedly and stop when the app is backgrounded.
