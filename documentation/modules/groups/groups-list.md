# Groups list

**Screen:** `Groups` (from the ☰ menu on `MyProfile`, or Create sheet → Group)  
**Deep link:** `nexity://groups`  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes  
**Note:** Optional v3 module — implement after core feed/DMs.

## Purpose

List communities the user joined or created, and discover new ones.

## UI

- Top tabs: **Joined** | **Discover**.
- Row: cover thumbnail, name, member count, unread posts dot.
- Header **+** → `CreateGroup` modal.

## API

### `GET /api/v1/groups?membership=joined|discover`

## Acceptance criteria

- [ ] Empty state links to create group.
