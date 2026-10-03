# Auth and security

The clients are native iOS and Android apps. There are **no cookies** — tokens travel in the JSON body and the `Authorization` header and are stored in the OS secure store.

## JWT

| Token | TTL | Storage on device |
|-------|-----|-------------------|
| Access | 15 minutes | Memory (auth context); copy in Keychain/Keystore for fast cold start is OK |
| Refresh | 7 days | **iOS Keychain / Android Keystore** via `react-native-keychain` (`ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) |

Never store tokens in AsyncStorage, logs, crash reports, or Redux devtools.

- Login and register return both `access_token` and `refresh_token` in the JSON body.
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

## Password policy

- Minimum 8 characters, at least one letter and one number.
- Hash: Argon2id or bcrypt (cost appropriate for production).
- Inputs use `textContentType="password"` / `"newPassword"` (iOS) and `autoComplete="password"` / `"password-new"` (Android) so password managers work.

## Rate limiting (defaults)

| Endpoint group | Limit |
|----------------|-------|
| Login / register | 10 req / 15 min / IP |
| Refresh | 30 req / 15 min / device |
| Password reset email | 3 req / hour / email |
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
- No secrets in the app bundle (Cloudinary secret, JWT keys, Firebase admin key stay on the server).
- Release builds: Hermes bytecode, R8/ProGuard minify on Android, strip `console.log`.
- Sensitive screens (none in v3) may set `FLAG_SECURE` on Android; not required for feed content.
- Certificate pinning: optional, Phase 2.

## CORS

Native apps are not subject to CORS. Keep `CORS_ORIGINS` only for any browser-based admin or marketing site; do not rely on CORS as a security control for the API.

## Content security

- **Cloudinary signed uploads** only; see [CLOUDINARY.md](CLOUDINARY.md). Never expose `CLOUDINARY_API_SECRET` to the client.
- Enable Cloudinary **moderation** add-on or webhook hook (future).
- Strip EXIF / GPS: photos from phones contain location. Apply Cloudinary `strip_metadata` on delivery when privacy setting `strip_location_metadata` is on (default true).
- User-generated content requires **Report** and **Block** in the app (App Store guideline 1.2, Google Play UGC policy).
