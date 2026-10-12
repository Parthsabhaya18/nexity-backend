# Post viewer

**Screen:** `PostViewer` (pushed in any tab stack)  
**Params:** `postId`, `source` (`user` | `saved`), `userId` (when `source=user`)  
**Deep link:** none. Shared links open `PostDetail` (`posts/:postId`).  
**Theme:** Light, Dark and every mood. See [THEMING.md](../../architecture/THEMING.md)  
**Auth required:** Yes

## Purpose

Opens a post from a profile grid (`Profile`, `UserProfile`) or `SavedPosts` and lets the user swipe **left / right** to the next or previous post in that grid, like Instagram.

## UI

- Horizontal pager, one full `PostCard` per page. Each page scrolls vertically when the caption is long.
- Starts on the tapped post. The screen loads grid pages until it finds the post (up to 12 pages), then falls back to `GET /posts/:id`.
- Loads more posts when the user nears the end of the list.
- Like, double-tap like, save, comments (`CommentsSheet`) and the owner's ••• sheet work as in the feed. Changes are shared with the grid and the feed through post events, so counts match everywhere.
- If the user deletes the last post on the list, the screen goes back.
- A carousel post swipes its own photos. To move to the next post, swipe on the header, actions or caption.

## API

`GET /users/:userId/posts` or `GET /users/me/saved-posts` (cursor pagination), `GET /posts/:id`.

## Acceptance criteria

- [x] Tapping a grid tile opens the viewer on that post.
- [x] Swiping sideways moves between posts in grid order.
- [x] Likes, comments and options stay in sync with the grid.
