# Theming — mood themes, dark & light appearance

Every screen supports three kinds of theme, chosen in **Settings → Theme** ([appearance.md](../modules/settings/appearance.md)):

- **Light**, **Dark**, or **System default** (the appearance), or
- one of ten **moods** (the **Mood-Based Dynamic Theme System** below).

These are **one single choice**. A mood is a full theme on its own, exactly like Light or Dark. It is applied to the **whole application**: every screen, post, card, sheet, menu, tab bar, top bar, input, chip, story ring, chat bubble, the Secret world, the Premium plan card, the splash and the logged-out screens.

**Rule of thumb: a mood works like Dark mode.** In Dark mode nothing stays white — the page, posts, cards and sheets all take dark colors. With a mood, nothing stays white either — the page, posts, cards and sheets all take that mood's colors. Buttons keep their normal design (shape, size, label, icon); only their colors come from the theme tokens, as they already do in Light and Dark.

The same palette is copied in [PROJECT_OVERVIEW.md](../overview/PROJECT_OVERVIEW.md). This document is the design-system source for implementation.

## Theme choice

| Stored values | Meaning |
|---------------|---------|
| `theme` = `system` | **Default.** Follow the device / OS color scheme and react live when it changes |
| `theme` = `light` | Always light (Nexity default palette) |
| `theme` = `dark` | Always dark |
| `mood` = `null` | **Default.** No mood. `theme` decides what is shown |
| `mood` = `happy` … `motivated` | That mood's theme is shown everywhere. `theme` is kept but not shown |

### Mutual exclusion (required behaviour)

1. **Selecting a mood** turns Light / Dark / System **off** in the UI (none of the three is shown as selected) and applies the mood theme to the whole app at once. Example: Dark is selected, the user taps ❤️ Romantic → Dark is deselected, the whole app turns Romantic.
2. **Selecting Light, Dark or System** removes the mood (`mood = null`) and applies that appearance.
3. **Tapping the selected mood again** removes it (`mood = null`). The app goes back to the stored `theme` (Light / Dark / System) that was active before the mood.
4. Any other "dark mode" switch (for example a quick toggle) also removes the mood.

### Resolved theme

What is actually rendered:

```
if (mood) resolved = { appearance: "light", palette: moodRow(mood) }
else      resolved = { appearance: theme === "system" ? osColorScheme : theme, palette: default }
```

Mood palettes are light-based, so while a mood is on, the app never renders the dark appearance and ignores OS dark-mode changes. When the mood is removed and `theme` is `system`, the app follows the OS again immediately.

## Persistence & sync

| Layer | Storage | Purpose |
|-------|---------|---------|
| Device | `AsyncStorage`, key `nexity.theme` | Light / Dark / System, applied instantly on launch (while the splash is visible), also when logged out |
| Device | `AsyncStorage`, key `nexity.mood` | Selected mood, or `null` for none. Initial value: `null` |
| Server | `User.theme_preference` and `User.mood` via `PATCH /api/v1/users/me/preferences` | Same theme choice on every device the user signs in to |

Rules:

1. On app start, read the device values first and render with them (no flash of the wrong theme). If `nexity.mood` is set, render the mood theme from the first frame, including the splash.
2. After login (or on `GET /api/v1/users/me/preferences`), if the server values differ, apply the server values and overwrite the device values.
3. When the user changes the choice: apply immediately, write both device values, then `PATCH` the server with both `theme` and `mood`. If the request fails, keep the local choice and retry on next app start.
4. On logout, keep the device theme and mood (login/register screens keep both).
5. Logged-out screens use the device values, or `system` and no mood if none are stored.

## Mood-Based Dynamic Theme System

### Purpose

When a mood is selected, the whole application takes that mood's colors, the same way Dark mode recolors the whole application. The hierarchy mirrors Dark mode: a slightly deeper page, lighter cards and sheets on top, a mood accent, a darker mood action color, and dark mood text.

### Supported moods

😊 Happy, 😌 Calm, ❤️ Romantic, 😢 Sad, 😡 Angry, 😎 Cool, 🌿 Relaxed, 🔥 Excited, 😴 Tired, 🤩 Motivated.

Names are exact. Do not add moods. No mood is selected by default.

### Complete color palette

