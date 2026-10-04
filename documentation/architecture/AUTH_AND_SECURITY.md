# Auth and security

The clients are native iOS and Android apps. There are **no cookies** — tokens travel in the JSON body and the `Authorization` header and are stored in the OS secure store.

## JWT

| Token | TTL | Storage on device |
|-------|-----|-------------------|
| Access | 15 minutes | Memory (auth context); copy in Keychain/Keystore for fast cold start is OK |
| Refresh | 7 days | **iOS Keychain / Android Keystore** via `react-native-keychain` (`ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) |

Never store tokens in AsyncStorage, logs, crash reports, or Redux devtools.

- Login and email verification return both `access_token` and `refresh_token` in the JSON body (register returns no session until the email code is verified).
- Access tokens are HS256 JWTs (`typ: access`); refresh tokens are random opaque strings stored server-side only as SHA-256 hashes.
- Rotate refresh on every use; reusing an old refresh token invalidates the whole token family (theft detection) and logs out that device.
- Each refresh token family is tied to a **device session** (platform, device model, app version, last active) so users can see and sign out devices (Phase 2 UI).
- Logout revokes the refresh token server-side and unregisters the push device.

### `POST /api/v1/auth/refresh`

**Body:** `{ "refresh_token": "..." }`

**Success `200`:**

```json
{
  "access_token": "eyJ...",
  "refresh_token": "new-rotated-token",
  "expires_in": 900
}
```

**Errors:** `INVALID_REFRESH_TOKEN` (401) → client clears tokens and shows Login.

### Client refresh flow

1. API returns `401` with code `TOKEN_EXPIRED`.
2. axios interceptor pauses other requests, calls `/auth/refresh` once, saves new tokens to Keychain/Keystore, replays queued requests.
3. Refresh fails → log out locally and open `Login` (keep pending deep link).
4. On cold start, if a refresh token exists, refresh before showing MainTabs (splash stays visible).

## Optional biometric unlock (Phase 2)

Face ID / Touch ID (iOS) and fingerprint/face (Android BiometricPrompt) can protect the stored refresh token (`accessControl: BIOMETRY_ANY`). iOS requires `NSFaceIDUsageDescription`.

## Email codes (OTP)

Email verification and password reset use **6-digit codes** sent by email (no links).

| Rule | Value |
|------|-------|
| Code storage | HMAC-SHA256 hash only; one active code per user and purpose (`verify_email`, `reset_password`) |
| Lifetime | 10 minutes |
| Verify attempts | 5 per code, then a new code is required |
| Resend cooldown | 30 s (`resend_available_in` in responses) |
| Sends | 5 per hour per user and purpose |
| Reset token | JWT `typ: pwd_reset`, 15 min, bound to the current password version (single use) |

- Forgot-password and resend responses are identical for unknown emails (no account enumeration).
- Development: when `SMTP_HOST` is empty and `NODE_ENV` is not production, the email is logged and the code is returned as `dev_code`. Production requires SMTP.
- A password reset revokes all refresh tokens, and access tokens issued before the change are rejected.

## Password policy

- Minimum 8 characters, at least one letter and one number.
- Hash: bcrypt, cost 12.
- Login: 5 wrong passwords lock the account for 15 minutes (`TOO_MANY_ATTEMPTS`); unknown users get the same `INVALID_CREDENTIALS` response and timing.
- Inputs use `textContentType="password"` / `"newPassword"` (iOS) and `autoComplete="password"` / `"password-new"` (Android) so password managers work.

## Rate limiting (defaults)

| Endpoint group | Limit |
|----------------|-------|
| Login | 20 req / 15 min / IP + identifier |
| All `/auth/*` | 60 req / 15 min / IP |
| Email codes | 30 s cooldown, 5 / hour / user |
| Post create | 30 / hour / user |
| Report | 20 / day / user |

Mobile carriers share IPs (CGNAT): combine IP with device id / username for auth limits.

## Privacy

- Private accounts: profile posts and reels visible only to accepted followers.
- Block: blocked user cannot see profile, message, or appear in search.
- Do not expose email or internal ids on public JSON; use `username` and public UUIDs.
- App Store privacy labels and Google Play Data safety form must match what the app collects (account info, user content, device id for push, crash data).

## Transport & app hardening

- HTTPS only in release builds. iOS App Transport Security stays enabled; Android `usesCleartextTraffic` is allowed **only** in debug (for `http://localhost:4000`).
- No secrets in the app bundle (AWS keys, JWT keys, Firebase admin key stay on the server).
- Release builds: Hermes bytecode, R8/ProGuard minify on Android, strip `console.log`.
- Sensitive screens (none in v3) may set `FLAG_SECURE` on Android; not required for feed content.
- Certificate pinning: optional, Phase 2.

## CORS

Native apps are not subject to CORS. Keep `CORS_ORIGINS` only for any browser-based admin or marketing site; do not rely on CORS as a security control for the API.

## Content security

- **S3 presigned POST uploads** only (key, type and max size signed by the server, real format verified on complete); see [MEDIA_STORAGE.md](MEDIA_STORAGE.md). Never expose AWS keys to the client.
- Content moderation (e.g. Amazon Rekognition on complete) is future work.
- Strip EXIF / GPS: photos from phones contain location. Must be stripped before posts ship when privacy setting `strip_location_metadata` is on (default true).
- User-generated content requires **Report** and **Block** in the app (App Store guideline 1.2, Google Play UGC policy).
