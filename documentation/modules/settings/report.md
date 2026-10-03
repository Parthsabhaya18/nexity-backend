# Report content

**Screen:** Report **bottom sheet** opened from post / reel / story / profile / message ••• menus  
**Deep link:** none  
**Theme:** Dark & light (sheet uses `surfaceElevated`, also over always-dark viewers) — [THEMING.md](../../architecture/THEMING.md)

Report is required for user-generated content apps (App Store guideline 1.2, Google Play UGC policy).

## UI

- Step 1: "Why are you reporting this?" — list of reasons.
- Step 2 (for **Other**): multiline details input above the keyboard.
- Submit → success state with **Block {username}** shortcut.
- Opening the sheet over a reel/story pauses playback.

## Reasons (enum)

- Spam
- Harassment
- Hate speech
- Nudity or sexual content
- Violence
- Self-harm
- Other (requires details min 10 chars)

## API

### `POST /api/v1/reports`

**Body:**

```json
{
  "target_type": "post",
  "target_id": "uuid",
  "reason": "spam",
  "details": ""
}
```

`target_type`: `post` | `reel` | `story` | `user` | `message` | `comment`

**Success `201`**

## Acceptance criteria

- [ ] Thank-you state; no indication if already reported.
- [ ] Reporter can block the user directly from the success state; blocked content then disappears.
- [ ] Moderators act on reports within 24 hours (store policy expectation).
