# Payments with Razorpay (UPI, AutoPay, QR, cards, net banking, wallets)

**Screens:** `Plans` → `Checkout` → Razorpay checkout → `PaymentProcessing` → `PurchaseSuccess` / `PaymentFailed` / `PaymentPending`, plus `PayByQr` and `Subscription`  
**Deep links:** none for payment screens (never deep-link into a checkout). `nexity://settings/subscription` → `Subscription`  
**Theme:** Light, Dark and every mood — tokens only ([THEMING.md](../../architecture/THEMING.md))  
**Auth required:** Yes, every payment route  
**Frontend:** `frontend/src/screens/premium/checkout/`, `frontend/src/features/payments/`, `frontend/src/services/api/payments.ts`  
**Backend:** `backend/src/modules/payments/` (Razorpay) + `backend/src/modules/subscriptions/` (plans, entitlement)  
**Plans & limits:** [plans-and-billing.md](plans-and-billing.md) · **Security:** §10 below + [SECRET_FEATURES_SECURITY.md](../../architecture/SECRET_FEATURES_SECURITY.md)  
**Prototype:** `frontend/prototype/js/subscription.js` (checkout, periods, coupons, processing, success, failed)

Razorpay is the payment gateway for Nexity plans. Users can pay with:

| Method | One-time payment | AutoPay (auto-renew) |
|---|:-:|:-:|
| **UPI apps** — Google Pay, PhonePe, Paytm, BHIM, any UPI app (intent: opens the app on the same phone) | ✅ | ✅ UPI AutoPay mandate |
| **UPI ID** (collect request, e.g. `name@okhdfcbank`) | ✅ | ✅ UPI AutoPay mandate |
| **Scan QR** (pay from another phone / any UPI scanner) | ✅ | ❌ (one-time only) |
| **Debit / credit card** — Visa, Mastercard, RuPay | ✅ | ✅ card e-mandate (RBI) |
| **Net banking** — all major banks | ✅ | ✅ bank e-mandate (eNACH via net banking / debit card) |
| **Wallets** — Paytm, Amazon Pay, MobiKwik… | ✅ | ❌ (one-time only) |

> **Golden rule:** the **server** decides the amount. The app only sends `plan_id`, `period`, `autopay` and an optional coupon code. Every payment Nexity accepts must match the plan price computed on the server, to the paisa, or the plan is **not** activated (§4).

## Implementation status

Built end to end (backend `src/modules/payments/`, tests `tests/payments.test.ts`; app screens listed above). Differences from the spec below:

- **Modes.** `razorpay` when `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` are set; `simulator` outside production without keys (an in-process fake Razorpay with key `rzp_test_simulator`, the app shows a "Razorpay · Test mode" sheet with Pay / Decline / Cancel); `off` in production without keys (checkout returns 503). Automated tests (`vitest`) always use the simulator and its own secret, so a developer `.env` with Razorpay keys cannot create a live order during `npm test`.
- **Dev endpoints:** `POST /payments/dev/simulate` (simulator only) pays or declines a checkout; `POST /payments/checkouts/:id/abandon` records a cancel/decline from the app.
- **Coupons** are constants in `quote.ts` (`NEXITY20`, `WELCOME50` first purchase only), one redemption per user per code — no coupons collection.
- **No Mongo transactions:** the checkout is claimed atomically (`status → paid`) before the `Payment` insert, so `/verify`, the webhook and polling activate exactly once.
- **Billing state** (period, AutoPay, `razorpay_subscription_id`, next charge, grace) lives on `user.entitlement`, not a separate subscriptions collection.
- A new checkout cancels the user's earlier unpaid ones (a late payment on them is still honoured). Downgrading while a plan is active returns `409 PLAN_DOWNGRADE_LATER`; the same plan with AutoPay on returns `409 ALREADY_ON_PLAN`. Upgrades go through `Checkout` with a pro-rated credit, so there is no `/subscriptions/me/change`.
- **iOS** uses the same Razorpay checkout as Android (`X-Platform: ios` is allowed). `Info.plist` lists the UPI app schemes and the `nexity` URL type so a UPI app can return to Nexity. `AppDelegate` forwards that return URL. A closed sheet is a cancel on both phones (Android code 0, iOS code 2). CocoaPods (`pod install`) is required on a Mac before the iOS binary includes the Razorpay SDK. Save QR uses `NSPhotoLibraryAddUsageDescription`.
- **Not built yet:** changing the AutoPay payment method, invoice PDFs, admin endpoints, `FLAG_SECURE`, Google Play User Choice Billing, Apple In-App Purchase, a daily reconciliation report (the 5-minute job reconciles stale checkouts), push notifications for billing (in-app notifications only). App Store guideline 3.1.1 still expects Apple IAP for digital subscriptions when the app is submitted to the store.

