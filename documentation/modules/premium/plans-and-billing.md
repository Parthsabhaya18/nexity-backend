# Plans, subscriptions & billing

**Screens:** `Plans` (paywall), `PurchaseSuccess`, `Subscription` (manage)  
**Deep links:** `nexity://premium/plans` → `Plans`, `nexity://settings/subscription` → `Subscription`  
**Theme:** Light, Dark and every mood — Plus card uses `accentGradient`, Premium card and buttons use `premiumGradient` ([THEMING.md](../../architecture/THEMING.md))  
**Auth required:** Yes  
**Frontend:** `frontend/src/screens/premium/`, `frontend/src/features/subscription/`, `frontend/src/services/api/subscriptions.ts`  
**Backend:** `backend/src/modules/subscriptions/`  
**Security:** [SECRET_FEATURES_SECURITY.md](../../architecture/SECRET_FEATURES_SECURITY.md)  
**Prototype:** `frontend/prototype/js/subscription.js`, `frontend/prototype/js/state.js` (`NX.defaultPlans`)  
**Razorpay (Android & web payments, AutoPay):** [razorpay-payments.md](razorpay-payments.md)

Nexity has **3 plans: Free, Plus, Premium**. Posts, Reels, Stories and Chat are free for everyone. Plans unlock the **Secret** features: [Secret Messages](secret-messages.md) and [Secret Crush](secret-crush.md).

---

## 1. Plans

### 1.1 Prices (India, INR, taxes included)

| | Free | Plus | Premium |
|---|---|---|---|
| Tagline | Everything you need to share and connect. | Start your secret side. | More mystery, more crushes, a 👑 badge. |
| Monthly | ₹0 forever | **₹99** (MRP ~~₹149~~) | **₹249** (MRP ~~₹399~~) |
| 3 months (save 10%) | — | ₹267 | ₹672 |
| Yearly (save 25%) | — | ₹891 | ₹2,241 |

- The prices above are the **store prices** to configure in App Store Connect and Google Play Console (use the nearest store price point). The app always **displays the localized price returned by the store**, never a hard-coded number.
- The MRP strike-through and "Save X%" labels are drawn by our paywall from `plans[].mrp` and the period discount in `GET /plans`.

### 1.2 What each plan unlocks

| Feature | Free | Plus | Premium |
|---|:-:|:-:|:-:|
| Posts, Reels, Stories, Chat | ✅ | ✅ | ✅ |
| Push + in-app notice "Someone is trying to reach you with a Secret Message 💌" | ✅ | ✅ | ✅ |
| Push + in-app notice "Someone added you as a Secret Crush 👀" | ✅ | ✅ | ✅ |
| See **how many** sealed Secret Messages / secret admirers you have (count only, locked) | ✅ | ✅ | ✅ |
| **Open the Secret Message list and reply** (needed for the reveal) | ❌ | ✅ | ✅ |
| **Send** new Secret Messages | ❌ (0) | **5 / month** | **Unlimited** (fair use: 30 new / day) |
| **Secret Crush spots** (people in your crush list at once) | ❌ (0) | **3** | **10** |
| Mutual match → celebration + **love-theme chat** | ❌ | ✅ | ✅ |
| "Was near you today 💫" (Nearby, separate feature) | ❌ | ✅ | ✅ |
| Premium profile badge 👑 | ❌ | ❌ | ✅ |
| Priority support | ❌ | ❌ | ✅ |

### 1.3 Limits as data (`plans` collection)

Limits are **server data**, editable by admins, never hard-coded in the app. `-1` = unlimited, `0` = not allowed.

```json
{
  "id": "plus",
  "name": "Plus",
  "description": "Start your secret side.",
  "rank": 1,
  "mrp_inr": 149,
  "price_inr": 99,
  "active": true,
  "features": ["Open & reply to Secret Messages", "Send 5 Secret Messages a month", "Add up to 3 Secret Crushes", "Match animation & chat", "See \"Was near you today 💫\""],
  "limits": {
    "secret_messages_per_month": 5,
    "secret_messages_per_day_fair_use": 30,
    "crush_spots": 3,
    "read_secret": true,
    "nearby": true,
    "badge": false
  },
  "products": {
    "ios":     { "monthly": "com.nexity.app.plus.monthly", "quarterly": "com.nexity.app.plus.quarterly", "yearly": "com.nexity.app.plus.yearly" },
    "android": { "subscription_id": "nexity_plus", "base_plans": { "monthly": "monthly", "quarterly": "quarterly", "yearly": "yearly" } }
  }
}
```

