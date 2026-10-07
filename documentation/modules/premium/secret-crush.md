# Secret Crush (Feature 2)

**Screens:** `Premium` → **Secret Crush** section, `SecretPeoplePicker { intent: 'crush' }`, add-crush confirm sheet, `MatchCelebration`, `ChatThread` with the **love theme**  
**Deep links:** `nexity://premium/crush` → `Premium { section: 'crush' }`, `nexity://secret/matches/:matchId` → `MatchCelebration`  
**Theme:** Light, Dark and every mood. Section uses `secretGradient`. The match chat uses the scoped **love** chat theme (tokens from the `romantic` mood palette) — no hard-coded colors ([THEMING.md](../../architecture/THEMING.md))  
**Auth required:** Yes  
**Plan:** Free = notification + admirer count only · Plus = 3 crush spots · Premium = 10 crush spots — [plans-and-billing.md](plans-and-billing.md)  
**Frontend:** `frontend/src/screens/premium/crush/`, `frontend/src/features/crush/`, `frontend/src/components/celebration/`, `frontend/src/services/api/secretCrush.ts`  
**Backend:** `backend/src/modules/secret-crush/`  
**Security:** [SECRET_FEATURES_SECURITY.md](../../architecture/SECRET_FEATURES_SECURITY.md)  
**Prototype:** `frontend/prototype/js/crush.js`, `frontend/prototype/js/chat.js` (`kind: 'match'`)

## 1. What it is

1. In **Premium → Secret Crush**, a user adds anyone (public or private account) to their **private crush list**.
2. The person added gets a notification: **"Someone added you as a Secret Crush 👀"** — never who.
3. **If that person has no plan**, they can't add anyone back. They see "1 person has a secret crush on you" and an upgrade button. After buying Plus or Premium, they can add the people they like to their own crush list.
4. **If both have added each other → it's a match:**
   - Both get a notification: **"Congratulations! 🎉 You and {username} are a match 💘"**.
   - Both see a **celebration**: two avatars, a heart, fireworks, crackers and confetti.
   - A **love-theme chat** opens between them (hearts in the background, pink romantic colors, "💘 You matched via Secret Crush" banner, one fireworks burst the first time it opens).
5. After that, the person appears in the **Matches** list (Premium → Secret Crush) and the chat appears in the normal **Inbox** like any other chat (tag "💘 Match").
6. **Not mutual → nobody ever finds out.** Not even whether the other person added you.

### Who can do what

