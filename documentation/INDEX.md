# Nexity (Secret Social App) — documentation index

Complete screen-level documentation for v3. Nexity is a **native iOS + Android app** (React Native, `frontend/`) with an Express REST API (`backend/`). Use with [AGENTS.md](AGENTS.md) when working in Cursor.

Every screen's deep link works as `nexity://<path>` and `https://nexity.com/<path>` — see [ROUTING_CONVENTIONS.md](architecture/ROUTING_CONVENTIONS.md).

## Overview & architecture

| Document | Description |
|----------|-------------|
| [overview/PROJECT_OVERVIEW.md](overview/PROJECT_OVERVIEW.md) | Vision, core loops, privacy principles, platforms |
| [architecture/MOBILE_APP.md](architecture/MOBILE_APP.md) | **iOS & Android:** navigation map, deep links, permissions, native UX, media, storage, offline, build & release |
| [architecture/TECH_STACK.md](architecture/TECH_STACK.md) | React Native app, Express backend, libraries, env vars, media limits |
| [architecture/ROUTING_CONVENTIONS.md](architecture/ROUTING_CONVENTIONS.md) | Screen names, deep links, `/api/v1` rules, WebSocket |
| [architecture/DATA_MODELS.md](architecture/DATA_MODELS.md) | Database entities |
| [architecture/AUTH_AND_SECURITY.md](architecture/AUTH_AND_SECURITY.md) | JWT, Keychain/Keystore storage, refresh, privacy, store rules |
| [architecture/PUSH_NOTIFICATIONS.md](architecture/PUSH_NOTIFICATIONS.md) | FCM / APNs, device registration, channels, tap routing |
| [architecture/MEDIA_STORAGE.md](architecture/MEDIA_STORAGE.md) | All image/video storage (AWS S3) & uploads from the device |
| [architecture/INSTAGRAM_CONTENT_UX.md](architecture/INSTAGRAM_CONTENT_UX.md) | Posts, Reels, Stories — IG parity, tabs, gestures |
| [architecture/THEMING.md](architecture/THEMING.md) | Mood themes (replace Light / Dark / System for the whole app), plus dark & light appearance |
| [architecture/SECRET_FEATURES_SECURITY.md](architecture/SECRET_FEATURES_SECURITY.md) | Secret Messages, Secret Crush & payments: anonymity, encryption, purchase verification, moderation, rate limits |

## Authentication & account

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Welcome | not shown (app opens on `Login`) | — | [modules/auth/welcome.md](modules/auth/welcome.md) |
| Login | `Login` (initial) | `login` | [modules/auth/login.md](modules/auth/login.md) |
| Register | `Register` | `register` | [modules/auth/register.md](modules/auth/register.md) |
| Email verification (OTP) | `VerifyEmail` | — | [modules/auth/email-verification.md](modules/auth/email-verification.md) |
| Forgot password (OTP) | `ForgotPassword` | — | [modules/auth/forgot-password.md](modules/auth/forgot-password.md) |
| Reset password | `ResetPassword` | — | [modules/auth/reset-password.md](modules/auth/reset-password.md) |
| Logout | (action in Settings) | — | [modules/auth/logout.md](modules/auth/logout.md) |
| Onboarding | `OnboardingStack` (4 steps) | — | [modules/auth/onboarding.md](modules/auth/onboarding.md) |

## Main tabs

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Home feed | `Home` (HomeTab) | `feed` | [modules/feed/home-feed.md](modules/feed/home-feed.md) |
| Explore | `Explore` (SearchTab) | `explore` | [modules/explore/explore.md](modules/explore/explore.md) |
| Search | `Explore` search mode | `search?q=` | [modules/search/search.md](modules/search/search.md) |
| Notifications | `Notifications` (Home header ♡) | `notifications` | [modules/notifications/notifications.md](modules/notifications/notifications.md) |

## Premium — Secret features & plans

