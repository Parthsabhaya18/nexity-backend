# Search

**Screen:** search mode of `Explore` (SearchTab) — activates when the search bar is focused  
**Deep link:** `nexity://search?q=:query`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Purpose

Search users, hashtags, and posts by keyword.

## UI

- Search input (`returnKeyType="search"`, `autoCapitalize="none"`, `autoCorrect={false}`, clear button) with **Cancel** to leave search mode and dismiss the keyboard.
- Top tabs: Top | Accounts | Tags | Posts.
- Recent searches stored in AsyncStorage (max 20, swipe/✕ to remove, **Clear all**).
- Results list dismisses the keyboard on scroll (`keyboardDismissMode="on-drag"`).
- Android back / iOS Cancel exits search mode before leaving the tab.

## API

### `GET /api/v1/search`

**Query:** `q`, `type=all|users|tags|posts`, `cursor`

**Example fragment:**

```json
{
  "users": [{ "username", "display_name", "avatar_url" }],
  "tags": [{ "name", "post_count" }],
  "posts": []
}
```

## Acceptance criteria

- [ ] Debounce input 300 ms; cancel in-flight request when the query changes.
- [ ] Empty query shows recents + trending tags.
- [ ] Tapping a user opens `UserProfile`; a tag opens `HashtagFeed`.
