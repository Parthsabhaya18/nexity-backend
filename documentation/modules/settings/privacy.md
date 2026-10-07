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
- Allow Secret Messages from: everyone (default) / people I follow / no one (`allow_secret_messages`) — [secret-messages.md](../premium/secret-messages.md).
- Allow Secret Crush from: everyone (default) / people I follow / no one (`allow_secret_crush`) — [secret-crush.md](../premium/secret-crush.md).
- Row → **Blocked accounts** (`BlockedAccounts`).
- Row → **Blocked secret senders** (anonymous blocks; `GET /users/me/secret-blocks`). Rows read "Anonymous sender · blocked 3 Oct" + Unblock — the sender is never shown.

## API

### `PATCH /api/v1/users/me/privacy`

**Body:** partial privacy object.

## Acceptance criteria

- [ ] Switching to private converts new follows to requests.
- [ ] Toggle reverts with an error toast if the request fails.
