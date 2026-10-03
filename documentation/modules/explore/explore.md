# Explore

**Screen:** `Explore` (SearchTab root)  
**Deep link:** `nexity://explore`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Purpose

Discover trending posts, reels, and suggested accounts.

## UI

- **Search bar** pinned at the top; tapping it switches to the search UI ([search.md](../search/search.md)) on the same screen.
- Grid of thumbnails (3 columns, Instagram explore pattern: every few rows one tall reel tile spanning 2 rows).
- Reel tiles show a reel icon; carousel posts show a stack icon.
- Tap opens `PostDetail` or `ReelDetail` (reel continues in a vertical feed of explore reels).
- Category chips (horizontal scroll): For You, Travel, Music, etc.
- Pull-to-refresh, infinite scroll.

## API

### `GET /api/v1/explore`

**Query:** `cursor`, `category`

Returns mixed `type: post | reel` items with thumbnail `delivery_url` (`c_fill` square or 1:2 for tall tiles).

## Acceptance criteria

- [ ] Exclude blocked users and NSFW flagged content (if moderation labels exist).
- [ ] Grid scrolls smoothly; thumbnails are cached.
- [ ] Tapping the Search tab again scrolls the grid to top.
