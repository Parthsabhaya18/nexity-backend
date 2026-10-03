# Theming — mood palette, dark & light appearance

Every screen supports a **light** and a **dark** appearance. Users choose Light, Dark, or System default in **Settings → Appearance** ([appearance.md](../modules/settings/appearance.md)).

The **light** appearance is the **Mood-Based Dynamic Theme System** below. Selecting a mood replaces the light palette immediately. The same palette is copied in [PROJECT_OVERVIEW.md](../overview/PROJECT_OVERVIEW.md). This document is the design-system source for implementation.

## Theme preference

| Value | Meaning |
|-------|---------|
| `system` | **Default.** Follow the device / OS color scheme and react live when it changes |
| `light` | Always light |
| `dark` | Always dark |

The **resolved theme** (what is actually rendered) is always `light` or `dark`:

```
resolved = preference === "system" ? osColorScheme : preference
```

## Persistence & sync

| Layer | Storage | Purpose |
|-------|---------|---------|
| Device | `AsyncStorage`, key `nexity.theme` | Apply Light / Dark / System instantly on launch (while the splash is visible), also when logged out |
| Device | `AsyncStorage`, key `nexity.mood` | Apply the selected mood palette with the light appearance. Initial value: `calm` |
| Server | `User.theme_preference` via `PATCH /api/v1/users/me/preferences` | Same Light / Dark / System value on every device the user signs in to |

Rules:

1. On app start, read the device value first and render with it (no flash of the wrong theme).
2. After login (or on `GET /api/v1/users/me/preferences`), if the server value differs, apply the server value and overwrite the device value.
3. When the user changes the setting: apply immediately, write the device value, then `PATCH` the server. If the request fails, keep the local choice and retry on next app start.
4. On logout, keep the device appearance value and the selected mood (login/register screens keep both).
5. Logged-out screens use the device appearance value, or `system` if none is stored, and the stored mood, or Calm if none is stored.

## Mood-Based Dynamic Theme System

### Purpose

The light appearance follows the selected mood. Hierarchy stays fixed: light page, white surface, mood accent, darker button, dark text. Do not fill every element with the mood color.

### Supported moods

😊 Happy, 😌 Calm, ❤️ Romantic, 😢 Sad, 😡 Angry, 😎 Cool, 🌿 Relaxed, 🔥 Excited, 😴 Tired, 🤩 Motivated.

Names are exact. Do not add moods. The initial mood is **Calm** (`calm`).

### Complete color palette

| Mood         | Background | Surface/Card | Primary   | Button    | Text      | Secondary Text | Border    |
| ------------ | ---------- | ------------ | --------- | --------- | --------- | -------------- | --------- |
| 😊 Happy     | `#FFFBEA`  | `#FFFFFF`    | `#F5B800` | `#D99500` | `#2B2200` | `#756A3A`      | `#F5E7A8` |
| 😌 Calm      | `#EFF8FF`  | `#FFFFFF`    | `#3B82F6` | `#1D4ED8` | `#0F2747` | `#58708C`      | `#CFE5FA` |
| ❤️ Romantic  | `#FFF1F5`  | `#FFFFFF`    | `#EC4899` | `#BE185D` | `#3B0A1E` | `#87506A`      | `#F7C6D8` |
| 😢 Sad       | `#EEF2FF`  | `#FFFFFF`    | `#6366F1` | `#4338CA` | `#171B3A` | `#626A91`      | `#D5D9F5` |
| 😡 Angry     | `#FFF1F1`  | `#FFFFFF`    | `#EF4444` | `#B91C1C` | `#350909` | `#824343`      | `#F6CACA` |
| 😎 Cool      | `#F5F3FF`  | `#FFFFFF`    | `#8B5CF6` | `#6D28D9` | `#21133D` | `#6B5A82`      | `#DDD4FE` |
| 🌿 Relaxed   | `#F1FAF4`  | `#FFFFFF`    | `#22C55E` | `#15803D` | `#0B2B18` | `#557562`      | `#CBEBD5` |
| 🔥 Excited   | `#FFF5ED`  | `#FFFFFF`    | `#F97316` | `#C2410C` | `#351306` | `#875D45`      | `#F6D0BA` |
| 😴 Tired     | `#F5F3F7`  | `#FFFFFF`    | `#8B7FA8` | `#625477` | `#292432` | `#756D7D`      | `#DDD8E5` |
| 🤩 Motivated | `#EEFDFD`  | `#FFFFFF`    | `#06B6D4` | `#0E7490` | `#062B32` | `#4C7278`      | `#BFE8EE` |

