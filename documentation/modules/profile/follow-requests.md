# Follow requests

**Screen:** `FollowRequests` (from the summary row on `Notifications` or the ☰ menu on `MyProfile`)  
**Deep link:** `nexity://follow-requests`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes (private accounts)

## UI

- Row: avatar, username, display name, **Confirm** (primary) and **Delete** buttons.
- Accepted rows change to a **Follow back** button.
- Pull-to-refresh; empty state "No pending requests".

## API

### `GET /api/v1/users/me/follow-requests`

### `POST /api/v1/follow-requests/:id/accept`

### `POST /api/v1/follow-requests/:id/decline`

## Acceptance criteria

- [ ] Badge count on the Notifications heart when pending > 0.
- [ ] `follow_request` push notification opens this screen.