| Mood         | Base      | Page & Sheet | Surface/Card | Primary   | Button    | Text      | Secondary Text | Border    |
| ------------ | --------- | ------------ | ------------ | --------- | --------- | --------- | -------------- | --------- |
| 😊 Happy     | `#FFFBEA` | `#FEF4D3`    | `#FEF6DA`    | `#F5B800` | `#D99500` | `#2B2200` | `#756A3A`      | `#F5E7A8` |
| 😌 Calm      | `#EFF8FF` | `#DDECFE`    | `#E2F0FE`    | `#3B82F6` | `#1D4ED8` | `#0F2747` | `#58708C`      | `#CFE5FA` |
| ❤️ Romantic  | `#FFF1F5` | `#FDE0EC`    | `#FEE5EF`    | `#EC4899` | `#BE185D` | `#3B0A1E` | `#87506A`      | `#F7C6D8` |
| 😢 Sad       | `#EEF2FF` | `#E0E4FE`    | `#E4E8FE`    | `#6366F1` | `#4338CA` | `#171B3A` | `#626A91`      | `#D5D9F5` |
| 😡 Angry     | `#FFF1F1` | `#FDE0E0`    | `#FEE5E5`    | `#EF4444` | `#B91C1C` | `#350909` | `#824343`      | `#F6CACA` |
| 😎 Cool      | `#F5F3FF` | `#EAE4FE`    | `#EEE8FE`    | `#8B5CF6` | `#6D28D9` | `#21133D` | `#6B5A82`      | `#DDD4FE` |
| 🌿 Relaxed   | `#F1FAF4` | `#DCF5E5`    | `#E3F6EA`    | `#22C55E` | `#15803D` | `#0B2B18` | `#557562`      | `#CBEBD5` |
| 🔥 Excited   | `#FFF5ED` | `#FEE8D8`    | `#FFECDE`    | `#F97316` | `#C2410C` | `#351306` | `#875D45`      | `#F6D0BA` |
| 😴 Tired     | `#F5F3F7` | `#EAE7EF`    | `#EEEBF1`    | `#8B7FA8` | `#625477` | `#292432` | `#756D7D`      | `#DDD8E5` |
| 🤩 Motivated | `#EEFDFD` | `#D7F6F9`    | `#DEF8FA`    | `#06B6D4` | `#0E7490` | `#062B32` | `#4C7278`      | `#BFE8EE` |

Base is the mood's light base color; derived tokens mix into it. Page & Sheet is Primary mixed 10% into Base (page background, bottom sheets, modals, menus). Surface/Card is Primary mixed 7% into Base (posts including the post header, cards, top bar, tab bar). Both are clearly tinted so nothing reads as white, and the page sits one step deeper than the cards on it (like `#0B1120` page / `#111827` card in Dark mode).

### Meaning of each color role

1. **Page & Sheet** — Main screen background, splash, logged-out screens, and the background of bottom sheets, modals and menus. Tokens: `background`, `surfaceElevated`.
2. **Surface/Card** — Posts (including the header row with avatar, username and •••), cards, list sections, the top bar and the floating tab bar. **Never `#FFFFFF` while a mood is on.** Token: `surface`.
3. **Primary** — Main mood accent: active states, selected tabs, the Premium crown, important icons, highlights, story rings, toast icons, focus rings. Token: `primary`.
4. **Button** — Action fill: primary buttons, send buttons, my chat bubbles, the active tab label. Token: `button`. Label color: `primaryText` `#FFFFFF`.
5. **Text** — Headings, body and outline icons. Token: `textPrimary`.
6. **Secondary Text** — Descriptions, metadata, timestamps, hints. Token: `textSecondary`.
7. **Border** — Inputs, cards, separators, outlines, dividers. Token: `border`.

### Derived mood tokens

Every other token is computed from the seven roles. Components never hard-code a mood hex.

| Token | Value while a mood is on | Used by |
|-------|--------------------------|---------|
| `inputBackground` | Border 30% over Base | Search bar, text fields, chat composer |
| `surfaceMuted` | Border 50% over Base | Chips, segmented controls, incoming chat bubble, icon tiles (not the action buttons inside sheets, which keep their normal light colors) |
| `surfaceStrong` | Border 80% over Base | Pressed / hover states, skeletons |
| `primarySoft` | Primary 16% over Base | Selected chip / row backgrounds, post image placeholder |
| `accentGradient` | Primary → Button (135°) | Create (+) button, Secret buttons, active Premium tab, splash progress |
| `storyRing` | Primary → Button → Primary | Story rings |
| `shadow*` | Text color at 7–18% | Cards, sheets, floating tab bar |
| `shadowPrimary` | Button at 34% | Primary buttons, Create (+) button |
| `overlay` | Text color at 50% | Behind sheets and modals |
| `secretGradient` | Button darkened toward `#060A1C` | Secret tab hero, Secret screens, locked secret cards, sealed messages, anonymous avatars, secret notification icons |
| `secretGlow` | Primary 55% over `#FFFFFF` | Highlights and focus rings inside the Secret world |
| `premiumGradient` | Button darkened toward `#060A1C` → Button | Premium plan card, Get Premium button, Premium chips and badges |

