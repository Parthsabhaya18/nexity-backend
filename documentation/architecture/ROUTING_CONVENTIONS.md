# Routing conventions

Two kinds of routes: **app screens** (React Navigation inside the iOS/Android app, reachable by deep link) and the **REST API** (`/api/v1`).

## App screens & deep links

Screens are named in `PascalCase` and typed in `frontend/src/navigation/types.ts`. Navigator structure: [MOBILE_APP.md — Navigation map](MOBILE_APP.md#navigation-map).

Every deep-link path below works with both prefixes:

- `nexity://<path>` — custom scheme
- `https://nexity.com/<path>` — iOS Universal Link / Android App Link

### Deep link table (React Navigation `linking` config)

| Path | Screen | Params | Auth |
|------|--------|--------|------|
| `login` | `Login` | — | No |
| `register` | `Register` | — | No |
| `feed` | `Home` (HomeTab) | — | Yes |
| `explore` | `Explore` (SearchTab) | — | Yes |
| `search` | `Explore` with search focused | `q?` | Yes |
| `notifications` | `Notifications` | — | Yes |
| `posts/:postId` | `PostDetail` | `postId` | Yes |
| `posts/:postId/comments` | `PostDetail` + Comments sheet open | `postId` | Yes |
| `saved` | `SavedPosts` | — | Yes |
| `reels` | `Reels` (ReelsTab) | — | Yes |
| `reels/:reelId` | `ReelDetail` | `reelId` | Yes |
| `stories/:userId/:storyId` | `StoryViewer` | `userId`, `storyId` | Yes |
| `create/post` | `CreatePostStack` | — | Yes |
| `create/reel` | `CreateReelStack` | — | Yes |
| `create/story` | `CreateStory` | — | Yes |
| `u/:username` | `UserProfile` (or `MyProfile` if self) | `username` | Yes |
| `u/:username/followers` | `Followers` (Followers tab) | `username`, `tab=followers` | Yes |
| `u/:username/following` | `Followers` (Following tab) | `username`, `tab=following` | Yes |
| `follow-requests` | `FollowRequests` | — | Yes |
| `messages` | `Inbox` | — | Yes |
| `messages/:conversationId` | `ChatThread` | `conversationId` | Yes |
| `groups` | `Groups` | — | Yes |
| `groups/:groupId` | `GroupDetail` | `groupId` | Yes |
| `settings` | `Settings` | — | Yes |
| `settings/appearance` | `AppearanceSettings` | — | Yes |
| `settings/notifications` | `NotificationSettings` | — | Yes |
| `settings/privacy` | `PrivacySettings` | — | Yes |
| `settings/account` | `AccountSettings` | — | Yes |

Screens **without** a deep link (only reached in-app): `VerifyEmail` and `ResetPassword` (email codes, not links), `ForgotPassword`, onboarding screens, `EditPost`, `EditReel`, `EditProfile`, `NewMessage`, `CreateGroup`, `BlockedAccounts`, `AdminModeration`, `DevComponents` (debug builds only), all bottom sheets.

### Rules

- Params carry **ids / usernames only**. Screens fetch their own data (TanStack Query); never pass full objects through navigation.
- Usernames and tags in paths are lowercase.
- Logged-out user opens an auth-required link → save it, show `Login`, open the saved link after sign-in. Only paths from this table are accepted (no arbitrary redirects).
- "Copy link" / "Share" in ••• menus always produce `https://nexity.com/<path>`.
- Push notification `deep_link` values use `nexity://<path>` ([PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md)).

### Navigation calls

```ts
navigation.navigate('PostDetail', { postId });
navigation.navigate('UserProfile', { username });
navigation.navigate('CreatePostStack', { screen: 'CreatePostSelect' });
```

## REST API

Base: **`/api/v1`** (dev `http://localhost:4000/api/v1`, prod `https://api.nexity.com/api/v1`).

| Method | Pattern | Notes |
|--------|---------|-------|
| GET | `/resources` | List + cursor |
| POST | `/resources` | Create |
| GET | `/resources/:id` | Detail |
| PATCH | `/resources/:id` | Partial update |
| DELETE | `/resources/:id` | Soft delete where noted |

### Request headers (sent by the app on every call)

```
Authorization: Bearer <access_token>
X-Platform: ios | android
X-App-Version: 1.0.0
Accept-Language: en-IN
```

### Query parameters (common)

| Param | Usage |
|-------|-------|
| `cursor` | Pagination |
| `limit` | Page size, default 20, max 50 |
| `q` | Search query |

### Standard list response

```json
{
  "data": [],
  "pagination": {
    "next_cursor": "opaque-string-or-null",
    "has_more": true
  }
}
```

Use with TanStack Query `useInfiniteQuery` (`getNextPageParam: (last) => last.pagination.next_cursor`).

### Error response

```json
{ "error": { "code": "SNAKE_CASE", "message": "Human readable" } }
```

Show `message` to the user; branch on `code` in code.

## WebSocket (messages)

- Transport: **Socket.IO v4** (`socket.io` on the server, `socket.io-client` in the app, `transports: ['websocket']`), served on the API host at path **`/ws/v1/chat`** (prod `https://api.nexity.com`, dev `http://localhost:4000`).
- Authenticate with the access token in the Socket.IO handshake: `io(origin, { path: '/ws/v1/chat', auth: { token } })` — custom headers are unreliable on React Native. On `connect_error` with an auth code, refresh the token and reconnect.
- Reconnect with backoff and on app foreground, then fetch missed messages (`?after=`); close when the app is backgrounded for > 30 s (push takes over).
- One server instance keeps presence and rooms in memory; running several instances needs the Socket.IO Redis adapter.
- Events documented in [chat-thread.md](../modules/messages/chat-thread.md).
