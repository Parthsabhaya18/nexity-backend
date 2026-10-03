# Post comments

**Screen:** Comments **bottom sheet** (`@gorhom/bottom-sheet`) opened from feed cards and `PostDetail`  
**Deep link:** `nexity://posts/:postId/comments` (opens `PostDetail` with the sheet expanded)  
**Theme:** Dark & light (`surfaceElevated`) — [THEMING.md](../../architecture/THEMING.md)

## Purpose

Threaded comments on posts.

## UI

- Sheet opens at ~70% height, drag up to full screen, swipe down or Android back to close.
- Sort: Top (default) / Newest.
- Reply: tap **Reply** → composer prefilled with `@username`; replies indented, max depth 3 (collapsed "View N more replies").
- Like comment: small heart on the right.
- **Composer pinned at the bottom above the keyboard** (keyboard-aware; respects the iOS home indicator / Android nav bar). Quick emoji row above the input (IG parity).
- Long-press a comment → action sheet: Reply, Copy, Report, Delete (own or post owner). iOS also supports swipe-left to delete own comment.
- New comment appears immediately (optimistic) with a "Posting…" state.

## API

### `GET /api/v1/posts/:postId/comments`

Cursor pagination. **Query:** `sort=top|newest`.

### `POST /api/v1/posts/:postId/comments`

**Body:** `{ "body": "Nice!", "parent_id": null, "client_id": "uuid" }`  
**Success `201`**

### `DELETE /api/v1/comments/:commentId`

Author or post owner; **204**.

## Validation

- Body 1–1000 chars after trim.

## Acceptance criteria

- [ ] Notifications (in-app + push) created for post author and parent comment author on reply.
- [ ] Keyboard never covers the composer on iOS or Android.
- [ ] Comment count on the card updates after posting.
