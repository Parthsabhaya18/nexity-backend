# Mobile app — iOS & Android

Nexity ships as a **native mobile app for iOS and Android**, built once with **React Native** (`D:\Nexity\frontend`, package `nexity-mobile`). There is no web app in v3. Every module doc describes a **screen** in this app, not a web page.

Read this file before building any screen. Platform-specific rules here apply to every module unless the module says otherwise.

## Platform targets

| | iOS | Android |
|---|-----|---------|
| Minimum OS | iOS 15.1 (React Native 0.87 `min_ios_version_supported`) | Android 7.0, API 24 (`minSdkVersion = 24`) |
| Target / SDK | Latest Xcode + iOS SDK | `targetSdkVersion = 36`, `compileSdkVersion = 37` |
| App id | Bundle ID `com.nexity.app` | Application ID `com.nexity.app` |
| Devices | iPhone (portrait). iPad runs the iPhone layout in v3 | Phones (portrait). Tablets run the phone layout in v3 |
| Orientation | Portrait only (fullscreen video may rotate in Phase 2) | Portrait only |
| Distribution | TestFlight → App Store | Internal testing → Google Play (AAB) |

Build both platforms from the same TypeScript code. Use `Platform.OS` / `Platform.select` only for the differences listed in this doc.

## App structure (`frontend/src`)

```
src/
  app/            # App.tsx, providers (Theme, Query, Auth, SafeArea, GestureHandler)
  navigation/     # RootNavigator, tab + stack navigators, linking config, param types
  screens/        # One folder per module: screens/auth/LoginScreen.tsx, screens/posts/...
  components/     # Shared UI (PostCard, Avatar, BottomSheet, Button, EmptyState...)
  features/       # Hooks + logic per domain (useFeed, useCloudinaryUpload, useChatSocket)
  services/
    api/          # axios client, interceptors, one file per resource (auth.ts, posts.ts...)
    storage/      # secureStore (Keychain/Keystore), keyValue (AsyncStorage)
    push/         # FCM/APNs registration, notification tap routing
  theme/          # tokens, ThemeProvider, useTheme (see THEMING.md)
  config/         # env.ts (API base URL per build)
  assets/         # fonts, brand images (light + dark variants)
```

Path alias `@/` maps to `src/` (already configured with `babel-plugin-module-resolver`).

## Navigation map

Built with **React Navigation 7**: native-stack for screens, bottom-tabs for the main shell. Instagram-style tab bar, 5 tabs, icons only:

```
RootStack (native-stack)
├── AuthStack                       (shown when logged out; no Welcome screen)
│   ├── Login                       initial route
│   ├── Register
│   ├── VerifyEmail                 6-digit code; mode 'register' | 'reset'
│   ├── ForgotPassword
│   └── ResetPassword               after a verified reset code
├── OnboardingStack                 (logged in, onboarding not completed)
│   ├── OnboardingWelcome
│   ├── OnboardingAvatar
│   ├── OnboardingInterests
│   └── OnboardingSuggestions
├── MainTabs (bottom-tabs)          (logged in)
│   ├── HomeTab     → HomeStack     root: Home (feed + stories tray)
│   ├── SearchTab   → SearchStack   root: Explore (search bar on top)
│   ├── CreateTab   → opens CreateSheet (does not switch tab)
│   ├── ReelsTab    → ReelsStack    root: Reels (always dark)
│   └── ProfileTab  → ProfileStack  root: MyProfile
│
│   Shared screens pushed inside any tab stack:
│   PostDetail, UserProfile, Followers, HashtagFeed, ReelDetail,
│   Notifications, Inbox, ChatThread, SavedPosts, FollowRequests,
│   Settings, PrivacySettings, AccountSettings, NotificationSettings,
│   AppearanceSettings, BlockedAccounts, Groups, GroupDetail, AdminModeration
│
└── Modals (presented over tabs)
    ├── CreatePostStack   (fullScreenModal): CreatePostSelect → CreatePostCrop → CreatePostDetails
    ├── CreateReelStack   (fullScreenModal): CreateReelVideo → CreateReelEdit → CreateReelDetails
    ├── CreateStory       (fullScreenModal, always dark camera)
    ├── StoryViewer       (fullScreenModal, transparent, swipe-down to close)
    ├── MediaLightbox     (fullScreenModal, always dark)
    ├── EditPost, EditReel, EditProfile, NewMessage, CreateGroup   (modal / pageSheet)
    └── Bottom sheets (not routes): Comments, ReelComments, Likers, Share, ••• menu, Report
```

