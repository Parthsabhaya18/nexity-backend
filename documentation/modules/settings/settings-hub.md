# Settings hub

**Screen:** `Settings` (from the ☰ menu on `MyProfile`)  
**Deep link:** `nexity://settings`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Sections

Grouped native-style list (iOS inset grouped look; Android full-width rows with section headers), with a search field at the top (optional v3).

| Row | Opens |
|-----|-------|
| Edit profile | `EditProfile` (modal) |
| Account | `AccountSettings` |
| Privacy | `PrivacySettings` |
| Notifications | `NotificationSettings` — see [notification-settings.md](notification-settings.md) |
| Theme (Light / Dark / System default, or a mood — one choice for the whole app) | `AppearanceSettings` — see [appearance.md](appearance.md) |
| Nearby (off by default; Bluetooth, location notifications, Nearby push) | `NearbySettings` — see [nearby-encounters.md](../nearby/nearby-encounters.md#112-nearbysettings) |
| Blocked accounts | `BlockedAccounts` |
| Help & support | In-app browser (help center) |
| Privacy Policy, Terms of Use | In-app browser |
| About | App version + build (e.g. "Version 1.0.0 (12)"), platform |
| Log out | Confirm `Alert` → [logout.md](../auth/logout.md) |
| Moderation (moderators only) | `AdminModeration` |

## Acceptance criteria

- [ ] Grouped list layout looks native on iOS and Android.
- [ ] Theme row shows the active choice: the mood name with emoji when a mood is on, otherwise Light / Dark / System default.
- [ ] Notifications row shows "Off" when OS notification permission is denied.
- [ ] About shows the real app version and build number.