---

## 1. App store rules (read before shipping)

Selling digital features inside a mobile app with a third-party gateway has store-policy limits:

| Platform | What's allowed | What Nexity does |
|---|---|---|
| **Android (Google Play, India)** | Google's **User Choice Billing** program lets apps in India offer an alternative billing system **next to** Google Play Billing (the user picks). Google still takes a reduced service fee, and the transactions must be reported to Google. Without enrolling, Razorpay for in-app digital subscriptions breaks the Payments policy and can get the app removed | Enrol in User Choice Billing; the checkout shows **Razorpay (UPI, cards…)** and **Google Play** as two options; report Razorpay transactions through the Play Developer API (`externaltransactions`) |
| **iOS** | Same Razorpay checkout as Android: UPI apps, UPI ID, QR, cards, net banking, wallets, AutoPay | The iOS app opens Razorpay. A plan bought on either phone unlocks the same account. Apple IAP is not the checkout |
| **Web** (`https://nexity.com/premium`) | No store rules | Razorpay checkout with every method, including QR on desktop |

Policies change — **re-check both programs before each release** and keep this table up to date. The rest of this doc covers Razorpay on **Android and web**.

---

## 2. Prices (single source of truth)

All amounts are **integer paise**, GST included. Stored in `plans.pricing` and served by `GET /plans`. The app never contains a price.

| Plan | Monthly | 3 months (−10%) | Yearly (−25%) |
|---|---|---|---|
| Plus | ₹99 → `9900` | ₹267 → `26700` | ₹891 → `89100` |
| Premium | ₹249 → `24900` | ₹672 → `67200` | ₹2,241 → `224100` |

**Quote formula** (only in `backend/src/modules/payments/quote.ts`):

```
base        = plan.pricing[period]                    // paise, from the table above
coupon_off  = coupon ? floor(base * coupon.pct / 100) : 0
amount      = max(100, base - coupon_off)             // never below ₹1
```

- Coupons apply to the **first billing period only** (AutoPay renewals are always charged at the full `base`).
- Coupons are server data (`coupons` collection): `code`, `pct` (1–90), `plans[]`, `periods[]`, `first_purchase_only`, `max_redemptions`, `per_user_limit` (default 1), `starts_at`, `ends_at`, `active`. Prototype codes: `NEXITY20` (20%, any plan), `WELCOME50` (50%, first purchase only).
- Razorpay **plan** entities (for AutoPay) are created once per plan × period by `npm run razorpay:sync-plans` with exactly these amounts. On startup the server fetches them and **refuses to start** if any Razorpay plan amount differs from the table (`RAZORPAY_PLAN_MISMATCH` in the log).
- Changing a price = new Razorpay plan entity (they're immutable) + update `plans.pricing`. Existing AutoPay subscribers keep their old price until they change plan (shown in `Subscription`).

---

## 3. User flow (frontend)

```
Plans ──(Upgrade to Plus / Get Premium)──► Checkout
Checkout ──(Pay ₹99)──► POST /payments/checkout ──► Razorpay checkout sheet
   ├─ success callback ─► PaymentProcessing ─► POST /payments/verify ─► PurchaseSuccess
   ├─ user closed      ─► back on Checkout (no message)
   ├─ failure callback ─► PaymentFailed
   └─ pending (UPI collect / bank delay) ─► PaymentPending (polls status, webhook finishes it)
Checkout ──(Scan QR)──► PayByQr ─► (polls) ─► PurchaseSuccess
```

### 3.1 `Checkout` (pushed, tab bar hidden)

**Params:** `{ planId: 'plus' | 'premium' }` (ids only). Rebuilds the prototype checkout.

1. **Order card:** plan icon, "Nexity Premium", "Monthly plan · renews automatically · cancel anytime" (or "One-time · no auto-renew" when AutoPay is off).
2. **Period picker:** Monthly · 3 months (Save 10%) · Yearly (Save 25%) — total and per-month from the server quote.
3. **AutoPay switch** (default **on**): "Auto-renew with AutoPay — no need to pay again every month. Cancel anytime in Subscription." Off → "Pay once for 1 month / 3 months / 1 year. We'll remind you before it ends."
4. **Coupon:** "Have a coupon code?" + Apply → `POST /payments/quote`. Errors inline ("That code isn't valid or has expired.", "This code is only for your first subscription."). Remove link.
5. **Price breakdown** (all from `POST /payments/quote`): Plan × months (MRP), Launch discount, Period saving, Coupon, **Total today**. For AutoPay: "Then ₹249 every month from 7 Nov 2026." Fine print: "Inclusive of all taxes."
6. **Payment method** (radio list — preselects the method in Razorpay; Razorpay shows the actual form):
   - **UPI** — chips Google Pay · PhonePe · Paytm · BHIM (only installed apps are enabled on Android), or "Pay with UPI ID".
   - **Scan QR** — "Pay from another phone or any UPI scanner" (hidden when AutoPay is on, with the note "QR is for one-time payments").
   - **Debit / credit card** — Visa, Mastercard, RuPay.
   - **Net banking** — all major Indian banks.
   - **Wallet** — Paytm, Amazon Pay, MobiKwik (hidden when AutoPay is on).
7. **Pay ₹249** button (`premiumGradient` for Premium, `accentGradient` for Plus). Disabled while a request is running. Below it: 🔒 "Secured by Razorpay · 256-bit encryption · We never see your card or bank details."
8. Links: Terms, Refund policy, Privacy.

**We never build card, CVV, UPI PIN or bank login fields in our UI.** Razorpay's checkout collects them. (The prototype's own card / UPI fields are demo only.)

