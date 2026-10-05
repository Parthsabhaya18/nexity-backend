# Search

**Screen:** `Search` tab  
**Deep link:** `nexity://search?q=:query`  
**Theme:** Light, Dark and every mood. See [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Purpose

Find people by username or name. Hashtags were removed from the app, so there is no tag search.

## UI

- Search input (`returnKeyType="search"`, `autoCapitalize="none"`, `autoCorrect={false}`, clear button).
- **Empty box:** only the **Recent** list, the profiles the user opened from Search (newest first, max 20). Each row has an **✕** to remove it, and there is **Clear all**. When there is no history, a short hint is shown instead.
- **Typing:** matching profiles, each with a Follow button. Opening a profile adds it to Recent.
- Results dismiss the keyboard on scroll (`keyboardDismissMode="on-drag"`).
- The list is fetched again whenever the tab gains focus.

## API

### `GET /api/v1/search`

**Query:** `q`, `type=users|places` (default `users`), `limit` (default 20, max 50).

- `type=users` → `{ "users": UserSummary[] }`. Matches anywhere in the username or display name. Active, verified accounts only. **Blocked users never appear, in either direction** (people you blocked and people who blocked you).
- `type=places` → `{ "places": [...] }` for the location sheet in the composers.

### Search history

| Method | Path | Body / result |
|--------|------|---------------|
| GET | `/search/history` | `{ "users": UserSummary[] }`, newest first, max 20; blocked, deactivated or unverified accounts are left out |
| POST | `/search/history` | `{ "user_id" }` → `204`; moves an existing entry to the top (30 stored); `404` for an inactive user |
| DELETE | `/search/history/:userId` | `204` |
| DELETE | `/search/history` | `204` (clear all) |

History is stored on the server, so it follows the account across devices.

## Acceptance criteria

- [x] Debounce input 300 ms; cancel in-flight request when the query changes.
- [x] Empty query shows only recent searches, each removable with ✕.
- [x] A search shows matching profiles; blocked users never appear.
- [x] Tapping a user opens `UserProfile` and saves it to Recent.
