# Register

**Screen:** `Register` (AuthStack, pushed from `Login`)  
**Deep link:** `nexity://register`  
**Theme:** Dark & light from device setting (logged out) — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** No  
**Status:** Implemented (backend + mobile)

## Purpose

Create a new account. The user then confirms their email with a 6-digit code ([email-verification.md](email-verification.md)).

## UI

Header: back button, **Create your account**, "It takes less than a minute."

### Fields

| Field | Rules | Input props |
|-------|-------|-------------|
| Full name (`display_name`) | 2–50 chars | `autoCapitalize="words"`, `textContentType="name"`, `autoComplete="name"` |
| Username | 3–30 chars, `[a-z0-9._]`, stored lowercase, unique. Hint: "Lowercase letters, numbers, dots and underscores." Live ✓ / ✗ check (debounced 400 ms) | `autoCapitalize="none"`, `autoCorrect={false}`, `autoComplete="username-new"` |
| Email | Valid email, unique, lowercased | `keyboardType="email-address"`, `autoCapitalize="none"`, `textContentType="emailAddress"`, `autoComplete="email"` |
| Password | 8–128 chars, at least one letter and one number; strength meter (Too weak → Strong) | Show/Hide toggle, `textContentType="newPassword"`, `autoComplete="password-new"` |
| Gender | Chips: Woman, Man, Non-binary, Prefer not to say | — |
| Date of birth | `DD/MM/YYYY` masked numeric field; real date between 1900 and today. Hint: "Your birthday is never shown publicly." | `keyboardType="number-pad"`, `autoComplete="birthdate-full"` |
| Terms checkbox | Required; **Terms** and **Privacy Policy** links | — |

- Scrollable, keyboard-aware form; `returnKeyType="next"` moves focus field by field.
- Server field errors (`EMAIL_TAKEN`, `USERNAME_TAKEN`, `VALIDATION_ERROR` details) are shown under the matching field.
- Bottom link: **Already have an account? Log in** → back to `Login`.

### Success flow

1. API returns `201` with a user stub and `resend_available_in`. No session yet.
2. Navigate to `VerifyEmail` (`mode: 'register'`). A correct code signs the user in.

## API

### `POST /api/v1/auth/register`

```json
{
  "display_name": "Jane Doe",
  "username": "jane_doe",
  "email": "jane@example.com",
  "password": "secretPass1",
  "gender": "woman",
  "date_of_birth": "1998-03-15",
  "accept_terms": true
}
```

**Success `201`:**

```json
{
  "user": { "id": "…", "username": "jane_doe", "email": "jane@example.com", "is_verified": false },
  "resend_available_in": 30
}
```

`dev_code` is included only in development when SMTP is not configured.

**Errors:**

| Code | HTTP | Details |
|------|------|---------|
| `EMAIL_TAKEN` | 409 | `{ field: "email" }` |
| `USERNAME_TAKEN` | 409 | `{ field: "username" }` |
| `VALIDATION_ERROR` | 400 | `[{ path, message }]` (e.g. future date of birth) |

### `GET /api/v1/auth/username-available?username=`

**Success `200`:** `{ "available": true }` or `{ "available": false, "reason": "taken" | "invalid" }`

## Business rules

- Email and username stored lowercase.
- Date of birth must be a real date between 1900 and today (checked on client and server).
- Signing up again with an email that is still unverified replaces the pending account and sends a new code; an unverified account holds its username for 24 h.
- Passwords hashed with bcrypt (cost 12).

## Acceptance criteria

- [x] Duplicate email/username shows field-level errors.
- [x] Username availability updates while typing with a ✓ / ✗ icon.
- [x] Terms must be checked to submit.
- [x] Future date of birth rejected.
- [x] User lands on the code verification screen.
- [ ] Keyboard never hides the focused field or the Create account button on small phones (verify on devices).
