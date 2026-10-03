# Forgot password

**Screen:** `ForgotPassword` (AuthStack, pushed from `Login`)  
**Deep link:** none  
**Theme:** Dark & light from device setting (logged out) — [THEMING.md](../../architecture/THEMING.md)

## Purpose

Request a password reset email without revealing whether the email exists.

## UI

- Single field: email (`keyboardType="email-address"`, `autoCapitalize="none"`, autofocus).
- Submit → always show: "If an account exists, we sent reset instructions." plus **Open email app** button and **Back to log in**.

## API

### `POST /api/v1/auth/forgot-password`

**Body:** `{ "email": "user@example.com" }`  
**Success `204`** (always, even if email unknown)

Email contains link: `{APP_LINK_BASE_URL}/reset-password/{token}` → `https://nexity.com/reset-password/{token}`, which opens the `ResetPassword` screen in the app (Universal Link / App Link).

## Acceptance criteria

- [ ] Same success message for valid and invalid emails.
- [ ] Rate limit enforced (see security doc).
- [ ] Email link opens the app on iOS and Android.