### Meaning of each color role

1. **Background** — Main screen and page background. Lightest mood-specific color. Token: `background`.
2. **Surface/Card** — Cards, containers, sheets, elevated sections, and content surfaces. Always `#FFFFFF`. Tokens: `surface`, `surfaceElevated`.
3. **Primary** — Main mood accent: active states, selected tabs, important icons, highlights, story rings. Token: `primary`.
4. **Button** — Darker call-to-action fill for primary buttons and important actions. Token: `button`. Label color: `primaryText` `#FFFFFF`.
5. **Text** — Headings and body. Token: `textPrimary`.
6. **Secondary Text** — Descriptions, metadata, timestamps, hints. Token: `textSecondary`.
7. **Border** — Inputs, cards, separators, outlines, dividers. Token: `border`.

### Dynamic theme behavior

Selecting a mood applies that row at once on the light appearance.

Happy selected: Background `#FFFBEA`, Surface/Card `#FFFFFF`, Primary `#F5B800`, Button `#D99500`, Text `#2B2200`, Secondary Text `#756A3A`, Border `#F5E7A8`.

Calm selected: Background `#EFF8FF`, Surface/Card `#FFFFFF`, Primary `#3B82F6`, Button `#1D4ED8`, Text `#0F2747`, Secondary Text `#58708C`, Border `#CFE5FA`.

Romantic, Sad, Angry, Cool, Relaxed, Excited, Tired, and Motivated follow the same seven roles from the table.

### Visual hierarchy

LIGHT BACKGROUND → WHITE SURFACE/CARD → LIGHT/MEDIUM MOOD ACCENTS → PRIMARY MOOD COLOR → DARK BUTTON / CTA → DARK TEXT.

### UI consistency rules

- Components read semantic tokens. They do not hard-code mood hex values.
- Primary is emphasis. Button is the action fill. Do not use Primary as the primary-button fill.
- Story rings use Primary.
- User photos and videos are not tinted to match the mood.

### Contrast and readability

Text on Background and on Surface/Card, and white text on Button, must meet WCAG AA (4.5:1 for body text).

### Single source of truth

The table above is the only mood palette. Dark appearance hex values and status colors below are not mood colors. Do not replace them with a mood hex.

## Color tokens

Components use **semantic tokens only**.

When the resolved appearance is **light**, `background`, `surface`, `surfaceElevated`, `textPrimary`, `textSecondary`, `border`, `primary`, and `button` come from the selected mood row. `primaryText` is `#FFFFFF`.

When the resolved appearance is **dark**, use the dark column. The mood table does not define dark hex values.

| Token | Dark | Usage |
|-------|------|-------|
| `background` | `#000000` | App/page background |
| `surface` | `#121212` | Cards, list sections, nav bars |
| `surfaceElevated` | `#262626` | Sheets, modals, menus, popovers |
| `textPrimary` | `#F5F5F5` | Main text, usernames |
| `textSecondary` | `#A8A8A8` | Timestamps, captions meta, hints |
| `border` | `#363636` | Dividers, input borders |
| `inputBackground` | `#262626` | Search bar, text fields, chat composer |
| `primary` | `#0095F6` | Links and accents while dark (not a mood Primary) |
| `button` | `#0095F6` | Primary buttons while dark |
| `primaryText` | `#FFFFFF` | Text on `button` |
| `skeleton` | `#262626` | Loading placeholders |
| `overlay` | `rgba(0,0,0,0.65)` | Behind sheets and modals |
| `bubbleOutgoing` | `#3797F0` | DM bubbles sent by me |
| `bubbleIncoming` | `#262626` | DM bubbles received |

Light appearance still uses these non-mood tokens:

| Token | Light | Usage |
|-------|-------|-------|
| `inputBackground` | `#FFFFFF` | Field fill; outline uses mood Border |
| `primaryText` | `#FFFFFF` | Text on Button |
| `skeleton` | `#EFEFEF` | Loading placeholders |
| `overlay` | `rgba(0,0,0,0.5)` | Behind sheets and modals |
| `bubbleOutgoing` | mood `button` | DM bubbles sent by me |
| `bubbleIncoming` | `#EFEFEF` | DM bubbles received |

Status colors stay the same in both appearances. They are not part of the mood palette:

| Token | Value | Usage |
|-------|-------|-------|
| `danger` | `#ED4956` | Delete, errors |
| `like` | `#FF3040` | Filled heart |