### 3.2 Opening Razorpay (`react-native-razorpay`, Standard Checkout)

```ts
const c = await api.payments.createCheckout({ planId, period, autopay, couponCode, method });
const options = {
  key: c.razorpay.key_id,                       // public key id from the server, never hard-coded
  name: 'Nexity',
  description: c.razorpay.description,          // "Nexity Premium · Monthly"
  image: c.razorpay.logo_url,
  currency: 'INR',
  ...(c.type === 'subscription'
    ? { subscription_id: c.razorpay.subscription_id, recurring: 1 }
    : { order_id: c.razorpay.order_id, amount: c.razorpay.amount }),
  prefill: c.razorpay.prefill,                  // { email, contact, method }
  notes: { checkout_id: c.checkout_id },
  theme: { color: colors.primary },             // from the active theme token
  retry: { enabled: true, max_count: 3 },
  timeout: 900,                                 // 15 min, same as the checkout expiry
};
const result = await RazorpayCheckout.open(options);
// result: razorpay_payment_id + razorpay_order_id | razorpay_subscription_id + razorpay_signature
navigation.replace('PaymentProcessing', { checkoutId: c.checkout_id });
await api.payments.verify({ checkoutId: c.checkout_id, ...result });
```

- The amount shown by Razorpay comes from the **server-created** order / subscription. The app can't change it (Razorpay ignores a different `amount` for an existing `order_id`, and the server re-checks anyway).
- **Android UPI intent:** add a `<queries>` block in `AndroidManifest.xml` for the `upi` scheme and the UPI app packages (`com.google.android.apps.nbu.paisa.user`, `com.phonepe.app`, `net.one97.paytm`, `in.org.npci.upiapp`) so Android 11+ can open them.
- **iOS UPI apps:** `LSApplicationQueriesSchemes` in `ios/Nexity/Info.plist` (`upi`, `tez`, `gpay`, `phonepe`, `paytmmp`, `paytm`, `bhim`, and the wallet schemes). The Razorpay pod is linked by autolinking; run `pod install` on a Mac before building iOS.
- On app kill during payment: on next start, `GET /payments/checkouts/pending` → if one exists, show `PaymentProcessing` and poll its status.

### 3.3 `PaymentProcessing`

Fullscreen, no back gesture: lock ring animation, "Confirming your payment…", "Please don't close the app." Calls `/payments/verify`, then polls `GET /payments/checkouts/:id` every 2 s for up to 60 s.

