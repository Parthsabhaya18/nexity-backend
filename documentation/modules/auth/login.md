# Login

**Screen:** `Login` (AuthStack)  
**Deep link:** `nexity://login`  
**Theme:** Dark & light from device setting (logged out); apply `user.preferences.theme` after success — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** No  
**Status:** Implemented (backend + mobile). `Login` is the **initial route** for logged-out users — there is no Welcome screen ([welcome.md](welcome.md)).  
**Related:** [register.md](register.md), [forgot-password.md](forgot-password.md), [email-verification.md](email-verification.md)

## Purpose

Allow existing users to sign in with email/username and password and receive JWT tokens.

## UI

### Layout

- Full-screen form inside `SafeAreaView`, content vertically centered; logo (light/dark variant), **Welcome back**, "Log in to continue to Nexity."
- Fields: **Email or username**, **Password** with Show/Hide toggle.
- Primary button: **Log in** (full width).
- Links: **Forgot password?** → `ForgotPassword`; bottom **New to Nexity? Create account** → `Register`.
- Success banner when returning from a password reset ("Password updated. Log in with your new password.").
- Wrap in keyboard-aware scroll so the Log in button stays visible above the keyboard on small phones.

### Inputs

| Field | Props |
|-------|-------|
| Identifier | `autoCapitalize="none"`, `autoCorrect={false}`, `textContentType="username"`, `autoComplete="username"`, `returnKeyType="next"` |
| Password | `secureTextEntry`, `textContentType="password"`, `autoComplete="password"`, `returnKeyType="go"` (submits) |

iOS Keychain and Android Autofill / Google Password Manager must offer saved credentials.

### States

| State | Behavior |
|-------|----------|
| Empty | Submit disabled until both fields non-empty |
| Loading | Disable form, spinner on button, keyboard dismissed |
| Error | Inline banner from API `error.message`; error haptic |
| Offline | Banner "No internet connection"; button disabled |
| Success | Save tokens to Keychain/Keystore; apply theme; open pending deep link, else `OnboardingStack` (if not completed) or `MainTabs` |

### Validation (client)

- Identifier: required, trim whitespace.
- Password: required.

## API

### `POST /api/v1/auth/login`

**Headers:** `X-Platform`, `X-App-Version` (used to create the device session)

**Body:**

```json
{
  "identifier": "jane_doe",
  "password": "secretPass1"
}
```

`identifier` is email **or** username (case-insensitive for email).

**Success `200`:**

```json
{
  "access_token": "eyJ...",
  "refresh_token": "opaque-or-jwt",
  "expires_in": 900,
  "user": {
    "id": "uuid",
    "username": "jane_doe",
    "display_name": "Jane",
    "avatar_url": null,
    "is_verified": true,
    "onboarding_completed": true,
    "preferences": { "theme": "system" }
  }
}
```

Tokens are returned in the body (no cookies on mobile). Store per [AUTH_AND_SECURITY.md](../../architecture/AUTH_AND_SECURITY.md).

**Errors:**

| Code | HTTP | When |
|------|------|------|
| `INVALID_CREDENTIALS` | 401 | Wrong password or unknown user |
| `ACCOUNT_DISABLED` | 403 | Admin suspended account |
| `EMAIL_NOT_VERIFIED` | 403 | Correct password but email not verified. A new code is sent; `details: { email, resend_available_in, dev_code? }`. App opens `VerifyEmail` |
| `TOO_MANY_ATTEMPTS` | 429 | Account temporarily locked after 5 failures |
| `TOO_MANY_REQUESTS` | 429 | IP/identifier rate limit |

## Business rules

- Do not reveal whether email exists on failed login (same message: "Invalid credentials").
- After 5 failed attempts in 15 minutes, temporary lock (15 min).
- After login, register the push device ([PUSH_NOTIFICATIONS.md](../../architecture/PUSH_NOTIFICATIONS.md)) if permission was already granted.

## Acceptance criteria

- [ ] Valid user can log in and reach the Home tab on iOS and Android.
- [ ] Invalid password shows generic error, no user enumeration.
- [ ] A deep link opened while logged out (e.g. `https://nexity.com/posts/abc`) opens after login; only known app paths are accepted.
- [ ] Killing and reopening the app keeps the user signed in until the refresh token expires.
- [ ] Password managers (iOS Keychain, Android Autofill) fill both fields.
- [ ] Android back on Login exits the app.

## Cursor implementation checklist

- [x] `LoginScreen` + React Hook Form + Zod schema
- [x] `services/api/auth.ts` → `login()`
- [x] Auth context: user, access token, secure storage, refresh interceptor
- [ ] Maestro flow: login → Home tab
