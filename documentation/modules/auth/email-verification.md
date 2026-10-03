# Email verification (OTP)

**Screen:** `VerifyEmail` (AuthStack) — route params `{ email, mode: 'register' | 'reset', resendIn?, devCode? }`  
**Deep link:** none  
**Theme:** Dark & light from device setting — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** No  
**Status:** Implemented (backend + mobile)

## Purpose

Confirm email ownership with a **6-digit code** emailed after registration. The same screen is reused with `mode: 'reset'` for the forgot-password code ([forgot-password.md](forgot-password.md)).

Reached from:

- `Register` after a successful sign-up.
- `Login` when the API answers `403 EMAIL_NOT_VERIFIED` (a fresh code is sent automatically).

## UI

- Icon (✉️ for verify, 🔑 for reset), title **Check your email** / **Enter reset code**, "We sent a 6-digit code to **{email}**".
- Six digit boxes backed by one hidden `TextInput` (`keyboardType="number-pad"`, `textContentType="oneTimeCode"`, `autoComplete="one-time-code"`) so typing, paste and SMS/email code autofill work. Submits automatically when the 6th digit is entered.
- **Verify** button (disabled until 6 digits).
- "Didn't get it? **Resend in 0:30**" countdown → **Resend code** link. Countdown uses `resend_available_in` from the API.
- Errors in a banner: wrong code shows attempts left; expired code asks to request a new one.
- Development only: when the backend runs without SMTP it returns `dev_code`; the app shows a dashed "Dev code: 123456 · Fill" hint (`__DEV__` only).
- Success (`register`): "Email verified" check screen, then the user is signed in (tokens stored) and lands on `Home`.
- Success (`reset`): replaces the screen with `ResetPassword` carrying the short-lived `reset_token`.

## API

### `POST /api/v1/auth/verify-email`

**Body:** `{ "email": "jane@example.com", "code": "123456" }`

**Success `200`:** a full session — the user is logged in right after verifying.

```json
{
  "verified": true,
  "access_token": "eyJ...",
  "refresh_token": "opaque",
  "expires_in": 900,
  "user": { "id": "…", "username": "jane_doe", "is_verified": true, "…": "…" }
}
```

### `POST /api/v1/auth/resend-verification`

**Body:** `{ "email": "jane@example.com" }` — no auth required.  
**Success `200`:** `{ "resend_available_in": 30 }` (+ `dev_code` in development without SMTP). Unknown or already-verified emails get the same response (no enumeration).

### Errors

| Code | HTTP | When |
|------|------|------|
| `INVALID_CODE` | 400 | Wrong code; `details.attempts_left` |
| `CODE_EXPIRED` | 400 | Code older than 10 minutes, already used, or 5 wrong attempts |
| `RESEND_COOLDOWN` | 429 | Resent within 30 s; `details.retry_after_seconds` |
| `TOO_MANY_CODES` | 429 | More than 5 codes in an hour |
| `EMAIL_SEND_FAILED` | 503 | SMTP failure |

## Business rules

- Codes are 6 random digits, stored only as an HMAC-SHA256 hash, valid **10 minutes**, max **5** verify attempts.
- One active code per user and purpose; sending a new code invalidates the old one.
- Resend cooldown **30 s**; max **5 sends per hour**.
- Unverified accounts reserve their username/email for 24 h; signing up again with the same unverified email replaces the pending account.

## Acceptance criteria

- [x] Correct code sets `is_verified=true` and signs the user in.
- [x] Wrong code shows attempts left; 6th attempt requires a new code.
- [x] Expired code (>10 min) rejected with clear message.
- [x] Resend respects cooldown UI.
- [ ] iOS/Android offer the emailed code from the keyboard (one-time-code autofill) on real devices.
