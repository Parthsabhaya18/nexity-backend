# Email verification

**Screen:** `VerifyEmail` (AuthStack; also reachable when logged in but unverified)  
**Deep link:** `https://nexity.com/verify-email/:token` (Universal Link / App Link) · `nexity://verify-email/:token`  
**Theme:** Dark & light from device setting — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Optional (logged-in unverified users see a banner)

## Purpose

Confirm email ownership via a link sent after registration. The link opens **the app** directly on iOS and Android.

## UI — without token (instructions)

- Illustration + "Check your inbox" + the email address.
- **Open email app** button: iOS `Linking.openURL('message://')`; Android launch the default mail app (intent `ACTION_MAIN` + `CATEGORY_APP_EMAIL`). Hide the button if no mail app is available.
- **Resend email** button (60 s cooldown with countdown).
- **Change email** → `AccountSettings` (if logged in).

## UI — with token (opened from the email link)

- On screen focus: call verify API with `token` from the deep link params.
- Loading → Success ("Email verified", success haptic) → `OnboardingStack` if logged in and onboarding not done, `MainTabs` if done, or `Login` if logged out.
- Invalid/expired token → error message + **Resend email** button.

If the app is not installed, `https://nexity.com/verify-email/:token` shows a web page that verifies the email and offers App Store / Play Store links.

## API

### `POST /api/v1/auth/verify-email`

**Body:** `{ "token": "signed-token" }`  
**Success `200`:** `{ "verified": true }`

### `POST /api/v1/auth/resend-verification`

**Auth:** Bearer required  
**Success `204`**

Rate limit: 3/hour per user.

## Acceptance criteria

- [ ] Tapping the email link on an iPhone and an Android phone opens the app on this screen (not the browser) when installed.
- [ ] Valid token sets `is_verified=true`.
- [ ] Expired token (>24h) rejected with clear message.
- [ ] Resend respects cooldown UI.
