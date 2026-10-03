# Privacy settings

**Screen:** `PrivacySettings` (Settings → Privacy)  
**Deep link:** `nexity://settings/privacy`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)

## Toggles

Native switches (`Switch` with theme `primary` track color); changes save immediately.

- Private account (confirm sheet: "Only your followers will see your photos and videos. Existing followers are kept.").
- Allow mentions from: everyone / followers.
- Allow DMs from: everyone / followers / none.
- Show activity status (online).
- Remove location data from my photos (`strip_location_metadata`, default on).
- Row → **Blocked accounts** (`BlockedAccounts`).

## API

### `PATCH /api/v1/users/me/privacy`

**Body:** partial privacy object.

## Acceptance criteria

- [ ] Switching to private converts new follows to requests.
- [ ] Toggle reverts with an error toast if the request fails.
