# Account settings

**Screen:** `AccountSettings` (Settings → Account)  
**Deep link:** `nexity://settings/account`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)

## Features

- Change email (verify new email via `https://nexity.com/verify-email/:token` link that opens the app).
- Change password (current password required; `textContentType="password"` / `"newPassword"`).
- Download my data (request queue — stub OK in MVP).
- **Delete account** (confirm by typing username). **Required by the App Store and Google Play:** account deletion must be possible inside the app, not only by email/website.

## API

### `POST /api/v1/users/me/change-password`

Revokes refresh tokens on all **other** devices.

### `POST /api/v1/users/me/delete`

Schedules deletion in 30 days or immediate per policy (document chosen behavior: **immediate soft delete** default). Removes push devices and revokes all sessions.

## Acceptance criteria

- [ ] Delete removes public profile, unregisters push, and logs the user out to `Welcome` on this device.
- [ ] Delete account flow is reachable within 3 taps from the profile (store review requirement).
- [ ] Google Play listing also provides a web URL for deletion requests (store requirement).
