# Register

**Screen:** `Register` (AuthStack)  
**Deep link:** `nexity://register`  
**Theme:** Dark & light from device setting (logged out) — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** No

## Purpose

Create a new account with email, username, password, and accept terms.

## UI

### Fields

| Field | Rules | Input props |
|-------|-------|-------------|
| Email | Valid email, unique | `keyboardType="email-address"`, `autoCapitalize="none"`, `textContentType="emailAddress"`, `autoComplete="email"` |
| Username | 3–30 chars, `[a-zA-Z0-9_.]`, unique, no spaces | `autoCapitalize="none"`, `autoCorrect={false}`, `textContentType="username"` |
| Display name | 1–50 chars | `textContentType="name"`, `autoComplete="name"` |
| Password | See [AUTH_AND_SECURITY.md](../../architecture/AUTH_AND_SECURITY.md) | `secureTextEntry`, `textContentType="newPassword"`, `autoComplete="password-new"` |
| Confirm password | Must match | same as password |
| Terms checkbox | Required | Checkbox row; **Terms** and **Privacy Policy** open in an in-app browser |

- Scrollable, keyboard-aware form; `returnKeyType="next"` moves focus field by field.
- iOS suggests a strong password (Keychain); Android Autofill may offer one.
- Bottom link: **Already have an account? Log in** → `Login`.

### Success flow

1. API returns `201` with user stub (may not issue full session until email verified — product choice).
2. Replace with `VerifyEmail` screen showing "Check your inbox" (user cannot go back to the filled form).

## API

### `POST /api/v1/auth/register`

**Body:**

```json
{
  "email": "jane@example.com",
  "username": "jane_doe",
  "display_name": "Jane",
  "password": "secretPass1"
}
```

**Success `201`:**

```json
{
  "user": {
    "id": "uuid",
    "username": "jane_doe",
    "email": "jane@example.com",
    "is_verified": false
  },
  "verification_sent": true
}
```

If the product issues a session at registration, the body also contains `access_token`, `refresh_token`, `expires_in` (same as login).

**Errors:**

| Code | HTTP |
|------|------|
| `EMAIL_TAKEN` | 409 |
| `USERNAME_TAKEN` | 409 |
| `VALIDATION_ERROR` | 400 |

### `GET /api/v1/auth/username-available?username=`

**Success `200`:** `{ "available": true }`

Use for a debounced check while typing.

## Business rules

- Normalize email to lowercase before store.
- Username stored lowercase for uniqueness checks; display may preserve case in display_name only.
- Send verification email asynchronously (queue). The email link is `https://nexity.com/verify-email/{token}` so it opens the app.
- Minimum age per store policy (13+); add a birthday field if required by your market.

## Acceptance criteria

- [ ] Duplicate email/username shows field-level errors.
- [ ] Username availability updates while typing (debounced 400 ms) with a ✓ / ✗ icon.
- [ ] Terms must be checked to submit; Terms and Privacy links open in-app.
- [ ] User lands on verification instructions screen.
- [ ] Keyboard never hides the focused field or the Sign up button on small phones.

## Cursor checklist

- [ ] `RegisterScreen` + validation
- [ ] Register API + error mapping
- [ ] Email verification mailer stub in dev
