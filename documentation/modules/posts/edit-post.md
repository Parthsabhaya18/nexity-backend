# Edit post

**Screen:** `EditPost` (modal, from post ••• → Edit)  
**Deep link:** none  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes (author only)  
**UX reference:** [INSTAGRAM_CONTENT_UX.md](../../architecture/INSTAGRAM_CONTENT_UX.md) — Edit

## Purpose

Edit published post **the same fields Instagram allows** — no media changes.

## UI

Reuse the **details** form from `CreatePostDetails`:

- Header: **Cancel** (left), "Edit info", **Done** (right).
- Edit caption, tag people, location, alt text per slide.
- Toggle hide like count, turn off commenting (if supported).
- Media shown read-only at the top as a swipeable carousel (from existing Cloudinary URLs). No gallery, crop, or reorder; tapping media shows a toast "Media can't be changed after posting".
- Cancel with unsaved changes → confirm "Discard changes?".

On **Done** → dismiss modal; `PostDetail` shows the update with the **Edited** label.

## API

### `PATCH /api/v1/posts/:postId`

**Body (all optional):**

```json
{
  "caption": "Updated text",
  "location_name": null,
  "alt_texts": ["...", "..."],
  "tagged_user_ids": ["uuid"],
  "hide_like_count": true,
  "comments_disabled": false,
  "visibility": "followers"
}
```

**Not accepted (return `400 MEDIA_CHANGE_NOT_ALLOWED`):**

- `media_ids`, new uploads, reorder

**Success `200`:** updated post; set `is_edited: true`.

## Acceptance criteria

- [ ] Non-owner receives 403.
- [ ] Alt text array length must match carousel count.
- [ ] UI matches IG edit post screen structure.
- [ ] Android back and iOS swipe-down on the modal ask before discarding changes.
