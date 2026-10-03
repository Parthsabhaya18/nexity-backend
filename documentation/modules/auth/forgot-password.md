# Forgot password (OTP)

**Screen:** `ForgotPassword` (AuthStack, pushed from `Login`)  
**Deep link:** none  
**Theme:** Dark & light from device setting (logged out) — [THEMING.md](../../architecture/THEMING.md)  
**Status:** Implemented (backend + mobile)

## Purpose

Start a password reset with a **6-digit code** sent by email, without revealing whether the email exists.

## Flow

1. `ForgotPassword` — enter email → **Send code**.
2. `VerifyEmail` with `mode: 'reset'` — enter the 6-digit code ([email-verification.md](email-verification.md) describes the shared OTP screen).
3. `POST /auth/verify-reset-code` returns a short-lived `reset_token`.
4. `ResetPassword` — choose a new password ([reset-password.md](reset-password.md)).

## UI

- Icon 🔑, title **Forgot your password?**, "Enter your email and we'll send you a 6-digit code to reset it."
- Email field (`keyboardType="email-address"`, `autoCapitalize="none"`, autofocus; prefilled when the user typed an email on `Login`).
- **Send code** → always continues to the code screen, whether or not the account exists.
- **Back to log in** link.

## API

### `POST /api/v1/auth/forgot-password`

**Body:** `{ "email": "user@example.com" }`  
**Success `200`:** `{ "resend_available_in": 30 }` — always the same for unknown emails. `dev_code` is added only in development without SMTP.

### `POST /api/v1/auth/verify-reset-code`

**Body:** `{ "email": "user@example.com", "code": "123456" }`  
**Success `200`:** `{ "reset_token": "eyJ...", "expires_in": 900 }`

Errors: `INVALID_CODE` (400, `details.attempts_left`), `CODE_EXPIRED` (400), `RESEND_COOLDOWN` / `TOO_MANY_CODES` (429). Unknown emails return `INVALID_CODE`, the same as a wrong code.

## Business rules

- Same code rules as email verification: 10 min TTL, 5 attempts, 30 s resend cooldown, 5 sends/hour.
- `reset_token` is a JWT (`typ: pwd_reset`) valid 15 min, bound to the user's current password version so it works only once.

## Acceptance criteria

- [x] Same response for registered and unknown emails.
- [x] Rate limit and cooldown enforced.
- [x] Correct code leads to `ResetPassword`.
