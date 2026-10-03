# Welcome

**Screen:** `Welcome` — **not shown** in the current app  
**Status:** Removed from the flow

## Decision

The app opens **directly on `Login`** for logged-out users. There is no Welcome screen with separate **Log in** / **Create account** buttons; `Login` links to `Register` ("New to Nexity? **Create account**").

Startup:

1. Splash (logo + spinner) while the stored refresh token is checked.
2. Valid session → `Home`.
3. No session → `Login` (AuthStack initial route).

Android back on `Login` exits the app.

If a Welcome / intro screen is added later (e.g. onboarding carousel), it should be shown only on first install and must not block returning users.
