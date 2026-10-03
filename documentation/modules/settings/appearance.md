# Theme settings (appearance and mood)

**Screen:** `AppearanceSettings` (Settings → Theme)  
**Deep link:** `nexity://settings/appearance`  
**Auth required:** Yes  
**Theme spec:** [THEMING.md](../../architecture/THEMING.md)

## Purpose

Let the user pick **one theme for the whole app**: **Light**, **Dark**, **System default**, or one of ten **moods**. A mood is a full theme, like Light or Dark: it recolors every screen the way Dark mode does (no white surfaces left), while buttons keep their normal design. The choice applies instantly and syncs to every device the user signs in to.

## UI

- Reached from the **Theme** row in the [settings hub](settings-hub.md). The row shows the active choice on the right: the mood name with emoji when a mood is on (e.g. "❤️ Romantic"), otherwise "Light", "Dark" or "System default".
- Small preview card at the top (sample post card: avatar, username, image placeholder, action row) rendered in the active theme.

### Appearance

Segmented control with three options:

| Option | Value | Helper text |
|--------|-------|-------------|
| Light | `light` | — |
| Dark | `dark` | — |
| System default | `system` | "Match your device's display setting" |

- While a mood is on, **none** of the three is shown as selected and the helper reads "Off while a mood is on · pick one to remove the mood".
- Selecting an option sets `theme`, **removes the mood** (`mood = null`), and applies the new theme immediately to the whole app (no Save button, no restart), with a selection haptic. Status bar, Android navigation bar, and native alerts switch too (`Appearance.setColorScheme`).

### Mood

Below the appearance control, a grid lists the ten moods with emoji and name:

😊 Happy, 😌 Calm, ❤️ Romantic, 😢 Sad, 😡 Angry, 😎 Cool, 🌿 Relaxed, 🔥 Excited, 😴 Tired, 🤩 Motivated.

- No mood is selected by default.
- **Tap a mood:** it becomes selected, Light / Dark / System is deselected, and the mood theme is applied to the **whole application** at once — page, posts, cards, sheets and menus, top bar, floating tab bar, inputs, story rings, the Secret world and the Premium card. Toast: "❤️ Romantic theme".
- **Tap the selected mood again:** the mood is removed and the app returns to the stored Light / Dark / System choice. Toast: "Mood removed".
- **Pick Light / Dark / System** (here or from any dark-mode toggle): the mood is removed.
- The helper under the "Mood" title shows the current mood name (or "No mood") and "replaces Light/Dark/System · tap again to remove".
- Colors come from the palette and derived tokens in [THEMING.md](../../architecture/THEMING.md). Example: Romantic sets Page & Sheet `#FDE0EC`, Surface/Card `#FEE5EF`, Primary `#EC4899`, Button `#BE185D`, Text `#3B0A1E`, Secondary Text `#87506A`, Border `#F7C6D8`.
- The choice is stored on device (`nexity.mood`) and synced to the server with `theme`.

## API

### `GET /api/v1/users/me/preferences`

**Auth:** Bearer required

**Success `200`:**

```json
{
  "theme": "system",
  "mood": "romantic",
  "updated_at": "2026-10-03T06:30:00Z"
}
```

`mood` is `null` when no mood is selected.

### `PATCH /api/v1/users/me/preferences`

**Auth:** Bearer required

**Body** (send either field or both):

```json
{
  "theme": "dark",
  "mood": null
}
```

- `theme`: `light` | `dark` | `system`
- `mood`: `happy` | `calm` | `romantic` | `sad` | `angry` | `cool` | `relaxed` | `excited` | `tired` | `motivated` | `null`

The client sends `mood: null` together with the new `theme` when the user picks Light / Dark / System, and sends the new `mood` (or `null` when it is tapped off) when the user taps a mood.

**Success `200`:** same shape as `GET`.

**Errors:**

| Code | HTTP | When |
|------|------|------|
| `VALIDATION_ERROR` | 400 | Body empty, or `theme` / `mood` not one of the allowed values |
| `UNAUTHORIZED` | 401 | No / invalid access token |

### Login response

`POST /api/v1/auth/login` includes the preferences in `user`:

```json
{
  "user": {
    "id": "uuid",
    "username": "jane_doe",
    "preferences": { "theme": "dark", "mood": null }
  }
}
```

## Business rules

- Defaults for new accounts: `theme = system`, `mood = null`.
- A non-null `mood` always wins over `theme` for what is rendered. `theme` is kept so it can come back when the mood is removed.
- Server values win after login; afterwards the client writes local first, then syncs (see [THEMING.md](../../architecture/THEMING.md) persistence rules).
- Unknown values from older clients are rejected with `400`, never stored.

## Acceptance criteria

- [ ] Tapping a mood deselects Light / Dark / System and re-themes the whole app instantly, with no white surface left (same as Dark mode).
- [ ] Buttons keep their normal design in every theme. In sheets and menus only the background follows the mood; the action buttons keep their normal light colors.
- [ ] Tapping the selected mood again removes it and the previous Light / Dark / System comes back.
- [ ] Choosing Light / Dark / System removes the mood and switches every open screen instantly.
- [ ] System default follows OS dark-mode changes live (iOS Control Center toggle, Android quick-settings dark theme tile) when no mood is on.
- [ ] Choice survives app restart and logout (device storage).
- [ ] Choice syncs across devices after login.
- [ ] Settings hub row shows the active choice.
- [ ] Offline change is kept locally and synced on next launch.

## Cursor checklist

- [ ] `ThemeProvider` + `useTheme()` with AsyncStorage persistence (`nexity.theme`, `nexity.mood`)
- [ ] `AppearanceSettingsScreen` with segmented control, mood grid (toggle) and preview, tested on iOS and Android
- [ ] `GET` / `PATCH /users/me/preferences` endpoints + Zod validation for `theme` and `mood`
- [ ] `theme_preference` (default `system`) and `mood` (nullable) columns, and `preferences.theme` / `preferences.mood` in the login response
