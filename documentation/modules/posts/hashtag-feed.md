# Hashtag feed

**Screen:** `HashtagFeed` (pushed in any tab stack)  
**Deep link:** `nexity://tags/:tag` · `https://nexity.com/tags/:tag`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Purpose

Browse public posts tagged with `#tag`.

## UI

- Header: `#travel`, post count, Follow tag (optional v3 — if omitted, hide button).
- Top tabs: Top | Recent; 3-column grid; tap opens `PostDetail`.
- Header ••• → Share (native share sheet with the hashtag link).

## API

### `GET /api/v1/tags/:tag/posts`

Only `visibility=public` posts from non-private accounts or viewer-authorized content. **Query:** `sort=top|recent`, `cursor`.

## Acceptance criteria

- [ ] Tag normalized lowercase in deep links and API calls.
- [ ] Tapping `#tag` in any caption or comment opens this screen.
