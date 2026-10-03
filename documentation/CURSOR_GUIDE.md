# Cursor workflow guide

This documentation is written so **Cursor (and other AI agents) can build the iOS + Android app screen-by-screen** without guessing.

## Start here

1. Read **[AGENTS.md](AGENTS.md)**.
2. Read **[architecture/MOBILE_APP.md](architecture/MOBILE_APP.md)** — platform rules that apply to every screen.
3. Open **[INDEX.md](INDEX.md)** for every screen and deep link.
4. For posts, reels, and stories, also read **[architecture/INSTAGRAM_CONTENT_UX.md](architecture/INSTAGRAM_CONTENT_UX.md)** and **[architecture/CLOUDINARY.md](architecture/CLOUDINARY.md)**.
5. For any UI screen, follow **[architecture/THEMING.md](architecture/THEMING.md)** so the screen works in Light, Dark and every mood theme. A selected mood replaces Light / Dark / System and must re-theme every element the way Dark mode does (no white surfaces), so use tokens only (no hard-coded colors). Buttons keep their design.

## Recommended prompts

| Goal | Prompt |
|------|--------|
| App shell | `Set up navigation (AuthStack, OnboardingStack, MainTabs, modals), linking config, ThemeProvider, TanStack Query, and secure token storage per documentation/architecture/MOBILE_APP.md.` |
| One screen | `Read documentation/modules/auth/login.md and implement LoginScreen in frontend plus POST /auth/login in backend.` |
| Instagram post flow | `Implement documentation/modules/posts/* and the INSTAGRAM_CONTENT_UX.md post section with Cloudinary uploads from the device.` |
| Reels | `Implement the Reels tab and create flow per documentation/modules/reels/ and INSTAGRAM_CONTENT_UX.md.` |
| Media | `Implement Cloudinary sign + confirm in backend and useCloudinaryUpload() in frontend per documentation/architecture/CLOUDINARY.md.` |
| Push | `Implement FCM/APNs push per documentation/architecture/PUSH_NOTIFICATIONS.md and NotificationSettings screen.` |
| Mood and appearance | `Implement ThemeProvider and AppearanceSettings per documentation/architecture/THEMING.md and documentation/modules/settings/appearance.md. Theme and mood are one exclusive choice; a mood re-themes the whole app like Dark mode and tapping it again removes it. Do not invent mood hex values.` |
| Platform audit | `Check this screen against the acceptance criteria in MOBILE_APP.md (safe areas, keyboard, Android back, permissions, offline) and list gaps.` |
| Fix drift | `Compare implementation to documentation/modules/reels/reels-viewer.md and list gaps.` |

## File order for greenfield build

1. `architecture/*` — set up navigation, theme, API client, secure storage, and splash before building screens
2. `modules/auth/*`
3. `modules/profile/*`
4. `modules/posts/*` + `modules/feed/*`
5. `modules/notifications/*` + push notifications
6. `modules/reels/*`
7. `modules/stories/*`
8. `modules/messages/*`
9. Everything else in `INDEX.md`

## Testing on devices

- Android: `npm run reverse` then `npm run android` in `frontend/` with the backend running on port 4000.
- iOS: requires macOS + Xcode (`pod install`, then `npx react-native run-ios`).
- Before marking a module done, run through its acceptance criteria on both platforms.

## Keeping docs accurate

When you change a screen, deep link, API, or upload flow in code, update the matching module doc in the **same commit**. Treat `documentation/` as the contract for agents.

If you add **`Secret_Social_App_Project_Overview_v3.docx`** under `documentation/source/`, ask the agent to reconcile it with these docs.
