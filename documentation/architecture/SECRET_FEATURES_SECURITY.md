# Secret features & subscriptions — end-to-end security

Applies to [Secret Messages](../modules/premium/secret-messages.md), [Secret Crush](../modules/premium/secret-crush.md) and [Plans & billing](../modules/premium/plans-and-billing.md). Builds on [AUTH_AND_SECURITY.md](AUTH_AND_SECURITY.md).

## 1. What "end to end" means here

These features are secured **across the whole path**: phone → network → API → database → push → moderation.

They are **not end-to-end encrypted (E2EE)**. The server **must** read the content to:

- keep a message sealed and reveal it only after the 2nd reply,
- let moderators review a reported message (App Store 1.2 / Google Play UGC policy require working reporting for anonymous content).

So the protection is **TLS in transit + field encryption at rest + strict server-side rules + no identity leaks anywhere**. Don't call the feature "end-to-end encrypted" in the app or store listing.

## 2. Threats we design against

| # | Threat | Main defence |
|---|---|---|
| T1 | Receiver finds out who sent a sealed message before the reveal | Server never sends sender data while sealed (§3) |
| T2 | User finds out who has a crush on them without a match | Same response for every add; count updates delayed; rate limits (§4) |
| T3 | Free user gets paid features with a modified app | Every check on the server; app state is only for display (§5) |
| T4 | Fake / shared / replayed purchase receipts | Store-signed verification + account binding (§5) |
| T5 | Harassment hidden behind anonymity | Report + anonymous block on every plan, rate limits, link ban, moderation sees identity (§6) |
| T6 | Database leak exposes secret messages | AES-256-GCM field encryption, keys outside the DB (§7) |
| T7 | Leaks through logs, push, crash reports, caches | Redaction rules (§8) |

## 3. Anonymity guarantees (Secret Messages)

1. **Role-based serializers.** `toReceiverSealedView()` builds the response from an **allow-list** of fields (`id, role, status, replies_used, has_unread, day`). Never spread a DB document into a response.
2. **No sender identity** in any sealed response: no `sender_id`, username, avatar, profile link, follow state, mutual friends or online status.
3. **No content and no content shape:** no body, no length, no word count, no emoji/language hint. Sealed bubbles in the app use **fixed** placeholder widths by position.
4. **No exact time:** sealed threads and messages expose `day` (`YYYY-MM-DD` in IST) only. Public ids are **random UUID v4** — not MongoDB ObjectIds, which contain the creation second.
5. **Notification timing jitter:** anonymous notifications (`secret_message_received`, `secret_message_followup`, `crush_added`) are delivered after a **random 30–120 s delay** (queue job with `delay`). This stops "I saw her tap her phone and 1 second later I got it".
6. **Anonymous notifications have `actor_id: null`** in the `notifications` collection. The link to the thread is `entity_id` only. The current `Notification` model requires `actor_id` — make it nullable and add a check that anonymous types are always saved with `null`.
7. **Push payload** for anonymous types: fixed title/body text, `deep_link` with the opaque thread id, no `actor_avatar_url`, iOS `thread-id: "secret"`, no `mutable-content` image.
8. **Generic errors:** every "you can't message / crush this person" case returns the same code (`CANNOT_SEND_SECRET` / `CANNOT_ADD_CRUSH`) and message, and takes similar time.
9. **Reveal is atomic:** `replies_used` is increased with a conditional update (`replies_used < 2`) inside the transaction that reveals. Two parallel replies can't skip or double the reveal.
10. **Sender always knows the receiver** (by design); the receiver's replies are not anonymous.
11. **Anonymous block doesn't touch public data:** it never hides the sender's profile or posts, because that would show who it is.

**Automated tests (must exist):**

- Snapshot of every sealed endpoint response → assert no key outside the allow-list, and no sender id / username / body substring anywhere in the JSON.
- Push payload builder test for anonymous types.
- Parallel reply test (2 requests at once → exactly 1 reveal, 1 conversation).

## 4. Crush privacy

1. The `POST /secret-crushes` response has the **same shape and status code** whether or not a reverse crush exists, except `matched: true` (the intended reveal, which also notifies both sides).
2. **No endpoint lists who crushed you.** Only `admirers_count`.
3. **Count timing:** increases are live (the user also gets the notification), **decreases only in the nightly recompute**, so removing a crush can't be traced to one person.
4. **Probing limits:** 10 adds / day, 24 h re-add cooldown, spots limit 3 / 10. Probing is also visible: if you add someone who already added you, they learn it's you too (it's a match).
5. Notifications: 1 per (adder, person) per 30 days.
6. **Match creation:** unique `pair_key` index → exactly one match even under races.
7. **Paused crushes** (adder without a plan) never match, so ending a plan can't leak anything.
8. `crushes` is never exposed through other APIs (profile, search, suggestions, "people you may know" must not use crush data).

