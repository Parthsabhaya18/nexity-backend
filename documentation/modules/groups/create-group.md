# Create group

**Screen:** `CreateGroup` (modal from `Groups` or the Create sheet)  
**Deep link:** none  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)

## UI

- Header: **Cancel**, "New group", **Create**.
- Cover photo picker (gallery, optional; Cloudinary upload), name, description, visibility (Public / Private).
- On success: dismiss modal and push `GroupDetail`.

## API

### `POST /api/v1/groups`

**Body:**

```json
{
  "name": "Photography",
  "description": "Share shots",
  "visibility": "public",
  "cover_media_id": null
}
```

## Acceptance criteria

- [ ] Creator is admin member with post permission.