3 plans: **Free**, **Plus** (₹99/month), **Premium** (₹249/month). Feature matrix in [plans-and-billing.md](modules/premium/plans-and-billing.md#12-what-each-plan-unlocks).

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Premium tab (Secret hub) | `Premium` (PremiumTab) | `premium`, `premium/messages`, `premium/crush` | [modules/premium/premium-hub.md](modules/premium/premium-hub.md) |
| Secret Messages (Feature 1) | `Premium` Messages section, `SecretPeoplePicker`, `SecretCompose`, `SecretThread`, reveal overlay | `secret/messages/:threadId` | [modules/premium/secret-messages.md](modules/premium/secret-messages.md) |
| Secret Crush (Feature 2) | `Premium` Secret Crush section, `MatchCelebration`, love-theme `ChatThread` | `secret/matches/:matchId` | [modules/premium/secret-crush.md](modules/premium/secret-crush.md) |
| Plans & billing | `Plans`, `PurchaseSuccess`, `Subscription` | `premium/plans`, `settings/subscription` | [modules/premium/plans-and-billing.md](modules/premium/plans-and-billing.md) |
| Razorpay payments (UPI, AutoPay, QR, cards, net banking, wallets — Android & web) | `Checkout`, `PaymentProcessing`, `PaymentFailed`, `PaymentPending`, `PayByQr` | — | [modules/premium/razorpay-payments.md](modules/premium/razorpay-payments.md) |

## Nearby

Opt-in, off by default. Bluetooth finds verified Nexity users around you, location sends a generic "Someone is near you on Nexity. ✨" push, and Secret Messages / Secret Crush show "This person was near you today / yesterday."

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Nearby people (Bluetooth) | `Nearby` | `nearby` | [modules/nearby/nearby-encounters.md](modules/nearby/nearby-encounters.md) |
| Nearby settings + consent | `NearbySettings`, `NearbyConsent` (modal) | `settings/nearby` | [modules/nearby/nearby-encounters.md](modules/nearby/nearby-encounters.md#112-nearbysettings) |
| Encounter hints in Secret features | Rows in `Premium`, `SecretThread`, `MatchCelebration` | — | [modules/nearby/nearby-encounters.md](modules/nearby/nearby-encounters.md#8-secret-message-integration) |

## Posts

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Create post | `CreatePostCrop` → `CreatePostDetails` (fullscreen modal) | `create/post` | [modules/posts/create-post.md](modules/posts/create-post.md) |
| Post detail | `PostDetail` | `posts/:postId` | [modules/posts/post-detail.md](modules/posts/post-detail.md) |
| Edit post | `EditPost` (modal) | — | [modules/posts/edit-post.md](modules/posts/edit-post.md) |
| Comments | Comments bottom sheet | `posts/:postId/comments` | [modules/posts/comments.md](modules/posts/comments.md) |
| Saved posts | `SavedPosts` | `saved` | [modules/posts/saved-posts.md](modules/posts/saved-posts.md) |
| Post viewer (swipe between a profile's posts) | `PostViewer` | — | [modules/posts/post-viewer.md](modules/posts/post-viewer.md) |

## Reels

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Reels viewer | `Reels` (ReelsTab), `ReelDetail` | `reels`, `reels/:reelId` | [modules/reels/reels-viewer.md](modules/reels/reels-viewer.md) |
| Create reel | `CreateReelStack` (fullscreen modal) | `create/reel` | [modules/reels/create-reel.md](modules/reels/create-reel.md) |
| Edit reel | `EditReel` (modal) | — | [modules/reels/edit-reel.md](modules/reels/edit-reel.md) |
| Reel comments | Bottom sheet on viewer | — | [modules/reels/reel-comments.md](modules/reels/reel-comments.md) |

## Stories

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Stories tray | Component on `Home` | — | [modules/stories/stories-tray.md](modules/stories/stories-tray.md) |
| View story | `StoryViewer` (fullscreen modal) | `stories/:userId/:storyId` | [modules/stories/view-story.md](modules/stories/view-story.md) |
| Create story | `CreateStory` (fullscreen camera) | `create/story` | [modules/stories/create-story.md](modules/stories/create-story.md) |

## Profile & social graph

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Profile | `MyProfile` (from Home header avatar), `UserProfile` | `u/:username` | [modules/profile/profile.md](modules/profile/profile.md) |
| Edit profile | `EditProfile` (modal) | — | [modules/profile/edit-profile.md](modules/profile/edit-profile.md) |
| Followers / following | `Followers` (top tabs) | `u/:username/followers`, `u/:username/following` | [modules/profile/followers.md](modules/profile/followers.md) |
| Follow requests | `FollowRequests` | `follow-requests` | [modules/profile/follow-requests.md](modules/profile/follow-requests.md) |
| Block & mute | `BlockedAccounts` | — | [modules/profile/block-mute.md](modules/profile/block-mute.md) |

## Messaging

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Inbox | `Inbox` (Home header) | `messages` | [modules/messages/inbox.md](modules/messages/inbox.md) |
| Chat thread | `ChatThread` | `messages/:conversationId` | [modules/messages/chat-thread.md](modules/messages/chat-thread.md) |
| New message | `NewMessage` (modal) | — | [modules/messages/new-message.md](modules/messages/new-message.md) |

## Groups (optional v3)

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Groups list | `Groups` | `groups` | [modules/groups/groups-list.md](modules/groups/groups-list.md) |
| Group detail | `GroupDetail` | `groups/:groupId` | [modules/groups/group-detail.md](modules/groups/group-detail.md) |
| Create group | `CreateGroup` (modal) | — | [modules/groups/create-group.md](modules/groups/create-group.md) |

## Settings & safety

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Settings hub | `Settings` | `settings` | [modules/settings/settings-hub.md](modules/settings/settings-hub.md) |
| Privacy | `PrivacySettings` | `settings/privacy` | [modules/settings/privacy.md](modules/settings/privacy.md) |
| Account (incl. delete account) | `AccountSettings` | `settings/account` | [modules/settings/account.md](modules/settings/account.md) |
| Notifications (push preferences) | `NotificationSettings` | `settings/notifications` | [modules/settings/notification-settings.md](modules/settings/notification-settings.md) |
| Theme (Light / Dark / System or a mood) | `AppearanceSettings` | `settings/appearance` | [modules/settings/appearance.md](modules/settings/appearance.md) |
| Report content | Report bottom sheet | — | [modules/settings/report.md](modules/settings/report.md) |
| Saved posts | Profile tab and `SavedPosts` | — | [modules/posts/create-post.md](modules/posts/create-post.md) |

## Developer (debug builds only)

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Component gallery (shared UI in Light / Dark / mood, live permission flow, FollowButton with mocked states, MediaFit + filters + export + upload) | `DevComponents` (Settings → Developer; registered only when `__DEV__`) | — | [modules/content-flow/NEXITY_CONTENT_SOCIAL_FLOW.md](modules/content-flow/NEXITY_CONTENT_SOCIAL_FLOW.md#shared-building-blocks-implemented) |

## Admin (moderators)

| Module | Screen | Deep link | Doc |
|--------|--------|-----------|-----|
| Moderation queue | `AdminModeration` (Settings, role-gated) | — | [modules/admin/moderation.md](modules/admin/moderation.md) |

## API

| Document | Description |
|----------|-------------|
| [API_QUICK_REFERENCE.md](API_QUICK_REFERENCE.md) | Every `/api/v1` endpoint in one list |