### Example: the post ••• menu sheet

With ❤️ Romantic on, only the **sheet background** follows the theme: it is Page & Sheet `#FDE0EC` (not white), and the grabber and "Cancel" text use mood tokens. The **buttons inside the sheet stay exactly as they are in the normal light theme**: the grouped action list keeps `#F1F5F9` with `#E2E8F0` dividers and pressed state, labels and icons `#0F172A`, and "Report post" / "Block" keep `danger`. The same applies to the Create sheet options (Post, Reel) and every other menu sheet.

### Dynamic theme behavior

Selecting a mood applies its full row and the derived tokens to every open screen at once, without restart.

Romantic selected: Page & Sheet `#FDE0EC`, Surface/Card `#FEE5EF`, Primary `#EC4899`, Button `#BE185D`, Text `#3B0A1E`, Secondary Text `#87506A`, Border `#F7C6D8`. Posts (including the post header row), cards, the top bar and the floating tab bar turn `#FEE5EF` on a `#FDE0EC` page; sheets turn `#FDE0EC`. The Create (+) button, active tab, Premium crown and story rings turn pink. The Secret tab hero and Premium plan card turn deep pink.

Every other mood follows the same roles from the table.

### What does not change with the mood

- Button design: shape, size, labels, icons, and which button style each action uses. Only their colors come from tokens (as in Light and Dark).
- Status colors: `success`, `warning`, `danger`, `like` (filled heart), and the notification count badge.
- The Nexity logo artwork.
- User photos and videos. They are never tinted.
- The black background of always-dark media screens (below). Their accents (progress, selected filter, record ring) do follow the mood.

### Visual hierarchy

MOOD PAGE → MOOD SURFACE/CARD → LIGHT/MEDIUM MOOD ACCENTS → PRIMARY MOOD COLOR → DARK MOOD BUTTON / CTA → DARK MOOD TEXT.

### UI consistency rules

- Components read semantic tokens only. They do not hard-code mood hex values, and they do not hard-code the default blue or `#FFFFFF` for a surface either. A hard-coded color means that element will not follow the mood (or Dark mode).
- Primary is emphasis. Button is the action fill. Do not use Primary as the primary-button fill.
- Selected tabs, the Premium crown and story rings use Primary. The active tab label uses Button.

### Contrast and readability

Text on Page and on Surface/Card, and white text on Button, must meet WCAG AA (4.5:1 for body text).

### Single source of truth

The table above is the only mood palette. Dark appearance hex values and status colors below are not mood colors. Do not replace them with a mood hex.

## Color tokens

Components use **semantic tokens only**.

- **Mood on:** every token comes from the mood row plus the derived mood tokens above. `primaryText` is `#FFFFFF`.
- **No mood, light:** the Nexity default light palette.
- **No mood, dark:** the dark column below.

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
| `skeleton` | `#262626` | Loading placeholders (light `#EFEFEF`; mood: Border 80% over Base) |
| `skeletonHighlight` | `#363636` | Moving shimmer on skeletons (light `#FAFAFA`; mood: Base) |
| `overlay` | `rgba(0,0,0,0.65)` | Behind sheets and modals |
| `bubbleOutgoing` | `#3797F0` | DM bubbles sent by me |
| `bubbleIncoming` | `#262626` | DM bubbles received |

Mood-independent tokens while a mood is on:

| Token | Value | Usage |
|-------|-------|-------|
| `primaryText` | `#FFFFFF` | Text on Button |
| `bubbleOutgoing` | mood `button` | DM bubbles sent by me |
| `bubbleIncoming` | mood `surfaceMuted` | DM bubbles received |

Status colors stay the same in every theme. They are not part of the mood palette:

| Token | Value | Usage |
|-------|-------|-------|
| `danger` | `#ED4956` | Delete, errors |
| `like` | `#FF3040` | Filled heart |

## Always-dark screens

Like Instagram, immersive media screens stay **black regardless of theme**:

- Reels viewer and reel comments sheet backdrop ([reels-viewer.md](../modules/reels/reels-viewer.md))
- Story viewer and story editor/camera ([view-story.md](../modules/stories/view-story.md), [create-story.md](../modules/stories/create-story.md))
- Reel editor / video trim ([create-reel.md](../modules/reels/create-reel.md))
- Fullscreen media lightbox

Their accents use the current theme's `primary`. Sheets opened on top of these screens (comments, share, ••• menu) use the **current theme's** `surfaceElevated`.

## Media & assets

