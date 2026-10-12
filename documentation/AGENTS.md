# Cursor agent guide — Nexity (Secret Social App)

Read this file first when implementing features. Nexity is a **native iOS + Android app** built with React Native, plus an Express REST API.

| Folder | What |
|--------|------|
| `D:\Nexity\frontend` | React Native 0.87 app (`nexity-mobile`, id `com.nexity.app`) — `android/`, `ios/`, `src/` |
| `D:\Nexity\backend` | Express 5 + Zod API (`nexity-backend`), port 4000, base `/api/v1` |
| `D:\Nexity\backend\documentation` | This documentation (paths below are relative to it) |

## Documentation map

| Start here | Purpose |
|------------|---------|
| [INDEX.md](INDEX.md) | Every screen, deep link, and module doc |
| [overview/PROJECT_OVERVIEW.md](overview/PROJECT_OVERVIEW.md) | Product vision, personas, non-goals, platforms |
| [architecture/MOBILE_APP.md](architecture/MOBILE_APP.md) | **iOS & Android rules**: navigation map, deep links, permissions, native UX, media, storage, offline, release |
| [architecture/TECH_STACK.md](architecture/TECH_STACK.md) | Libraries, repo layout, env vars, media limits |
| [architecture/ROUTING_CONVENTIONS.md](architecture/ROUTING_CONVENTIONS.md) | Screen names + deep links, API conventions, WebSocket |
| [architecture/DATA_MODELS.md](architecture/DATA_MODELS.md) | Shared entities and relationships |
| [architecture/AUTH_AND_SECURITY.md](architecture/AUTH_AND_SECURITY.md) | Tokens in Keychain/Keystore, refresh flow, store rules |
| [architecture/PUSH_NOTIFICATIONS.md](architecture/PUSH_NOTIFICATIONS.md) | FCM / APNs push |
| [architecture/MEDIA_STORAGE.md](architecture/MEDIA_STORAGE.md) | Image/video uploads from the device to AWS S3 and delivery |
| [architecture/INSTAGRAM_CONTENT_UX.md](architecture/INSTAGRAM_CONTENT_UX.md) | Posts, Reels, Stories UX (match Instagram app) |
| [architecture/THEMING.md](architecture/THEMING.md) | Mood themes (each replaces Light / Dark / System for the whole app), plus dark & light |
| [modules/premium/](modules/premium/premium-hub.md) | **Secret Messages, Secret Crush, 3 plans (Free / Plus / Premium), store billing** |
| [modules/premium/razorpay-payments.md](modules/premium/razorpay-payments.md) | **Razorpay payments**: UPI apps, AutoPay, QR, cards, net banking, wallets, server-side amounts, payment security |
| [architecture/SECRET_FEATURES_SECURITY.md](architecture/SECRET_FEATURES_SECURITY.md) | Anonymity, encryption, purchase verification and moderation rules for the Secret features |
| [modules/nearby/nearby-encounters.md](modules/nearby/nearby-encounters.md) | **Nearby**: Bluetooth nearby users (rotating ids, mutual verification), location push, today/yesterday hints in Secret features, audit, test plan |
| [API_QUICK_REFERENCE.md](API_QUICK_REFERENCE.md) | All endpoints |

## How to implement a feature

1. Open the module doc under `modules/<name>/`.
2. Implement the **screen(s)** in `frontend/src/screens/<module>/`, register them in the navigator and the deep-link `linking` config exactly as listed (screen names may change only if INDEX and ROUTING_CONVENTIONS are updated in the same change).
3. Implement the **API endpoints** in `backend/src/modules/<module>/` (routes → controller → service, Zod schemas).
4. Match **validation**, **auth requirements**, and **acceptance criteria** in the module doc.
5. Follow **MOBILE_APP.md** for every screen: safe areas, keyboard, Android back, permissions, offline, accessibility.
6. Verify on **both an Android device/emulator and an iOS simulator** (or note that iOS was not tested if no Mac is available).
7. **Media**: never send post/reel/story binaries through the API; upload from the device to **AWS S3** with `useMediaUpload()` per MEDIA_STORAGE.md.
8. **Posts / Reels / Stories**: create, view, and edit flows must follow **INSTAGRAM_CONTENT_UX.md**.
9. **Theme**: every screen must work in Light, Dark and every mood theme using semantic color tokens per **THEMING.md**. A selected mood replaces Light / Dark / System and re-themes the whole app like Dark mode (no white surfaces), so no element may hard-code a color. Buttons keep their design.
10. If the implementation diverges, update the module doc in the same change (docs are the source of truth).

## Conventions

- **Auth**: JWT access (15 min) + refresh (7 days, rotated) in the JSON body; tokens stored in Keychain/Keystore; protected endpoints return `401` without a valid access token.
- **IDs**: UUID v4 in APIs; expose as strings.
- **Timestamps**: ISO 8601 UTC (`created_at`, `updated_at`); format relative times on the device.
- **Pagination**: cursor-based `?cursor=&limit=` default `limit=20`, max `50`.
- **Errors**: `{ "error": { "code": "SNAKE_CASE", "message": "Human readable" } }`.
- **Navigation params**: ids only, never full objects.
- **Theme**: one exclusive choice: `theme` `light` | `dark` | `system` (default `system`) or a `mood` (default `null`). A mood replaces the theme for the whole app; picking a theme removes the mood; tapping the selected mood again removes it. See **THEMING.md**. No hard-coded colors in components.
- **Platform code**: shared by default; use `Platform.select` / `.ios.tsx` / `.android.tsx` only for differences listed in MOBILE_APP.md.

## Source document

Specification baseline: **Secret_Social_App_Project_Overview_v3.docx** (product owner). Module docs expand v3 into implementable screens and endpoints. If the `.docx` and these docs conflict, ask the user which wins before large refactors.
