# Secret Messages (Feature 1)

**Screens:** `Premium` → **Messages** section (Received / Sent), `SecretPeoplePicker`, `SecretCompose`, `SecretThread`, reveal overlay  
**Deep links:** `nexity://premium/messages` → `Premium { section: 'messages' }`, `nexity://secret/messages/:threadId` → `SecretThread`  
**Theme:** Light, Dark and every mood. Secret screens use `secretGradient`, sealed bubbles use `secretGlow` — no hard-coded colors ([THEMING.md](../../architecture/THEMING.md))  
**Auth required:** Yes  
**Plan:** Free = notification + locked count only · Plus = read/reply + 5 new / month · Premium = read/reply + unlimited (fair use) — [plans-and-billing.md](plans-and-billing.md)  
**Frontend:** `frontend/src/screens/premium/secret/`, `frontend/src/features/secret/`, `frontend/src/services/api/secretMessages.ts`  
**Backend:** `backend/src/modules/secret-messages/`  
**Security:** [SECRET_FEATURES_SECURITY.md](../../architecture/SECRET_FEATURES_SECURITY.md)  
**Prototype:** `frontend/prototype/js/secret.js`

## 1. What it is

A user can send an **anonymous message to any account, public or private**.

1. The receiver gets a notification: **"Someone is trying to reach you with a Secret Message 💌"** — never a name.
2. **Receiver on Free:** they can't open Secret Messages at all. They only see a locked card ("You have 2 sealed messages") and an upgrade button.
3. **Receiver on Plus / Premium:** they see the **list** of Secret Messages. Each item is **sealed**: the sender's **name, photo and message text are all hidden**.
4. The receiver **replies**. After the receiver's **2nd reply**, the thread **unseals**: name, photo and full message are revealed together with an animation.
5. The thread then becomes a **normal chat** in the Inbox (tag "💌 Revealed").

The sender always knows who they wrote to and sees the receiver's replies. The sender stays "Someone" until the reveal.

### Who can do what

| Action | Free | Plus | Premium |
|---|:-:|:-:|:-:|
| Receive the push / in-app notice | ✅ | ✅ | ✅ |
| See the number of sealed messages (locked card) | ✅ | ✅ | ✅ |
| Open the list and a thread | ❌ → `Plans {reason:'secret_read'}` | ✅ | ✅ |
| Reply (and so unlock the reveal) | ❌ | ✅ | ✅ |
| Start a new Secret Message | ❌ → `Plans {reason:'secret_send'}` | 5 / month | Unlimited (30 new / day fair use) |
| Follow-up messages in a sealed thread you started | ✅ (existing threads only) | ✅ | ✅ |
| Report / block an anonymous sender | ✅ (from the notification / locked card menu) | ✅ | ✅ |

## 2. Rules

