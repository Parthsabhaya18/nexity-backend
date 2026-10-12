# Edit profile

**Screen:** `EditProfile` (modal, from **Edit profile** or the avatar on `Profile`, or the profile card at the top of Settings)  
**Deep link:** none  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## UI

- Header: **Cancel**, "Edit profile", **Done** (disabled until something changes, while the photo uploads, or while the username is taken).
- Avatar at top with **Change profile photo** (or **Add profile photo**) → bottom action sheet: **Take photo** (camera), **Choose from library**, **Remove current photo** (only when there is a photo).
- The photo is resized on the device to at most 640 px (JPEG) and uploaded straight to S3 with `useMediaUpload('avatar')` per [MEDIA_STORAGE.md](../../architecture/MEDIA_STORAGE.md), with a progress overlay on the avatar. A failed upload shows the error and **Try again**. The avatar is shown as a centred circle; a dedicated 1:1 crop screen is not built yet.
- Fields: name, username (live availability check), bio (multiline, counter 0/150), website (`keyboardType="url"`, `autoCapitalize="none"`).
- **Private account** switch: only approved followers see photos and videos (enforced in the follow step).
- Cancel or Android back with unsaved changes → "Discard changes?". Photos uploaded but not saved are deleted when the screen closes.

## Fields & rules

- `display_name` 2–50 characters; `username` 3–30 of `a-z 0-9 . _` and unique; `bio` up to 150 characters (Instagram); `website` up to 200 characters, `https://` is added when no scheme is typed, only `http(s)` URLs with a domain are accepted.
- `avatar_media_id` must be the user's own **ready** media with `purpose: avatar` and kind `image`. When the avatar is replaced or removed, the old file is deleted from S3.
- Counts (`posts_count`, `followers_count`, `following_count`), `role` and `is_verified` cannot be changed here; unknown fields are ignored.

## API

### `PATCH /api/v1/users/me`

**Body:** any subset of `{ "display_name": "Jane", "username": "jane.doe", "bio": "...", "website": "jane.dev", "avatar_media_id": "<24-hex media id>" | null, "is_private": true }`. `avatar_media_id: null` removes the photo.

**Response:** the updated `GET /users/me` shape.

**Errors:** `400 VALIDATION_ERROR` (with `details[].path`), `400 INVALID_AVATAR`, `409 USERNAME_TAKEN` (`details.field = "username"`), `429` after 60 updates in 15 minutes.

## Acceptance criteria

- [ ] New avatar shows everywhere after save (profile, Home header, Settings).
- [ ] Keyboard never hides the active field.
- [ ] Discard prompt on Cancel and Android back when there are changes.
- [ ] Avatar upload works on iOS and Android; a 1:1 crop screen is a follow-up.
