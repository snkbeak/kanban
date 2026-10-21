# Next steps

Updated October 20, 2026. This is the active checklist for work remaining after backend CRUD delivery. The confirmed decisions and implementation resolutions in [06-backend-crud.md](06-backend-crud.md) are authoritative. API examples and setup commands are in [backend/README.md](../backend/README.md).

## Completed baseline

- Username is the account primary key; public users contain username only.
- Cookie/JWT authentication, revocable tokens, account creation/password reset, and read-only account listing are implemented.
- Card/comment CRUD, persistent ordering, version preconditions, Blocked health rules, comment ownership, the 20-comment cap, and health endpoints are implemented.
- Verification recorded at backend delivery: 78 contract tests and 13 real Atlas integration tests passed, plus Ruff lint/format checks.
- Atlas connectivity was verified using disposable test databases, which were removed. Application accounts/data were not provisioned or reset.
- Astro board/login scaffolds and Cloudflare static-asset configuration exist. The board still uses sample data; browser interactions do not persist through the API.

## 1. Finish application setup

- [ ] Add a random `JWT_SECRET` and explicitly select `MONGO_DB` in the local/backend environment.
- [ ] Use the existing complete `MONGODB_URI` or `MONGO_URL`; keep credentials outside source control. `MONGO_URL` takes precedence.
- [ ] Create `chris`, `sean`, and `james` with `python -m app.create_user <username>`. This command deliberately resets passwords and revokes tokens when repeated; do not run it as an automatic startup seed.
- [ ] Start FastAPI and verify readiness and account login against the selected application database.
- [ ] If legacy UUID-based development data exists, identify the exact disposable database before resetting it. A fresh database requires no reset. Do not reset the Atlas cluster or unrelated databases.
- [ ] Supply bundled pictures keyed by username, or retain initials until pictures are available.

Done when the intended accounts can log in to the application database and the app can persist a card. Test fixtures do not satisfy account provisioning.

## 2. Connect the frontend to the API

Follow [03-frontend.md](03-frontend.md); this is the next substantial implementation task.

- [ ] Add a typed API client and same-origin development `/api` routing.
- [ ] Connect login, current-user restoration, logout, and expired-session handling.
- [ ] Replace sample data with `GET /api/users` and the full `GET /api/cards` board response.
- [ ] Implement card create/edit/delete and comments with the confirmed field limits, one required tag, username references, and author-only individual comment controls.
- [ ] Persist selector moves and drag-and-drop with `POST /api/cards/{id}/move`, card version, and source/destination ordering revisions.
- [ ] Make selectors append to another column and disable the current option. Use drag-and-drop for within-column ordering; disable reordering while filters hide cards.
- [ ] Enforce Blocked health behavior in the UI, including direct creation in Blocked and preserving blocked health after leaving.
- [ ] Implement search, filters, counts, and any display pagination locally over the complete fetched dataset.

Done when a signed-in browser can complete the card/comment workflow and a reload preserves content and ordering. There are no new backend query or account-management endpoints to build.

## 3. Add collaboration and recovery behavior

- [ ] Refresh while visible and on focus; use 15 seconds as the initial polling interval and prevent overlapping refreshes.
- [ ] Preserve unsaved content/comment drafts through refreshes, network failures, and version conflicts.
- [ ] Merge card content by `version`, discussion by `comments_version`, and ordering by column revisions. Refresh the whole board after ordering changes.
- [ ] Show explicit refresh/reapply choices for stale writes; never automatically overwrite another user's save.
- [ ] Handle loading, empty results, validation errors, forbidden comment changes, deleted resources, session expiry, and database/proxy failures.
- [ ] After an uncertain mutation response, refresh before offering a deliberate retry. Do not automatically replay create/comment requests.

Done when two browser sessions see each other's updates without losing drafts or regressing state from late responses.

## 4. Deploy the complete application

Follow [05-cloudflare-deployment.md](05-cloudflare-deployment.md).

- [ ] Choose the Python backend host/tier. Render remains an option, not a confirmed deployment.
- [ ] Configure the backend's application secrets, explicit database, production cookies, Atlas access, and readiness probe.
- [ ] Add the Cloudflare Worker `/api` proxy alongside the existing static assets and preserve the configured `kanban.sneakybeak.net` hostname.
- [ ] Verify cookie forwarding, API error/status preservation, disabled API caching, and bounded proxy timeouts.
- [ ] Decide and implement backend-origin access controls as deployment work; proxy-secret validation does not exist in the current backend.
- [ ] Keep preview/test data and accounts separate from application data.
- [ ] Deploy and verify the full browser flow through the public hostname.

Done when the public frontend uses the hosted backend and Atlas, with persistent data across backend redeploys.

## 5. Complete release verification and operations

- [ ] Add browser tests for login, card/comment CRUD, selector moves, drag-and-drop ordering, and logout.
- [ ] Exercise multiple users, conflicting edits/moves, independent discussion updates, comment ownership, the 20-comment limit, and guarded whole-card deletion.
- [ ] Check mobile layout, keyboard operation, focus behavior, status labels, long text, and empty/error states. Keep the selector available for column movement without a pointer; do not add a separate within-column ordering control.
- [ ] Add CI for backend lint/format/tests, TypeScript/Astro checks, frontend build, and core browser tests. CI must explicitly configure disposable MongoDB so integration tests do not silently skip.
- [ ] Decide how to make release dependency resolution reproducible; the current repository ignores `uv.lock`. Do not assume a committed backend lockfile or Dockerfile exists.
- [ ] Configure a backup policy appropriate to the selected Atlas tier and perform an isolated restore, including cards, comments, username accounts, counters, and ordering metadata.
- [ ] Document start/redeploy, password rotation, secret rotation, recovery, and rollback.
- [ ] Resolve the upstream Starlette TestClient/HTTPX deprecation warning during test dependency maintenance; it did not prevent the verified tests from passing.

Done when the multi-user browser workflow, deployment persistence, and backup recovery have been demonstrated.

## Separate authentication follow-up

Login throttling and origin/CSRF protection remain tracked in [07-auth-follow-up.md](07-auth-follow-up.md), including their eventual frontend integration. They were excluded from backend CRUD delivery and are not assumed to exist in the current API. Their mechanism, configuration, and tests must be planned there; do not invent a CSRF token/header contract while wiring the current frontend.