- Never tint, invert, or filter user photos/videos for dark mode or a mood.
- Logos and app icons that are black-on-transparent need a light and a dark variant.
- Icons use `textPrimary` (outline) so they follow every theme; filled heart stays `like`.
- Placeholder avatars and empty-state illustrations need both variants or use tokens.

## Implementation — React Native (iOS & Android)

- `ThemeProvider` holds `theme` (`light` | `dark` | `system`), `mood` (mood id or `null`), the resolved appearance, and `colors`. Expose `useTheme()` with `setTheme(value)` (also clears `mood`) and `setMood(id)` (toggles: the same id again clears it).
- `colors` is built once per change: mood row + derived mood tokens when `mood` is set, otherwise the default light or dark tokens. Do not invent extra mood hex values.
- `ThemeScope` (`src/theme/ThemeProvider.tsx`) renders a subtree in another resolved theme; `useAppTheme()` reads it first. Used by the dev component gallery and by the app-root hosts (`ToastHost`, `PermissionHost`) so a toast or permission sheet takes the theme of the screen that opened it.
- Read the OS scheme with `useColorScheme()` / `Appearance.addChangeListener` only when `theme` is `system` and no mood is set.
- Pass a matching theme to React Navigation `NavigationContainer` (extend `DefaultTheme` / `DarkTheme` with the tokens above) so headers, the tab bar, and card backgrounds follow the mood too.
- Build styles from `colors` (e.g. a `makeStyles(colors)` helper); no hex values in component files.
- Hold the native splash (`react-native-bootsplash`) until the stored theme and mood are read to avoid a flash. Provide **light and dark splash** assets; the JS splash screen that follows uses `background` so it already shows the mood.
- Bottom sheets (`@gorhom/bottom-sheet` `backgroundStyle` = `surfaceElevated`), `RefreshControl` (`tintColor` iOS, `colors` Android), `TextInput` (`placeholderTextColor`, `selectionColor`, `keyboardAppearance` on iOS) must take colors from the theme.

### iOS

- `Info.plist`: keep `UIUserInterfaceStyle` **unset** (Automatic) so `useColorScheme()` reports the real OS value.
- Status bar: `barStyle` `dark-content` in light and in every mood, `light-content` in dark and on always-dark screens.
- Native alerts, the share sheet, and date pickers follow the system scheme; call `Appearance.setColorScheme(resolvedAppearance)` (`light` while a mood is on) so native UI matches the app.

### Android

- Theme in `styles.xml` extends `Theme.AppCompat.DayNight.NoActionBar` (or Material3 DayNight); set `android:forceDarkAllowed="false"` so the OS never auto-inverts the app.
- Edge-to-edge: status bar and navigation bar are transparent; set icon contrast per theme (dark icons in light and moods, light icons in dark).
- `Appearance.setColorScheme(resolvedAppearance)` also switches native dialogs and the date picker.
- Splash: `values/` and `values-night/` drawables / colors.

## Backend

- Store `theme_preference` (default `system`) and `mood` (nullable, default `null`) on the user ([DATA_MODELS.md](DATA_MODELS.md)).
- `GET /api/v1/users/me/preferences` and `PATCH /api/v1/users/me/preferences` — see [appearance.md](../modules/settings/appearance.md).
- Include `preferences.theme` and `preferences.mood` in the `user` object returned by `POST /auth/login` so the client can apply them right after sign-in.
- Transactional emails use a light layout with colors that remain readable when mail clients force dark mode.

## Acceptance criteria (every screen)

- [ ] Selecting a mood deselects Light / Dark / System and re-themes the **whole app** instantly: page, posts, cards, sheets and menus, top bar, floating tab bar, inputs, Create (+) button, active tab, Premium crown, chips, story rings, chat bubbles, Secret screens and the Premium plan card.
- [ ] With a mood on, **no surface is white** — exactly like no surface is white in Dark mode.
- [ ] Buttons keep their normal design in every theme; only their colors follow the tokens.
- [ ] Selecting Light / Dark / System removes the mood instantly.
- [ ] Tapping the selected mood again removes it and returns to the stored Light / Dark / System.
- [ ] Primary buttons use Button with white text. Selected tabs and story rings use Primary.
- [ ] `danger` and `like` do not change with the theme.
- [ ] `system` follows OS changes live while the app is open and no mood is set.
- [ ] No flash of the wrong theme or mood on launch or navigation.
- [ ] Always-dark screens stay dark in every theme.
- [ ] Text and icons meet WCAG AA contrast in every theme.
- [ ] Status bar, Android navigation bar, native alerts, and keyboard match the resolved appearance on iOS and Android.
