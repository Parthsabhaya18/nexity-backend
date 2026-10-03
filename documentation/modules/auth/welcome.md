# Welcome

**Screen:** `Welcome` (AuthStack initial route)  
**Deep link:** none  
**Theme:** Dark & light from device setting (logged out) — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** No

## Purpose

First screen for logged-out users after the splash: brand + two clear choices.

## UI

- Logo (light/dark variant) and short tagline centered.
- Primary button **Create new account** → `Register`.
- Secondary button **Log in** → `Login`.
- Footer: Terms and Privacy Policy links (in-app browser).
- Shown only when there is no stored refresh token; a returning signed-in user never sees it.

## Acceptance criteria

- [ ] Appears after splash on first install on iOS and Android.
- [ ] Android back exits the app.
- [ ] Respects safe areas on notch / Dynamic Island / punch-hole devices.
