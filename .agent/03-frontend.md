# Frontend integration plan

October 22 update: [plain Python Worker + D1](08-d1-migration.md) replaces FastAPI/Containers while retaining Astro and browser TypeScript. The same Worker deployment serves assets and same-origin `/api`. Use the existing $5/month Paid plan; Free next month is optional after measurement. No frontend redesign or automatic retries. Re-run API/conflict/recovery journeys against the real Python Worker/D1 backend; Mongo-era fixtures alone do not prove acceptance.

Updated October 20, 2026 to match the implemented backend. [06-backend-crud.md](06-backend-crud.md) and [backend/README.md](../backend/README.md) supersede older frontend assumptions. Track execution in [next-steps.md](next-steps.md).

## Starting point and structure

Implemented October 20, 2026 using Astro page shells and browser TypeScript, preserving the existing board/card styles. Sample data has been replaced with the API client in `frontend/src/lib/api.ts`; independent revision merging is in `board-state.ts`, and browser interactions/drafts are in `frontend/src/scripts/board.ts`. No React island or state framework was added. Login and editor dialogs connect the current API contract. See [next-steps.md](next-steps.md) for verified checks and remaining live-backend acceptance.

Follow-up verification: two real browser journeys pass against local FastAPI and the `kanban_dev` replica set, including multi-session conflicts, retained drafts, uncertain-response recovery, comment ownership/cap, guarded deletion, and reload/order persistence. No application behavior or design changes were needed. This local verification does not establish Atlas/production acceptance.

Use a typed API client and separate state for fetched records, ordering, and unsaved drafts. Preserve the existing TypeScript contract against backend schemas and response fixtures; the target has no FastAPI-generated OpenAPI dependency. A global state framework is not required for three users.

Keep same-origin `/api` in development and production. Update development routing to the local Python Worker and serve production API routes directly in that Worker through [05-cloudflare-deployment.md](05-cloudflare-deployment.md). D1 bindings and signing secrets remain server-side; no browser database credentials.

## Authentication and identity

On page load, call `GET /api/auth/me`; show login on 401, otherwise fetch users and the full board. Connect the login form to `POST /api/auth/login` and logout to `POST /api/auth/logout`. Use the existing HttpOnly cookie; do not store a JWT in browser storage.

Public account records contain only `username`. Card `creator` and `assignees`, and comment `author`, are canonical usernames. Use username to key bundled pictures and initials. There is no separate user ID, display name, avatar field, signup, or profile editing API.

Show a generic failed-login message, disable duplicate submissions, and display the current username and logout control. On session expiry, stop polling, return to login, and preserve drafts in memory where practical.

Login throttling and exact-Origin CSRF protection are implemented in the current backend; preserve their contract from [07-auth-follow-up.md](07-auth-follow-up.md) in the Python Worker. Login/me responses do not contain CSRF tokens. Preserve retry guidance and rejected-logout/draft recovery.

## Board data and presentation

`GET /api/cards` returns `{cards: [...], order_versions: {...}}`: all full records, including descriptions and comments, in persisted manual order. `GET /api/users` returns the sorted username-only account list. No server-side search, filters, pagination, summary endpoint, or count query exists.

| API value | Display |
| --- | --- |
| `review` | Review / Brainstorm |
| `backlog` | Backlog |
| `in_progress` | In Progress |
| `done` | Done |
| `blocked` | Blocked |
| `at_risk` | At risk |
| `ticket_number: N` | KAN-N |

Difficulty values are `easy`, `medium`, `hard`; health values are `healthy`, `at_risk`, `blocked`. Translate display labels only in the UI.

Keep the complete fetched board in memory. Search title/ticket and filter assignee/tag/health/difficulty locally; derive counts from that same dataset and make filtered versus total counts clear. Any display pagination or "Load more" behavior is local and must not discard fetched records. Do not sort cards by creation time.

Show ticket number, title, difficulty, health text/color, the single tag, assignees, and comment count. Distinguish loading, empty board/column, no matching results, and failed refresh. Support horizontal column scrolling on narrow screens and an appropriate details panel.

## Card creation and editing

Create with `POST /api/cards`. Title and one nonblank `tag` are required; no separate tag-management API exists. Defaults are Review / Brainstorm, Medium, Healthy, empty description, and no assignees. New cards append to their column.

| Field | Validation |
| --- | --- |
| Title | Trimmed, 1-200 characters |
| Description | Plain text, up to 20,000 characters; empty allowed |
| Tag | Trimmed/lowercased, 1-32 characters; cannot be cleared |
| Assignees | Zero to three distinct existing canonical usernames |
| Comment text | Trimmed, 1-4,000 characters |

