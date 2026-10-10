# Nearby Encounters — Bluetooth Nearby, location notifications, Secret hints

**Screens:** `Nearby` (people around you, Bluetooth), `NearbySettings`, `NearbyConsent` (fullscreen modal)  
**Deep links:** `nexity://nearby` → `Nearby`, `nexity://settings/nearby` → `NearbySettings`  
**Theme:** Light, Dark and every mood, semantic tokens only ([THEMING.md](../../architecture/THEMING.md)). The hint chip uses `warning` text on `warningSoft`, never a hard-coded colour  
**Auth required:** Yes  
**Plan:** Nearby discovery and the generic "Someone is near you" push are free for everyone. The person-specific hint inside Secret Messages and Secret Crush follows the existing `limits.nearby` flag (Free sees a locked teaser) — [plans-and-billing.md](../premium/plans-and-billing.md)  
**Frontend (planned):** `frontend/src/screens/nearby/`, `frontend/src/features/nearby/`, `frontend/src/services/api/nearby.ts`  
**Backend (planned):** `backend/src/modules/nearby/`  
**Security:** [SECRET_FEATURES_SECURITY.md](../../architecture/SECRET_FEATURES_SECURITY.md) §12  
**Prototype:** `frontend/prototype/js/nearby.js`, `frontend/prototype/js/state.js` (encounters, hint rules), `frontend/prototype/js/settings.js` (`settingsNearby`, `nearbyConsent`), `frontend/prototype/js/demo.js` (Nearby simulator)  
**Source:** *Nexity — Nearby Encounters, End-to-End Technical Implementation Documentation* (product owner, Oct 2026). Where it conflicts with the earlier "Was near you 💫" rules, this document wins (see [§2.2](#22-decisions-that-replace-earlier-rules)).

---

## 0. Status (read first)

| Part | Status |
|---|---|
| Specification (this document) | Done |
| Clickable prototype (`frontend/prototype`) | Done — whole flow simulated in the browser, no real Bluetooth, GPS or push |
| Backend module `backend/src/modules/nearby/` | **Location and Bluetooth done** — settings, location pings, BLE tokens, mutual sightings, `GET /nearby/users`, today / yesterday hints |
| React Native location | **Done (foreground only)** — `NearbyLocationHost` samples while the app is open; `NearbySettings` screen (in `screens/premium/`) with separate toggles and permission buttons |
| React Native screens and BLE native code | **Android and iOS** — `Nearby` circle, `NearbyBle` on both. The rotating id is inside the advert (16-bit service data on Android, local name on iOS). Phones scan only and never connect or pair. Android Kotlin compiles. iOS was not compiled here (no Mac) |
| Secret Message backend (hint host) | **Done** — the hint shows in Secret threads ([§8](#8-secret-message-integration)) |
| Secret Crush backend (hint host) | **Done** — hint on your own crush rows, matches and the match celebration; never on the admirer card ([§9](#9-secret-crush-integration)) |
| Push delivery (FCM / APNs) | **Not started** — no `firebase-admin`, no `Device` model, no `@react-native-firebase/*` ([§13](#13-notifications-and-reliability)) |
| Physical-device tests | **None run** ([§14](#14-physical-device-testing)) |

Nothing in this feature may be reported as working on a phone until the matching row in [§14](#14-physical-device-testing) has passed on real devices.

---

## 1. Feature overview

Three connected capabilities with separate responsibilities:

| | Capability | Signal | What the user sees |
|---|---|---|---|
| A | **Bluetooth Nearby users** | BLE (rotating anonymous ids, mutually verified by the server) | `Nearby` screen: cards for verified Nexity users who also turned Nearby on and are in Bluetooth range now |
| B | **Location-based notifications** | Coarse device location, validated on the server | A generic push to both people: **Nexity** · *Someone is near you on Nexity. ✨* — never a name, photo or place |
| C | **Secret Message / Secret Crush hints** | Any validated, person-specific encounter (A or B) | One line in the existing Secret UI: *This person was near you today.* / *This person was near you yesterday.* — nothing for older or missing encounters |

A hint never creates a message, a crush, a chat or a match, and never reveals a crush or an anonymous sender.

---

## 2. Core business rules

1. Nearby is **opt-in** and **off by default** for every account, new and existing.
2. Both people must be active, registered Nexity users.
3. Both must have the relevant signal turned on (Bluetooth discovery for A, location assistance for B; either for C).
4. Bluetooth and location are **separate signals with separate states**. One being off never hides the other, and the UI never shows a signal as working when it isn't.
5. The **backend validates every encounter** and enforces every privacy rule. The app only reports raw observations.
6. One encounter never produces repeated notifications (per-pair cooldown + idempotency key, [§13](#13-notifications-and-reliability)).
7. A block in either direction (normal block or Secret Message sender block) removes the pair from discovery, notifications and hints, on the server.
8. Expiry is enforced in every query, even when the TTL monitor hasn't deleted the row yet.
9. No identity is ever inferred from a device id the server didn't issue and verify (MAC address, device name, unknown UUID).
10. Auth, chat, posts, reels, stories, Secret Message, Secret Crush and S3 media keep working unchanged.
11. No hint without a valid, unexpired, person-specific encounter record.
12. No fake users, mock encounters or hard-coded notifications in production code. The prototype simulator lives only in `frontend/prototype`.

### 2.1 What the signals can and can't prove

- **BLE** shows two phones were within radio range (typically a few metres to a few tens of metres; walls, bodies and pockets change it). RSSI is a rough hint, **never a distance**. The app never shows metres.
- **Location** shows two phones reported nearby coordinates. Indoors and in dense areas this produces false positives (different floors, neighbouring buildings).
- Neither proves two people **met** or saw each other. Copy says "was near you", never "you met" or "you crossed paths with".

### 2.2 Decisions that replace earlier rules

| Earlier rule (prototype v5 / old docs) | Now | Why |
|---|---|---|
| "Was near you today / yesterday / **N days ago** 💫", kept up to 30 days | **Today** and **yesterday** only; 2+ calendar days ago → nothing | New spec, §8 |
| Wording "Was near you today 💫" | *This person was near you today.* / *This person was near you yesterday.* | New spec |
| Location permission asked at app launch (prototype Home) | Asked **only** when the user turns on location assistance | Spec §5.1, [MOBILE_APP.md](../../architecture/MOBILE_APP.md#permissions) (just-in-time) |
| No screen listing nearby people | `Nearby` screen with verified Bluetooth users | Spec §4.3 |
| No push | Generic push *Someone is near you on Nexity. ✨* | Spec §5.3 |
| One "Nearby" switch | Master switch + Bluetooth + location + notifications switches | Spec §7.1 |

Kept unchanged: off by default; nobody else ever sees whether your Nearby is on or off; no map, distance, place, time or history is ever shown; admins never see locations; hints are plan-gated by `limits.nearby`.

---

## 3. Phase 1 — Codebase audit (Oct 2026)

### 3.1 Versions and tooling

| | Frontend `nexity-mobile` | Backend `nexity-backend` |
|---|---|---|
| Runtime | React Native **0.87.1**, React 19.2.3, New Architecture | Node **≥ 22.11**, Express **5.2**, TypeScript 6 |
| Package manager | npm (`package-lock.json`) | npm (`package-lock.json`) |
| Data | TanStack Query 5, axios | MongoDB via Mongoose **9.10** |
| Validation | zod 3 | zod 4 |
| Tests | Jest 29 (`npm test`) | Vitest 5 + supertest + mongodb-memory-server (`npm test`) |
| Native | Android `minSdk 24`, `compileSdk 37`, `targetSdk 36`; iOS project present | — |
| Build | `npm run apk:debug`, `npm run apk:release`, `npm run install:debug` | `npm run build`, `npm run dev` |

### 3.2 Existing code to reuse

| Need | Reuse |
|---|---|
| Auth on every Nearby endpoint | `backend/src/middlewares/requireAuth.ts` (`req.user` = acting user; never trust a body `user_id`) |
| Rate limits | `backend/src/middlewares/rateLimit.ts` → add `nearbyLimiter`, `nearbyReportLimiter` with the existing `limiter()` helper and `account` key |
| Errors | `backend/src/utils/ApiError.ts`, `{ error: { code, message } }` |
| Config | `backend/src/config/env.ts` (zod schema) |
| Blocks | `backend/src/modules/safety/block.service.ts` → `isBlockedEither()`, `blockIdsFor()` |
| Public profile shape | `toPublicUserDto()` / `withAvatarUrls()` in `backend/src/modules/users/user.model.ts` (avatars stay on S3 via `viewUrl`) |
| In-app notifications | `backend/src/modules/notifications/notification.model.ts` + service (extend the type enum) |
| Scheduled cleanup pattern | `backend/src/modules/stories/story.cleanup.ts`, `media.cleanup.ts` (in-process interval; no Redis) |
| Permissions UI | `frontend/src/features/permissions/` (`usePermission`, `PermissionSheet`, `PermissionGate`, `openSettingsFor`) — add `bluetooth` and `location` types |
| Navigation | `frontend/src/navigation/RootNavigator.tsx`, `types.ts` (push `Nearby`, `NearbySettings` as shared screens) |
| UI | `AppBar`, `EmptyState`, `SafeAreaView`, theme tokens from `useAppTheme()` |

### 3.3 Gaps found (must be closed or acknowledged)

| Gap | Impact | Decision |
|---|---|---|
| **No Secret Message / Secret Crush backend**, and `PremiumScreen.tsx` is a "coming soon" placeholder | Hints (C) have no host screens or APIs yet | Build the hint service now (`nearby.hints.ts`); wire it into Secret APIs when those modules land. No invented relationship ([§8.4](#84-relationship-rule)) |
| **No push infrastructure** (no FCM, no `devices` collection) | Location push (B) can't reach a closed app | Write the in-app notification + outbox now; delivery starts when [PUSH_NOTIFICATIONS.md](../../architecture/PUSH_NOTIFICATIONS.md) is implemented. Don't claim push works until then |
| No timezone on the user | "Today / yesterday" needs the viewer's calendar | Add `X-Timezone` request header + `nearby.timezone` (IANA, default `Asia/Kolkata`) |
| No BLE or location package | — | [§4.1](#41-package-selection), [§5.1](#51-packages-and-permissions) |
| Android manifest already declares `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION`; iOS has `NSLocationWhenInUseUsageDescription` | Location is already requestable | Keep; add Bluetooth permissions only when BLE ships |
| `react-native-permissions` 5.6 installed, types limited to camera / photos / microphone / notifications | — | Extend the type union |
| `PERMISSION`/`Device`/`NotificationPreference` docs exist but not code | — | Nearby adds only its own preference fields |

### 3.4 New files that are genuinely required

**Backend** (`backend/src/modules/nearby/`)

| File | Responsibility |
|---|---|
| `nearby.routes.ts` | Router mounted at `/nearby` in `src/routes/index.ts` |
| `nearby.controller.ts` | HTTP ↔ service, zod parsing |
| `nearby.schema.ts` | zod request schemas |
| `nearby.config.ts` | Typed config from `env.ts` ([§16](#16-environment-and-deployment)) |
| `nearby.settings.ts` | Read / update settings, opt-out side effects |
| `nearby.tokens.ts` | Issue, hash, look up and revoke rotating BLE ids |
| `nearby.sightings.ts` | Store BLE reports, mutual verification, presence |
| `nearby.location.ts` | Validate location pings, coarse cells, proximity matching |
| `nearby.encounters.ts` | Eligibility (opt-in, blocks, status), upsert encounter, dedupe |
| `nearby.hints.ts` | `hintFor(viewer, otherUserId)` → `'today' \| 'yesterday' \| null` + `valid_until` |
| `nearby.notify.ts` | Generic push via outbox, cooldowns, idempotency |
| `nearby.cleanup.ts` | Interval sweep (backs up the TTL indexes) |
| `nearbyToken.model.ts`, `nearbySighting.model.ts`, `nearbyLocationPing.model.ts`, `encounter.model.ts`, `nearbyNotification.model.ts` | Collections in [§7](#7-mongodb-data-model) |
| `tests/nearby/*.test.ts` | Vitest: date logic, verification, blocks, opt-out, dedupe, expiry |

**Frontend**

| File | Responsibility |
|---|---|
| `src/screens/nearby/NearbyScreen.tsx` | People around you ([§4.3](#43-nearby-screen)) |
| `src/screens/nearby/NearbySettingsScreen.tsx` | Switches ([§11.2](#112-nearbysettings)) |
| `src/screens/nearby/NearbyConsentScreen.tsx` | First-time explanation |
| `src/features/nearby/ble/` | `bleAdvertiser.ts`, `bleScanner.ts`, `ephemeralIds.ts` (token cache + rotation), `bleSession.ts` (bounded scan sessions) |
| `src/features/nearby/location/locationSampler.ts` | Foreground location samples with accuracy / age checks |
| `src/features/nearby/useNearbyState.ts` | Combined state machine ([§11.1](#111-state-model)) |
| `src/features/nearby/nearbyHint.ts` | `hintText()` + midnight re-render timer |
| `src/components/nearby/NearbyHint.tsx` | The one-line hint (used by Secret screens) |
| `src/services/api/nearby.ts` | API client + query keys |

### 3.5 Implementation sequence

See [§17](#17-implementation-order-and-file-plan). Short version: settings → BLE foreground prototype on two Android phones → token protocol + verification → location → encounters → notifications → Secret hints → native hardening → regression + APK.

---

## 4. Phase 2 — Bluetooth discovery

### 4.1 Package selection

Checked Oct 2026. **Re-check versions, RN 0.87 compatibility and licence before `npm install`.**

| Package | Scan | Advertise | Notes | Verdict |
|---|:-:|:-:|---|---|
| `react-native-ble-plx` (dotintent) / `@sfourdrinier/react-native-ble-plx` (RN 0.86+ fork) | ✅ | ❌ | Central only. Docs list "phone-as-peripheral (advertising / GATT server)" as **not supported** | Not enough alone — both phones must advertise |
| `react-native-bluetooth-ble` (Nitro) | ✅ | ✅ | Central + peripheral in one library. Built on Nitro Modules (the app already ships `react-native-nitro-modules` 0.37). iOS advertising limited to local name + service UUIDs (CoreBluetooth rule) | **Preferred candidate** — one library for both roles |
| `munim-bluetooth-peripheral` | ❌ | ✅ | Peripheral only; would need ble-plx for scanning | Fallback only (two overlapping libraries) |
| Own native module (`BluetoothLeAdvertiser` + `BluetoothLeScanner` on Android, `CBPeripheralManager` + `CBCentralManager` on iOS) | ✅ | ✅ | ~600 lines per platform, full control of scan modes and filters | Use if the preferred library fails the two-phone test |

Rule: install **one** BLE library. Verify on two physical Android phones (Step 2 of [§17](#17-implementation-order-and-file-plan)) before writing any feature UI on top of it.

### 4.2 Discovery protocol (rotating ids, mutual verification)

```
 Phone A                         Server                          Phone B
   | POST /nearby/ble/tokens  -->  | issue 8 ids (15 min each),    |
   | <-- [{eph_id, valid_from,      |  store sha256(eph_id) only    |
   |      valid_until}]             |                               |
   | advertise eph_id(now)          |       advertise eph_id(now)   |
   |   ~~~~~~~~ BLE ~~~~~~~~~~~~~~~~~~~~~~~~~~~ BLE ~~~~~~~~~~~~~~~~ |
   | scan → saw eph_B               |                saw eph_A ←scan|
   | POST /nearby/ble/sightings --> | resolve hash(eph_B) → B       |
   |                                | <-- POST /nearby/ble/sightings|
   |                                | resolve hash(eph_A) → A       |
   |                                | A saw B AND B saw A within    |
   |                                | 2 min, both eligible → VERIFIED|
   | GET /nearby/users  ----------> | [B's public card]             |
```

**Ephemeral id (EphID)**

- 16 random bytes (`crypto.randomBytes(16)`), base64url on the wire. No user data inside; unlinkable across windows.
- Validity window `NEARBY_TOKEN_TTL_MINUTES` (default **15**). The app fetches **8** at a time (2 h) and rotates at each `valid_from`. Rotating BLE MAC addresses are handled by the OS; we never read or store MACs.
- The server stores only `sha256(eph_id)` with `user_id`, `valid_from`, `valid_until`, `revoked_at`. TTL deletes rows 1 h after `valid_until`.
- Issuing requires a valid access token **and** `nearby.enabled && nearby.bluetooth_enabled`. Max 16 unexpired ids per user; older ones are revoked on refresh.

**What goes over the air**

| Platform | Advertisement | How the scanner gets the EphID |
|---|---|---|
| Android | 16-bit service UUID `FFF0` plus the 16-byte EphID as manufacturer data `0x4E58` in the same advert. Non-connectable. If the radio rejects that packet, the EphID is sent alone | Read from the scan result. No connection and no pairing |
| iOS (foreground) | 16-bit service UUID `FFF0` plus the EphID as the advert local name (CoreBluetooth can't advertise service data) | Read the Android manufacturer data, or the iOS local name, from the advert. No connection |

Never broadcast user ids, usernames, phone numbers, auth tokens, or any id that is stable across windows. The device name is left as the OS default and is ignored by the scanner.

**Sighting report** — `POST /nearby/ble/sightings`, batched every 30–60 s during a session:

```json
{ "sightings": [
  { "eph_id": "q83vEj...", "first_seen_at": "2026-10-10T08:01:12Z", "last_seen_at": "2026-10-10T08:02:40Z", "count": 7, "rssi_max": -64 }
] }
```

Server validation:

1. Max 50 sightings per request, max one request / 20 s / user (`nearbyLimiter`).
2. `last_seen_at` not in the future (> 60 s skew) and not older than 10 min; `first_seen_at ≤ last_seen_at`.
3. `sha256(eph_id)` must match an issued, unrevoked token whose `[valid_from − 2 min, valid_until + 2 min]` contains the sighting. Unknown or expired → silently ignored (no error that confirms or denies an id).
4. The token owner ≠ reporter, both `active`, both `enabled && bluetooth_enabled`, no block either way.
5. Replay: a (reporter, token) pair is stored once per window; repeats only extend `last_seen_at`.
6. **Mutual verification:** the pair becomes *verified* only when **both** phones reported each other's current EphIDs with overlapping times (± 2 min). A recorded EphID replayed elsewhere can't produce the victim's own report, so impersonation and "fake nearby" fail. A phone that only scans (never advertises) is never verified to anyone.
7. Verified pair → presence row (`NEARBY_PRESENCE_TTL_SECONDS`, default 300) for `GET /nearby/users`, and → encounter candidate ([§6.3](#63-encounter-validation)).

RSSI is stored only as a coarse bucket (`near` ≥ −70 dBm, `far` otherwise) to drop very weak, one-off sightings. It's never returned to clients.

### 4.3 `Nearby` screen

Entry points: Home header radar button, Settings → Nearby → "See who's nearby", push tap on the generic notification. Shared screen pushed in any stack.

| State | When | UI |
|---|---|---|
| `disabled` | `nearby.enabled = false` | Explanation + **Turn on Nearby** → `NearbyConsent` |
| `bluetooth_off_setting` | Nearby on, Bluetooth discovery switch off | "Bluetooth discovery is off" + **Turn on** (switch) |
| `requesting_permissions` | OS popup showing | Our pre-permission sheet first (shared `PermissionSheet`) |
| `permission_denied` | `denied` | "Nexity needs Nearby devices permission to find people around you" + **Try again** |
| `permission_blocked` | `blocked` | Same text + **Open Settings** (re-checks on return) |
| `bluetooth_unavailable` | Adapter off | "Turn on Bluetooth to find people nearby" + system Bluetooth settings (Android `ACTION_REQUEST_ENABLE`) |
| `unsupported` | Not shown. Missing Bluetooth or location permission is requested. Bluetooth off opens the system switch. The screen stays on Turn on Nearby until scanning can start. |
| `scanning` | Session running, no verified users yet | Radar animation, "Looking for people who turned on Nearby…" |
| `found` | ≥ 1 verified user | Cards (below) + "Updated just now" |
| `empty` | Session ended, nobody verified | "No one nearby right now" + **Scan again** |
| `error` | API / offline | "Nearby is temporarily unavailable" + **Try again** |

Location has its own row on the screen ("Location notifications: On / Off / Needs permission") so one signal never stands in for the other.

**Card** — data from `GET /nearby/users`, which reuses `toPublicUserDto` + follow state:

- avatar (S3 URL), display name, `@username`, 👑 if Premium, **Follow** / **Following** / **Requested** (existing follow rules, private accounts included).
- subtitle **"Nearby now"**. No distance, direction, RSSI, time, or "seen N times".
- tap → `UserProfile { username }` (existing visibility rules apply).
- ••• → Block, Report (existing safety flows; `Report` reason "Nearby misuse").
- A user disappears when their presence expires (5 min without a verified sighting), when either side turns Bluetooth discovery off, or on block.

Fine print under the list: "Only people who turned on Nearby appear here. Other Bluetooth devices are ignored."

Duplicate advertisements (same person, several EphIDs, several reports) collapse server-side by `user_id`; the list is keyed by user id.

### 4.4 Bluetooth limitations

| Situation | Behaviour |
|---|---|
| Bluetooth off / permission denied / blocked | States above; nothing advertised; server presence expires |
| App backgrounded | **Phase 1:** advertising and scanning stop on `AppState` `background`; presence expires after 5 min |
| App killed | Nothing runs. No claim otherwise |
| Android battery saver / OEM killers | Scans may return nothing; we never show "nobody nearby" as a fact while a session is degraded — show `empty` only after a full, healthy session |
| Android scan throttling (> 5 starts / 30 s → silent failure) | Bounded sessions ([§15](#15-performance-and-battery)); never restart scans in a tight loop |
| iOS background | Advertising moves service UUIDs to the "overflow area": iOS ↔ iOS discovery in background is unreliable and Android can't see it. iOS background BLE is **out of scope until tested** |
| Device can't advertise | `unsupported` state; scanning alone never verifies anyone |

Background BLE (Android foreground service `connectedDevice`) is Phase 9 and needs a battery study first.

---

## 5. Phase 3 — Location proximity

### 5.1 Packages and permissions

| Package | Status Oct 2026 | Verdict |
|---|---|---|
| `react-native-geolocation-service` | Last release 5.3.1, **Sept 2022**; inactive | **Don't install** (spec asked to evaluate it; it fails the maintenance check) |
| `@react-native-community/geolocation` 3.x | Maintained, TurboModule + legacy bridge | Acceptable |
| `react-native-nitro-geolocation` | Maintained, Nitro / New Architecture, `/compat` API, optional background module | **Preferred** — matches the app's existing Nitro stack. Use the foreground API only |
| `react-native-permissions` 5.6 | Already installed | Reuse for `LOCATION_WHEN_IN_USE` / `ACCESS_FINE_LOCATION` |

Request only:

- Android: `ACCESS_COARSE_LOCATION` first; `ACCESS_FINE_LOCATION` optional (approximate is accepted, see accuracy rule). Already declared in the manifest.
- iOS: When-In-Use only. Precise location is not required; with reduced accuracy (`CLAccuracyAuthorization.reducedAccuracy`, ~1–3 km) readings fail the accuracy check and the UI says "Precise location is off — location notifications need it" with Open Settings.
- **No background location** in this phase (`ACCESS_BACKGROUND_LOCATION`, iOS Always are not requested). Nexity never asks for location to use any other feature.

| Case | UI / behaviour |
|---|---|
| Not granted yet | Asked only when the user turns on **Location assistance** |
| Denied | Switch returns to off; "Location permission is needed for location notifications" + Try again |
| Permanently denied | Open Settings |
| Location services off | "Turn on Location in your phone settings" (Android: Google Location Accuracy dialog when available) |
| Approximate only | Samples fail accuracy → no encounters; explained once |
| Timeout / unavailable | Skip this sample; retry next interval; no error spam |

### 5.2 Proximity validation

Client sampling (foreground, location assistance on): one reading every `NEARBY_LOCATION_SAMPLE_SECONDS` (default 120) while the app is in the foreground, `maximumAge` 60 s, timeout 20 s. Send only if `accuracy ≤ NEARBY_LOCATION_ACCURACY_LIMIT_METERS` and age ≤ 2 min.

`POST /nearby/location` — `{ lat, lng, accuracy_m, captured_at }`

Server:

1. Reject if Nearby or location assistance is off (`409 NEARBY_DISABLED`), if `accuracy_m` > limit (stored nowhere, `202` ignored), if `captured_at` is > 60 s in the future or > 2 min old.
2. Rate: max 1 ping / 60 s / user (`nearbyLimiter` + server check).
3. Round to 4 decimals (~11 m) and store in `nearby_location_pings` with a **15-minute TTL**. Nothing else stores coordinates.
4. Look up other eligible users' pings in the same and 8 neighbouring geohash-7 cells (~150 m) within the last `NEARBY_MIN_ENCOUNTER_DURATION_SECONDS + 120 s`.
5. A pair is **co-located** in a sample when `haversine(a, b) ≤ NEARBY_RADIUS_METERS` **and** both accuracies ≤ limit.
6. A pair becomes a location encounter only when it is co-located in **≥ 2 samples spanning ≥ `NEARBY_MIN_ENCOUNTER_DURATION_SECONDS`** for each user. One matching coordinate is never enough.
7. Then eligibility + encounter upsert ([§6.3](#63-encounter-validation)).

Defaults (starting values only — tune on devices, [§14](#14-physical-device-testing)):

| Key | Default |
|---|---|
| `nearbyRadiusMeters` | 50 |
| `minimumEncounterDurationSeconds` | 120 |
| `locationAccuracyLimitMeters` | 40 |
| `encounterCooldownMinutes` | 30 (a pair's `last_detected_at` is refreshed at most this often) |
| `notificationCooldownMinutes` | 360 per pair; plus max 3 Nearby pushes per user per local day |
| `encounterRetentionDays` | 2 (enough to show "yesterday"; TTL deletes after) |

### 5.3 Location notification flow

1. Encounter validated (both users opted in, location assistance on, not blocked, active).
2. For each user: `nearby.notifications_enabled`, the global push switch, and daily cap.
3. Idempotency key `nearby:{recipient}:{pair_key}:{floor(now / notificationCooldown)}` → unique insert into `nearby_notifications`. Duplicate key = already handled, stop.
4. Create the in-app `Notification` (`type: 'nearby_encounter'`, `actor_id: null`, text fixed).
5. Enqueue push in the outbox ([§13](#13-notifications-and-reliability)).

Payload — the same for everyone, no data about the other person:

```json
{
  "notification": { "title": "Nexity", "body": "Someone is near you on Nexity. ✨" },
  "data": { "type": "nearby_encounter", "notification_id": "uuid", "deep_link": "nexity://nearby" },
  "android": { "notification": { "channel_id": "nearby" } },
  "apns": { "payload": { "aps": { "thread-id": "nearby" } } }
}
```

BLE-verified encounters create the encounter and the hint, but **don't** push by default (the user is already looking at the Nearby screen when BLE runs in Phase 1). Turn on with `NEARBY_PUSH_ON_BLE=true` once background BLE exists.

---

## 6. Phase 4 — Backend architecture

Extend the existing Express app: `routes → controller → service`, zod schemas, `ApiError`, `requireAuth`. Mount `apiRouter.use('/nearby', nearbyRouter)`.

### 6.1 Endpoints

All require `Authorization: Bearer`. The acting user is always `req.user`. No endpoint accepts another user's id except the hint lookup inside Secret services (server-side only).

| Method | Path | Body / query | Response | Notes |
|---|---|---|---|---|
| GET | `/nearby/settings` | — | `{ enabled, bluetooth_enabled, location_enabled, notifications_enabled, timezone, updated_at, feature_available }` | `feature_available=false` when the global switch is off |
| PATCH | `/nearby/settings` | any subset of `{ enabled, bluetooth_enabled, location_enabled, notifications_enabled, timezone }` | same as GET | Turning `enabled` or `bluetooth_enabled` off revokes all tokens and deletes presence **in the same request**; `location_enabled` off deletes the user's pings. `timezone` must be a valid IANA name |
| POST | `/nearby/ble/tokens` | — | `{ items: [{ eph_id, valid_from, valid_until }] }` | `409 NEARBY_DISABLED` unless enabled + Bluetooth on. Limit 30 / 15 min |
| POST | `/nearby/ble/sightings` | `{ sightings[] }` ([§4.2](#42-discovery-protocol-rotating-ids-mutual-verification)) | `202 { accepted: n }` | Never says which ids matched |
| GET | `/nearby/users` | — | `{ items: [{ user: PublicUser, follow_state, is_premium }], refreshed_at }` | Verified presence only, ≤ 50, blocks removed |
| POST | `/nearby/location` | `{ lat, lng, accuracy_m, captured_at }` | `202` | Never returns other users |

**Not added** (not needed by the final design): a separate "validate encounter" endpoint (validation is internal), "mark hint as seen" (hints are date-based and disappear by themselves), a public encounter-history endpoint (forbidden). Hints are returned inside Secret APIs ([§8](#8-secret-message-integration), [§9](#9-secret-crush-integration)).

Errors: `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `409 NEARBY_DISABLED`, `409 NEARBY_UNAVAILABLE` (global switch off), `429 TOO_MANY_REQUESTS`.

### 6.2 Settings service

Defaults for every account: all four flags `false`. Turning on `enabled` from the app always goes through `NearbyConsent`; the server stores `consented_at` the first time. Turning `enabled` on does **not** turn on Bluetooth or location — the app turns each on after its own permission succeeds.

### 6.3 Encounter validation

`recordEncounter(a, b, source)`:

1. `pair_key = [a, b].sort().join(':')` (ObjectId hex) — normalises order.
2. Eligibility: both `status: 'active'`; both `nearby.enabled`; the signal's switch on for both (`bluetooth_enabled` for `ble`, `location_enabled` for `location`); `!isBlockedEither(a, b)`; no Secret sender block between them; global switch on.
3. Upsert by `pair_key`:
   - none → insert `{ detected_at: now, last_detected_at: now, sources: [source], expires_at }`.
   - exists and `now − last_detected_at < encounterCooldown` → no write (dedupe).
   - else → `$set { last_detected_at: now, expires_at }`, `$addToSet { sources }`. Both sources → `source: 'hybrid'`.
4. `expires_at = endOfLocalDay(last_detected_at, latest timezone of the pair) + (encounterRetentionDays − 1) days`. Hints never read past this.
5. Location source → notification flow ([§5.3](#53-location-notification-flow)).

One row per pair holds only the **latest** encounter. No history, no counts, no coordinates.

### 6.4 Security requirements (checklist)

- [ ] Every route behind `requireAuth`; acting user from the token.
- [ ] zod on every body / query; unknown keys stripped.
- [ ] `nearbyLimiter` (120 / 15 min per account) on all Nearby routes; tighter per-route checks above.
- [ ] EphIDs stored hashed; expired / revoked / unknown ids ignored without telling the caller.
- [ ] Mutual verification before any profile is returned.
- [ ] No endpoint returns another user's encounters, settings, tokens, coordinates or RSSI.
- [ ] Blocks checked on write (sightings, encounters, notifications) **and** on read (`/nearby/users`, hints).
- [ ] Opt-out effective immediately: tokens revoked, presence and pings deleted, future processing skipped.
- [ ] Notification idempotency rows; per-pair and per-user caps so one user can't spam another.
- [ ] Coordinates kept ≤ 15 min, rounded; never logged (pino redaction for `lat`, `lng`, `eph_id`).
- [ ] Encounters never appear in public profile, search, admin user detail, or exports other than the user's own data export.

---

## 7. Phase 5 — MongoDB data model

### 7.1 User additions (`users`)

```ts
nearby: {
  enabled: { type: Boolean, default: false },
  bluetooth_enabled: { type: Boolean, default: false },
  location_enabled: { type: Boolean, default: false },
  notifications_enabled: { type: Boolean, default: false }, // set true together with the first opt-in, user can turn off
  timezone: { type: String, default: 'Asia/Kolkata' },
  consented_at: { type: Date, default: null },
  updated_at: { type: Date, default: null },
}
```

Index: `{ 'nearby.enabled': 1 }` (sparse use only; matching filters by ids first). Never part of `toPublicUserDto`.

### 7.2 Collections

**`nearby_ble_tokens`**

| Field | Notes |
|---|---|
| `token_hash` | sha256 hex of the EphID, **unique** |
| `user_id` | ObjectId → User |
| `valid_from`, `valid_until` | 15-min window |
| `revoked_at` | set on opt-out / refresh |
| `expire_at` | `valid_until + 1 h`; **TTL** `expireAfterSeconds: 0` |

Indexes: `{ token_hash: 1 }` unique, `{ user_id: 1, valid_until: -1 }`, TTL `{ expire_at: 1 }`.

**`nearby_sightings`** — `reporter_id`, `subject_id`, `token_hash`, `first_seen_at`, `last_seen_at`, `count`, `rssi_bucket`, `expire_at` (+30 min, TTL). Unique `{ reporter_id: 1, token_hash: 1 }`; index `{ subject_id: 1, reporter_id: 1, last_seen_at: -1 }` (mutual lookup).

**`nearby_presence`** — `viewer_id`, `subject_id`, `verified_at`, `expire_at` (+5 min, TTL). Unique `{ viewer_id: 1, subject_id: 1 }`. Written for both directions on verification.

**`nearby_location_pings`** — `user_id`, `cell` (geohash-7), `lat`, `lng` (4 decimals), `accuracy_m`, `captured_at`, `expire_at` (+15 min, TTL). Index `{ cell: 1, captured_at: -1 }`, `{ user_id: 1, captured_at: -1 }`.

**`encounters`**

| Field | Notes |
|---|---|
| `public_id` | UUID v4 (never exposed today; reserved for support tooling) |
| `pair_key` | `"<lowId>:<highId>"`, **unique** — dedupe across both orders |
| `participant_a`, `participant_b` | ObjectIds, sorted (`a < b`) |
| `detected_at` | first detection of the current row |
| `last_detected_at` | latest validated detection — the hint uses this |
| `source` | `ble` \| `location` \| `hybrid` |
| `validation_status` | `verified` (only verified rows are written; field kept for future `revoked`) |
| `expires_at` | [§6.3](#63-encounter-validation) step 4; **TTL** |
| `notification_dedup_key` | last key used ([§5.3](#53-location-notification-flow)) |
| `created_at`, `updated_at` | |

Indexes: `{ pair_key: 1 }` unique, `{ participant_a: 1, last_detected_at: -1 }`, `{ participant_b: 1, last_detected_at: -1 }`, TTL `{ expires_at: 1 }`.

**`nearby_notifications`** — `dedup_key` (unique), `recipient_id`, `pair_key`, `notification_id`, `push_status` (`pending` \| `sent` \| `failed` \| `skipped`), `attempts`, `next_attempt_at`, `last_error`, `created_at`, `expire_at` (+7 days, TTL). Index `{ push_status: 1, next_attempt_at: 1 }`, `{ recipient_id: 1, created_at: -1 }` (daily cap).

**`notifications`** — add `nearby_encounter` to `NOTIFICATION_TYPES`; make `actor_id` nullable (already planned for anonymous Secret types).

### 7.3 Expiration

TTL deletion runs about once a minute and can lag. Every read filters by time:

- tokens: `valid_until > now && revoked_at == null`
- presence: `expire_at > now`
- encounters: `expires_at > now` **and** the calendar rule in [§10](#10-date-and-time-logic)

`nearby.cleanup.ts` runs every 10 min and deletes anything past `expire_at` (belt and braces if the TTL monitor is paused, e.g. on a secondary).

---

## 8. Secret Message integration

Applies to the Secret Message module in [secret-messages.md](../premium/secret-messages.md). No change to sending, sealing, reveal, encryption, limits or access control.

### 8.1 Where the hint appears

| Place | Whose encounter | Shown when |
|---|---|---|
| Inbox row of a **sealed** thread (receiver) | receiver ↔ sender | valid hint and receiver's plan has `limits.nearby` |
| `SecretThread` header, sealed (receiver) | receiver ↔ sender | same; replaces the "Name sealed" line |
| Revealed row / reveal overlay / revealed chat header | the two people | same |
| `SecretThread` sender view | sender ↔ recipient | same (the sender already knows who they wrote to) |

Free plan with a valid hint → locked teaser chip ("This person was near you · Upgrade") linking to `Plans { reason: 'nearby' }`. No hint → nothing (never a locked chip for a non-existent encounter).

### 8.2 API

Each thread object from `GET /secret-messages/inbox`, `/sent`, `/:threadId` gets:

```json
"nearby_hint": { "state": "today", "valid_until": "2026-10-10T18:30:00Z" }
```

`state`: `today` | `yesterday` | `locked` (encounter exists, plan lacks `limits.nearby`; the day is **not** sent) | `null` (no field → nothing). `valid_until` = the viewer's next local midnight; after it the app must refetch or hide.

### 8.3 Anonymity

On a sealed thread the hint narrows who the sender could be. This is accepted product behaviour **only because** the sender opted in to Nearby. Guards:

- Hint requires **both** people to have `nearby.enabled` (the sender's choice is respected; turning Nearby off hides every hint about them at once).
- The hint key is the **thread id**, never the sender's user id; the client never learns the sender.
- Only day granularity. No time, place, count or source.
- A secret-blocked sender produces no hint.

### 8.4 Relationship rule

A hint is computed only between two users that **already** share a Secret Message thread (sender ↔ recipient). Nearby never creates a thread, never suggests "send a secret message to the person near you", and the people picker gets no "nearby" section. Until `backend/src/modules/secret-messages/` exists, there is no host for this hint; the hint service is built and unit-tested on its own.

---

## 9. Secret Crush integration

Applies to [secret-crush.md](../premium/secret-crush.md). Matching, admirer counts and reveal rules are unchanged.

| Place | Shown? |
|---|---|
| **Your Secret Crushes** list rows (people *you* added; you already know them) | ✅ hint about you ↔ them |
| **Matches** row, `MatchCelebration`, love-theme chat header | ✅ |
| "N people have a secret crush on you" card (admirers) | ❌ never — a hint here would reveal who added you |
| `UserProfile` of someone who isn't in your crush list / matches | ❌ |

API: each item in `GET /secret-crushes` and `GET /secret-crushes/matches` gets `nearby_hint` (same shape as [§8.2](#82-api)).

Never: auto-add a crush, auto-match, notify "your crush is nearby", or change the admirer count because of an encounter. A nearby encounter is not evidence of interest.

---

## 10. Date and time logic

The server decides; the app only formats and hides at boundaries.

```ts
// nearby.hints.ts
export function hintState(lastDetectedAt: Date, expiresAt: Date, now: Date, tz: string) {
  if (Number.isNaN(lastDetectedAt.getTime()) || expiresAt <= now) return null;
  if (lastDetectedAt.getTime() > now.getTime() + 5 * 60_000) return null; // clock skew guard
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); // YYYY-MM-DD
  const diff = (Date.parse(day(now)) - Date.parse(day(lastDetectedAt))) / 86_400_000;
  if (diff <= 0) return 'today';      // same local calendar day (≤0 absorbs small skew)
  if (diff === 1) return 'yesterday';
  return null;                        // 2+ calendar days → hide
}
```

- Calendar days in the **viewer's** `nearby.timezone`, not elapsed hours. 23:50 → 00:10 is "yesterday" after 20 minutes.
- Example: encounter 10 Oct (local) → "today" on 10 Oct, "yesterday" on 11 Oct, nothing on 12 Oct.
- Timezone: app sends `X-Timezone: <IANA>` on every request; `PATCH /nearby/settings { timezone }` stores it when it changes. Invalid → keep the stored value.
- Times come from the server clock (`last_detected_at` is set by the server, not the device).
- `valid_until` lets the app drop stale cached hints: `NearbyHint` sets a timer to the earlier of `valid_until` and local midnight, then invalidates the query. Cached responses older than `valid_until` render no hint.

Unit tests: same day, yesterday, 2 days, DST zone (`America/New_York`), `Asia/Kolkata` half-hour offset, future timestamp, invalid date, expired row still present.

---

## 11. Frontend state and UX

### 11.1 State model

```ts
type SignalState =
  | 'off'            // user switch off
  | 'needs_permission' | 'denied' | 'blocked'
  | 'unavailable'    // adapter / location services off
  | 'unsupported'    // hardware can't advertise (BLE only)
  | 'ready' | 'active' | 'error';

type NearbyState = {
  enabled: boolean;
  bluetooth: SignalState;
  location: SignalState;
  notifications: boolean;
  session: 'idle' | 'scanning' | 'found' | 'empty' | 'error';
};
```

`useNearbyState()` combines server settings (TanStack Query `['nearby','settings']`), permission status (`usePermission('bluetooth' | 'location')`), adapter state, and the BLE session.

### 11.2 `NearbySettings`

Settings → **Nearby**. Rows:

1. **Nearby** (master) — off → on opens `NearbyConsent`.
2. **Bluetooth discovery** — "Find people around you who also turned on Nearby." Asks the Nearby-devices permission when turned on.
3. **Location notifications** — "Get a notification when someone is near you. Your location is never shown." Asks location (When In Use) when turned on.
4. **Nearby notifications** — push on / off.
5. Row **See who's nearby** → `Nearby`.
6. **Your privacy** card (3 short rows): "Private by design" (anonymous Bluetooth ids that change every 15 minutes), "Only today or yesterday" (just the latest day is kept), "Only you control it" (nobody can see whether Nearby is on). No list of "never shown" items in the UI.

Each signal row shows its live status on the right: *On*, *Off*, *Needs permission*, *Bluetooth is off*, *Location is off*, *Not supported*.

### 11.3 Turning Nearby off

1. Stop advertising, scanning and location sampling immediately (`bleSession.stop()`, `locationSampler.stop()`).
2. Cancel timers and pending sighting batches (drop them; don't upload after opt-out).
3. `PATCH /nearby/settings { enabled: false }` → server revokes tokens, deletes presence and pings.
4. Server skips the user in all future matching and notifications.
5. Clear `['nearby', *]` caches and the token cache in memory.
6. Hints about this user disappear for others on their next fetch (the hint requires both opted in).
7. Everything else in the app is untouched.

Copy after turning off: "Nearby is off. Notifications that were already sent may still arrive." (we can't recall a push already handed to FCM).

### 11.4 Accessibility & theme

Hint chip: `accessibilityLabel="This person was near you today"`. Radar animation respects Reduce Motion. All colours from tokens (Light, Dark, every mood).

---

## 12. Native configuration

### 12.1 Android (`frontend/android/app/src/main/AndroidManifest.xml`)

Add **only** when BLE ships (Step 2):

```xml
<!-- Android 12+ -->
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" tools:targetApi="s" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<!-- Android 11 and below -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />
```

- `neverForLocation` is valid because we only look for our own service UUID. On Android ≤ 11 BLE scanning needs location permission (already declared) — the app asks for it with BLE on those versions only.
- `BLUETOOTH_CONNECT` lets Android show the system "turn on Bluetooth" dialog. Discovery itself does not connect.
- Location: `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` already present. **Don't** add `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_*` in Phase 1.
- Phase 9 (background BLE, after testing): `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, a service with `foregroundServiceType="connectedDevice"` and a persistent notification.
- `react-native-permissions`: add `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT` to the handled list.
- After native changes: `npm run clean:android && npm run apk:debug && npm run install:debug` (fresh install).

### 12.2 iOS (`frontend/ios/Nexity/Info.plist`)

- Add `NSBluetoothAlwaysUsageDescription`: "Nexity uses Bluetooth to find people nearby who also turned on Nearby. Your location is never shown."
- Keep `NSLocationWhenInUseUsageDescription` (already present); update text to: "Nexity uses your location only for Nearby notifications you turned on. Your place is never shown to anyone."
- Podfile `setup_permissions`: `Bluetooth`, `LocationWhenInUse`, `LocationAccuracy` (precise-location prompt). `Bluetooth` covers scan and advertise on iOS 13 and newer.
- `NSBluetoothPeripheralUsageDescription` is set as well, for the advertise prompt on older system builds.
- `NSLocationTemporaryUsageDescriptionDictionary` key `NearbyPrecise` asks for precise location when the user chose Approximate. Nearby does not send a sample until precision is on.
- **No** `UIBackgroundModes` (`bluetooth-central`, `bluetooth-peripheral`, `location`). Discovery runs only while Nexity is open, which is what App Review expects for this feature.

---

## 13. Notifications and reliability

Current backend: in-app `notifications` only. Push needs the [PUSH_NOTIFICATIONS.md](../../architecture/PUSH_NOTIFICATIONS.md) work (`devices`, `firebase-admin`, `@react-native-firebase/messaging`, Notifee channels). **Nearby adds no other provider.**

Dispatch (no Redis, no paid queue):

1. `nearby_notifications` row is the outbox (unique `dedup_key` = idempotency).
2. A worker in `nearby.notify.ts` runs every 15 s (same pattern as the cleanup intervals), takes `push_status: 'pending', next_attempt_at ≤ now` with `findOneAndUpdate` (claim), sends via the shared push sender.
3. Success → `sent`. Transient FCM error → `attempts++`, back-off 30 s · 2ⁿ, max 5 → `failed`. `registration-token-not-registered` → delete that device, continue with others.
4. Push disabled / Nearby notifications off / user opted out since → `skipped`.
5. Encounter writes never wait for the push.

Android channel `nearby` ("Nearby", default importance). The Notifications screen gets a **Nearby** filter and a 💫 icon; tap → `Nearby`.

---

## 14. Physical-device testing

Two physical Android phones, two Nexity accounts. Record result, device model and Android version per row. **Status today: none run.**

| # | Test | Expected | Status |
|---|---|---|---|
| B1 | Both opted in, permissions granted, screens open | Each sees the other on `Nearby` within 60 s | Not run |
| B2 | Third phone with a generic BLE app advertising | Not shown | Not run |
| B3 | Scanner-only phone (advertising disabled) | Not shown to anyone, sees nobody | Not run |
| B4 | Replay a captured EphID from a third device | No profile shown | Not run |
| B5 | Many advertisements / rotation across 15-min boundary | One card per person | Not run |
| B6 | B turns Bluetooth discovery off | B disappears from A within 5 min; B's tokens revoked | Not run |
| B7 | A blocks B | Neither sees the other; no hint | Not run |
| B8 | Bluetooth adapter off / permission denied / blocked | Correct state, Open Settings returns correctly | Not run |
| B9 | App to background and back; 20 start/stop cycles | No crash, no scan-throttle failure | Not run |
| L1 | Both opted in, same room ≥ 2 samples / 2 min | Both get "Someone is near you on Nexity. ✨" once | Not run |
| L2 | Stay together 1 h | No more pushes inside the cooldown | Not run |
| L3 | Approximate location only | No encounter, explained in UI | Not run |
| L4 | 500 m apart | No encounter | Not run |
| L5 | Location services off | State shown; nothing sent | Not run |
| H1 | Encounter today → Secret thread | "This person was near you today." | Not run (needs Secret module) |
| H2 | Same encounter next day | "…yesterday." | Not run |
| H3 | Two days later | No hint | Not run |
| H4 | No encounter / expired / blocked | No hint | Not run |
| H5 | Free plan with encounter | Locked chip only | Not run |
| H6 | Encounter never creates message, crush or match | Verified in DB | Not run |
| R1 | Regression: login, signup, profile, posts, reels, stories, chat, notifications, S3 upload/display | Unchanged | Not run |

Unit / integration (Vitest) to write with the backend module: hint date logic, mutual verification, replay, expiry filter, opt-out side effects, block filtering, dedupe in both orders, notification idempotency and caps.

---

## 15. Performance and battery

| Control | Value |
|---|---|
| BLE session | Starts when `Nearby` opens; scans **10 s on / 20 s off** (low-latency mode only while the screen is visible); stops after **5 min** without interaction ("Scan again") and on background |
| Advertising | Only during a session; `ADVERTISE_MODE_BALANCED`, `TX_POWER_MEDIUM` |
| Scan filter | Nexity service UUID only (required for Android screen-off scans later) |
| Sighting upload | Batched every 30–60 s, max 50 |
| Location | 1 sample / 120 s in foreground while the switch is on; never `watchPosition` with high accuracy continuously |
| Server | `nearbyLimiter`, per-route minimum intervals, TTL cleanup, indexes in [§7](#7-mongodb-data-model) |

Measure on devices (Android battery historian, 30-min session) before enabling any background mode.

---

## 16. Environment and deployment

Add to `backend/src/config/env.ts` (zod, with defaults) and `.env.example`. **Only add each when the code using it lands.**

| Variable | Default |
|---|---|
| `NEARBY_ENABLED` | `true` (global kill switch) |
| `NEARBY_RADIUS_METERS` | `50` |
| `NEARBY_MIN_ENCOUNTER_DURATION_SECONDS` | `120` |
| `NEARBY_LOCATION_ACCURACY_LIMIT_METERS` | `40` |
| `NEARBY_LOCATION_SAMPLE_SECONDS` | `120` (sent to the app in `GET /nearby/settings`) |
| `NEARBY_ENCOUNTER_COOLDOWN_MINUTES` | `30` |
| `NEARBY_NOTIFICATION_COOLDOWN_MINUTES` | `360` |
| `NEARBY_MAX_PUSHES_PER_DAY` | `3` |
| `NEARBY_ENCOUNTER_RETENTION_DAYS` | `2` |
| `NEARBY_TOKEN_TTL_MINUTES` | `15` |
| `NEARBY_PRESENCE_TTL_SECONDS` | `300` |
| `NEARBY_PUSH_ON_BLE` | `false` |

Push credentials (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) are server-only, per PUSH_NOTIFICATIONS.md. The app ships no secret; the BLE service UUID is public by design.

---

## 17. Implementation order and file plan

| Step | Work | Files | Done when |
|---|---|---|---|
| 1 | Audit | this doc §3 | ✅ |
| 2 | Foreground BLE prototype | install the chosen library; `src/features/nearby/ble/*`; manifest Bluetooth permissions; dev-only test screen in `DevComponents` | Two Android phones see each other's **fixed test** service data |
| 3 | Secure identity matching | backend `nearby.tokens.ts`, `nearby.sightings.ts`, models, routes; app token cache + rotation; `NearbyScreen` | B1–B6 pass |
| 4 | Location | `locationSampler.ts`, `nearby.location.ts`, `POST /nearby/location` | L3–L5 pass |
| 5 | Encounters | `nearby.encounters.ts`, `encounter.model.ts`, cleanup, blocks | Vitest suite green |
| 6 | Notifications | outbox + worker; depends on PUSH_NOTIFICATIONS.md implementation | L1–L2 pass |
| 7 | Secret Message hints | `nearby.hints.ts` + Secret Message APIs; `NearbyHint` component | H1–H6 pass (thread rows) |
| 8 | Secret Crush hints | Secret Crush APIs + rows | H1–H6 pass (crush rows) |
| 9 | Native hardening | background study, FGS decision, iOS on a Mac | Documented results |
| 10 | Regression + APK | `npm test` (both), `npm run apk:release`, install on both phones | R1 passes |

---

## 18. Definition of done

- [ ] Bluetooth finds supported nearby Nexity devices on tested physical phones (B1).
- [ ] Device-to-account matching is mutual, server-verified and replay-safe (B2–B5).
- [ ] Location proximity follows [§5.2](#52-proximity-validation) (L1–L5).
- [ ] Both users get one generic notification per cooldown (L1–L2).
- [ ] Secret Message shows today / yesterday only for valid encounters (H1–H5).
- [ ] Secret Crush follows the same rules without revealing crush status ([§9](#9-secret-crush-integration)).
- [ ] Old, invalid and missing encounters show nothing (H3–H4).
- [ ] Opt-out and blocks enforced on the backend (B6–B7).
- [ ] Existing features still work (R1).
- [ ] Native permissions documented and built into a fresh APK.
- [ ] Test results recorded in [§14](#14-physical-device-testing); unverified items stay labelled.

---

## 19. Known limitations

- No background discovery in Phase 1 (Android or iOS). Encounters happen only while the app is open on both phones (BLE) or at least foregrounded periodically (location).
- iOS ↔ Android BLE needs a short GATT read; iOS background advertising is not discoverable by Android.
- Location-only encounters can be false positives indoors (floors, neighbours).
- Push depends on the FCM / APNs work that isn't built yet.
- Hint hosts (Secret Message / Secret Crush) aren't built yet in the app or API.
- Already-sent pushes can't be recalled after opt-out.

---

## 20. Prototype mapping

The browser prototype simulates everything above (no real radio or GPS). Open `frontend/prototype/index.html` → Demo controls (Alt + D) → **Nearby simulator**.

| Spec | Prototype |
|---|---|
| Settings + consent + per-signal permissions | Settings → Nearby (`settingsNearby`, `nearbyConsent`) |
| `Nearby` screen states | Home header radar (or desktop sidebar) → `nearby` screen; force states with Demo controls → **Phone** (Bluetooth adapter, advertising support, location services, precise location, permissions cycling not asked → denied → blocked → allowed) and the Network error toggle |
| Mutual verification | "Someone comes into Bluetooth range" is verified only while the Nearby screen is scanning (otherwise a toast says to open it); "Unknown Bluetooth device" is ignored |
| Location push + cooldown | "Location encounter (server)" → generic notification once per pair; repeating inside the cooldown or past the daily cap saves the encounter and shows "Encounter saved. No notification — …" |
| Persona | Demo controls → **Nearby explorer**: Plus, Nearby on, two people in Bluetooth range, one unread nearby notification |
| Calendar logic | "Advance clock by 1 day" moves the demo clock: today → yesterday → hidden |
| Hints in Secret UI | Premium → Secret Messages / Secret Crush rows, sealed thread header, reveal overlay, match screen |
| Opt-out | Turning Nearby off clears live cards and hides every hint |
| Admin | `admin.html` → Nearby: global switch, editable server settings (audited), aggregate counts only |