Rules:

- **Tab bar** hides on fullscreen screens (Reels uses a dark tab bar; StoryViewer, create flows, ChatThread hide it).
- Tapping the active tab again **scrolls to top**, and a second tap pops to the stack root (Instagram behavior).
- The **Create** tab opens `CreateSheet` with: Post, Reel, Story (and Group if enabled).
- Home header: logo (left), **Notifications** heart and **Messages** icon (right) with unread badges.
- Type every navigator with param lists in `navigation/types.ts` (`RootStackParamList`, `HomeStackParamList`, ...). Pass **ids only** in params, never whole objects.
- Bottom sheets use `@gorhom/bottom-sheet` and are **not** navigation routes, except when opened from a deep link (then open the parent screen and present the sheet).

## Deep links & universal links

Every module doc lists its **Deep link**. The same path works with two prefixes:

| Prefix | Use |
|--------|-----|
| `nexity://` | Custom scheme (push notification taps, in-app links, dev testing) |
| `https://nexity.com/` | iOS **Universal Links** + Android **App Links** (shared links, emails). If the app is not installed, the website shows a "Get the app" page with store badges |

Example: `nexity://posts/123` and `https://nexity.com/posts/123` both open `PostDetail { postId: "123" }`.

Setup:

- **iOS:** add `nexity` to URL Types; enable *Associated Domains* `applinks:nexity.com`; host `https://nexity.com/.well-known/apple-app-site-association`.
- **Android:** `intent-filter` for scheme `nexity` and an `autoVerify="true"` filter for `https://nexity.com`; host `https://nexity.com/.well-known/assetlinks.json` with the release signing SHA-256.
- Configure React Navigation `linking` with both prefixes; map paths exactly as in [ROUTING_CONVENTIONS.md](ROUTING_CONVENTIONS.md).
- If a deep link needs auth and the user is logged out, store the pending link, show Login, then open the link after sign-in (replaces the web `?redirect=`).
- Unknown or invalid paths open Home, never a blank screen.

Email links (verify email, reset password) **must** use `https://nexity.com/...` so they open the app from any mail client.

## Permissions

Ask **only when the feature is used** (just-in-time), never at launch. Show a short in-app explainer before the system prompt. If denied permanently, show an "Open Settings" button (`Linking.openSettings()`). Use `react-native-permissions` for both platforms.

| Feature | iOS `Info.plist` key (usage string required) | Android permission |
|---------|----------------------------------------------|--------------------|
| Camera (story, reel record, avatar) | `NSCameraUsageDescription` | `CAMERA` |
| Microphone (video recording) | `NSMicrophoneUsageDescription` | `RECORD_AUDIO` |
| Photo library read (gallery picker) | `NSPhotoLibraryUsageDescription` (support **Limited** access) | API 33+: `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` (+ `READ_MEDIA_VISUAL_USER_SELECTED` on 34+); API ≤32: `READ_EXTERNAL_STORAGE` |
| Save to gallery (download own media) | `NSPhotoLibraryAddUsageDescription` | API ≤28: `WRITE_EXTERNAL_STORAGE` |
| Push notifications | Requested via `UNUserNotificationCenter` (no plist key) | API 33+: `POST_NOTIFICATIONS` |
| Location (optional "Add location" by GPS) | `NSLocationWhenInUseUsageDescription` | `ACCESS_COARSE_LOCATION` |

Suggested usage strings (iOS):

- Camera: "Nexity uses your camera so you can take photos and videos for posts, reels, and stories."
- Microphone: "Nexity uses your microphone to record sound with your videos."
- Photos: "Nexity needs access to your photos so you can share them."

Also always declare `INTERNET` (Android). Location is optional: typing a location name works without the permission.

## Native UX conventions

