# Reel comments

**Screen:** bottom sheet on `Reels` / `ReelDetail` (`@gorhom/bottom-sheet`)  
**Deep link:** none (push for `comment_reel` opens `ReelDetail` with this sheet expanded)  
**Theme:** Sheet follows dark & light (`surfaceElevated`) on top of the always-dark viewer — [THEMING.md](../../architecture/THEMING.md)

## API

Same pattern as post comments:

- `GET /api/v1/reels/:reelId/comments`
- `POST /api/v1/reels/:reelId/comments`
- `DELETE /api/v1/comments/:commentId`

## UI

- Sheet ~70% height; swipe down or Android back closes it.
- Compact list; composer pinned bottom above the keyboard (respects safe area).
- Long-press comment → Reply, Copy, Report, Delete (own).
- Closing the sheet resumes normal video playback.

## Acceptance criteria

- [ ] Comment count updates on reel overlay after post.
- [ ] Keyboard never covers the composer on iOS or Android.