## 5. Entitlements & payments

**Server is the only source of truth.**

- Gated endpoints use `requireFeature()` ([plans-and-billing §5.2](../modules/premium/plans-and-billing.md#52-entitlement)). The app's `useEntitlement()` only decides what to **show**.
- Limits are reserved with atomic conditional updates (no "check then insert" races).
- The entitlement cache is ignored once `expires_at` has passed, even if a webhook is late.

**Purchase verification:**

| Check | iOS | Android |
|---|---|---|
| Authentic | JWS verified against Apple root CA (`SignedDataVerifier`), never decoded without verifying | Fetched from Google with our service account (`subscriptionsv2.get`); never trust data from the app |
| Our app | `bundleId == com.nexity.app`, `appAppleId` | `packageName == com.nexity.app` |
| Right environment | `Production` (Sandbox allowed only for App Review / TestFlight, flagged `environment: 'sandbox'`) | `testPurchase` flagged |
| Right account | `appAccountToken == users.billing_account_token` | `obfuscatedExternalAccountId == users.billing_account_token` |
| Right product | Product id belongs to a known plan | Same |
| Not replayed | Unique `(store, original_transaction_id)` | Unique `(store, purchase_token)`; `linkedPurchaseToken` chain handled |
| Acknowledged | `finishTransaction` only after the server said OK | Server `acknowledge` |

**Webhooks:** signature-verified (Apple JWS / Google Pub/Sub OIDC), idempotent by event id, out-of-order safe, processed in a queue, raw events kept 2 years for disputes. Webhook routes are excluded from bearer auth and **must** reject unsigned requests.

**No card / UPI data ever touches Nexity.** Payment details stay inside Apple / Google. We store order ids, product ids, amounts and statuses only.

**Admin plan edits and gifts** are audit-logged (`admin_audit`: admin id, action, before/after, time, IP).

## 6. Safety & moderation

- **Report** and **Block sender** are available on every sealed item, for every plan (also Free on the locked card).
- **Moderators** see the real sender and decrypted thread **only through a report** in the admin queue ([moderation.md](../modules/admin/moderation.md)). Every decrypt by an admin writes an `admin_audit` row. There is no "browse secret messages" admin screen.
- Actions: warn, remove thread, **suspend Secret features** for the sender (`users.secret_suspended_until` → all secret endpoints return `403 CANNOT_SEND_SECRET`), ban account.
- Automatic: 3+ reports from different receivers in 7 days → auto-suspend Secret features pending review.
- **Content rules at send:** no links, length limits, optional profanity / threat word list (flag → still delivered but marked for review). Self-harm keywords → the receiver sees a "Need help?" resources link.
- **Age:** anonymous messaging and crush features make the App Store rating **17+** and need the Play "UGC" declarations. If users under 18 can sign up, Secret features must be disabled for them (needs a date of birth at sign-up — open product decision).
- **Privacy settings** ([privacy.md](../modules/settings/privacy.md)): `allow_secret_messages` and `allow_secret_crush`: `everyone` (default) | `following` (only people I follow) | `off`. Required as a safety control even though the default is "everyone".

## 7. Data protection

| Data | Protection |
|---|---|
| Secret message bodies (`secret_thread_messages.body_enc`) | **AES-256-GCM**, random 12-byte IV per message, auth tag stored, `key_version`. Key `SECRET_MESSAGE_KEY` (32 bytes, base64) from the secret manager / env, never in the DB or repo. Key rotation: new writes use the new version, old rows decrypt with their version |
| After reveal | Copied into normal `messages` like any chat (same protection as chat) |
| `crushes`, `crush_matches` | DB access control; never exported to analytics |
| Purchase tokens / receipts | Stored for re-verification; DB access control; never logged |
| Database | MongoDB with TLS, auth, encryption at rest (Atlas default), least-privilege app user, backups encrypted |

**Retention:**

- Sealed threads with no reply for 30 days → archived, deleted after 90 days.
- Withdrawn threads → deleted after 30 days (kept that long for reports).
- Removed crushes → hard-deleted after 30 days (the cooldown and notify-once data only needs that long).
- **Account deletion** → delete the user's secret threads (both roles), crushes, matches, usage and secret blocks. Revealed / match chats follow normal chat deletion rules.

## 8. Logs, push, crash reports, caches

- Request logger **redacts** `body` on every `/secret-messages*` route and every purchase token / `signed_transaction` / `signedPayload`.
- Never log `sender_id` together with `recipient_id` for sealed threads outside the audited admin flow. Error logs use the thread `public_id` only.
- Crash reporting (app): no request/response bodies for secret or subscription endpoints (breadcrumb filter).
- App caches: secret queries are memory-only (no React Query persister, no AsyncStorage). Analytics events carry no user ids of the other person and no content (e.g. `secret_message_sent` with no properties).
- Push: see §3, point 7.

## 9. Rate limits

| Endpoint | Limit |
|---|---|
| `POST /secret-messages` | 10 / min, 60 / day / user (then plan limits: Plus 5 / month, Premium 30 / day fair use) |
| `POST /secret-messages/:id/messages` | 30 / min / user; sender max 3 unanswered follow-ups |
| `POST /secret-messages/:id/report` | 20 / day / user |
| `POST /secret-crushes` | 30 / min, **10 adds / day** / user |
| `DELETE /secret-crushes/:userId` | 30 / min / user |
| `POST /subscriptions/purchases` | 20 / hour / user |
| `POST /subscriptions/restore` | 10 / hour / user |
| Webhooks | No user limit; signature required; 1 MB body cap |

Exceeded → `429 TOO_MANY_REQUESTS` (`Retry-After` header).

## 10. Transport & app

- HTTPS only (ATS on iOS, no cleartext on Android release) — see [AUTH_AND_SECURITY.md](AUTH_AND_SECURITY.md#transport--app-hardening).
- Socket events for secret features go only to `user:<id>` rooms of the two members, with the same role-based serializers as REST.
- No store keys, encryption keys or service accounts in the app bundle.

## 11. Security checklist (release blocker)

- [ ] Sealed-response allow-list tests pass (no sender data, no body, no length, no exact time).
- [ ] Anonymous notifications: `actor_id` null, generic push payload, 30–120 s jitter.
- [ ] All gated endpoints return `403` for Free / over-limit users when called directly (Postman test with a Free token).
- [ ] iOS JWS and Google purchase verification + account-token binding; webhook signature checks; replay test.
- [ ] Secret message bodies encrypted at rest; key not in the repo; rotation documented.
- [ ] Logs and crash reports redact bodies and purchase tokens.
- [ ] Report + anonymous block on every plan; moderator decrypt is audit-logged.
- [ ] Parallel-race tests: double reveal, double match, quota overuse.
- [ ] Privacy settings `allow_secret_messages` / `allow_secret_crush` enforced.
- [ ] App Store privacy labels and Play Data safety updated (purchase history, user content).

## 12. Nearby encounters

Full design: [nearby-encounters.md](../modules/nearby/nearby-encounters.md).

- **Opt-in, off by default.** Nobody can see whether another person's Nearby is on.
- **Bluetooth ids:** 16 random bytes from the server, 15-minute windows, stored only as sha256. Never a user id, username, phone, token or stable id over the air. MAC addresses and device names are never used to identify anyone.
- **Mutual verification:** a profile appears on `Nearby` only after **both** phones report each other's current ids within ± 2 minutes. Replayed ids and scan-only devices never verify.
- **Location:** When-In-Use only; readings rejected above the accuracy limit or older than 2 minutes; rounded to ~11 m and deleted after 15 minutes. Encounters store no coordinates. Logs redact `lat`, `lng`, `eph_id`.
- **Hints on sealed threads:** keyed by thread id (the client never learns the sender), day granularity only, require both people to have Nearby on, hidden after a secret block. Never shown on the "people who have a crush on you" card.
- **No side effects:** an encounter never creates a message, crush, match or chat, and never changes admirer counts.
- **Push:** generic "Someone is near you on Nexity. ✨", no actor; per-pair cooldown, daily cap, idempotency key.
- **Opt-out / block:** applied on the server at once (tokens revoked, presence and pings deleted, encounters ignored).
- **Admins** see aggregate counts and "Nearby misuse" reports only, never locations, encounters, or who has Nearby on.

| Endpoint | Limit |
|---|---|
| All `/nearby/*` | 120 / 15 min / user |
| `POST /nearby/ble/tokens` | 30 / 15 min / user |
| `POST /nearby/ble/sightings` | 1 / 20 s / user, ≤ 50 sightings |
| `POST /nearby/location` | 1 / 60 s / user |
