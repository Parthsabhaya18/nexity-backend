# Theming — dark & light mode

Every screen in the app must support **light** and **dark** themes. Users pick their theme in **Settings → Appearance** ([appearance.md](../modules/settings/appearance.md)), matching Instagram’s *Light / Dark / System default* setting.

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
| Device | `AsyncStorage`, key `nexity.theme` | Apply theme instantly on launch (while the splash is visible), also when logged out |
| Server | `User.theme_preference` via `PATCH /api/v1/users/me/preferences` | Same theme on every device the user signs in to |

Rules:

1. On app start, read the device value first and render with it (no flash of the wrong theme).
2. After login (or on `GET /api/v1/users/me/preferences`), if the server value differs, apply the server value and overwrite the device value.
3. When the user changes the setting: apply immediately, write the device value, then `PATCH` the server. If the request fails, keep the local choice and retry on next app start.
4. On logout, keep the device value (login/register screens keep the user’s theme).
5. Logged-out screens use the device value, or `system` if none is stored.

## Color tokens

Components must use **semantic tokens only** — never hard-coded hex values in screens or components.

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `background` | `#FFFFFF` | `#000000` | App/page background |
| `surface` | `#FAFAFA` | `#121212` | Cards, list sections, nav bars |
| `surfaceElevated` | `#FFFFFF` | `#262626` | Sheets, modals, menus, popovers |
| `textPrimary` | `#000000` | `#F5F5F5` | Main text, usernames |
| `textSecondary` | `#737373` | `#A8A8A8` | Timestamps, captions meta, hints |
| `border` | `#DBDBDB` | `#363636` | Dividers, input borders |
| `inputBackground` | `#EFEFEF` | `#262626` | Search bar, text fields, chat composer |
| `primary` | `#0095F6` | `#0095F6` | Buttons, links, Follow |
| `primaryText` | `#FFFFFF` | `#FFFFFF` | Text on `primary` |
| `danger` | `#ED4956` | `#ED4956` | Delete, errors |
| `like` | `#FF3040` | `#FF3040` | Filled heart |
| `skeleton` | `#EFEFEF` | `#262626` | Loading placeholders |
| `overlay` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.65)` | Behind sheets and modals |
| `bubbleOutgoing` | `#3797F0` | `#3797F0` | DM bubbles sent by me |
| `bubbleIncoming` | `#EFEFEF` | `#262626` | DM bubbles received |

Story ring gradient, brand colors, and the `like` red are identical in both themes. Text on any background must meet **WCAG AA** contrast (4.5:1 for body text).

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

- Replace the single `colors` object in `frontend/src/theme/index.ts` with `lightColors` / `darkColors` using the tokens above.
- `ThemeProvider` context holds `preference`, `resolved`, and `colors`; expose `useTheme()`.
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

- [ ] Screen renders correctly in light and dark with no hard-coded colors.
- [ ] Switching theme in settings updates the open screen instantly, without app restart.
- [ ] `system` follows OS changes live while the app is open.
- [ ] No flash of the wrong theme on launch or navigation.
- [ ] Always-dark screens stay dark in light mode.
- [ ] Text and icons meet WCAG AA contrast in both themes.
- [ ] Status bar, Android navigation bar, native alerts, and keyboard match the resolved theme on iOS and Android.
