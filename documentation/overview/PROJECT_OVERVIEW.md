# Secret Social App — project overview (v3)

## Product summary

**Secret Social App** is a privacy-aware social network where people share posts, short-form reels, ephemeral stories, and direct messages. Users control visibility (public, followers-only, close friends), can use a **display identity** separate from legal account data, and expect strong safety tooling (block, report, moderation).

Baseline name: **Secret_Social_App_Project_Overview_v3.docx**.

## Goals

- Fast, familiar social UX (feed, reels, stories, DMs) with clearer privacy defaults than legacy networks.
- Pseudonymous-friendly profiles where allowed by policy (username + avatar, minimal PII on public surfaces).
- Safe sharing: reporting, blocks, rate limits, and moderation queue for staff.
- Comfortable in any lighting: full **dark and light appearance** on every screen, chosen in Settings → Theme (Light / Dark / System default).
- A **mood-based dynamic theme**: when the user selects a mood, it replaces Light / Dark / System and the whole application switches to that mood's colors, the same way Dark mode recolors everything (see below and [THEMING.md](../architecture/THEMING.md)).

## Mood-Based Dynamic Theme System

### Purpose

A mood is a full theme, like Light or Dark. Theme and mood are **one exclusive choice**:

- Selecting a mood deselects Light / Dark / System and applies the mood to the **whole application** (every screen, post, card, sheet, menu, tab bar, input, story ring, the Secret world and the Premium card).
- Selecting Light / Dark / System removes the mood.
- Tapping the selected mood again removes it, and the previous Light / Dark / System comes back.

It works like Dark mode: no surface stays white. The palette keeps a clear hierarchy: a slightly deeper mood page, mood-tinted cards and sheets on top, a mood accent, a darker mood action color, and dark mood text. Buttons keep their normal design; only their colors come from the theme.

This section and [THEMING.md](../architecture/THEMING.md) are the same palette. If another document disagrees, this palette wins.

### Supported moods

Use these names exactly. Use the emoji when a screen shows the mood visually.

- 😊 Happy
- 😌 Calm
- ❤️ Romantic
- 😢 Sad
- 😡 Angry
- 😎 Cool
- 🌿 Relaxed
- 🔥 Excited
- 😴 Tired
- 🤩 Motivated

No other moods are part of this system. No mood is selected by default.

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

Page & Sheet is Primary mixed 10% into Base; Surface/Card is Primary mixed 7% into Base. Both are clearly tinted so nothing reads as white, and cards sit on a slightly deeper page (like Dark mode's card on page). In sheets and menus only the background follows the mood; the action buttons inside keep their normal light colors.

### Meaning of each color role

1. **Page & Sheet** — Main screen and page background, splash, logged-out screens, and the background of sheets, modals and menus.
2. **Surface/Card** — Posts (including the post header row), cards, containers, the top bar and the tab bar. Never `#FFFFFF` while a mood is on.
3. **Primary** — Main mood accent. Use it for active states, selected tabs, important icons, highlights, story rings, and other accent elements.
4. **Button** — Darker action and call-to-action color. Use it for primary buttons and important interactive actions. Button text is a high-contrast light color (`#FFFFFF`).
5. **Text** — Main heading and body text. It must stay strong against Background and Surface/Card.
6. **Secondary Text** — Supporting text, descriptions, metadata, timestamps, and hints.
7. **Border** — Inputs, cards, separators, outlines, and subtle dividers.

### Dynamic theme behavior

When the user selects a mood, the whole app updates immediately to that mood's full palette. No restart is required.

Happy selected:

- Page & Sheet → `#FEF4D3`
- Surface/Card → `#FEF6DA`
- Primary → `#F5B800`
- Button → `#D99500`
- Text → `#2B2200`
- Secondary Text → `#756A3A`
- Border → `#F5E7A8`

Calm selected:

- Page & Sheet → `#DDECFE`
- Surface/Card → `#E2F0FE`
- Primary → `#3B82F6`
- Button → `#1D4ED8`
- Text → `#0F2747`
- Secondary Text → `#58708C`
- Border → `#CFE5FA`

The same mapping applies to Romantic, Sad, Angry, Cool, Relaxed, Excited, Tired, and Motivated.

While a mood is on, Light / Dark / System is not applied. The mood palette does not redefine dark-mode hex values. Success, error, warning, and destructive colors are not mood colors.

### Visual hierarchy

```
MOOD PAGE
↓
MOOD SURFACE/CARD
↓
LIGHT/MEDIUM MOOD ACCENTS
↓
PRIMARY MOOD COLOR
↓
DARK BUTTON / CTA
↓
DARK TEXT
```

### UI consistency rules

- Screens and components use these semantic roles. They do not hard-code a different mood hex.
- Primary marks selection and emphasis. Button marks the main action.
- Mood surfaces sit on the slightly deeper mood page so cards stay distinct. No surface is white while a mood is on.
- Buttons keep their normal design; only their colors come from the theme.
- Story rings and selected tabs use Primary. Primary button labels use white.
- Always-dark media screens (reels viewer, story viewer, editors) stay dark. Sheets opened on top of them use the current appearance.

### Contrast and readability

Text and Secondary Text must remain readable on Page and on Surface/Card. Body text targets WCAG AA (4.5:1). Button text on Button targets the same bar with white. Do not replace Text with Primary, and do not place Primary text on a Primary fill.

### Single source of truth

The table in this section is the only mood palette. Do not introduce another mood, rename a mood, or substitute a different hex. Status colors (success, error, warning, destructive actions, the like heart) stay outside this table.

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
