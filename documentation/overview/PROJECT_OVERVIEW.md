# Secret Social App — project overview (v3)

## Product summary

**Secret Social App** is a privacy-aware social network where people share posts, short-form reels, ephemeral stories, and direct messages. Users control visibility (public, followers-only, close friends), can use a **display identity** separate from legal account data, and expect strong safety tooling (block, report, moderation).

Baseline name: **Secret_Social_App_Project_Overview_v3.docx**.

## Goals

- Fast, familiar social UX (feed, reels, stories, DMs) with clearer privacy defaults than legacy networks.
- Pseudonymous-friendly profiles where allowed by policy (username + avatar, minimal PII on public surfaces).
- Safe sharing: reporting, blocks, rate limits, and moderation queue for staff.
- Comfortable in any lighting: full **dark and light theme** on every screen, chosen in Settings → Appearance (Light / Dark / System default).

## Primary personas

| Persona | Needs |
|---------|--------|
| **Creator** | Post/reel tools, insights (later), audience growth |
| **Consumer** | Endless feed/reels, saves, notifications |
| **Private user** | Private account, follow requests, DMs from followers only |
| **Moderator** | Review reports, remove content, suspend accounts |

## Core user loops

1. **Register → verify email → onboarding → home feed**
2. **Create post/reel/story → notifications → engagement (like/comment)**
3. **Discover (explore/search) → follow → personalized feed**
4. **Message → real-time chat → optional media**

## Non-goals (v3)

- E-commerce checkout, live streaming studio, or full algorithm transparency UI.
- Selling user data or showing ads in MVP docs (hooks may exist later).

## Platform targets

- **iOS app** (iPhone, iOS 15.1+) and **Android app** (Android 7.0+, API 24) — one React Native codebase in `frontend/`, published to the App Store and Google Play. No web app in v3.
- **API**: versioned REST under `/api/v1` (Express, `backend/`) plus WebSocket `/ws/v1/chat` for real-time messages and typing.
- **Push notifications** on both platforms (FCM / APNs) for likes, comments, follows, and messages.
- **Links** (`https://nexity.com/...`) open the app directly via Universal Links (iOS) and App Links (Android).

Details: [MOBILE_APP.md](../architecture/MOBILE_APP.md).

## Module dependency order (build suggestion)

0. App shell: navigation (tabs + stacks), theme, API client, secure token storage, splash
1. Auth (login, register, JWT, refresh)
2. Profile + follow graph
3. Posts + feed (Cloudinary upload from device)
4. Notifications + push
5. Reels
6. Stories
7. Messages
8. Explore/search, groups, admin

See [INDEX.md](../INDEX.md) for every documented screen.
