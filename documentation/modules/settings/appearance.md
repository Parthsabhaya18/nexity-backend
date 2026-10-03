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
- Small preview card at the top (sample post card: avatar, username, image placeholder, action row) rendered in the resolved appearance. In light appearance the card uses the selected mood palette.
- On request failure: keep the selected appearance locally, show toast “Couldn’t sync theme. We’ll try again later.”

### Mood

Below the appearance control, a single-choice grid lists the ten moods with emoji and name:

😊 Happy, 😌 Calm, ❤️ Romantic, 😢 Sad, 😡 Angry, 😎 Cool, 🌿 Relaxed, 🔥 Excited, 😴 Tired, 🤩 Motivated.

- The initial mood is **Calm**.
- Selecting a mood applies that mood’s complete palette immediately (no Save button, no restart), with a selection haptic, and stores it on device (`nexity.mood`).
- The palette is the table in [THEMING.md](../../architecture/THEMING.md). Example: Happy sets Background `#FFFBEA`, Surface/Card `#FFFFFF`, Primary `#F5B800`, Button `#D99500`, Text `#2B2200`, Secondary Text `#756A3A`, Border `#F5E7A8`. Calm sets Background `#EFF8FF`, Surface/Card `#FFFFFF`, Primary `#3B82F6`, Button `#1D4ED8`, Text `#0F2747`, Secondary Text `#58708C`, Border `#CFE5FA`. Every other mood uses its own row the same way.
- The mood palette is the light appearance. Dark appearance keeps the dark tokens in THEMING.md. Choosing a mood while dark is resolved switches the preview to the light mood palette so the change is visible; Light / Dark / System can be changed again afterward.
- This grid does not change the `theme` API field (`light` | `dark` | `system`).

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

- [ ] Choosing a mood switches the light palette to that mood’s seven hex values instantly.
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