Content saves use `PATCH /api/cards/{id}` with the loaded `expected_version` and only supplied editable fields: title, description, tag, difficulty, health, assignees. Omitted fields are preserved; empty description and empty assignee list clear those values. Reject nulls and prevent empty saves. Never send IDs, metadata, raw position, column, nested comments, or obsolete `tags`.

Show immutable ticket, creator, and UTC timestamps formatted for the viewer. Render description/comment text safely as plain text with line breaks.

A content save advances `version` once and does not change `comments_version`. Even a valid unchanged-value submission advances the version; avoid unnecessary saves.

## Movement and Blocked health

Both column-selector moves and drag-and-drop use `POST /api/cards/{id}/move`:

```json
{
  "column": "blocked",
  "before_card_id": null,
  "expected_version": 2,
  "expected_order_versions": {"review": 5, "blocked": 0}
}
```

Supply the observed source/destination column revisions; sending the whole board map is allowed. Null/omitted anchor appends; another destination card's ID places the card immediately before it. The response is `{card: {...}, order_versions: {...}}`.

The column selector appends to another column and disables its current option. Drag-and-drop persists the chosen position and is the only UI mechanism for rearranging cards within a column. Manual ordering is required, not optional polish. Disable reordering while filters hide cards, but allow selector moves. Keep the selector usable on keyboard/touch; do not add alternative within-column reorder controls.

Disable repeat moves while saving and apply server-confirmed results. Refresh the complete board after create/move/delete, because neighbor positions may change without advancing their content versions. Never submit numeric positions or a replacement array of cards.

Entering Blocked sets health to blocked atomically. While there, lock the health control to blocked. For creation directly in Blocked, omit health or send blocked; another health returns 422. Leaving Blocked preserves blocked health and unlocks manual health editing. Moves between other columns preserve health.

If a form contains unsaved content, preserve its original content version when another operation moves the card. Do not silently replace that precondition with the newer move response and thereby bypass a conflict check.

## Comments and deletion

All signed-in users can read/add comments. Show individual Edit/Delete controls only when the current username matches `author`. The API independently enforces ownership.

- Create: `POST /api/cards/{id}/comments` with text; no card/discussion precondition.
- Edit: `PATCH /api/cards/{id}/comments/{comment_id}` with text and `expected_comment_version`.
- Delete: `DELETE /api/cards/{id}/comments/{comment_id}?expected_comment_version=N`.
- Each response is the full card. Edits advance the targeted comment version; all comment mutations advance `comments_version`, never card `version` or parent `updated_at`.

Display oldest first, preserve original attribution, and show an edited indicator when appropriate. Provide Save/Cancel, deletion confirmation, length feedback, and a clear message at 20 comments. At the cap, edits remain allowed and deleting an owned comment frees a slot. Do not use a stale whole-card version for comment writes.

Any signed-in user can delete any card and its entire discussion. Confirm the ticket and explicitly state that everyone's comments will be removed. Call `DELETE /api/cards/{id}?expected_version=N&expected_comments_version=M` using both loaded revisions. On conflict, show the refreshed discussion before requesting a deliberate new deletion decision; do not silently retry with updated revisions.

## Synchronization and resilience

Start with a 15-second refresh while visible, pause in background tabs, and refresh on focus and after successful writes. Prevent overlapping polls and ignore/cancel obsolete requests. Filters operate locally and do not trigger server queries.

Merge content by `version` and discussion by `comments_version`; late full-card responses must not regress either. Treat ordering separately using column revisions and fresh full-board snapshots. A late pre-deletion snapshot must not resurrect a removed card. Do not replace unsaved drafts or advance their original preconditions during background refresh.

Handle the shared `{error: {code, message, fields}}` envelope:

| Status | UI behavior |
| --- | --- |
| 401 | Return to login, pause polling, preserve drafts where practical |
| 403 | Explain comment ownership; keep unsaved text |
| 404 | Explain removal/missing resource and refresh the board |
| 409 | Preserve draft; show latest state and an explicit refresh/reapply choice |
| 422 | Show field/health/anchor/assignee/comment-limit feedback |
| 503 or proxy/network failure | Retain last successful data and offer retry |

After an uncertain mutation response, refresh before a deliberate retry. Do not automatically replay create/comment writes. When newer content arrives while a draft is open, show a notice instead of replacing it. Comment-only activity must not invalidate a current content draft.

## Acceptance and accessibility

Verify login/logout, card/comment CRUD, assignments, single tags, selector moves, persistent drag-and-drop order, and local filters through actual browser requests. Use multiple sessions to exercise stale card/comment/order preconditions and independent discussion updates.

Check labeled controls, visible focus, dialog Escape/focus return, mobile layouts, long text, empty states, readable status text alongside color, and noninterrupting save/error announcements. Cover no assignees, multiple assignees, all five columns, and the comment cap. Browser checks supplement the already-passing backend tests.