| Action | Free | Plus | Premium |
|---|:-:|:-:|:-:|
| Receive "Someone added you as a Secret Crush 👀" | ✅ | ✅ | ✅ |
| See "N people have a secret crush on you" | ✅ | ✅ | ✅ |
| Add people to your crush list | ❌ → `Plans {reason:'crush'}` | up to **3** | up to **10** |
| Get matched (celebration + love chat) | ❌ (can't add) | ✅ | ✅ |
| Chat with a match | ✅ forever, even after the plan ends | ✅ | ✅ |
| Remove a crush | ✅ | ✅ | ✅ |

## 2. Rules

| Rule | Value |
|---|---|
| Who can be added | Any active account, public or private. Not yourself (`400 CANNOT_CRUSH_SELF`). Not anyone in a block relation with you, or who blocked you as an anonymous sender, or whose `allow_secret_crush` is `off` → `403 CANNOT_ADD_CRUSH` (one generic code) |
| Spots | `active` + `paused` crushes ≤ plan `crush_spots` (3 / 10). A match **moves to Matches and frees the spot** |
| Duplicate | Already in the list → `409 ALREADY_CRUSH` |
| Add rate | Max **10 adds per day** (stops people adding everyone to find out who likes them) → `429 CRUSH_DAILY_LIMIT` |
| Re-add cooldown | A removed person can't be re-added for **24 h** → `429 CRUSH_COOLDOWN` |
| "Someone added you" notification | At most **once per (adder, person) per 30 days**. Removing and re-adding never sends a 2nd one |
| Admirer count | Non-matched, `active` crushes on you, from people you haven't secret-blocked. **Increases live; decreases only in the nightly recompute** (00:00 IST) so a drop can't be timed to one person |
| Matched crush | Can't be removed from the list. To end it: delete the chat or block the person (normal block) |
| Paused crush (adder's plan ended) | Kept but **can't create a match**. Reactivates when the adder re-subscribes |

## 3. Screens (frontend)

### 3.1 `Premium` → Secret Crush section

Part of the Premium tab ([premium-hub.md](premium-hub.md)). Data: `GET /secret-crushes/summary` (all plans), `GET /secret-crushes` and `GET /secret-crushes/matches`.

From top to bottom:

1. **Received card** (👀): "**2 people have a secret crush on you**" + "We'll never tell you who. Add your own crushes — if one is mutual, it's a match." Empty: "No secret crushes on you yet" + "When someone adds you, you'll be notified — never with their name."
2. **Matches 💘** (if any): a horizontal row of match cards (avatar with a pink ring, first name, "Matched 2d ago"). Tap → `ChatThread`.
3. **Your Secret Crushes** header with **+ Add** (paid only).
   - **Free:** upsell card 💘 "Add your own Secret Crushes — Plus lets you add up to 3 crushes, Premium up to 10. Mutual crushes become a match." → `Plans { reason: 'crush' }`.
   - **Paid:** usage meter "**1 of 3** crush spots used" (+ "Get more" when full), then rows: avatar, name, "Added 2d ago · kept secret 🤫", ✕ remove button. Paused rows show "Paused — renew your plan to reactivate". Empty: 💘 "No crushes yet — Add someone you like. They'll only know it was you if they add you too."
4. Button **Add a Secret Crush 💘** → `SecretPeoplePicker { intent: 'crush' }` (or the limit sheet when full).
5. Rule card 🛡: "**Only mutual crushes are revealed.** If it's not mutual, nobody ever finds out — not even whether they added you."

### 3.2 Entry points to add

1. **UserProfile** → heart button **Secret Crush** (filled when already added; tap again → menu "Remove from Secret Crushes").
2. Premium → Secret Crush → **Add**.

Checks before opening the sheet (server checks again): no plan → `Plans { reason: 'crush' }`; no spots left → limit sheet "You've used all 3 Secret Crush spots" + "Go Premium for up to 10 Secret Crushes — ₹249/month" (Premium: "Spots free up when you remove someone").

### 3.3 Add-crush confirm sheet (bottom sheet)

Heart icon, "**Add Riya as a Secret Crush?**", "Riya will get *'Someone added you as a Secret Crush 👀'*. She'll only find out it's you if she adds you too.", **Add Secret Crush 💘** / Cancel.

→ `POST /secret-crushes`:

- `matched: false` → toast "Added to Secret Crush 👀", list updates.
- `matched: true` → open `MatchCelebration { matchId }` at once.

### 3.4 Remove

✕ on a row → confirm "Remove Riya from your crushes? — They'll never know you added or removed them." → `DELETE /secret-crushes/:userId` → toast "Removed from Secret Crushes".

### 3.5 `MatchCelebration` (fullscreen modal, transparent)

**Params:** `{ matchId }`. Opened right after a match for the user who added second, and from the push / in-app notification (or on the next app open) for the other user. Data: `GET /secret-crushes/matches/:matchId`.

- **Under the overlay:** the stack is reset to `Inbox → ChatThread { conversationId }`, so closing the celebration lands in the love chat.
- Background: floating hearts (💗 💘) rising.
- My avatar slides in from the left and theirs from the right; a 💘 pops between them.
- "**Congratulations!**" · "**It's a match 💘**" · "You and **Riya Patel** both added each other as a Secret Crush. Your chat is open."
- **Fireworks + crackers:** Skia particle bursts (rockets → bursts in `primary` / `secretGlow` / `premiumGradient` colors from the active theme), plus a confetti fall and a heart burst from the center heart. About 3 s, then a gentle loop of hearts.
- Buttons: **Say hi 👋** (closes, focuses the chat input with "Hi 👋" prefilled) and **Open chats** (→ Inbox).
- On open: `POST /secret-crushes/matches/:matchId/celebrated`, so each user sees the full celebration **once**.
- Accessibility: Reduce Motion (`AccessibilityInfo.isReduceMotionEnabled`) → no particles, a simple fade; the screen reader announces "It's a match with Riya Patel".
- Performance: particles run on the UI thread (Skia), max ~150 particles, stop when the screen blurs.

### 3.6 Love-theme chat (`ChatThread` with `conversation.theme === 'love'`)

The normal [chat thread](../messages/chat-thread.md) with a scoped theme:

- `ChatThread` wraps its content in `<ScopedTheme chatTheme="love">`, which swaps the semantic tokens for the **romantic** palette while the app-wide theme stays as it is (in Dark mode a darker variant is used, so there are no white surfaces). Components keep using tokens (`bubbleOutgoing`, `bubbleIncoming`, `background`, `primary`) — **no hard-coded colors**.
- A soft animated hearts layer behind the messages (Skia, low opacity, paused when Reduce Motion is on or the app is in background).
- Banner at the top of the history: "💘 You matched via Secret Crush" (system message).
- First time each user opens the chat after the match: one fireworks burst (tracked by `celebrated_at` on the match, so it doesn't repeat).
- Header subtitle chip "💘 Match".
- Everything else (text, GIFs, replies, read receipts, unsend, typing) works like a normal chat.
- The love theme stays on this conversation. (Changing chat themes is out of scope for v3.)

**Inbox:** the row shows a "💘 Match" tag; matches also appear in a top "Matches" row with a pink ring.

## 4. REST API

`backend/src/modules/secret-crush/` (routes → controller → service, Zod). All routes need auth.

### `GET /api/v1/secret-crushes/summary` — all plans

```json
{
  "admirers_count": 2,
  "can_add": true,
  "spots": { "limit": 3, "used": 1, "left": 2 },
  "matches_count": 1,
  "pending_celebration_match_id": "c1f2…"
}
```

`pending_celebration_match_id` = a match this user hasn't celebrated yet (the app opens `MatchCelebration` on the next launch or foreground).

### `GET /api/v1/secret-crushes` — my list

Plan not required (a downgraded user can still see and remove). Cursor list:

```json
{ "data": [ { "user": { "id", "username", "display_name", "avatar_url" }, "status": "active", "added_at": "…" } ], "pagination": { … } }
```

`status`: `active` | `paused`. Matched crushes are **not** in this list (they're in `/matches`).

### `POST /api/v1/secret-crushes` — add

**Middleware:** `requireFeature('crush')`. **Rate limit:** 10 adds / day, 30 requests / min.

```json
{ "user_id": "…" }
```

Service — **one MongoDB transaction** (replica set required):

1. Validate the target (§2) → `CANNOT_CRUSH_SELF` / `CANNOT_ADD_CRUSH` / `ALREADY_CRUSH` / `CRUSH_COOLDOWN` / `CRUSH_DAILY_LIMIT`.
2. Count spots (`active` + `paused`) < `crush_spots` → else `403 PLAN_LIMIT_REACHED`.
3. Insert `crushes { from_user_id: me, to_user_id: them, status: 'active' }` (unique `{ from_user_id, to_user_id }`).
4. Look for the reverse crush `{ from: them, to: me, status: 'active' }`.
5. **Reverse exists → match:**
   - Insert `crush_matches { pair_key: sorted(me, them), user_ids, conversation_id }` with a **unique index on `pair_key`**. If two people add each other at the same moment, one insert wins and the other gets a duplicate-key error → it reads the existing match. So **exactly one match** is created.
   - Set both crushes to `status: 'matched'`, `match_id`.
   - Get or create the direct conversation (`direct_key`), set `origin: 'secret_crush_match'`, `theme: 'love'`, add the system message "You matched via Secret Crush 💘". A match chat ignores `allow_dm_from`; blocks still apply.
6. **No reverse:** if the 30-day notification window allows, queue `crush_added` for the target (random 30–120 s delay). Increase their admirer count.
7. After commit: on a match, send `crush_match` to **both** (push + in-app), socket `crush.matched` to both, `conversation.updated` to both.

**`201`:**

```json
{ "crush": { "user": { … }, "status": "active", "added_at": "…" }, "matched": false }
```

```json
{ "crush": { "user": { … }, "status": "matched" }, "matched": true,
  "match": { "id": "c1f2…", "user": { "id", "username", "display_name", "avatar_url" }, "conversation_id": "…", "matched_at": "…" } }
```

The response for an add is the **same whether or not the other person was crushed on you before** (only `matched` differs, and that is the intended reveal).

### `DELETE /api/v1/secret-crushes/:userId`

`204`. Sets `removed_at` (for the 24 h cooldown), frees the spot. **No notification** to anyone. Matched → `409 CRUSH_MATCHED` (delete the chat or block instead).

### `GET /api/v1/secret-crushes/matches`

Cursor list: `{ id, user, conversation_id, matched_at, celebrated: boolean }`. Blocked / deleted users are filtered out.

### `GET /api/v1/secret-crushes/matches/:matchId`

For `MatchCelebration`: `{ id, me: { … }, user: { … }, conversation_id, matched_at, celebrated }`. `404` if the caller isn't in the match.

### `POST /api/v1/secret-crushes/matches/:matchId/celebrated`

`204`. Sets `celebrated_at[me]`. Idempotent.

### Error codes

| Code | HTTP | When |
|---|---|---|
| `PLAN_REQUIRED` | 403 | Free user adds (`details.feature = 'crush'`) |
| `PLAN_LIMIT_REACHED` | 403 | No spots left (`details.limit`) |
| `CANNOT_CRUSH_SELF` | 400 | Own id |
| `CANNOT_ADD_CRUSH` | 403 | Target not allowed (any reason) |
| `ALREADY_CRUSH` | 409 | Already in the list |
| `CRUSH_COOLDOWN` | 429 | Re-add within 24 h of removing (`details.retry_at`) |
| `CRUSH_DAILY_LIMIT` | 429 | 10 adds today |
| `CRUSH_MATCHED` | 409 | Trying to remove a match |
| `NOT_FOUND` | 404 | Unknown match / not a member |

## 5. Downgrade & upgrade

- **Plan ends** (expiry sweep, refund, revoke): all the user's `active` crushes → `paused`. Paused crushes can't create matches (step 4 only looks at `active`). The admirer count of the people they had added drops in the next nightly recompute. Existing matches and chats stay.
- **Plan starts again** (`POST /subscriptions/purchases` or webhook): `paused` → `active` (up to the plan's spots; extras stay paused, oldest first reactivated). For each reactivated crush, run the **match check** (step 4–7). So if Riya added you while you were paused, you match the moment you re-subscribe.
- **Free user who was crushed on** buys a plan → adds people → normal add flow; if one of them is a mutual crush → match.

## 6. Data (summary)

Full fields: [DATA_MODELS.md — Secret Crush](../../architecture/DATA_MODELS.md#secret-crush).

- `crushes`: `from_user_id`, `to_user_id`, `status` (`active` | `paused` | `matched` | `removed`), `match_id`, `notified_at`, `removed_at`, `created_at`. Unique `{ from_user_id, to_user_id }`. Index `{ to_user_id, status }` (match check + admirer count).
- `crush_matches`: `public_id` (UUID), `pair_key` (unique), `user_ids[2]`, `conversation_id`, `matched_at`, `celebrated_at` per user.
- `crush_admirer_counts`: `user_id`, `count`, `recomputed_at` (the displayed count).
- `conversations` gets `origin` (`null` | `secret_message` | `secret_crush_match`) and `theme` (`null` | `love`).

## 7. Notifications

**Every person added gets `crush_added`, Free included** — the plan is never checked before sending. A Free user's tap opens the "1 person has a secret crush on you" card → `Plans { reason: 'crush' }`. Free / expired users also get the `crush_admirer_waiting` reminder (24 h, 3 days, 7 days) — see [plans-and-billing §6.1–6.2](plans-and-billing.md#61-free-users-get-every-secret-notification-this-is-how-nexity-earns).

| type | To | Copy | Opens | Notes |
|---|---|---|---|---|
| `crush_added` | person added | Someone added you as a Secret Crush 👀 | `Premium { section: 'crush' }` | `actor_id: null`, no identity in the payload, random 30–120 s delay, max 1 per adder per 30 days |
| `crush_match` | both | Congratulations! 🎉 You and **{username}** are a match 💘 | `MatchCelebration { matchId }` (`nexity://secret/matches/:matchId`) | Sent immediately, high priority |

Android channel `secret`. Preference keys `secret_crush` and `matches` ([notification-settings.md](../settings/notification-settings.md)).

## 8. Acceptance criteria

- [ ] Paid users can add public and private accounts up to their plan's spots; Free users get `PLAN_REQUIRED` from the API even with a modified app.
- [ ] The person added gets "Someone added you as a Secret Crush 👀" with no identifying data; re-adding never notifies twice in 30 days.
- [ ] A Free user who got the notification can buy a plan and then add the adder back → match.
- [ ] Two users adding each other at the same moment create **exactly one** match and one chat.
- [ ] On a match both users get the notification, both see the celebration once (fireworks, crackers, confetti, hearts), and land in the love-theme chat.
- [ ] After the match, the person is in Matches and the chat is in the Inbox with the "💘 Match" tag; the chat keeps working after either plan ends.
- [ ] Non-mutual crushes are never revealed by any API response, count change timing, error code or notification.
- [ ] Plan expiry pauses crushes; re-subscribing reactivates them and runs the match check.
- [ ] Love theme uses tokens only and looks right in Light, Dark and every mood; Reduce Motion disables particles.
