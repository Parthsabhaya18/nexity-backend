# Admin moderation

**Screen:** `AdminModeration` (Settings → Moderation; row visible only to role `moderator` / `admin`)  
**Deep link:** none  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Role `moderator` or `admin`

## Purpose

Review open reports and take action from the phone.

## UI

- List of report cards (not a table): target thumbnail/preview, target type, reason, reporter, date.
- Top filter chips: Open | Resolved, and by type.
- Tap card → detail view with full content preview and actions: **Dismiss**, **Remove content**, **Warn user**, **Suspend user** (destructive actions confirm with `Alert`).
- Optional note field before resolving.

## API

### `GET /api/v1/admin/reports?status=open`

### `POST /api/v1/admin/reports/:id/resolve`

**Body:** `{ "action": "remove_content", "note": "..." }`

## Acceptance criteria

- [ ] Non-admin receives 403 on all `/admin/*` routes; the Settings row is hidden for them.
- [ ] Resolved reports disappear from open queue.
