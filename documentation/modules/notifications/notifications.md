# Notifications

**Screen:** `Notifications` (pushed from the heart icon in the Home header)  
**Deep link:** `nexity://notifications`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**Push:** [PUSH_NOTIFICATIONS.md](../../architecture/PUSH_NOTIFICATIONS.md)

## Purpose

In-app activity inbox: likes, comments, follows, mentions, message requests. The same events are also delivered as **push notifications** on iOS and Android.

## Notification types

| type | Copy template | Opens |
|------|----------------|-------|
| `like_post` | `{actor} liked your post` | `PostDetail` |
| `comment_post` | `{actor} commented: …` | `PostDetail` + Comments sheet |
| `follow` | `{actor} started following you` | `UserProfile` |
| `follow_request` | `{actor} requested to follow you` | `FollowRequests` |
| `follow_accepted` | `{actor} accepted your follow request` | `UserProfile` |
| `mention_post` | `{actor} mentioned you in a post` | `PostDetail` |
| `like_reel` | `{actor} liked your reel` | `ReelDetail` |
| `comment_reel` | `{actor} commented on your reel: …` | `ReelDetail` + comments sheet |

## API

### `GET /api/v1/notifications`

Cursor list; each item includes `deep_link` (same value used in the push payload).

### `POST /api/v1/notifications/read-all`

### `POST /api/v1/notifications/:id/read`

### `GET /api/v1/notifications/unread-count`

`{ "notifications": 3, "messages": 1 }` — used for header badges and the app icon badge.

## UI

- Sections: **New**, **Today**, **This week**, **Earlier**.
- Row: actor avatar, text, time, and either a post thumbnail (right) or a **Follow / Following** button.
- Follow request summary row at the top ("Follow requests · 3") → `FollowRequests`.
- Tap navigates using the row's `deep_link`.
- Pull-to-refresh; infinite scroll.

## Acceptance criteria

- [ ] Unread count badge on the Home header heart, refreshed on app foreground and on push received.
- [ ] Opening the screen marks visible items as read (default) and updates the app icon badge on iOS and Android.
- [ ] Tapping a push notification and tapping the same row here open the same screen.