| Plan | `rank` | `secret_messages_per_month` | `crush_spots` | `read_secret` | `nearby` | `badge` |
|---|---|---|---|---|---|---|
| `free` | 0 | 0 | 0 | false | false | false |
| `plus` | 1 | 5 | 3 | true | true | false |
| `premium` | 2 | -1 | 10 | true | true | true |

Seeded by `backend/src/modules/subscriptions/plans.seed.ts` on startup when missing.

### 1.4 Usage counting

- **Secret Messages / month** counts **new threads started** (the first message to a person). Follow-ups in an existing thread and replies are free.
- Month = calendar month in `Asia/Kolkata` (key `2026-10`). Resets at 00:00 IST on the 1st.
- **Crush spots** = people currently in your crush list with status `active` or `paused`. A crush that **becomes a match moves to Matches and frees its spot**. Removing a crush frees its spot.
- Usage is reserved **atomically** on the server (see [§5.4](#54-atomic-limit-checks)). A failed send refunds the reservation.

---

## 2. Payment providers

| Where | Provider | Doc |
|---|---|---|
| **Android** | **Razorpay** — UPI apps (Google Pay, PhonePe, Paytm, BHIM), UPI ID, QR, cards, net banking, wallets, **AutoPay** — offered through Google's User Choice Billing next to Google Play Billing | [razorpay-payments.md](razorpay-payments.md) |
| **Web** (`nexity.com/premium`) | **Razorpay** (all methods) | [razorpay-payments.md](razorpay-payments.md) |
| **iOS** | Apple In-App Purchase (StoreKit 2) — required by App Store Guideline 3.1.1; Razorpay is never shown on iOS | This section |

All providers write to the same `subscriptions` collection, so **one plan works on every device** of the account: a plan bought with Razorpay on Android also unlocks the iPhone app, and the other way round. Only one paid subscription can be active per account (`409 ALREADY_ON_PLAN` from the other provider's checkout).

The prototype's own card / UPI input fields are demo only — the real card, UPI and bank screens are Razorpay's (Android / web) or Apple's (iOS). The rest of this section describes the **store** billing used on iOS (and Google Play Billing as the second option on Android).

| Prototype element | Production equivalent |
|---|---|
| Plan cards + compare table | Same `Plans` screen, prices from the store |
| Monthly / 3 months / Yearly picker | 3 store products per plan (iOS) / 3 base plans (Android) |
| Coupon `WELCOME50` (50% off first month, first subscription only) | **Introductory offer** (iOS) / **new-customer offer** (Android). The store checks eligibility |
| Coupon `NEXITY20` (20% off) | **Offer codes** (iOS `presentCodeRedemptionSheet`) / **promo codes** (Play Store redeem). The paywall shows a "Redeem a code" link instead of a coupon field |
| Processing / Success / Failed screens | Store sheet → `PurchaseSuccess`, or an inline error on `Plans` |
| Cancel / resume auto-renew | Opens the store's subscription management page (apps can't cancel store subscriptions) |
| Admin "gift a plan" | Server-side `gift` subscription (no store) |

### 2.1 Libraries

| Side | Library | Purpose |
|---|---|---|
| App | `react-native-iap` (StoreKit 2 + Play Billing 7) | Load products, buy, restore, finish transactions |
| Backend | `@apple/app-store-server-library` | Verify signed transactions/notifications (JWS), call App Store Server API |
| Backend | `googleapis` (`androidpublisher` v3) | `purchases.subscriptionsv2.get`, `purchases.subscriptions.acknowledge` |
| Backend | `google-auth-library` | Verify Pub/Sub push OIDC token (RTDN webhook) |

(RevenueCat is an acceptable alternative to the two store libraries; the API contract below stays the same.)

### 2.2 Store setup

**App Store Connect**

- One subscription group **"Nexity"**. Level 1 = Premium (3 products), Level 2 = Plus (3 products). Apple then handles upgrades (immediate, prorated) and downgrades (at the next renewal).
- Billing Grace Period: **on (16 days)**. Billing retry: on.
- App Store Server Notifications **V2** → `https://api.nexity.com/api/v1/webhooks/apple` (production and sandbox).
- In-App Purchase key (`.p8`) for the App Store Server API.

**Google Play Console**

- Subscriptions `nexity_plus` and `nexity_premium`, each with base plans `monthly`, `quarterly`, `yearly` (auto-renewing).
- Grace period 7 days, then account hold 30 days.
- Real-time developer notifications → Pub/Sub topic → **push** subscription to `https://api.nexity.com/api/v1/webhooks/google` with OIDC auth.
- Service account with "View financial data" + "Manage orders and subscriptions".

### 2.3 Binding a purchase to the Nexity account

Every user gets `users.billing_account_token` (random UUID v4, created on first paywall open, never derived from the user id). The app passes it on every purchase:

- iOS: `appAccountToken`
- Android: `obfuscatedAccountIdAndroid`

The server rejects a purchase whose token does not belong to the caller (`403 PURCHASE_ACCOUNT_MISMATCH`). This stops one person's receipt being used to unlock another account.

**Restore on a new Nexity account:** a store subscription can entitle **one Nexity account at a time**. Restoring it on account B **transfers** it from account A. A gets a `subscription_transferred` notification. Both sides are written to the audit log. Max 1 transfer per 30 days per subscription (`429 TRANSFER_LIMIT`).

---

## 3. Screens (frontend)

### 3.1 `Plans` (paywall)

**Params:** `{ reason?: 'secret_send' | 'secret_read' | 'crush' | 'limit' | 'nearby'; targetUserId?: string }`  
Pushed from any locked Secret action, from the Premium tab, and from `Subscription`.

UI (top to bottom):

1. **Reason banner** when `reason` is set:

   | `reason` | Emoji | Title | Text |
   |---|---|---|---|
   | `secret_send` | 💌 | Secret Messages need Plus or Premium | Send anonymous messages — you're only revealed after they reply twice. |
   | `secret_read` | 💌 | Someone is trying to reach you | Upgrade to open and reply. Their name and message unseal together after your 2nd reply. |
   | `crush` | 💘 | Secret Crush needs Plus or Premium | Add your crushes privately. If it's mutual, it's a match. |
   | `limit` | 👑 | You've reached your plan limit | Premium gives unlimited Secret Messages (fair use) and up to 10 Secret Crushes. |
   | `nearby` | 💫 | See who was near you | Plus and Premium show "Was near you today 💫" — never a place, time or distance. |

   Without a reason: heading "Unlock your secret side" + "Save up to 25% when you pay yearly."
2. **Current plan pill:** "You're on **Plus** · active until 12 Nov 2026".
3. **Period picker:** Monthly · 3 months (Save 10%) · Yearly (Save 25%). Each shows the total and the per-month price.
4. **Plan cards** (Free, Plus, Premium; Premium has a "Most loved" ribbon). Each card shows the name, description, store price, MRP strike-through, feature list (✓), and on Free the missing features (✗). CTA:
   - current plan → "Your current plan" (disabled), or "Manage subscription" for a paid plan;
   - lower plan → "Included in Premium" note;
   - higher plan → "Upgrade to Plus" / "Get Premium".
5. **Compare plans** table (rows from §1.2).
6. Trust row: "Monthly, 3-month or yearly · Cancel anytime · Secure payment by App Store / Google Play".
7. Footer links: **Restore purchases**, **Redeem a code**, Terms, Privacy. These are required by both stores.
8. Legal fine print: auto-renew terms ("Renews automatically at ₹99/month until cancelled. Cancel at least 24 hours before renewal in your App Store / Google Play settings.").

**Purchase flow:** on **Android and web**, the plan button opens `Checkout { planId }` (Razorpay — [razorpay-payments.md §3](razorpay-payments.md#3-user-flow-frontend)); on Android a "Pay with Google Play" option is shown next to it. On **iOS** the flow below (StoreKit) is used:

```
Tap "Get Premium"
 → useSubscription().purchase(planId, period)
 → (if needed) POST /subscriptions/billing-token        get billing_account_token
 → react-native-iap requestSubscription(...)             store sheet (UPI / card / wallet inside Apple/Google)
 → purchaseUpdatedListener(purchase)
 → POST /subscriptions/purchases                         server verifies with Apple/Google
 → 200 { subscription, entitlement }
 → finishTransaction(purchase)                           ONLY after the server said OK
 → invalidate ['subscription','me'], ['secret', …], ['crush', …]
 → replace with PurchaseSuccess { planId }
```

- Button shows a spinner and the whole screen ignores taps while a purchase is in flight.
- User cancelled the store sheet → no message (silent).
- Store error → inline error "Payment didn't go through. You weren't charged." + Try again.
- Server verification failed or offline → keep the transaction **unfinished**. Retry `POST /subscriptions/purchases` on the next app start (`getAvailablePurchases`) and on the next foreground. The webhook also activates the plan, so the user is never charged without getting the plan.
- `pending` purchase (Android UPI "pending", iOS Ask to Buy) → show "Payment pending — we'll unlock your plan as soon as it's confirmed." The webhook activates it later and a `subscription_activated` push arrives.

### 3.2 `PurchaseSuccess`

Fullscreen, no tab bar. Big check animation, confetti (Skia, skipped when Reduce Motion is on), "You're on Premium 🎉", "Active until 12 Nov 2026", and a list of unlocked features with an unlock icon.

Primary button by `Plans.reason`:

| From | Button | Goes to |
|---|---|---|
| `secret_send` + `targetUserId` | Continue your Secret Message 💌 | `SecretCompose { userId }` |
| `secret_read` | Open your Secret Messages 💌 | `Premium { section: 'messages' }` |
| `crush` | Add your Secret Crush 💘 | `Premium { section: 'crush' }` |
| anything else | Explore Secret ✨ | `Premium` |

Secondary: "View subscription" → `Subscription`.

### 3.3 `Subscription` (Settings → Subscription, and Plans → Manage)

- **Plan card:** icon, "Current plan", plan name, status chip (`Active` / `Ends soon` (auto-renew off) / `Payment issue` (grace) / `Gifted`).
- **Rows:** "Renews on" or "Active until", price + period, store ("App Store" / "Google Play" / "Gift from Nexity").
- **This month:** Secret Messages left (`∞` for Premium), Crush spots left, Nearby ✓/—.
- **Payment issue banner** (`in_grace` / `on_hold`): "We couldn't renew your plan. Update your payment method to keep Secret features." → store page.
- **Buttons:** "Upgrade to Premium" / "See plans"; "Manage in App Store" / "Manage in Google Play":
  - iOS: `showManageSubscriptionsIOS()` (falls back to `https://apps.apple.com/account/subscriptions`)
  - Android: `https://play.google.com/store/account/subscriptions?sku=<subscription_id>&package=com.nexity.app`
- **Billing history** from `GET /subscriptions/me/transactions` (plan · period, date, store, order id, amount, Paid / Refunded / Failed).
- Free users: "You're on the Free plan. Upgrade to open Secret Messages, send them and add Secret Crushes." + See plans.

### 3.4 Client state

- `useEntitlement()` (TanStack Query key `['subscription','me']`, stale 60 s) returns `{ plan, limits, usage, status, expires_at }`. Refetch on app foreground, after a purchase, and on the socket event `subscription.updated`.
- The UI **only uses this to decide what to show**. Every gated action is still checked on the server; on `403 PLAN_REQUIRED` / `PLAN_LIMIT_REACHED` the app opens `Plans` with the matching reason.
- The entitlement is not stored on disk; it is refetched on cold start.

---

## 4. REST API

All routes need auth unless noted. Errors use the standard `{ error: { code, message, details? } }`.

### `GET /api/v1/plans`

Active plans with limits and store product ids, plus period discounts.

```json
{
  "data": [ { "id": "free", "...": "..." }, { "id": "plus", "...": "..." }, { "id": "premium", "...": "..." } ],
  "periods": [ { "id": "monthly", "months": 1, "save_pct": 0 }, { "id": "quarterly", "months": 3, "save_pct": 10 }, { "id": "yearly", "months": 12, "save_pct": 25 } ]
}
```

### `GET /api/v1/subscriptions/me`

```json
{
  "plan": "plus",
  "status": "active",
  "source": "app_store",
  "period": "monthly",
  "auto_renew": true,
  "current_period_end": "2026-11-07T06:30:00Z",
  "limits": { "secret_messages_per_month": 5, "crush_spots": 3, "read_secret": true, "nearby": true, "badge": false },
  "usage": {
    "secret_messages_this_month": 2,
    "secret_messages_left": 3,
    "month_resets_at": "2026-10-31T18:30:00Z",
    "crush_spots_used": 1,
    "crush_spots_left": 2
  },
  "management_url": "https://apps.apple.com/account/subscriptions"
}
```

`status`: `none` (Free) | `active` | `canceled` (auto-renew off, still active until `current_period_end`) | `in_grace` | `on_hold` | `paused` | `expired` | `revoked`.  
**Entitled** = `active` | `canceled` | `in_grace`. Anything else → Free limits.

### `POST /api/v1/subscriptions/billing-token`

Returns `{ "billing_account_token": "uuid" }` and creates it if missing. Idempotent.

### `POST /api/v1/subscriptions/purchases`

Verify a purchase the app just made.

```json
{ "platform": "ios", "product_id": "com.nexity.app.premium.monthly", "signed_transaction": "<JWS from StoreKit 2>" }
{ "platform": "android", "product_id": "nexity_premium", "purchase_token": "<token>" }
```

Server steps:

1. **iOS:** verify the JWS with `SignedDataVerifier` (Apple root CA, `bundleId = com.nexity.app`, expected environment). Then read the latest status from the App Store Server API (`getAllSubscriptionStatuses`) by `originalTransactionId`.  
   **Android:** call `purchases.subscriptionsv2.get(packageName, token)`. Check `packageName`, line item `productId`, `subscriptionState`.
2. Check the account binding (`appAccountToken` / `obfuscatedExternalAccountId` = caller's `billing_account_token`) → else `403 PURCHASE_ACCOUNT_MISMATCH`.
3. Upsert `subscriptions` by `(store, original_transaction_id | purchase_token)` — idempotent; retries return the same row.
4. **Android:** `purchases.subscriptions.acknowledge` if not yet acknowledged (Google refunds unacknowledged purchases after 3 days).
5. Recompute `users.entitlement` (§5.2). Write a `billing_events` row. Emit `subscription.updated` to the user's sockets. Create the `subscription_activated` notification on first activation.
6. If the plan went up from Free: **reactivate paused crushes** and run match checks ([secret-crush.md](secret-crush.md#downgrade--upgrade)).

**`200`:** `{ "subscription": { … }, "entitlement": { …same as GET /subscriptions/me… } }`

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Bad body |
| `PURCHASE_INVALID` | 400 | Signature / token invalid, wrong bundle or package, unknown product |
| `PURCHASE_ACCOUNT_MISMATCH` | 403 | Purchase bound to another account token |
| `PURCHASE_NOT_ACTIVE` | 409 | Valid but expired / refunded |
| `STORE_UNAVAILABLE` | 503 | Apple / Google API down — the app retries later, the transaction stays unfinished |

Rate limit: 20 / hour / user.

### `POST /api/v1/subscriptions/restore`

`{ "platform": "ios", "signed_transactions": ["…"] }` or `{ "platform": "android", "purchase_tokens": ["…"] }` (max 20). Verifies each one like `/purchases`, transfers if needed (§2.3) and returns the entitlement. Rate limit: 10 / hour / user.

### `GET /api/v1/subscriptions/me/transactions`

Cursor list: `{ id, plan, period, amount_inr, currency, store, store_order_id, status: 'paid'|'refunded'|'failed', created_at }`.

### Webhooks (no bearer auth — verified by signature)

| Route | Verification | Handles |
|---|---|---|
| `POST /api/v1/webhooks/apple` | Body `{ signedPayload }` verified with `SignedDataVerifier` (Apple certificate chain, bundle id, environment). Reject anything unsigned or invalid with `400` | `SUBSCRIBED`, `DID_RENEW`, `DID_CHANGE_RENEWAL_STATUS`, `DID_CHANGE_RENEWAL_PREF` (up/downgrade), `DID_FAIL_TO_RENEW` (grace / retry), `GRACE_PERIOD_EXPIRED`, `EXPIRED`, `REFUND`, `REVOKE`, `OFFER_REDEEMED` |
| `POST /api/v1/webhooks/google` | `Authorization: Bearer <OIDC JWT>` verified with `google-auth-library` (`audience = GOOGLE_PUBSUB_AUDIENCE`, `email = GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL`). Then **always re-fetch** the subscription with `subscriptionsv2.get` — the notification is only a hint | `SUBSCRIPTION_PURCHASED`, `RENEWED`, `CANCELED`, `RESTARTED`, `IN_GRACE_PERIOD`, `ON_HOLD`, `RECOVERED`, `PAUSED`, `EXPIRED`, `REVOKED`, voided purchases |

Rules:

- Idempotent: unique index on `billing_events.store_event_id` (Apple `notificationUUID`, Pub/Sub `messageId`). Duplicates return `200` without reprocessing.
- Respond `200` fast; the work runs in a queue job. Failures retry with backoff. Unknown users are kept in `billing_events` with `status: 'orphan'` for support.
- Out-of-order safe: apply an event only if its `signedDate` / `eventTimeMillis` is newer than `subscriptions.last_event_at`.
- `REFUND` / `REVOKE` → entitlement drops at once.

### Admin (role `admin`)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/plans` | All plans incl. inactive |
| PATCH | `/admin/plans/:id` | `name`, `description`, `features`, `active`, `limits` (Zod: integers ≥ -1). Prices are changed in the stores, not here. Audit-logged |
| POST | `/admin/users/:id/plan-gift` | `{ plan: 'plus'|'premium', days: 1-365, note }` → `subscriptions` row with `source: 'gift'`. Audit-logged |
| DELETE | `/admin/users/:id/plan-gift` | Ends the gift now |
| GET | `/admin/billing-events` | Search by user / store id (support) |

---

## 5. Backend design

### 5.1 Module layout

```
backend/src/modules/subscriptions/
  plan.model.ts               plans collection
  plans.seed.ts               free / plus / premium defaults (§1.3)
  subscription.model.ts       subscriptions collection
  billingEvent.model.ts       raw store events (audit, idempotency)
  usage.model.ts              secret_usage collection (monthly counters)
  entitlement.service.ts      getEntitlement(), recompute(), reserveSecretMessage(), …
  entitlement.middleware.ts   requireFeature('read_secret' | 'send_secret' | 'crush')
  apple.verifier.ts           StoreKit 2 JWS + App Store Server API
  google.verifier.ts          Play Developer API + Pub/Sub OIDC
  subscription.schema.ts      Zod bodies
  subscription.controller.ts / subscription.routes.ts
  webhook.routes.ts           /webhooks/apple, /webhooks/google (raw body, no auth middleware)
  subscription.jobs.ts        expiry sweep, "expires in 3 days" reminder
```

### 5.2 Entitlement

`users.entitlement` is a denormalised cache, recomputed whenever a subscription changes:

```json
{ "plan": "premium", "expires_at": "2026-11-07T06:30:00Z", "source": "app_store", "updated_at": "…" }
```

- `getEntitlement(userId)` = highest-ranked **entitled** subscription (store or gift). If `expires_at < now` the user is treated as Free **even if a webhook is late** (never trust a stale cache past its expiry).
- `requireFeature(feature)` middleware loads the entitlement + plan limits and attaches `req.entitlement`. No plan → `403 PLAN_REQUIRED` with `details: { feature, required_plan: 'plus' }`.
- Plans are cached in memory for 60 s and the cache is cleared on admin `PATCH`.

### 5.3 Collections

See [DATA_MODELS.md](../../architecture/DATA_MODELS.md#plans--subscriptions) for full fields: `plans`, `subscriptions`, `billing_events`, `secret_usage`, plus `users.entitlement` and `users.billing_account_token`.

### 5.4 Atomic limit checks

Monthly Secret Messages (no race even with parallel requests):

```ts
// limit = plan.limits.secret_messages_per_month (-1 = unlimited → skip this, apply fair-use daily cap)
const res = await SecretUsage.findOneAndUpdate(
  { user_id, month, count: { $lt: limit } },
  { $inc: { count: 1 } },
  { new: true },
);
if (!res) {
  // either no doc yet (create with count 1 via upsert in a retry) or limit reached
  throw new ApiError(403, 'PLAN_LIMIT_REACHED', '…', { limit, resets_at });
}
```

The doc for the month is created with `count: 0` beforehand (`updateOne({ user_id, month }, { $setOnInsert: { count: 0 } }, { upsert: true })`) so the conditional `$inc` never upserts past the limit. If the send fails afterwards, `$inc: { count: -1 }`.

Crush spots are checked inside the same MongoDB transaction that inserts the crush (count `active|paused` crushes of the user < `crush_spots`).

### 5.5 Expiry & reminders (jobs)

| Job | Every | Does |
|---|---|---|
| `expirySweep` | 15 min | Subscriptions with `current_period_end + grace < now` and no renewal → `expired`; recompute the entitlement; pause crushes ([secret-crush.md](secret-crush.md#downgrade--upgrade)); notify `subscription_expired` |
| `expiringReminder` | 1 h | Auto-renew **off** and ends in ≤ 3 days → `subscription_expiring` (once per period) |
| `giftExpiry` | 15 min | Gifts past `ends_at` → ended + `subscription_expired` ("Your gifted plan has ended…") |

### 5.6 What happens on downgrade / expiry

| Area | Effect |
|---|---|
| Secret Messages received | Stay saved and sealed. The list locks again (count still visible). Replies count is kept, so after re-subscribing the user continues where they were |
| Secret Messages sent | Threads stay. The sender can still read replies to existing threads and send follow-ups; starting **new** threads needs a plan |
| Revealed chats / match chats | Stay forever as normal chats (no plan needed) |
| Secret Crushes | Change from `active` to `paused`: kept, but they **cannot create a match** while paused. They reactivate on re-subscribe |
| Premium badge | Hidden |
| Premium → Plus with 7 crushes (limit 3) | Existing crushes are kept (all stay `active`). New adds are blocked until the user is under the limit |

---

## 6. Notifications

| type | Recipient | Copy | Opens |
|---|---|---|---|
| `subscription_activated` | buyer | Payment successful — your Premium plan is active until 7 Nov 2026. | `Subscription` |
| `subscription_renewal_failed` | user | We couldn't renew your Plus plan. Update your payment method to keep Secret features. | store page |
| `subscription_expiring` | user | Your Plus plan ends in 3 days. | `Plans` |
| `subscription_expired` | user | Your Plus plan has ended. Renew anytime to keep your secret side. | `Plans` |
| `subscription_refunded` | user | Your Premium plan was refunded and has ended. | `Subscription` |
| `subscription_transferred` | old account | Your subscription was restored on another Nexity account. | `Subscription` |

Android channel `general`. Preference key `subscription` ([notification-settings.md](../settings/notification-settings.md)).

### 6.1 Free users get every Secret notification (this is how Nexity earns)

The Secret notifications are the main reason a Free user buys a plan. So:

1. **Plan never blocks a notification.** `secret_message_received`, `secret_message_followup`, `crush_added` and the reminders below go to **every user — Free, Plus, Premium and expired**, as push **and** in the in-app Notifications list. The notification service must **not** check the recipient's entitlement before sending. Only these can stop a notification: the user's own preference switches, OS permission, blocks, and the anti-spam limits in the feature docs.
2. **The tap leads to the paywall.** A Free user tapping the notification lands on the locked card ("You have 2 sealed messages" / "1 person has a secret crush on you") with one button → `Plans { reason: 'secret_read' | 'crush' }` → store sheet → `PurchaseSuccess` → straight back to the message or crush section.
3. **Badges stay until they upgrade.** For Free users the Premium tab dot and the unread count stay visible until the plan unlocks the section (they're not cleared just by looking at the locked card).
4. **Every notification is anonymous** for every plan (no name, photo or text) — the curiosity is what sells the plan, and the anonymity rules in [SECRET_FEATURES_SECURITY.md](../../architecture/SECRET_FEATURES_SECURITY.md#3-anonymity-guarantees) apply to Free users exactly the same.

### 6.2 Reminder notifications (Free and expired users)

Sent by the job `secretReminders` (every hour) only to users **without** `read_secret` / `crush` who still have something waiting:

| type | Condition | Copy | Opens | Schedule |
|---|---|---|---|---|
| `secret_message_waiting` | ≥ 1 sealed, unopened Secret Message | 💌 You have **2** sealed Secret Messages waiting. Someone wants to tell you something — unlock to reply. | `Premium { section: 'messages' }` (locked card) | 24 h, 3 days and 7 days after the newest one arrived |
| `crush_admirer_waiting` | `admirers_count ≥ 1` | 👀 **1 person** has a secret crush on you. Add your crushes to find out if it's mutual 💘 | `Premium { section: 'crush' }` | 24 h, 3 days and 7 days after the newest admirer |

Rules:

- Max **1 reminder per user per 3 days** (both types together), max 3 per item, none between 22:00 and 09:00 IST.
- Stop as soon as the user buys a plan, opens the item after upgrading, or the item is gone (thread withdrawn / archived, crush removed).
- Preference keys `secret_messages` / `secret_crush` (same switches as the main notifications). Android channel `secret`.
- Anonymous: `actor_id: null`, counts only, no names.

### 6.3 Measuring conversion

App analytics events (no ids of the other person, no content): `secret_notification_opened { type, plan }`, `paywall_viewed { reason, source: 'notification' | 'locked_card' | 'profile' | 'tab' }`, `purchase_started { plan, period }`, `purchase_completed { plan, period, reason }`. Funnel: notification → paywall → purchase, per `reason`.

---

## 7. Environment variables (backend)

| Var | Purpose |
|---|---|
| `APPLE_BUNDLE_ID` | `com.nexity.app` |
| `APPLE_APP_APPLE_ID` | Numeric App Store app id (required for production JWS verification) |
| `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | App Store Server API key (`.p8` content) |
| `APPLE_ENVIRONMENT` | `Sandbox` \| `Production` (production also accepts sandbox receipts from App Review) |
| `GOOGLE_PLAY_PACKAGE_NAME` | `com.nexity.app` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Service account key (base64) |
| `GOOGLE_PUBSUB_AUDIENCE`, `GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL` | RTDN webhook verification |

Never ship any of these in the app.

---

## 8. Testing

- **iOS:** StoreKit configuration file (`ios/Nexity.storekit`) with all 6 products for local testing; sandbox testers in App Store Connect; TestFlight uses sandbox.
- **Android:** license testers in Play Console (renewals every 5 min for monthly); internal testing track. A purchase only works on a build installed from Play (internal track), not a sideloaded APK.
- Backend unit tests with recorded Apple JWS / Google API fixtures. Webhook replay test (same event twice → processed once). Out-of-order events.

## 9. Acceptance criteria

- [ ] A Free user receives every Secret Message / Secret Crush notification (push + in-app) and the waiting reminders; tapping one reaches the paywall in at most 2 taps.
- [ ] Free / Plus / Premium limits match §1.2 and are read from `GET /plans`, never hard-coded in the app.
- [ ] Buying on iOS and Android unlocks features within 5 s; killing the app mid-purchase still unlocks on the next launch or via the webhook.
- [ ] A purchase can't unlock a different Nexity account (account token check).
- [ ] Restore purchases works after reinstall and on a new phone.
- [ ] Upgrade Plus → Premium applies at once; downgrade applies at the next renewal.
- [ ] Turning off auto-renew shows "Ends soon" and keeps the plan until the period ends; expiry moves the user to Free and pauses crushes.
- [ ] Refund / revoke removes access at once.
- [ ] Every gated endpoint returns `403 PLAN_REQUIRED` / `PLAN_LIMIT_REACHED` for a Free / over-limit user, even if the app is modified.
- [ ] Paywall shows localized store prices, auto-renew terms, Restore, Redeem code, Terms and Privacy (store review requirements).
- [ ] Works in Light, Dark and every mood (no hard-coded colors).