| Topic | iOS | Android |
|-------|-----|---------|
| Back | Swipe from left edge + header back button | System **back** button / back gesture; must close sheets and modals first, then pop the stack, then exit from tab root |
| Safe areas | Respect notch / Dynamic Island and home indicator with `react-native-safe-area-context` | Respect status bar, display cutout, and gesture/3-button nav bar; draw **edge-to-edge** (required on targetSdk 35+) |
| Status bar | `barStyle` follows theme; light content on always-dark screens | Same, plus navigation bar color/contrast follows theme |
| Haptics | Light impact on like, selection on tab/segment change (`react-native-haptic-feedback`) | Same, mapped to Android haptic constants |
| Pull to refresh | `RefreshControl` (native spinner) | `RefreshControl` with `colors` from theme |
| Action menus | Bottom sheet (•••) | Same bottom sheet (do not use native Android popup menus) |
| Alerts / confirms | `Alert.alert` (destructive button style for Delete) | `Alert.alert` |
| Share | `Share.share({ url })` native share sheet | Same |
| Fonts | Plus Jakarta Sans (bundled), scale with Dynamic Type | Same, scale with system font size |

General rules:

- **Keyboard:** forms and chat composer must stay visible above the keyboard (`react-native-keyboard-controller` or `KeyboardAvoidingView` with `behavior="padding"` on iOS, `"height"` on Android). Tap outside dismisses keyboard. Set `returnKeyType` and `textContentType` / `autoComplete` (`username`, `password`, `newPassword`, `email`, `oneTimeCode`) so iOS Keychain / Android Autofill work.
- **Lists:** use `FlashList` (or `FlatList`) for feeds, grids, comments, chats. Never map long arrays inside `ScrollView`.
- **Images:** cached image component (`@d11/react-native-fast-image`); request Cloudinary sizes that match the device width × pixel ratio.
- **Touch targets:** at least 44×44 pt (iOS) / 48×48 dp (Android).
- **Accessibility:** every icon button has `accessibilityLabel`; images use the post `alt_text`; support VoiceOver and TalkBack; respect Reduce Motion (skip heart burst and auto-advance animations).
- **Loading:** skeletons (theme `skeleton` token) for first load, spinners only for actions.
- **Toasts:** non-blocking toast at the top below the safe area.

## Media: capture, pick, play

| Need | Library |
|------|---------|
| Gallery grid (Instagram-style picker, multi-select up to 10) | `@react-native-camera-roll/camera-roll` |
| Camera capture (photo + video, flip, flash) | `react-native-vision-camera` |
| Crop (avatar 1:1, post aspects) | Custom crop view with gesture handler + Reanimated, or `react-native-image-crop-picker` for avatar |
| Video playback (feed, reels, stories) | `react-native-video` |
| Video trim | Store `trim_start_ms` / `trim_end_ms` and apply with Cloudinary `so_` / `eo_` transformations (no on-device ffmpeg in v3) |

Rules:

- **iOS HEIC/HEVC:** convert photos to JPEG before upload (picker option or Cloudinary `f_jpg` on delivery); Cloudinary accepts `heic` and `mov` input, so add them to `allowed_formats`.
- **iOS iCloud photos:** assets may need download first; show progress and handle failure.
- **Android content URIs:** pass `content://` URIs straight to the upload (`{ uri, type, name }` multipart); do not copy whole videos into memory.
- Check size and duration **on device before upload** (limits in [TECH_STACK.md](TECH_STACK.md)).
- **Autoplay:** feed videos autoplay muted when ≥ 50% visible. Only one video plays at a time.
- **App state:** pause all video and audio when the app goes to background (`AppState` `background` / `inactive`) or the screen loses focus (`useIsFocused`); resume on return.
- Respect the iOS silent switch for feed videos (start muted); unmuting uses the playback audio category.

## Storage on device

| Data | Where | Notes |
|------|-------|-------|
| Refresh token, access token | **Keychain (iOS) / Keystore-backed EncryptedSharedPreferences (Android)** via `react-native-keychain` | Never in AsyncStorage. See [AUTH_AND_SECURITY.md](AUTH_AND_SECURITY.md) |
| Theme `nexity.theme`, mute preference, recent searches, onboarding step | AsyncStorage | Non-sensitive only |
| Post / reel drafts | AsyncStorage (`nexity.draft.post`, `nexity.draft.reel`) with local media URIs | Survives app restarts; clear after successful share |
| Query cache (optional offline feed) | TanStack Query persister on AsyncStorage | Last feed page shown offline |

On logout: clear tokens, query cache, drafts, and recent searches. Keep the theme value.

## Networking & offline

