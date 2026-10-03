# Saved posts

**Screen:** `SavedPosts` (from `MyProfile` ☰ menu → **Saved**)  
**Deep link:** `nexity://saved`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Purpose

Grid of posts the user saved (a separate saved-reels tab is Phase 2).

## UI

- 3-column grid of thumbnails; tap opens `PostDetail`.
- Pull-to-refresh, infinite scroll.
- Empty state: "Save photos and videos that you want to see again."

## API

### `GET /api/v1/users/me/saved-posts`

Cursor pagination.

## Acceptance criteria

- [ ] Unsaving from a post removes it from this grid with animation (shared query cache).
- [ ] Only visible to the owner.