| Rule | Value |
|---|---|
| Recipients | Any active account, public or private. Not yourself. Not anyone in a block relation with you (either direction). Not someone who blocked you **as an anonymous sender**. Not someone whose `allow_secret_messages` is `off` (or `following` and you aren't followed by them) |
| One open thread per pair | Max **1 sealed thread** from A to B. Starting again returns `409 SECRET_THREAD_EXISTS` with the thread id, and the app opens it |
| First message | 3–300 characters, trimmed. **No links** (`http`, `www.`, `.com/`…) → `400 LINKS_NOT_ALLOWED` |
| Follow-ups by the sender while sealed | Max **3 in a row** without a reply from the receiver (`429 SECRET_FOLLOWUP_LIMIT`). 1–500 chars, no links |
| Receiver replies | 1–500 chars. Reply **#2 reveals** |
| What "reveal" means | Sender's identity **and** every sender message body become visible to the receiver |
| Reveal is final | It can't be undone |
| Time shown on sealed items | **Day only** ("Today", "Yesterday", "3 Oct"), never the exact time |
| Sealed thread expiry | A sealed thread with no receiver reply for **30 days** is archived: hidden from both lists, kept 90 days for moderation, then deleted. The monthly quota is not refunded |
| Deleted / disabled sender | Their sealed threads disappear from the receiver's list |

## 3. Screens (frontend)

### 3.1 `Premium` → Messages section

Part of the Premium tab ([premium-hub.md](premium-hub.md)). Two segments: **Received** (count badge) and **Sent** (count badge).

**Received — receiver on Free (`GET /secret-messages/summary` only):**

- Locked card on `secretGradient`: lock icon, "You have **2** sealed messages", "Someone has something to tell you. Upgrade to reply — the name and message unseal after your 2nd reply.", button **Unlock Secret Messages** → `Plans { reason: 'secret_read' }`.
- Below it, one locked envelope row per message (no text, only the day). Tapping a row opens `Plans`. The ••• menu on a row offers **Report** and **Block sender**.

**Received — Plus / Premium (`GET /secret-messages/inbox`):**

- Privacy line: 🛡 "Name and message stay sealed until you reply twice."
- Sealed card: envelope with a wax seal (mask icon), title **"Someone sent you a secret message"**, status "Sealed · reply twice to unseal" or "One more reply unseals it ✨", a 2-step progress track, the day, and a **New** chip when the last message is from them and unread. Tap → `SecretThread`.
- Revealed card: avatar, name, "Unsealed · now a chat", ✓ Revealed chip. Tap → `ChatThread { conversationId }`.
- Empty state: 💌 "No secret messages yet" + "Send a Secret Message".
- Pull to refresh, infinite scroll.

**Sent:**

- Paid: usage meter "**3 of 5** Secret Messages left this month" (Premium: "Unlimited Secret Messages with Premium") with "Get more" when 0 left.
- Free: upsell card "Send your first Secret Message" → `Plans { reason: 'secret_send' }`.
- Rows: receiver avatar + "To Riya Patel", status "Delivered · you're hidden" / "1 of 2 replies · you're still hidden" / "They replied twice · you're revealed", progress track, day. Tap → `SecretThread` (sealed) or `ChatThread` (revealed).
- Button **Send another Secret Message** → `SecretPeoplePicker`.

### 3.2 Entry points to send

1. **UserProfile** → button **Send Secret Message** (mask icon) under Follow/Message.
2. **Premium → Messages → Send a Secret Message** → `SecretPeoplePicker { intent: 'secret_message' }`.

Before navigating, the app checks `useEntitlement()`:

- No plan → `Plans { reason: 'secret_send', targetUserId }`.
- 0 left this month → limit sheet: "You've used all 5 Secret Messages this month", "Go Premium for unlimited Secret Messages — ₹249/month", **Upgrade to Premium** / Not now. Premium users at the daily fair-use cap see "You've sent a lot today. Try again tomorrow."
- Open thread with that person exists → toast "You already have a secret conversation going with them." → `SecretThread`.

The server checks all of these again.

### 3.3 `SecretPeoplePicker` (modal, shared with Secret Crush)

**Params:** `{ intent: 'secret_message' | 'crush' }`. A search field (`GET /users/search?q=`) plus suggestions. Rows: avatar, username, name. Blocked users never appear. Tap → `SecretCompose { userId }` (or the crush confirm sheet).

### 3.4 `SecretCompose` (modal, `fullScreenModal`)

**Params:** `{ userId }`

- Header: back, "New secret message".
- "To" row: avatar, name, @username, mask badge "You're anonymous".
- Letter card: "From: **Someone**", multiline input (`maxLength 300`, live counter `0/300`), placeholder "Write something kind, honest or brave…".
- Prompt chips: "I've always wanted to tell you…", "You made my day when…", "Honestly, I admire how you…", "Can I be honest? 🙈".
- How-it-works steps: ① They get "Someone is trying to reach you with a Secret Message 💌" ② Your name and message stay sealed while they reply ③ After their 2nd reply, both are revealed and you chat normally.
- Usage line: "Uses 1 of your **3** remaining Secret Messages this month" (Premium: "Unlimited with Premium").
- **Send secretly** button (spinner "Sealing…").
- Fine print: "Be kind. Recipients can report and block anonymously, and abuse gets accounts removed."
- Keyboard: `KeyboardAvoidingView`; the button stays visible above the keyboard.

Send → `POST /secret-messages` with a `client_message_id` (UUID v4, so retries can't double-send or double-charge the quota). On `201` → sent state in the same modal: envelope animation, "Sealed & sent", "Riya will see 'Someone is trying to reach you…'", buttons **View conversation** (`SecretThread`, replaces the modal) and **Done**.

Errors: `PLAN_REQUIRED` → `Plans`; `PLAN_LIMIT_REACHED` → limit sheet; `SECRET_THREAD_EXISTS` → open the thread; `CANNOT_SEND_SECRET` → "You can't send a Secret Message to this person."; `LINKS_NOT_ALLOWED` → inline "Links aren't allowed in Secret Messages."; offline → keep the draft and show "No connection. Try again." (never queue a secret send offline).

### 3.5 `SecretThread` — receiver view (sealed)

**Params:** `{ threadId }`. Tab bar hidden. `secretGradient` background.

- Header: mask avatar, a sealed name placeholder (two blurred bars, `accessibilityLabel` "Sender's name is sealed"), "Name sealed until the reveal". ••• → **Report this message**, **Block sender** ("Your report stays private. The sender's identity stays hidden.").
- Seal box: big wax seal (cracks after reply 1), title "This message is sealed" / "One more reply to unseal", text, track **Reply 1 → Reply 2 → ✨ Reveal**.
- Day divider (day only).
- Messages: sender messages render as **sealed bubbles** — fixed-width placeholder bars by position, never sized from the real text, and a "🔒 Sealed" tag. The receiver's own replies render as normal outgoing bubbles.
- Composer: quick replies ("Who is this? 👀", "Hi! 👋", "Tell me more 🙈", "You made me curious 😄"), hint "Reply 1 of 2 · everything stays sealed until your 2nd reply" / "✨ Reply 2 of 2 — this unseals their name & message", input (max 500), send.
- Free user opening via a deep link or push: the same header, a seal box "Someone has something to tell you 💌" + **Unlock Secret Messages**, one sealed bubble, no composer.

**Reveal (2nd reply):** the `POST` response contains the sender and the decrypted messages. The app shows the **reveal overlay**: the envelope splits, "Unsealed ✨", the masked avatar morphs into the real avatar, "It's Riya Patel!", @username, "What they wrote" bubbles appear one by one, confetti + hearts burst (Skia), buttons **Open chat** (→ `ChatThread`, stack reset to `Inbox`) and **View profile**. With Reduce Motion on: a simple fade, no particles. Screen reader announces "Sender revealed: Riya Patel".

### 3.6 `SecretThread` — sender view

- Header: receiver avatar + name (tap → profile), "🎭 You're 'Someone' to them".
- Seal box: "Waiting for their first reply" / "One more reply and you're revealed", track Reply 1 → Reply 2 → Reveal.
- All messages fully visible (own + their replies).
- Composer placeholder "Add to your message (still anonymous)…". Disabled with the hint "Wait for their reply" after 3 unanswered follow-ups.
- On reveal (socket `secret.revealed` or push), the screen switches to "You've been revealed — They replied twice, so your conversation is now a regular chat" + **Open chat**.

### 3.7 Realtime & cache

- Socket events (same connection as chat): `secret.new`, `secret.message`, `secret.revealed`, `secret.summary` (§6).
- TanStack Query keys: `['secret','summary']`, `['secret','inbox']`, `['secret','sent']`, `['secret','thread',id]`, `['secret','messages',id]`. **Never** persist these to disk (no query persister) and never log them.

## 4. REST API

`backend/src/modules/secret-messages/` (routes → controller → service, Zod). All routes need auth. Ids are **random UUID v4** (`public_id`), not ObjectIds — ObjectIds contain the exact creation second ([security](../../architecture/SECRET_FEATURES_SECURITY.md#3-anonymity-guarantees)).

### `POST /api/v1/secret-messages` — start a thread

**Middleware:** `requireFeature('send_secret')`. **Rate limit:** 10 / min, 60 / day / user (before the plan limits).

```json
{ "recipient_id": "…", "body": "I've always wanted to tell you…", "client_message_id": "uuid-v4" }
```

Service (one MongoDB transaction):

1. Validate the recipient (§2 rules) → `403 CANNOT_SEND_SECRET` (one generic code for every "not allowed" reason, so the sender can't tell which one applies).
2. Existing sealed thread A→B → `409 SECRET_THREAD_EXISTS { thread_id }`.
3. Same `client_message_id` already stored → return the stored thread `200` (idempotent, no quota used).
4. Reserve quota ([plans-and-billing §5.4](plans-and-billing.md#54-atomic-limit-checks)) → `403 PLAN_LIMIT_REACHED { limit, resets_at }`.
5. Insert `secret_threads` + the first `secret_thread_messages` row (body **encrypted**).
6. After commit: queue the receiver's notification with **random 30–120 s delay** (§6). Emit `secret.summary` to the receiver.

**`201`** (sender view of the thread):

```json
{
  "id": "6b0e…", "role": "sent", "status": "sealed",
  "recipient": { "id", "username", "display_name", "avatar_url" },
  "replies_received": 0, "followups_left": 3,
  "created_at": "2026-10-07T06:28:11Z",
  "usage": { "secret_messages_left": 4 }
}
```

### `GET /api/v1/secret-messages/summary`

Available on **every plan** (powers the locked card and badges).

```json
{ "sealed_count": 2, "unread_count": 1, "sent_open_count": 1, "can_read": false, "can_send": false }
```

### `GET /api/v1/secret-messages/inbox` — receiver list

**Middleware:** `requireFeature('read_secret')` → Free gets `403 PLAN_REQUIRED`. Cursor list (`?cursor=&limit=`), newest activity first.

Sealed item — **contains no sender field and no message text or length**:

```json
{
  "id": "6b0e…", "role": "received", "status": "sealed",
  "replies_used": 1, "has_unread": true,
  "day": "2026-10-07",
  "sender": null, "conversation_id": null
}
```

Revealed item:

```json
{
  "id": "6b0e…", "role": "received", "status": "revealed",
  "day": "2026-10-07", "revealed_at": "2026-10-07T09:10:00Z",
  "sender": { "id", "username", "display_name", "avatar_url" },
  "conversation_id": "…"
}
```

### `GET /api/v1/secret-messages/sent` — sender list

Plan **not** required (so a downgraded user can still follow their threads). Items: `{ id, role: 'sent', status, recipient, replies_received, followups_left, day, conversation_id }`.

### `GET /api/v1/secret-messages/:threadId`

Role-based view of one thread (`404 NOT_FOUND` for non-members, archived or deleted threads). The receiver needs `read_secret` for a sealed thread, else `403 PLAN_REQUIRED`.

### `GET /api/v1/secret-messages/:threadId/messages`

Cursor list, newest first.

- **Receiver, sealed:** sender messages are `{ "id", "from": "them", "sealed": true, "day": "2026-10-07" }` — no `body`, no length, no exact time. Own replies: `{ id, from: 'me', body, created_at }`.
- **Sender** or **after reveal:** every message has `body` and `created_at`.

### `POST /api/v1/secret-messages/:threadId/messages`

```json
{ "body": "Who is this? 👀", "client_message_id": "uuid-v4" }
```

- **Sender** (sealed thread): follow-up. 3 unanswered max → `429 SECRET_FOLLOWUP_LIMIT`. No plan needed. The receiver gets "Someone sent you another secret message 💌" (collapsed, max 1 push per thread per hour).
- **Receiver:** needs `read_secret`. Increments `replies_used` with an atomic conditional update (`replies_used < 2`).
  - Reply 1 → push to the sender: "**riya.patel** replied to your Secret Message (1 of 2)".
  - Reply 2 → **reveal** (below).
- Revealed thread → `409 SECRET_THREAD_REVEALED { conversation_id }` (the app moves to the chat).

**Reveal** (same transaction as reply 2):

1. `status = 'revealed'`, `revealed_at = now`.
2. Get or create the **direct conversation** between the two (`direct_key`, existing chat reused). Set `origin: 'secret_message'` if new. Insert a system message "Started as a Secret Message 💌 — unsealed", then copy the thread messages in order as normal messages (`meta.origin = 'secret_message'`, `meta.sent_at` = original time). A revealed chat **ignores `allow_dm_from`** (both sides took part), but blocks still apply.
3. Response `200`:

```json
{
  "message": { "id", "from": "me", "body", "created_at" },
  "thread": { "id", "status": "revealed", "conversation_id": "…" },
  "sender": { "id", "username", "display_name", "avatar_url" },
  "revealed_messages": [ { "id", "from": "them", "body", "created_at" } ]
}
```

4. After commit: socket `secret.revealed` to both, `conversation.updated` to both; push to the sender "**riya.patel** replied twice — you've been revealed ✨ Your chat is open."

### `POST /api/v1/secret-messages/:threadId/read`

Marks the thread read for the caller.

### `POST /api/v1/secret-messages/:threadId/report`

`{ "reason": "harassment" | "hate" | "sexual" | "spam" | "self_harm" | "other", "details"?: "…" }` → `204`. Creates a `reports` row with `target_type: 'secret_thread'`. Works on **every plan**. The reporter never learns the sender. Moderators see the sender and the decrypted messages ([security §6](../../architecture/SECRET_FEATURES_SECURITY.md#6-safety--moderation)). Rate limit: 20 / day.

### `POST /api/v1/secret-messages/:threadId/block-sender`

Anonymous block → `204`. Stores `secret_blocks { blocker_id, blocked_id }`. Hides every sealed thread from that sender and stops future Secret Messages and crush notifications from them. It does **not** hide their profile or posts (that would hint who they are). Works on every plan.

### `GET /api/v1/users/me/secret-blocks` · `DELETE /api/v1/users/me/secret-blocks/:blockId`

Settings → Privacy → **Blocked secret senders**. Rows show "Anonymous sender · blocked 3 Oct" with **Unblock**. The block id is opaque; the sender is never shown.

### `DELETE /api/v1/secret-messages/:threadId`

Receiver: hides the thread for them (`204`). Sender: **withdraws** a sealed thread (deleted for both, the receiver's count drops; quota not refunded).

### Error codes

| Code | HTTP | When |
|---|---|---|
| `PLAN_REQUIRED` | 403 | Feature not in the caller's plan (`details.feature`, `details.required_plan`) |
| `PLAN_LIMIT_REACHED` | 403 | Monthly limit or daily fair-use cap (`details.limit`, `details.resets_at`) |
| `CANNOT_SEND_SECRET` | 403 | Recipient not allowed (any reason) |
| `SECRET_THREAD_EXISTS` | 409 | Open sealed thread already exists (`details.thread_id`) |
| `SECRET_THREAD_REVEALED` | 409 | Thread already revealed (`details.conversation_id`) |
| `SECRET_FOLLOWUP_LIMIT` | 429 | 3 unanswered follow-ups |
| `LINKS_NOT_ALLOWED` | 400 | Body contains a link |
| `VALIDATION_ERROR` | 400 | Length / type |
| `NOT_FOUND` | 404 | Unknown thread or not a member |

## 5. Data (summary)

Full fields: [DATA_MODELS.md — Secret Messages](../../architecture/DATA_MODELS.md#secret-messages).

- `secret_threads`: `public_id` (UUID), `sender_id`, `recipient_id`, `status` (`sealed` | `revealed` | `archived` | `withdrawn`), `replies_used`, `sender_followups_unanswered`, `conversation_id`, `revealed_at`, per-member `last_read_at` and `hidden`, `created_at`, `last_activity_at`. Partial unique index `{ sender_id, recipient_id }` where `status = 'sealed'`.
- `secret_thread_messages`: `public_id`, `thread_id`, `from` (`sender` | `recipient`), `body_enc` (AES-256-GCM), `client_message_id` (unique per author), `created_at`.
- `secret_blocks`, `secret_usage` (monthly counter).

## 6. Notifications

**Every receiver gets these notifications, Free included** — the plan is never checked before sending. A Free user's tap opens the locked card → `Plans { reason: 'secret_read' }`. Free / expired users also get the `secret_message_waiting` reminder (24 h, 3 days, 7 days) — see [plans-and-billing §6.1–6.2](plans-and-billing.md#61-free-users-get-every-secret-notification-this-is-how-nexity-earns).

Anonymous types are stored with **`actor_id: null`**. The push has **no** sender name, avatar, id or message text. Android channel `secret` ("Secret", high importance). iOS `thread-id: "secret"`.

| type | To | Copy | Opens | Delay |
|---|---|---|---|---|
| `secret_message_received` | receiver | Someone is trying to reach you with a Secret Message 💌 | `SecretThread` (paid) / `Premium {section:'messages'}` (Free, shows the locked card) | random 30–120 s |
| `secret_message_followup` | receiver | Someone sent you another secret message 💌 | same | random 30–120 s, max 1 / thread / hour |
| `secret_message_reply` | sender | **{username}** replied to your Secret Message (1 of 2) | `SecretThread` | none |
| `secret_message_revealed` | sender | **{username}** replied twice — you've been revealed ✨ Your chat is open. | `ChatThread` | none |

Preference key `secret_messages` ([notification-settings.md](../settings/notification-settings.md)). The in-app Notifications list shows anonymous items with a mask icon and the **day only**.

## 7. Acceptance criteria

- [ ] Any user can be messaged, public or private, unless blocked or opted out; the error never says why.
- [ ] Receiver gets "Someone is trying to reach you with a Secret Message 💌" on iOS and Android with no identifying data in the payload.
- [ ] Free receiver sees only the count + locked card; every read/reply endpoint returns `403 PLAN_REQUIRED`.
- [ ] Paid receiver sees the list; sealed responses contain **no** sender fields, no body, no body length and no exact time (automated API test).
- [ ] The 2nd reply reveals name, photo and message together exactly once, even when two replies are sent at the same moment.
- [ ] After the reveal both users have a normal chat (tag "💌 Revealed") that works on any plan.
- [ ] Plus users can start 5 threads per month; the 6th returns `PLAN_LIMIT_REACHED`; a retried send never uses 2.
- [ ] Report and anonymous block work on every plan and never reveal the sender.
- [ ] Works in Light, Dark and every mood; VoiceOver/TalkBack read sealed items as "Sealed message".