- `services/api/client.ts` axios instance with base URL from `config/env.ts` and a 15 s timeout (already in the repo).
- **Request interceptor:** attach `Authorization: Bearer <access_token>`, plus `X-App-Version`, `X-Platform` (`ios` | `android`) and `Accept-Language`.
- **Response interceptor:** on `401 TOKEN_EXPIRED`, call `POST /auth/refresh` once (queue parallel requests), retry, and log out if refresh fails.
- Watch connectivity with `@react-native-community/netinfo`. When offline: show a slim "No internet connection" banner, keep cached content visible, disable send/share buttons, and retry automatically when back online.
- Chat WebSocket reconnects with exponential backoff and on app foreground.
- On app foreground, refetch the active screen (TanStack Query `focusManager` wired to `AppState`).

## App lifecycle

1. **Launch:** native splash (`react-native-bootsplash`) stays until theme, tokens, and `GET /app/config` are loaded (max 2 s, then continue with cached values).
2. **Force update:** `GET /api/v1/app/config` returns `min_supported_version` per platform. If the installed version is lower, show a blocking "Update Nexity" screen linking to the App Store / Play Store.
3. **Session restore:** if a refresh token exists, refresh silently and open MainTabs (or OnboardingStack); otherwise AuthStack.
4. **Background → foreground:** refresh unread badges, reconnect the socket, resume video on focused screen.

## Push notifications

FCM for Android and APNs for iOS (via Firebase Cloud Messaging). Full spec in [PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md).

## Development setup

| Step | Command (in `frontend/`) |
|------|--------------------------|
| Start Metro | `npm start` |
| Android device over USB | `npm run reverse` (maps device ports 8081 and 4000 to your PC), then `npm run android` |
| iOS simulator (macOS only) | `cd ios && pod install && cd ..`, then `npx react-native run-ios` |
| Backend API | In `backend/`: `npm run dev` (port **4000**, base `/api/v1`) |

- Development builds call `http://localhost:4000/api/v1` (Android via `adb reverse`; iOS simulator shares the Mac's localhost).
- Production builds call `https://api.nexity.com/api/v1`.
- iOS builds require a Mac with Xcode. Windows developers build Android locally and use a Mac / CI service for iOS.

## Build & release

| | Android | iOS |
|---|---------|-----|
| Debug build | `npm run apk:debug` | Xcode *Debug* scheme |
| Release build | `npm run aab:release` (Play Store), `npm run apk:release` (sideload/testing) | Xcode *Archive* → upload to App Store Connect |
| Signing | Upload keystore (never commit; keep in CI secrets); Play App Signing enabled | Apple Distribution certificate + provisioning profile (automatic signing) |
| Testing channel | Play Console internal testing | TestFlight |
| Versioning | `versionName` = `1.2.0`, `versionCode` +1 every upload | `CFBundleShortVersionString` = `1.2.0`, `CFBundleBuildNumber` +1 every upload |

Store requirements to plan for:

- **Account deletion inside the app** (required by both stores) — [account.md](../modules/settings/account.md).
- **Report and block** for user-generated content (App Store guideline 1.2) — [report.md](../modules/settings/report.md), [block-mute.md](../modules/profile/block-mute.md).
- iOS **Privacy manifest** (`PrivacyInfo.xcprivacy`) and App Store privacy labels; Google Play **Data safety** form.
- Privacy policy and terms URLs reachable from Register and Settings.
- App icons (iOS 1024 px + Android adaptive icon), splash in light and dark.

## Testing

- **Unit / component:** Jest + `@testing-library/react-native`.
- **End-to-end:** Maestro flows run on both an Android emulator and an iOS simulator (login, post create, reel view, story view, DM send, theme switch).
- Test on at least: one small screen (iPhone SE / 5.5" Android), one large notch/punch-hole device, Android 7 (API 24) and the latest Android, iOS 15 and the latest iOS.

## Acceptance criteria (every screen)

- [ ] Works on iOS and Android with no platform-only crashes.
- [ ] Respects safe areas (notch, Dynamic Island, cutout, home indicator, nav bar).
- [ ] Android back button behaves correctly (closes sheet → pops screen → exits app from tab root).
- [ ] Keyboard never covers the focused input or the primary button.
- [ ] Dark appearance and the selected mood palette for light appearance, per [THEMING.md](THEMING.md).
- [ ] Offline state is handled (banner, no crash, retry).
- [ ] Permissions are requested only when needed and denial is handled.
- [ ] VoiceOver / TalkBack can reach every action.
