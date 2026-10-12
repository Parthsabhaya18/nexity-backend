# Notification settings

**Screen:** `NotificationSettings` (Settings → Notifications)  
**Deep link:** `nexity://settings/notifications`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**Push spec:** [PUSH_NOTIFICATIONS.md](../../architecture/PUSH_NOTIFICATIONS.md)

## Purpose

Let users choose which push notifications they receive on this account (all their devices).

## UI

- **System permission banner** at the top when OS notifications are off for Nexity: "Notifications are turned off in your device settings" + **Open Settings** (`Linking.openSettings()`; on Android 8+ can deep-link to the app's notification settings).
  - Recheck permission whenever the screen gains focus (user may come back from system settings).
- **Pause all** switch (master `push_enabled`).
- **Posts & reels:** Likes (Off / From people I follow / From everyone), Comments (same three options), Mentions (switch).
- **Followers:** New followers, Follow requests (switches).
- **Messages:** Messages (switch), Show message previews (switch).
- **Secret:** Secret Messages ("Always anonymous"), Secret Crush ("Always anonymous"), Matches (switches) — keys `secret_messages`, `secret_crush`, `matches`.
- **Subscription & billing** (switch) — key `subscription`. Payment problems and refunds are always sent.
- **Nearby** (switch, mirrors `nearby.notifications_enabled`; shown only when Nearby is on) — "Someone is near you on Nexity. ✨". See [nearby-encounters.md](../nearby/nearby-encounters.md#112-nearbysettings).
- Changes save immediately (optimistic) — no Save button.
- Android only: link **Manage notification categories** → system channel settings (channels in PUSH_NOTIFICATIONS.md).

## API

### `GET /api/v1/users/me/notification-preferences`

**Success `200`:**

```json
{
  "push_enabled": true,
  "likes": "everyone",
  "comments": "everyone",
  "mentions": true,
  "new_followers": true,
  "follow_requests": true,
  "messages": true,
  "show_message_previews": true,
  "secret_messages": true,
  "secret_crush": true,
  "matches": true,
  "subscription": true,
  "updated_at": "2026-10-03T06:30:00Z"
}
```

### `PATCH /api/v1/users/me/notification-preferences`

**Body:** any subset of the fields above.  
**Success `200`:** full object.

**Errors:**

| Code | HTTP | When |
|------|------|------|
| `VALIDATION_ERROR` | 400 | Unknown field or invalid value |
| `UNAUTHORIZED` | 401 | No / invalid access token |

## Business rules

- Preferences control **push** only; the in-app Notifications list still records events.
- Default for new accounts: everything on, likes/comments `everyone`.
- Server checks preferences before sending every push.

## Acceptance criteria

- [ ] Turning a toggle off stops that push type within one minute on all the user's devices.
- [ ] Banner appears when OS permission is denied and disappears after enabling it in system settings and returning.
- [ ] Works on iOS and Android 13+ (runtime permission) and Android ≤ 12.

## Cursor checklist

- [ ] `NotificationSettingsScreen` + permission check via `react-native-permissions`
- [ ] `GET` / `PATCH /users/me/notification-preferences` with Zod validation
- [ ] `NotificationPreference` table ([DATA_MODELS.md](../../architecture/DATA_MODELS.md))
