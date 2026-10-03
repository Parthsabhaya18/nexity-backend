# Edit profile

**Screen:** `EditProfile` (modal, from **Edit profile** on `MyProfile` or Settings → Profile)  
**Deep link:** none  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## UI

- Header: **Cancel**, "Edit profile", **Done**.
- Avatar at top with **Change profile photo** → action sheet: **Take photo** (camera), **Choose from library**, **Remove current photo**. Permissions requested when chosen.
- 1:1 circular crop before upload; resize to 640×640 on device; upload via Cloudinary (`purpose: avatar`) with a progress overlay on the avatar.
- Fields (each opens an inline input): display name, username, bio (multiline, counter 0/500), website (`keyboardType="url"`, `autoCapitalize="none"`).
- Cancel with changes → "Discard changes?"; Android back behaves the same.

## Fields & rules

- display_name, bio, website (URL validated), avatar.
- Username change: max once per 14 days (optional rule); live availability check.

## API

### `PATCH /api/v1/users/me`

**Body:** partial profile fields, e.g. `{ "display_name": "Jane", "bio": "...", "website": "https://...", "avatar_media_id": "uuid" }`.

## Acceptance criteria

- [ ] Avatar crop UI 1:1 before upload, on iOS and Android.
- [ ] New avatar shows everywhere after save (profile, feed header, tray) — invalidate cached image URLs.
- [ ] Keyboard never hides the active field.
