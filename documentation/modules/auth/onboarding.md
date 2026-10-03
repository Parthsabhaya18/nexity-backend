# Onboarding

**Screens:** `OnboardingStack` → `OnboardingWelcome`, `OnboardingAvatar`, `OnboardingInterests`, `OnboardingSuggestions`  
**Deep link:** none  
**Theme:** Dark & light — [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes (shown after first verified login while `onboarding_completed` is false)

## Purpose

Collect avatar, bio, interest tags, suggest accounts to follow, and ask for notification permission.

## Flow

1. **Welcome** — skip allowed → `MainTabs`.
2. **Avatar** — **Take photo** (camera) or **Choose from library**; 1:1 crop; or skip. Ask camera / photo permission only when the user taps the button ([MOBILE_APP.md — Permissions](../../architecture/MOBILE_APP.md#permissions)).
3. **Interests** — pick 3+ categories (chips).
4. **Follow suggestions** — list from interests; follow batch action.
5. **Notifications soft prompt** — "Turn on notifications?" → **Turn on** triggers the system prompt (iOS / Android 13+); **Not now** continues ([PUSH_NOTIFICATIONS.md](../../architecture/PUSH_NOTIFICATIONS.md)).

Header shows a step progress bar; Android back / iOS swipe goes to the previous step (disabled on step 1).

## API

### `PATCH /api/v1/users/me/onboarding`

**Body:**

```json
{
  "step_completed": "interests",
  "interest_slugs": ["music", "tech", "travel"]
}
```

### `GET /api/v1/users/suggestions?limit=20`

Returns recommended users based on interests.

### Avatar upload

Use Cloudinary flow from the device: `cloudinary-sign` (`purpose: avatar`) → upload → `confirm` → `PATCH /users/me` with `{ "avatar_media_id": "uuid" }`. Resize to 640×640 on device before upload.

## Acceptance criteria

- [ ] Progress persisted on the server (and current step in AsyncStorage); killing the app resumes the correct step.
- [ ] Skip on any step completes onboarding flag `onboarding_completed_at`.
- [ ] Denying camera/photos permission still allows skip.
