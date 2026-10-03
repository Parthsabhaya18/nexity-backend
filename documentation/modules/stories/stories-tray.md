# Stories tray

**Screen:** component at the top of `Home` (list header of the feed)  
**Deep link:** none  
**Theme:** Dark & light (tray background and usernames use tokens; ring gradient same in both) — [THEMING.md](../../architecture/THEMING.md)

## Purpose

Horizontal list of followed users with active stories; "+" for own story.

## UI

- Horizontal `FlatList`, no scroll indicator; first item is **Your story**.
- Rings: gradient = unseen, gray = seen; username under each avatar (truncate).
- Tap avatar → `StoryViewer` for that user, continuing through the tray order.
- **Your story:** "+" badge opens `CreateStory` if none; otherwise opens viewer (long-press → "Add to story").
- While your story is uploading, show a progress ring on your avatar.

## API

### `GET /api/v1/stories/tray`

```json
{
  "data": [
    {
      "user": { "id", "username", "avatar_url" },
      "latest_story_id": "uuid",
      "seen": false,
      "story_count": 3
    }
  ]
}
```

## Acceptance criteria

- [ ] Expired stories disappear from tray within 60 s of expiry (refetch on pull-to-refresh, app foreground, and every 60 s while visible).
- [ ] Ring turns gray immediately after viewing (optimistic).
- [ ] Prefetch the first story image of the first few users for instant open.
