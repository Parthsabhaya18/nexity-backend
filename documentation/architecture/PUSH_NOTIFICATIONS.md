# Push notifications — iOS & Android

Push notifications reach users when the app is closed or in the background. Both platforms go through **Firebase Cloud Messaging (FCM)**; FCM delivers to Android directly and to iOS through **APNs**.

In-app activity (the Notifications screen) is defined in [notifications.md](../modules/notifications/notifications.md). User controls are in [notification-settings.md](../modules/settings/notification-settings.md).

## Libraries

| Purpose | Library |
|---------|---------|
| FCM token + messages | `@react-native-firebase/app`, `@react-native-firebase/messaging` |
| Display, channels, foreground banners, badges | `@notifee/react-native` |

Config files (never commit production secrets to public repos):

- Android: `android/app/google-services.json`
- iOS: `ios/GoogleService-Info.plist`, APNs auth key (`.p8`) uploaded to Firebase, Xcode capabilities **Push Notifications** + **Background Modes → Remote notifications**

## Permission

| Platform | Behavior |
|----------|----------|
| iOS | Must ask (`messaging().requestPermission()`). Ask after onboarding with a soft prompt ("Turn on notifications to know when friends like or message you") — never on first launch |
| Android 13+ (API 33) | Runtime `POST_NOTIFICATIONS` permission — same soft prompt first |
| Android ≤ 12 | Granted by default |

If the user declines, the app works normally. [notification-settings.md](../modules/settings/notification-settings.md) shows "Notifications are off — Open Settings".

## Device registration

1. After login and permission grant, get the FCM token (`messaging().getToken()`).
2. `POST /api/v1/devices` with the token.
3. Listen to `messaging().onTokenRefresh` and re-register.
4. On logout, `DELETE /api/v1/devices/:deviceId` **before** clearing the access token.

### `POST /api/v1/devices`

**Auth:** Bearer required

**Body:**

```json
{
  "push_token": "fcm-token-string",
  "platform": "ios",
  "app_version": "1.0.0",
  "os_version": "18.1",
  "device_model": "iPhone15,2",
  "locale": "en-IN"
}
```

`platform`: `ios` | `android`

**Success `201`:** `{ "device_id": "uuid" }` — upsert by `push_token` (same token → same device row, re-assigned to the current user).

### `DELETE /api/v1/devices/:deviceId`

**Auth:** Bearer required. **Success `204`.**

**Errors:** `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404 — device belongs to another user).

## Notification channels (Android)

Create channels at startup with Notifee. Users can mute channels in Android system settings.

| Channel id | Name | Importance | Types |
|------------|------|------------|-------|
| `messages` | Messages | High (heads-up, sound) | `message_new` |
| `social` | Likes & comments | Default | `like_post`, `like_reel`, `comment_post`, `comment_reel`, `mention_post` |
| `follows` | Followers | Default | `follow`, `follow_request`, `follow_accepted` |
| `general` | Other | Low | Account and security notices |

iOS uses the matching `thread-id` (groups by conversation / post) and `category` for actions (Phase 2: Reply, Like).

## Payload

Server sends **notification + data** messages so the OS shows the alert when the app is killed, and the app can route on tap.

```json
{
  "notification": {
    "title": "jane_doe",
    "body": "liked your post"
  },
  "data": {
    "type": "like_post",
    "notification_id": "uuid",
    "deep_link": "nexity://posts/3f1c...",
    "actor_avatar_url": "https://res.cloudinary.com/.../c_fill,w_128,h_128/..."
  },
  "android": { "notification": { "channel_id": "social" } },
  "apns": { "payload": { "aps": { "badge": 4, "thread-id": "post-3f1c", "mutable-content": 1 } } }
}
```

Rules:

- `deep_link` uses the paths in [ROUTING_CONVENTIONS.md](ROUTING_CONVENTIONS.md).
- Never put private content in a push for private messages if the user turned off **Show previews** (body becomes "Sent you a message").
- `badge` = unread notifications + unread conversations.

## Tap handling

| App state | Handler |
|-----------|---------|
| Killed | `messaging().getInitialNotification()` on startup → open `deep_link` after auth restore |
| Background | `messaging().onNotificationOpenedApp` → navigate to `deep_link` |
| Foreground | `messaging().onMessage` → show an in-app banner (Notifee) instead of a system alert; do **not** show a banner for the chat you are viewing |

After opening, call `POST /api/v1/notifications/:id/read`.

## Backend

- Store devices in `Device` ([DATA_MODELS.md](DATA_MODELS.md)).
- Send through Firebase Admin SDK (`firebase-admin`) from a queue worker, not inside the request.
- Check the recipient's notification preferences and blocks before sending.
- Collapse duplicates: max 1 like push per post per 10 minutes ("jane and 4 others liked your post").
- Delete the device row when FCM returns `messaging/registration-token-not-registered`.

Env vars: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.

## Acceptance criteria

- [ ] Push arrives on iOS and Android when the app is killed, background, and foreground.
- [ ] Tapping a push opens the exact screen (post, reel, chat, profile, follow requests).
- [ ] Logged-out devices receive no pushes.
- [ ] Turning a type off in settings stops that push within one minute.
- [ ] App icon badge matches unread count and clears when read.
