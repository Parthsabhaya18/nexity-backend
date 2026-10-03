# Appearance (theme) settings

**Screen:** `AppearanceSettings` (Settings → Appearance)  
**Deep link:** `nexity://settings/appearance`  
**Auth required:** Yes  
**Theme spec:** [THEMING.md](../../architecture/THEMING.md)

## Purpose

Let the user choose **Light**, **Dark**, or **System default** theme, the same way Instagram’s *Settings → Theme* works. The choice applies instantly and syncs to every device the user signs in to.

## UI

- Reached from the **Appearance** row in the [settings hub](settings-hub.md); the row shows the current value on the right (e.g. “System default”).
- Single-choice radio list:

| Option | Value | Helper text |
|--------|-------|-------------|
| Light | `light` | — |
| Dark | `dark` | — |
| System default | `system` | “Match your device’s display setting” |

- Selecting an option applies the new theme **immediately** to the whole app (no Save button, no restart), with a selection haptic. Status bar, Android navigation bar, and native alerts switch too (`Appearance.setColorScheme`).
- Small preview card at the top (sample post card: avatar, username, image placeholder, action row) rendered in the selected theme.
- On request failure: keep the selected theme locally, show toast “Couldn’t sync theme. We’ll try again later.”

## API

### `GET /api/v1/users/me/preferences`

**Auth:** Bearer required

**Success `200`:**

```json
{
  "theme": "system",
  "updated_at": "2026-10-03T06:30:00Z"
}
```

### `PATCH /api/v1/users/me/preferences`

**Auth:** Bearer required

**Body:**

```json
{
  "theme": "dark"
}
```

`theme`: `light` | `dark` | `system`

**Success `200`:** same shape as `GET`.

**Errors:**

| Code | HTTP | When |
|------|------|------|
| `VALIDATION_ERROR` | 400 | `theme` missing or not one of the allowed values |
| `UNAUTHORIZED` | 401 | No / invalid access token |

### Login response

`POST /api/v1/auth/login` includes the preference in `user`:

```json
{
  "user": {
    "id": "uuid",
    "username": "jane_doe",
    "preferences": { "theme": "dark" }
  }
}
```

## Business rules

- Default for new accounts: `system`.
- Server value wins after login; afterwards the client writes local first, then syncs (see [THEMING.md](../../architecture/THEMING.md) persistence rules).
- Unknown values from older clients are rejected with `400`, never stored.

## Acceptance criteria

- [ ] Choosing Light / Dark switches every open screen instantly.
- [ ] System default follows OS dark-mode changes live (iOS Control Center toggle, Android quick-settings dark theme tile) without restarting the app.
- [ ] Choice survives app restart and logout (device storage).
- [ ] Choice syncs across devices after login.
- [ ] Settings hub row shows the current choice.
- [ ] Offline change is kept locally and synced on next launch.

## Cursor checklist

- [ ] `ThemeProvider` + `useTheme()` with AsyncStorage persistence (`nexity.theme`)
- [ ] `AppearanceSettingsScreen` with radio list + preview, tested on iOS and Android
- [ ] `GET` / `PATCH /users/me/preferences` endpoints + Zod validation
- [ ] `theme_preference` column (default `system`) and `preferences.theme` in login response
