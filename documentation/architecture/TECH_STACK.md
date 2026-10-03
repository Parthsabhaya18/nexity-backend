# Tech stack (v3 implementation)

Nexity is a **native iOS + Android app** (React Native) talking to a **Node.js REST API**. Align code with this unless the repo already chooses differently; if it does, update this file in the same change.

## Mobile app (`frontend/`, package `nexity-mobile`)

| Layer | Choice | Status |
|-------|--------|--------|
| Framework | React Native **0.87** (New Architecture) + React 19 | Installed |
| Language | TypeScript | Installed |
| Navigation | React Navigation 7 — `native-stack` + `bottom-tabs` (+ `material-top-tabs` for profile / followers tabs) | `native-stack` installed |
| Native screens & safe area | `react-native-screens`, `react-native-safe-area-context` | Installed |
| HTTP | axios (`services/api/client.ts`) | Installed |
| Server state | TanStack Query (`@tanstack/react-query`) | Add |
| Forms | React Hook Form + Zod (`@hookform/resolvers`) | Add |
| Gestures & animation | `react-native-gesture-handler`, `react-native-reanimated` | Add |
| Bottom sheets | `@gorhom/bottom-sheet` | Add |
| Lists | `@shopify/flash-list` | Add |
| Secure token storage | `react-native-keychain` (iOS Keychain / Android Keystore) | Add |
| Key-value storage | `@react-native-async-storage/async-storage` | Add |
| Images | `@d11/react-native-fast-image` (cached) | Add |
| Video | `react-native-video` | Add |
| Camera | `react-native-vision-camera` | Add |
| Gallery | `@react-native-camera-roll/camera-roll` | Add |
| Permissions | `react-native-permissions` | Add |
| Push | `@react-native-firebase/messaging` + `@notifee/react-native` ([PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md)) | Add |
| Network status | `@react-native-community/netinfo` | Add |
| Splash | `react-native-bootsplash` | Add |
| Keyboard | `react-native-keyboard-controller` | Add |
| Haptics | `react-native-haptic-feedback` | Add |
| Realtime | Native `WebSocket` to `/ws/v1/chat` | Built in |
| Media upload | Direct signed upload from the device to Cloudinary ([CLOUDINARY.md](CLOUDINARY.md)) | — |
| Theming | `ThemeProvider` + `useColorScheme` + semantic tokens ([THEMING.md](THEMING.md)) | Add |
| Testing | Jest + React Native Testing Library; Maestro E2E on both platforms | Jest installed |

Platform rules, navigation map, permissions, and release process: **[MOBILE_APP.md](MOBILE_APP.md)**.

## Backend (`backend/`, package `nexity-backend`)

| Layer | Choice | Status |
|-------|--------|--------|
| Runtime | Node.js ≥ 22.11, TypeScript | Installed |
| HTTP framework | Express 5 + `helmet`, `compression`, `cors`, `pino-http` | Installed |
| Validation | Zod 4 (request bodies, query, env) | Installed |
| Auth | JWT access (15 min) + refresh (7 days) with rotation | Add |
| DB | MongoDB (local `mongod` in development, MongoDB Atlas in production) via Mongoose 9 — connection in `src/config/database.ts` | Installed |
| Cache / pub-sub | Redis (rate limits, refresh token families, presence, chat fan-out) | Add |
| Realtime | WebSocket server (`ws`) at `/ws/v1/chat` | Add |
| **Media** | **Cloudinary** — posts, reels, stories, avatars, DM attachments | Add |
| Video processing | Cloudinary eager transformations / streaming profiles (no self-hosted ffmpeg) | — |
| Push | `firebase-admin` (FCM → Android, APNs → iOS) | Add |
| Email | Transactional provider (verify email, reset password) | Add |
| Testing | Vitest + Supertest | Installed |

Code layout follows the existing pattern: `src/modules/<module>/<module>.routes.ts`, `.controller.ts`, `.service.ts`, `.schema.ts` (Zod), mounted under `/api/v1` in `src/routes/index.ts`. Errors use `ApiError` and the shared error handler.

## Repository layout

```
D:\Nexity\
  backend\                # Express API (port 4000, /api/v1)
    src\modules\...       # One folder per API module
    documentation\        # This documentation (source of truth)
  frontend\               # React Native app (iOS + Android)
    android\              # Gradle project, com.nexity.app
    ios\                  # Xcode project, Nexity.xcworkspace
    src\                  # App code (see MOBILE_APP.md)
```

Shared types: keep request/response Zod schemas in the backend; mirror TypeScript types in `frontend/src/services/api/types.ts` (or extract a shared package later).

## Environment variables

### Backend (`backend/.env`)

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default `4000`) |
| `MONGODB_URI` | MongoDB connection string (`mongodb://` or `mongodb+srv://`); required except in tests |
| `MONGODB_DB_NAME` | Database name (default `nexity`); `nexity_dev` locally, `nexity` in production |
| `MONGODB_MAX_POOL_SIZE`, `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | Driver tuning (defaults `10`, `10000`) |
| `REDIS_URL` | Cache, chat, rate limits |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Token signing |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Media signing |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Push notifications |
| `APP_LINK_BASE_URL` | `https://nexity.com` — base for email links that open the app (universal / app links) |
| `IOS_MIN_VERSION`, `ANDROID_MIN_VERSION` | Force-update threshold returned by `GET /app/config` |
| `CORS_ORIGINS` | Only for the admin/web tools if any; native apps do not need CORS |

### Mobile (`frontend/src/config/env.ts`)

| Value | Debug | Release |
|-------|-------|---------|
| `apiBaseUrl` | `http://localhost:4000/api/v1` (via `adb reverse` on Android) | `https://api.nexity.com/api/v1` |
| `wsUrl` | `ws://localhost:4000/ws/v1/chat` | `wss://api.nexity.com/ws/v1/chat` |
| `appLinkBaseUrl` | `https://nexity.com` | `https://nexity.com` |

Never put secrets (Cloudinary secret, JWT secrets, Firebase private key) in the mobile app — anything in the bundle can be extracted.

## Media limits (default)

Enforce **on the device before upload**, at the API sign endpoint, and in the Cloudinary preset.

| Type | Max size | Max duration | Accepted input |
|------|----------|--------------|----------------|
| Post image | 10 MB | — | jpg, png, webp, heic |
| Post video | 100 MB | 10 min | mp4, mov |
| Reel | 100 MB | 90 sec | mp4, mov |
| Story | 50 MB | 60 sec | jpg, png, heic, mp4, mov |
| Avatar | 2 MB (after on-device resize) | — | jpg, png, heic |

Document changes in the relevant module file when limits change.
