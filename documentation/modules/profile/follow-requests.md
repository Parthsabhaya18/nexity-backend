# Follow requests

**Screen:** `FollowRequests` (from the summary row on `Notifications` or the **Follow requests** row on `Profile`)  
**Deep link:** `nexity://follow-requests`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes (private accounts)

## UI

- Row: avatar, username, display name, **Confirm** (primary) and **Delete** buttons.
- Accepted rows change to a **Follow back** button.
- Pull-to-refresh; empty state "No pending requests".
- Switching the account from private to public accepts every pending request.

## API

### `GET /api/v1/users/me/follow-requests`

**Query:** `cursor`, `limit`.  
**Success:** `{ "items": [{ "id", "user": UserSummary, "created_at" }], "total": 3, "next_cursor": null }`

`GET /users/me` also returns `follow_requests_count`.

### `POST /api/v1/follow-requests/:id/accept`

**Success:** `{ "user": UserSummary }` (the requester, with the viewer's follow state for **Follow back**).  
**Errors:** `404 NOT_FOUND` (request was withdrawn or already handled).

### `POST /api/v1/follow-requests/:id/decline`

**204.**

## Acceptance criteria

- [x] Badge count on the Home notifications bell includes pending requests.
- [ ] `follow_request` push notification opens this screen (with push, later step).
