# Reset password

**Screen:** `ResetPassword` (AuthStack)  
**Deep link:** `https://nexity.com/reset-password/:token` (Universal Link / App Link) · `nexity://reset-password/:token`  
**Theme:** Dark & light from device setting (logged out) — [THEMING.md](../../architecture/THEMING.md)

## Purpose

Set a new password using a one-time token from email.

## UI

- Fields: new password, confirm password (`textContentType="newPassword"`, `autoComplete="password-new"` so iOS/Android can suggest a strong password).
- Success → toast "Password updated" → `Login`.
- Invalid token state: message + button to `ForgotPassword`.
- If a user is logged in on this device when the link opens, log them out first (reset invalidates all sessions).

## API

### `POST /api/v1/auth/reset-password`

**Body:**

```json
{
  "token": "from-deep-link",
  "password": "newPass123"
}
```

**Success `204`** — invalidate all refresh tokens (all devices) for the user and remove their push devices.

## Acceptance criteria

- [ ] Email link opens this screen in the app on iOS and Android.
- [ ] Token single-use.
- [ ] After reset, all devices are logged out.
