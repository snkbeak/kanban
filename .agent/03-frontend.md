# Frontend plan

## Structure and state

Create `frontend/` using Astro and TypeScript. Build a static page shell and one client-rendered React island for login and the interactive board. React is a proposed implementation choice, not a requirement of the rough draft; keep it to one UI framework.

Deploy the built static files to Cloudflare Workers Static Assets with Wrangler. Add a small TypeScript Worker entry point to proxy `/api/*` to FastAPI; it does not contain board business logic. Commit the Wrangler configuration and provide build, local-preview, and deploy scripts as described in the [deployment plan](05-cloudflare-deployment.md).

Organize the island into login, board, column, card summary, card editor/details, comments, and filter components. Use local component state and a small typed API client; a global state framework is unnecessary for three users. Derive API types from FastAPI's OpenAPI schema and provide a repeatable generation command.

Use a same-origin `/api` proxy in development and production. On load, fetch `/auth/me`; show login on `401`, otherwise load users and board summaries. Keep the session in the HttpOnly cookie and the CSRF token in memory. On expiry, return to login with a clear message and retain unsaved text in memory where possible.

## Primary interactions

### Sign in

Show a username and password form with proper labels and autocomplete attributes. Provide useful validation and a generic failed-login message. Disable repeat submissions while a request is pending. Show the signed-in user's avatar/name and a logout button after authentication.

### View the board

- Show all five columns in the order specified in [scope](01-scope.md), with matching total counts and independent “Load more” controls.
- Each summary shows ticket number, title, difficulty, health text/color, tags, assignee avatars, and comment count.
- Support title/ticket search and combinable assignee, tag, health, and difficulty filters. Provide a visible clear-filters action.
- Distinguish an empty board, empty column, no matching results, initial loading, and a failed refresh.
- On narrow screens, provide horizontal column scrolling with visible column navigation; details use a full-screen panel.

### Create and edit cards

Use a form with title, multiline description, column, difficulty, health, editable tags, and a three-person assignee picker. Defaults follow the scope document. Display field-level errors and enforce the same limits as the API.

Open details from a card summary. Show editable content, immutable ticket/creator/timestamps, and the comment thread. Format timestamps in the viewer's local timezone and expose full dates in accessible text.

Save explicit edits with the loaded version. Keep entered values when a save fails. On `409`, explain that someone changed the card, fetch the latest record for comparison, and let the user reload or reapply their draft deliberately. Do not overwrite a newer edit automatically.

### Move and delete cards

Provide an accessible “Move to” selector that changes the column through the same versioned PATCH endpoint. Retain the health label when moving. Disable the control while saving; move the summary after server confirmation.

Drag-and-drop may be added after the core flow passes verification. It must call the same move operation and retain the selector for keyboard and touch use. Manual ordering within columns is outside the first release.

Delete confirmation identifies the ticket and states that its comments will also be deleted. Handle a concurrently changed or already deleted card without losing the user's place on the board.

### Comments

Display oldest first with author avatar/name, creation time, and an edited indicator when timestamps differ. All three users can read/add comments; show Edit/Delete controls only when the signed-in user's ID matches the comment's author ID. The API must independently enforce that rule. Handle `403` without changing the thread or discarding an unsaved draft. Preserve original attribution on edits and do not imply there is an edit-history feature.

Provide explicit Save/Cancel controls for editing, confirmation for deletion, text length feedback, and a clear message at the proposed 200-comment limit. A successful comment operation updates the detail view and board comment count/version from the returned card.

Render descriptions and comments as plain text; preserve line breaks and never inject user HTML.

## Synchronization and resilience

Poll every 15 seconds while the document is visible; pause in background tabs and refresh on focus. Refresh after successful local mutations. Cancel outdated requests when filters change and prevent overlapping polls. For each column, preserve the amount of loaded data when refreshing; do not silently collapse it to the first page.

Refresh open details when there are no unsaved edits. When a form has unsaved edits, preserve its values and original version and show a “Newer changes available” notice if polling detects a version change. Let explicit user action resolve the difference.

Keep the last successful board visible after a network error and show a retry control with a stale-data notice. Pause polling after authentication failure. For a timed-out write, indicate that the result is uncertain and reload server state before offering a retry.

## Accessibility and visual checks

- Use semantic headings, labeled controls, visible focus styles, and sufficient contrast.
- Pair health colors with words; color alone must never convey status.
- Support full keyboard use, Escape to close dialogs, focus containment, and focus return to the triggering card.
- Give avatars useful accessible names without repeating adjacent names unnecessarily.
- Announce save/move/error results without interrupting typing; respect reduced-motion preferences.
- Check desktop and narrow mobile layouts, long titles, empty descriptions, unassigned cards, and multiple assignees.
