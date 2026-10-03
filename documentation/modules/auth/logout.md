# Logout

**Screen:** none (action from `Settings` → **Log out**)  
**Theme:** Keep the device theme value after logout so the login screen stays in the user's theme — [THEMING.md](../../architecture/THEMING.md)

## Purpose

End the session on this device and revoke its refresh token server-side.

## UI

- Settings row **Log out jane_doe** → native confirm `Alert` ("Log out of your account?" — Cancel / Log out).

## API

### `DELETE /api/v1/devices/:deviceId`

Unregister push first so this device stops receiving notifications ([PUSH_NOTIFICATIONS.md](../../architecture/PUSH_NOTIFICATIONS.md)).

### `POST /api/v1/auth/logout`

**Auth:** Bearer  
**Body:** `{ "refresh_token": "..." }`  
**Success `204`**

## Client behavior

1. Call the two APIs above (ignore network failure — logout must always succeed locally).
2. Delete tokens from Keychain/Keystore; close the chat WebSocket.
3. Clear TanStack Query cache, drafts, recent searches; reset app icon badge to 0.
4. Reset navigation to `AuthStack` → `Login` (no back navigation into the app).

## Acceptance criteria

- [ ] After logout, Android back / iOS swipe cannot return to logged-in screens.
- [ ] Refresh token cannot be reused after logout.
- [ ] Device receives no pushes after logout.
- [ ] Logout works offline (server revoke retried silently is optional).
