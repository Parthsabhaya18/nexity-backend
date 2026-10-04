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

## Implementation status

- Implemented: the `Search` tab searches **users** only (`type=users`). A query matches anywhere in the username or display name (`smith` finds `bob.smith`); active, verified accounts only; returns `{ "users": UserSummary[] }` (same shape as follower lists, with `follow_status`), each row has a Follow button. `limit` default 20, max 50. Rate limited per account (`searchLimiter`).
- Empty search box calls `GET /users/suggestions` and shows **Suggested for you**: verified people the viewer does not already follow and has not blocked, most-followed first.
- Also implemented for the post composer: `type=tags` → `{ "tags": [{ "name", "post_count" }] }` (hashtag prefix, most used first) and `type=places` → `{ "places": [{ "name", "post_count" }] }` (location names used on posts by public accounts or the viewer).
- Not yet: Tags / Posts tabs in the Search screen, recent searches (needs AsyncStorage), trending tags.

## Acceptance criteria

- [x] Debounce input 300 ms; cancel in-flight request when the query changes.
- [x] Empty query shows suggested people. A search shows matching profiles.
- [ ] Tapping a user opens `UserProfile` (done); a tag opens `HashtagFeed`.
