# Group detail

**Screen:** `GroupDetail` (pushed)  
**Deep link:** `nexity://groups/:groupId` · `https://nexity.com/groups/:groupId`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)

## UI

- Collapsing header: cover image, name, description, member count, **Join / Leave** (leave asks for confirmation).
- Feed of group-only posts (same post card as Home), pull-to-refresh.
- ••• → Share group (native share sheet), Report, Leave.

## API

### `GET /api/v1/groups/:groupId`

### `GET /api/v1/groups/:groupId/posts`

### `POST /api/v1/groups/:groupId/join`

### `POST /api/v1/groups/:groupId/leave`

## Acceptance criteria

- [ ] Private groups require invite or approval (flag on group).
- [ ] Shared link opens this screen in the app.
