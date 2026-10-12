# Premium tab (Secret hub)

**Screen:** `Premium` (root of `PremiumTab`, between Search and Reels)  
**Deep links:** `nexity://premium` · `nexity://premium/messages` · `nexity://premium/crush` → `Premium { section }`  
**Theme:** Light, Dark and every mood. Hero uses `secretGradient`, crown uses `primary` ([THEMING.md](../../architecture/THEMING.md))  
**Auth required:** Yes  
**Frontend:** `frontend/src/screens/premium/PremiumScreen.tsx` (today a "coming soon" placeholder — replace it)  
**Prototype:** `frontend/prototype/js/secret.js` (`Screens.secret`)

## Purpose

The home of Nexity's secret side. It holds the two paid features:

| Section | Doc |
|---|---|
| 💌 **Messages** | [secret-messages.md](secret-messages.md) |
| 💘 **Secret Crush** | [secret-crush.md](secret-crush.md) |

Plans, prices and limits: [plans-and-billing.md](plans-and-billing.md). Security: [SECRET_FEATURES_SECURITY.md](../../architecture/SECRET_FEATURES_SECURITY.md).

## Navigation

```
PremiumTab → PremiumStack (native-stack)
├── Premium                { section?: 'messages' | 'crush' }       root
├── SecretThread           { threadId }
├── Plans                  { reason?, targetUserId? }
├── PurchaseSuccess        { planId }                              (replace after purchase)
└── Subscription                                                   (also pushed from Settings)

Root modals:
├── SecretCompose          { userId }       fullScreenModal
├── SecretPeoplePicker     { intent: 'secret_message' | 'crush' }   modal
└── MatchCelebration       { matchId }      fullScreenModal, transparent
```

## UI

1. **App bar:** 👑 "Premium" + help icon (?) → **How it works** bottom sheet + plan pill ("Free" / "Plus" / "👑 Premium") → `Subscription`.
2. **Hero** (`secretGradient`, slow twinkling stars, Reduce Motion → static): eyebrow "🎭 Your secret side", title "Say it without saying who.", 💌 seal.
3. **Section tabs:** 💌 Messages (unread badge from `GET /secret-messages/summary`) · 💘 Secret Crush (dot when there's a new admirer or an uncelebrated match).
4. **Section content** (see the module docs). The last selected section is remembered for the session; `section` from a deep link or push wins.
5. Free users: a compact **"Unlock your secret side — from ₹99/month"** card at the bottom → `Plans`.

### How it works (bottom sheet)

- **💌 Secret Messages:** 1) Send a message to anyone. They're told "Someone is trying to reach you with a Secret Message 💌". 2) The sender's name and message stay sealed while they reply. 3) After their 2nd reply, the name, photo and full message unseal together and it becomes a normal chat.
- **💘 Secret Crush:** 1) Add people to your private crush list. 2) They're told "Someone added you as a Secret Crush 👀" — never who. 3) If they add you too: "Congratulations! It's a match 💘" and a love chat opens. 4) No match? Nobody ever finds out.
- Footer: "Opening and replying to Secret Messages, sending them and adding crushes need **Plus** or **Premium**." + **Got it**.

## Badges

- Tab bar Premium icon: dot when `secret.unread_count > 0`, a new admirer or an uncelebrated match exists. Cleared when the matching section is viewed.
- Notifications with type `secret_*` / `crush_*` are marked read when their section is opened. **Free users:** the dot and counts stay until a plan unlocks the section, so the reason to upgrade stays visible ([plans-and-billing §6.1](plans-and-billing.md#61-free-users-get-every-secret-notification-this-is-how-nexity-earns)).

## Behavior

- On focus: refetch `['secret','summary']` and `['crush','summary']`. If `pending_celebration_match_id` is set → open `MatchCelebration`.
- Tapping the active tab again scrolls to the top (same as other tabs).
- Offline: show cached summary counts with the offline banner; actions that send are disabled with "You're offline".

## Acceptance criteria

- [ ] `nexity://premium/messages` and `nexity://premium/crush` open the right section, also from a killed app.
- [ ] Badges match the server counts and clear when viewed.
- [ ] Free, Plus and Premium users see the right locked / unlocked states without a restart after buying.
- [ ] Works in Light, Dark and every mood; safe areas and the floating tab bar don't cover content.