The Nexity logo colors are brand artwork, not mood tokens. The filled heart stays `like`.

## Always-dark screens

Like Instagram, immersive media screens stay **black regardless of theme**:

- Reels viewer and reel comments sheet backdrop ([reels-viewer.md](../modules/reels/reels-viewer.md))
- Story viewer and story editor/camera ([view-story.md](../modules/stories/view-story.md), [create-story.md](../modules/stories/create-story.md))
- Reel editor / video trim ([create-reel.md](../modules/reels/create-reel.md))
- Fullscreen media lightbox

Sheets opened on top of these screens (comments, share, ••• menu) use the **current theme’s** `surfaceElevated`.

## Media & assets

- Never tint, invert, or filter user photos/videos for dark mode.
- Logos and app icons that are black-on-transparent need a light and a dark variant.
- Icons use `textPrimary` (outline) so they flip automatically; filled heart stays `like`.
- Placeholder avatars and empty-state illustrations need both variants or use tokens.

## Implementation — React Native (iOS & Android)

- `ThemeProvider` holds appearance `preference` (`light` | `dark` | `system`), selected `mood`, `resolved` appearance, and `colors`. Expose `useTheme()`.
- When `resolved` is `light`, fill `background`, `surface`, `surfaceElevated`, `textPrimary`, `textSecondary`, `border`, `primary`, and `button` from the mood table. When `resolved` is `dark`, use the dark column. Do not invent extra mood hex values.
- Read the OS scheme with `useColorScheme()` / `Appearance.addChangeListener` when preference is `system`.
- Pass a matching theme to React Navigation `NavigationContainer` (extend `DefaultTheme` / `DarkTheme` with the tokens above) so headers, tab bar, and card backgrounds follow.
- Build styles from `colors` (e.g. a `makeStyles(colors)` helper); no hex values in component files.
- Hold the native splash (`react-native-bootsplash`) until the stored theme is read to avoid a flash. Provide **light and dark splash** assets.
- Bottom sheets (`@gorhom/bottom-sheet`), `RefreshControl` (`tintColor` iOS, `colors` Android), `TextInput` (`placeholderTextColor`, `selectionColor`, `keyboardAppearance` on iOS) must take colors from the theme.

### iOS

- `Info.plist`: keep `UIUserInterfaceStyle` **unset** (Automatic) so `useColorScheme()` reports the real OS value.
- Status bar: `barStyle` `dark-content` in light, `light-content` in dark and on always-dark screens.
- Native alerts, the share sheet, and date pickers follow the system scheme; when preference is `light`/`dark`, call `Appearance.setColorScheme(resolved)` so native UI matches the app.

### Android

- Theme in `styles.xml` extends `Theme.AppCompat.DayNight.NoActionBar` (or Material3 DayNight); set `android:forceDarkAllowed="false"` so the OS never auto-inverts the app.
- Edge-to-edge: status bar and navigation bar are transparent; set icon contrast per theme (light icons on dark, dark icons on light).
- `Appearance.setColorScheme(resolved)` also switches native dialogs and the date picker.
- Splash: `values/` and `values-night/` drawables / colors.

## Backend

- Store `theme_preference` on the user ([DATA_MODELS.md](DATA_MODELS.md)); default `system`.
- `GET /api/v1/users/me/preferences` and `PATCH /api/v1/users/me/preferences` — see [appearance.md](../modules/settings/appearance.md).
- Include `preferences.theme` in the `user` object returned by `POST /auth/login` so the client can apply it right after sign-in.
- Transactional emails use a light layout with colors that remain readable when mail clients force dark mode.

## Acceptance criteria (every screen)

- [ ] Screen renders correctly in light (selected mood palette) and dark with no hard-coded mood colors.
- [ ] Selecting a mood updates Background, Surface/Card, Primary, Button, Text, Secondary Text, and Border to that row immediately, without restart.
- [ ] Primary buttons use Button with white text. Selected tabs and story rings use Primary.
- [ ] Switching Light / Dark / System updates the open screen instantly, without app restart.
- [ ] `danger` and `like` do not change when the mood changes.
- [ ] `system` follows OS changes live while the app is open.
- [ ] No flash of the wrong theme on launch or navigation.
- [ ] Always-dark screens stay dark in light mode.
- [ ] Text and icons meet WCAG AA contrast in both themes.
- [ ] Status bar, Android navigation bar, native alerts, and keyboard match the resolved theme on iOS and Android.