| Server status | Screen |
|---|---|
| `paid` | `PurchaseSuccess` (from [plans-and-billing §3.2](plans-and-billing.md#32-purchasesuccess)) |
| `failed` | `PaymentFailed` |
| `pending` after 60 s | `PaymentPending` |

### 3.4 `PaymentFailed`

✕ icon, "Payment failed", "Your bank declined the UPI payment of ₹249. **No money was deducted.** If money was deducted, it will be refunded automatically within 5–7 working days." Tips: check balance / UPI limit / try another method. Buttons: **Try again** (new checkout, same choices), **Back to plans**, **Contact support** (subject "Payments & subscription", includes the checkout id).

### 3.5 `PaymentPending`

⏳ "Payment is being confirmed", "Your bank is taking longer than usual. We'll unlock your plan as soon as it's confirmed — you'll get a notification. You don't need to pay again." Button **OK**. The webhook finishes it and sends `subscription_activated`. If still not confirmed after 30 min → `failed` + `payment_failed` notification.

### 3.6 `PayByQr` (one-time only)

**Params:** `{ checkoutId }`. Server creates a **single-use, fixed-amount** Razorpay QR that closes in 15 min.

- QR image, amount "₹249", plan + period, countdown "Expires in 14:32", "Scan with any UPI app — Google Pay, PhonePe, Paytm, BHIM".
- **Save QR** to the gallery (asks Photos-add permission just in time) and **Share** (to pay from another phone).
- Polls `GET /payments/checkouts/:id` every 3 s. On `paid` → `PurchaseSuccess`. On expiry → "QR expired" + **Get a new QR**.
- Paying a different amount is impossible: the QR is fixed-amount, and the server checks the credited amount anyway.

### 3.7 `Subscription` additions for Razorpay

- Rows: "Pays with: **UPI AutoPay · Google Pay**" / "Card •••• 4242 (Visa)" / "Net banking mandate · HDFC" (masked values from Razorpay only), "Next charge ₹249 on 7 Nov 2026".
- **Cancel AutoPay** → confirm "You'll keep Premium until 7 Nov 2026. After that you'll move to Free and lose access to Secret features." → `POST /subscriptions/me/cancel`. Chip becomes "Ends soon".
- **Turn AutoPay back on** → new checkout that starts on `current_period_end` (no charge today, only a mandate approval).
- **Change payment method** → `POST /subscriptions/me/payment-method` → opens Razorpay's hosted authorisation link for a new mandate.
- **Upgrade / change period** → `Checkout` with the new plan (§5.4).
- **Billing history** with **Download invoice** (PDF, GST).
- One-time plan (no AutoPay): "Active until 7 Nov 2026 · doesn't renew" + **Renew / Turn on AutoPay**.

---

## 4. Amount integrity — "payment always matches the plan"

These checks run on **every** payment, whether it arrives through `/payments/verify`, the webhook, or the reconciliation job. If any check fails, the plan is **not** activated, the payment is flagged and auto-refunded, and an alert is raised.

| # | Check | Stops |
|---|---|---|
| 1 | The checkout is created by the server from `(plan_id, period, coupon)` → `amount_paise` is stored in `payment_checkouts` **before** Razorpay is called | Client-chosen prices |
| 2 | The Razorpay order / subscription is created by the server with that amount (order) or the matching Razorpay plan id + upfront add-on (subscription) | Edited order amounts |
| 3 | Signature check (HMAC-SHA256, constant-time compare) | Forged success callbacks |
| 4 | **Fetch the payment from Razorpay's API** (`GET /v1/payments/:id`) and compare: `status = captured`, `amount == checkout.amount_paise`, `currency == INR`, `order_id` / `subscription_id` == checkout's, `notes.checkout_id == checkout.id` | Payments for a cheaper plan / another order |
| 5 | Subscription: `plan_id` == the Razorpay plan id expected for `(plan, period)`, `notes.user_id == checkout.user_id`, status `authenticated` / `active` | Swapped subscriptions |
| 6 | The checkout belongs to the **calling user** and is `created` (not expired / used) | Using someone else's payment to unlock your account |
| 7 | `razorpay_payment_id` is **unique** in `payments` | Replaying one payment to get the plan twice or on two accounts |
| 8 | Renewal charges (`subscription.charged`): amount == the subscription's plan price | Wrong renewal amounts |
| 9 | Daily reconciliation compares Razorpay payments / refunds with our DB | Anything missed |

If check 4 or 8 finds a different amount, the server refunds the payment in full and sets the checkout to `amount_mismatch`. Support is alerted.

---

## 5. AutoPay (recurring) with Razorpay Subscriptions

### 5.1 How it works

1. Server creates a Razorpay **subscription** for the Razorpay plan of `(plan, period)`:
   - `total_count`: 120 monthly / 40 quarterly / 10 yearly (≈ 10 years; cancel anytime).
   - `start_at`: **now + 1 period**.
   - `addons`: one upfront item = the **first-period amount from the quote** (full price, or the coupon price).
   - `notes`: `{ user_id, checkout_id, plan, period }`. `customer_notify: 0` (Nexity sends its own notifications).
2. The user approves the mandate in Razorpay checkout (UPI app PIN / card OTP / bank login). The **first period is charged right away** through the upfront add-on.
3. On success, the plan is active from **now** until `start_at`. From `start_at`, Razorpay charges the full plan price automatically every period.
4. Razorpay sends the **pre-debit notification** required by RBI before every renewal. Nexity also sends a push 24 h before ("Your Premium renews tomorrow for ₹249").

Mandate limits: UPI AutoPay and card e-mandates allow automatic debits up to ₹15,000 without extra approval (RBI). The highest plan charge (₹2,241 yearly) is well below that.

### 5.2 Renewal states

| Razorpay webhook | Our `subscriptions.status` | Effect |
|---|---|---|
| `subscription.authenticated` | `active` (after the first payment is verified) | Plan on |
| `subscription.activated` | `active` | — |
| `subscription.charged` | `active`, `current_period_end` moved forward | Payment row + invoice + "Payment successful" notification |
| `subscription.pending` (renewal failed, Razorpay retrying) | `in_grace` | Plan **stays on** for up to 3 days; "We couldn't renew your plan" notification + "Pay now" link |
| `subscription.halted` (retries exhausted) | `expired` | Plan off → Free, crushes paused ([secret-crush.md §5](secret-crush.md#5-downgrade--upgrade)) |
| `subscription.cancelled` | `canceled` → `expired` at `current_period_end` | Keeps the plan until the period ends |
| `subscription.completed` | `expired` | — |
| `refund.processed` (full refund) | `revoked` | Plan off at once |

### 5.3 Cancel / resume

- **Cancel** (`POST /subscriptions/me/cancel`) → Razorpay `POST /v1/subscriptions/:id/cancel` with `cancel_at_cycle_end: 1`. The user keeps the plan until `current_period_end`. **No partial refunds** for the remaining days (stated in the refund policy).
- **Resume** → a new subscription with `start_at = current_period_end` and no upfront add-on. Nothing is charged today; the user only approves the mandate (some methods take a small authorisation amount that Razorpay refunds automatically).

### 5.4 Change plan or period

| Change | How |
|---|---|
| **Upgrade** Plus → Premium (or a longer period) | New checkout for Premium with **upfront = Premium price − unused value of the current Plus period** (pro-rated by days, rounded down to the rupee, minimum ₹1). After it's paid: cancel the old subscription immediately (no refund, the credit was already used). Premium starts now |
| **Downgrade** Premium → Plus | Cancel the current subscription at cycle end + new Plus subscription with `start_at = current_period_end`, no upfront. Premium stays until then |
| One-time → AutoPay | New subscription with `start_at = current_period_end`, no upfront |

### 5.5 One-time payments (AutoPay off, QR, wallets)

A Razorpay **order** for `amount_paise` with `payment_capture` automatic. On capture: plan active for `months × 30 days` from now (or from the current end if a plan is already active, so it stacks). Reminders: 3 days and 1 day before the end ("Renew now" → `Checkout`).

---

## 6. REST API (`backend/src/modules/payments/`)

All routes need auth, return the standard error shape, and are **Android/web only** (`X-Platform: ios` → `403 PAYMENT_PROVIDER_NOT_AVAILABLE`).

### `POST /api/v1/payments/quote`

`{ "plan_id": "premium", "period": "monthly", "autopay": true, "coupon_code"?: "NEXITY20" }` →

```json
{
  "plan_id": "premium", "period": "monthly", "months": 1, "autopay": true,
  "mrp_paise": 39900, "base_paise": 24900, "coupon": { "code": "NEXITY20", "pct": 20, "off_paise": 4980 },
  "amount_paise": 19920,
  "renewal_paise": 24900, "renews_on": "2026-11-07",
  "currency": "INR"
}
```

Display only — the checkout recomputes everything. Coupon errors: `COUPON_INVALID`, `COUPON_EXPIRED`, `COUPON_FIRST_PURCHASE_ONLY`, `COUPON_NOT_FOR_PLAN`, `COUPON_LIMIT_REACHED` (all `400`). Rate limit 20 / min.

### `POST /api/v1/payments/checkout`

`{ "plan_id", "period", "autopay", "coupon_code"?, "method"?: "upi" | "card" | "netbanking" | "wallet" }`. Header **`Idempotency-Key: <uuid>`** required (a retry returns the same checkout).

Server: validate the plan is active and higher than / different from the current plan → compute the quote → reserve the coupon redemption → create `payment_checkouts` (status `created`, `expires_at` +15 min) → create the Razorpay order or subscription → return:

```json
{
  "checkout_id": "9d3c…", "type": "subscription", "expires_at": "2026-10-07T07:00:00Z",
  "quote": { "...": "same as /quote" },
  "razorpay": {
    "key_id": "rzp_live_xxx", "subscription_id": "sub_Nx…", "order_id": null, "amount": 24900,
    "description": "Nexity Premium · Monthly", "logo_url": "https://cdn.nexity.com/logo.png",
    "prefill": { "email": "t***@nexity.app", "contact": "", "method": "upi" }
  }
}
```

Errors: `PLAN_NOT_AVAILABLE` (400), `ALREADY_ON_PLAN` (409), `CHECKOUT_IN_PROGRESS` (409, another unexpired checkout exists — returns its id), coupon errors, `PAYMENT_PROVIDER_ERROR` (502). Rate limit: 10 / hour / user.

### `POST /api/v1/payments/verify`

`{ "checkout_id", "razorpay_payment_id", "razorpay_signature", "razorpay_order_id"? , "razorpay_subscription_id"? }`

1. Load the checkout **by id and caller's user id** → else `404`.
2. Signature: order → `HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)`; subscription → `HMAC_SHA256(payment_id + "|" + subscription_id, KEY_SECRET)`. Compare with `crypto.timingSafeEqual` → else `400 PAYMENT_SIGNATURE_INVALID`.
3. Run the §4 checks (fetch payment / subscription from Razorpay).
4. In one transaction: insert `payments` (unique `razorpay_payment_id`), checkout → `paid`, upsert `subscriptions` (`source: 'razorpay'`), recompute entitlement, consume the coupon.
5. After commit: notification `subscription_activated`, socket `subscription.updated`, reactivate paused crushes.

`200` → `{ "status": "paid", "entitlement": { … } }`. Already paid → same `200` (idempotent). Captured but still processing → `202 { "status": "pending" }`.

### `GET /api/v1/payments/checkouts/:id` · `GET /api/v1/payments/checkouts/pending`

Status for polling: `{ id, status: 'created' | 'pending' | 'paid' | 'failed' | 'expired' | 'amount_mismatch', failure_reason? }`. Own checkouts only. Rate limit 60 / min.

### `POST /api/v1/payments/qr`

`{ "checkout_id" }` (an order-type checkout) → Razorpay QR Codes API: `type: upi_qr`, `usage: single_use`, `fixed_amount: true`, `payment_amount = checkout.amount_paise`, `close_by = checkout.expires_at`, `notes.checkout_id`. Returns `{ image_url, close_by }`. Completed by the `qr_code.credited` webhook (same §4 checks).

### Subscription management (Razorpay)

| Method | Path | Notes |
|---|---|---|
| POST | `/subscriptions/me/cancel` | Cancel AutoPay at cycle end |
| POST | `/subscriptions/me/resume` | Returns a new checkout (mandate only) |
| POST | `/subscriptions/me/payment-method` | Returns Razorpay's hosted authorisation `short_url` for a new mandate; the old subscription is cancelled at cycle end once the new one is authenticated |
| POST | `/subscriptions/me/change` | `{ plan_id, period }` → checkout with the pro-rated upfront (§5.4) |
| GET | `/payments/:paymentId/invoice` | Short-lived signed URL to the GST invoice PDF (own payments only) |

### `POST /api/v1/webhooks/razorpay` (no bearer auth)

- Read the **raw body** (route registered before `express.json()`), verify `X-Razorpay-Signature = HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)` with `timingSafeEqual` → else `400` and an alert.
- Idempotent on the `x-razorpay-event-id` header (unique in `payment_webhook_events`).
- Respond `200` quickly; process in a queue job with retries. Out-of-order safe (compare `created_at` / subscription `current_end`).
- Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.updated`, `refund.created`, `refund.processed`, `refund.failed`, `qr_code.credited`, `qr_code.closed`, `payment.dispute.created`.
- The webhook is the **source of truth**: if the app never calls `/verify` (killed, offline), the webhook still activates the plan after the §4 checks.

### Admin

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/payments` | Search by user, payment id, status, date |
| POST | `/admin/payments/:id/refund` | `{ amount_paise?, reason }` (full by default). Needs `admin` role + re-auth within 10 min. Audit-logged. Full refund revokes the plan |
| GET / POST / PATCH | `/admin/coupons` | Create / edit / disable coupons |
| GET | `/admin/payments/reconciliation` | Latest reconciliation report and mismatches |

---

## 7. Data (MongoDB)

**`payment_checkouts`** — `public_id` (UUID), `user_id`, `plan_id`, `period`, `autopay`, `coupon_code`, `quote` (frozen copy), `amount_paise`, `currency`, `razorpay_order_id` / `razorpay_subscription_id` / `razorpay_qr_id`, `idempotency_key` (unique per user), `status`, `failure_reason`, `expires_at`, `platform`, `created_at`, `updated_at`. TTL: unpaid rows deleted after 30 days.

**`payments`** — `razorpay_payment_id` (**unique**), `user_id`, `checkout_id`, `subscription_id`, `kind` (`first` | `renewal` | `one_time` | `upgrade`), `amount_paise`, `currency`, `method` (`upi` | `card` | `netbanking` | `wallet`), `method_display` (masked: "UPI · Google Pay", "Visa •••• 4242", "HDFC Bank"), `status` (`captured` | `refunded` | `partially_refunded` | `failed` | `disputed`), `refunded_paise`, `invoice_id`, `gst` `{ taxable_paise, gst_paise }`, `created_at`.

**`subscriptions`** (shared with [plans-and-billing](plans-and-billing.md)) gets `source: 'razorpay'`, `razorpay_subscription_id` (unique, sparse), `razorpay_plan_id`, `payment_method_display`, `next_charge_at`, `price_paise`.

**`payment_webhook_events`** — `event_id` (unique), `event`, `payload` (verified), `status` (`processed` | `ignored` | `failed`), `attempts`, `error`, `received_at`. Kept 2 years.

**`coupons`**, **`coupon_redemptions`** (`coupon_id`, `user_id`, `checkout_id`, `status: reserved | used | released`; unique `{ coupon_id, user_id }` for per-user limit 1).

**Never stored:** card number, CVV, expiry, UPI PIN, bank login, full bank account number, full UPI ID. Only Razorpay ids and the masked display strings Razorpay returns.

---

## 8. Notifications

| type | When | Copy |
|---|---|---|
| `subscription_activated` | First payment verified | Payment successful — your Premium plan is active until 7 Nov 2026 🎉 |
| `payment_renewal_upcoming` | 24 h before an AutoPay charge | Your Premium renews tomorrow for ₹249 via UPI AutoPay. |
| `payment_renewed` | `subscription.charged` | ₹249 paid — Premium renewed until 7 Dec 2026. |
| `subscription_renewal_failed` | `subscription.pending` | We couldn't renew your Premium plan. Pay now to keep Secret features. |
| `subscription_expiring` | One-time plan, 3 days / 1 day left | Your Plus plan ends in 3 days. Renew now 💌 |
| `payment_failed` | Pending payment failed after 30 min | Your payment of ₹249 didn't go through. No money was deducted. |
| `payment_refunded` | `refund.processed` | ₹249 has been refunded to your original payment method. |

Channel `general`. Payment and refund notices are always sent (they ignore the `subscription` preference switch).

---

## 9. Environment variables (backend)

| Var | Purpose |
|---|---|
| `RAZORPAY_KEY_ID` | Public key id (sent to the app per checkout) |
| `RAZORPAY_KEY_SECRET` | **Server only.** API auth + payment signature |
| `RAZORPAY_WEBHOOK_SECRET` | **Server only.** Webhook signature (different from the key secret) |
| `RAZORPAY_LOGO_URL` | Optional logo shown in Razorpay checkout |
| `PAYMENTS_ENABLED_PLATFORMS` | `android,ios,web` |

Razorpay plan entities are created on first use and cached in the `razorpay_plans` collection (keyed by plan, period, key mode and amount), so there is no `RAZORPAY_PLAN_IDS` / sync script.

Test mode (`rzp_test_…`) in development and staging, live keys only in production, kept in the secret manager. The app gets `key_id` from the checkout response, so **no Razorpay key is ever compiled into the app**.

---

## 10. Security — so nobody can hack payments

### 10.1 Threats and defences

| Attack | Defence |
|---|---|
| Change the price in the app / intercept the request and send ₹1 | The app never sends an amount. The server computes it (§2) and re-checks the real payment amount with Razorpay (§4) |
| Fake a "payment success" callback | HMAC signature with `KEY_SECRET` (server only) + the payment is fetched from Razorpay's API before activation |
| Reuse someone else's payment id / replay a success | Checkout tied to the caller's `user_id`; `razorpay_payment_id` unique; `notes.checkout_id` must match |
| Fake webhook calls | Signature over the **raw** body with `RAZORPAY_WEBHOOK_SECRET`; unsigned → `400` + alert; event id idempotency |
| Pay for Plus, get Premium | Plan / period / Razorpay plan id / amount all compared with the checkout |
| Coupon abuse (reuse, guessing codes) | Server-side coupons, per-user limit, first-purchase check by user **and** by payment method fingerprint (masked card / VPA hash), `quote` rate limit 20 / min, codes ≥ 8 chars for private codes |
| Steal card / UPI / bank details from Nexity | Nexity never sees them — Razorpay (PCI-DSS Level 1) collects them. Our PCI scope is SAQ-A |
| Leaked API keys | Secret manager, never in git or the app; Razorpay dashboard: 2FA for every member, least-privilege roles, rotate keys on staff change; `key_secret` is only used by the payments module |
| Account takeover → attacker cancels / refunds | Normal JWT auth for cancel; refunds are **admin-only** with re-auth + audit log; payment notifications go to the owner |
| Brute-force / bot checkouts | Rate limits (§10.3), one active checkout per user, `Idempotency-Key` |
| Tampered / rooted device, overlay attacks | All checks are server-side, so a modified app gains nothing. Android `FLAG_SECURE` on `Checkout`, `PayByQr` and `PaymentProcessing` (no screenshots / screen recording of payment screens) |
| Man-in-the-middle | HTTPS only (TLS 1.2+), HSTS on the API and web, Android `usesCleartextTraffic=false` in release; certificate pinning for `api.nexity.com` on the payment calls (recommended) |
| Server bug grants plan without payment | Entitlement for `source: razorpay` can only be written by the payments service after §4; daily reconciliation flags plans with no matching captured payment |
| Chargebacks / disputes | `payment.dispute.created` → plan stays, support alerted; lost dispute → plan revoked |

### 10.2 Code rules

- Signatures: `crypto.createHmac('sha256', secret)` + `crypto.timingSafeEqual` (never `===`).
- Webhook route uses `express.raw({ type: 'application/json', limit: '1mb' })` and is excluded from auth and JSON middlewares.
- All money is **integer paise**. No floats anywhere in payments code.
- The logger redacts `razorpay_signature`, `key_secret`, webhook bodies, email and phone. Payment ids may be logged.
- Payment state changes happen in MongoDB transactions; every activation writes a `billing_events` audit row.
- Zod validates every body; unknown fields rejected.
- The Razorpay client has timeouts (10 s) and retries only on idempotent calls (`GET`s, or creates with our receipt / idempotency key).

### 10.3 Rate limits

| Route | Limit |
|---|---|
| `POST /payments/quote` | 20 / min / user |
| `POST /payments/checkout` | 10 / hour / user, 1 active checkout |
| `POST /payments/verify` | 30 / hour / user |
| `GET /payments/checkouts/:id` | 60 / min / user |
| `POST /payments/qr` | 5 / hour / user |
| `POST /subscriptions/me/*` | 10 / hour / user |
| Webhook | No user limit; signature required |

### 10.4 Monitoring & reconciliation

- **Daily job** `paymentsReconcile` (03:00 IST): pull Razorpay payments, refunds and subscriptions for the last 3 days and compare with `payments` / `subscriptions`. Fix missed webhooks automatically; flag amount mismatches and plans without payments.
- **Alerts** (to the on-call channel): webhook signature failures, `amount_mismatch`, failure rate > 30% in 15 min, reconciliation differences, refunds > ₹5,000 / day.
- Admin dashboard: revenue, active subscribers per plan, AutoPay vs one-time, failure reasons, refunds.

### 10.5 Legal & compliance

- Refund policy, Terms and the auto-renew terms are linked on `Checkout`. AutoPay consent text is shown before paying.
- GST invoices for every payment (Razorpay invoices or our own PDF with Nexity's GSTIN).
- RBI e-mandate rules (pre-debit notification, easy cancel) are covered by Razorpay + our `Subscription` screen.
- Privacy policy and Play Data safety: "Purchase history" and "Payment info (processed by Razorpay)".

---

## 11. Testing

- Razorpay **test mode**: test cards (success / failure / 3DS), test UPI ids (`success@razorpay`, `failure@razorpay`), test net banking, test subscriptions (fast-forward charges from the dashboard).
- Webhooks locally: Razorpay dashboard test webhooks → tunnel (e.g. `cloudflared`) to `localhost:4000`.
- Automated tests: quote table for every plan × period × coupon; signature valid / invalid; amount mismatch → no plan + refund; replayed payment id; webhook before `/verify` and after; duplicate webhook; out-of-order renewal events; parallel `/verify` calls → one activation.
- Manual on a real Android phone: GPay, PhonePe and Paytm intents, UPI ID collect, QR from a second phone, card OTP, net banking, wallet, AutoPay approve + test renewal, cancel, upgrade.

## 12. Acceptance criteria

- [ ] Every method in the table at the top works on a real Android phone and on the web; AutoPay works with UPI apps, cards and net banking.
- [ ] The amount charged always equals the server quote for the chosen plan, period and coupon; a tampered app or request can't pay less or get a higher plan.
- [ ] A forged success callback, a replayed payment id and an unsigned webhook never activate a plan.
- [ ] Killing the app during payment still activates the plan (webhook) and never charges twice.
- [ ] Failed payments show "No money was deducted"; pending payments finish via webhook with a notification.
- [ ] AutoPay renews automatically with a reminder 24 h before; failed renewals give a 3-day grace and then move the user to Free.
- [ ] Cancel AutoPay keeps the plan until the period ends; upgrade charges only the pro-rated difference.
- [ ] No card, UPI PIN or bank data is stored or logged by Nexity; no Razorpay secret is in the app.
- [ ] Android and iOS open the same Razorpay checkout; a plan bought on either phone unlocks the same account.
- [ ] Works in Light, Dark and every mood.
