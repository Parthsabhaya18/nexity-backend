# Reset password

**Screen:** `ResetPassword` (AuthStack) — route params `{ email, resetToken }`  
**Deep link:** none (reached only after a verified reset code)  
**Theme:** Dark & light from device setting (logged out) — [THEMING.md](../../architecture/THEMING.md)  
**Status:** Implemented (backend + mobile)

## Purpose

Set a new password using the `reset_token` returned by `POST /auth/verify-reset-code` ([forgot-password.md](forgot-password.md)).

## UI

- Icon 🔒, title **Create a new password**, "For **{email}**. You'll be logged out on all other devices."
- Fields: **New password** (with strength meter) and **Confirm password** (`textContentType="newPassword"`, `autoComplete="password-new"`).
- **Update password** → on success the stack resets to `Login` with the email prefilled and the banner "Password updated. Log in with your new password."
- Expired/used token: banner "This reset session has expired. Go back and request a new code."

### Validation (client and server)

- 8–128 characters, at least one letter and one number.
- Confirm must match.

## API

### `POST /api/v1/auth/reset-password`

```json
{
  "reset_token": "eyJ...",
  "password": "newPass123"
}
```

**Success `204`** — revokes all refresh tokens (all devices) and rejects access tokens issued before the change. Also marks the email as verified (the user proved ownership with the code).

**Errors:** `INVALID_RESET_TOKEN` (401) when expired or already used; `VALIDATION_ERROR` (400) for a weak password.

## Acceptance criteria

- [x] Token single-use.
- [x] After reset, all devices are logged out.
- [x] Success returns to `Login` with a confirmation banner.
