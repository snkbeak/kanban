# Next steps

Updated October 21, 2026. This is the active checklist for work remaining after backend CRUD delivery. The confirmed decisions and implementation resolutions in [06-backend-crud.md](06-backend-crud.md) are authoritative. API examples and setup commands are in [backend/README.md](../backend/README.md).

## Completed baseline

- Username is the account primary key; public users contain username only.
- Cookie/JWT authentication, revocable tokens, account creation/password reset, and read-only account listing are implemented.
- Login throttling is implemented: configurable MongoDB allowances of 5 per canonical username per 15 minutes and 30 shared per 5 minutes, before password verification; both login screens explain retry time. Strict Origin/CSRF validation and frontend recovery messaging are also implemented; deployment remains pending.
- Card/comment CRUD, persistent ordering, version preconditions, Blocked health rules, comment ownership, the 20-comment cap, and health endpoints are implemented.
- Verification recorded at backend delivery: 78 contract tests and 13 real Atlas integration tests passed, plus Ruff lint/format checks.
- Atlas connectivity was verified using disposable test databases, which were removed. Application accounts/data were not provisioned or reset.
- Frontend API integration is implemented: typed same-origin requests, login/session recovery/logout, full-board/users loading, card/comment CRUD, selector moves and drag ordering, local filters, independent revision merging, polling, and retained drafts. The existing Astro design and Cloudflare static-asset configuration are preserved.
- Frontend verification on October 20: 9 API/state tests and 12 isolated Chromium browser journeys passed. Astro/TypeScript checks and production build pass. Browser fixtures do not connect to Atlas; live application/proxy acceptance remains below.
- Live local verification on October 20: two Chromium journeys passed against FastAPI and the local `kanban_dev` replica set through Astro's `/api` proxy. All three local accounts can log in, restore sessions, and log out. This is real database acceptance, **not Atlas or production acceptance**.

## 1. Finish application setup

Latest setup audit (October 20, 2026): the initial missing database/short JWT secret blockers were resolved by the user's local environment update. Effective settings select a loopback MongoDB replica set, explicit `MONGO_DB=kanban_dev`, a JWT secret passing validation, and `COOKIE_SECURE=false`. `MONGO_URL` takes precedence; the production `MONGODB_URI` was not contacted. After confirming the new local database had no accounts/cards, the user explicitly authorized one-time local account creation. A one-off transactional insert created `chris`, `sean`, and `james`, refused existing accounts, and saved random passwords to ignored `frontend/.env.live`. No application seed code, password reset, database reset, or deployment was added/performed. Browser logout revoked only the verification sessions. Production provisioning remains the user's responsibility.

- [x] Configure a valid `JWT_SECRET` and explicitly select `MONGO_DB` in the local/backend environment. User supplied the secret; its value was not printed or replaced by the agent.
- [x] Select the development `MONGO_URL`; keep credentials outside source control. `MONGO_URL` takes precedence over the retained production `MONGODB_URI`.
- [x] Create `chris`, `sean`, and `james` once in local `kanban_dev` with explicit user authorization. The existing operator command resets passwords/revokes tokens when repeated; do not run it as an automatic startup seed. Production accounts remain unprovisioned by this work.
- [x] Start FastAPI and verify readiness and all three account logins against local `kanban_dev`, including through Astro's proxy.
- [x] Confirm the newly created local database has no legacy accounts. No reset was needed or performed; Atlas and unrelated databases were not touched.
- [x] Retain initials keyed by canonical username until bundled pictures are available.

Done when the intended accounts can log in to the application database and the app can persist a card. Test fixtures do not satisfy account provisioning.

## 2. Connect the frontend to the API

Implementation follows [03-frontend.md](03-frontend.md). Setup and repeatable checks are in [frontend/README.md](../frontend/README.md).

- [x] Add a typed API client and same-origin development `/api` routing.
- [x] Connect login, current-user restoration, logout, and expired-session handling.
- [x] Replace sample data with `GET /api/users` and the full `GET /api/cards` board response.
- [x] Implement card create/edit/delete and comments with the confirmed field limits, one required tag, username references, and author-only individual comment controls.
- [x] Persist selector moves and drag-and-drop with `POST /api/cards/{id}/move`, card version, and source/destination ordering revisions.
- [x] Make selectors append to another column and disable the current option. Use drag-and-drop for within-column ordering; disable reordering while filters hide cards.
- [x] Enforce Blocked health behavior in the UI, including direct creation in Blocked and preserving blocked health after leaving.
- [x] Implement search, assignee/tag/health/difficulty filters, and filtered/total counts locally over the complete fetched dataset. All matching cards are displayed; no pagination is needed.
- [ ] Demonstrate the browser workflow against the deliberately provisioned FastAPI/Atlas application database, including reload persistence. The isolated browser tests verify requests/UI behavior, not this live acceptance gate.
- [x] Demonstrate card/comment CRUD, moves, conflicts, recovery, and content/discussion/order reload persistence against the user-selected **local** FastAPI/MongoDB replica set. Atlas acceptance above remains open.

Done when a signed-in browser can complete the card/comment workflow and a reload preserves content and ordering. There are no new backend query or account-management endpoints to build.

## 3. Add collaboration and recovery behavior

- [x] Refresh while visible and on focus; use 15 seconds as the initial polling interval and prevent overlapping refreshes.
- [x] Preserve unsaved content/comment drafts through refreshes, network failures, and version conflicts.
- [x] Merge card content by `version`, discussion by `comments_version`, and ordering by column revisions. Refresh the whole board after ordering changes; invalidate pre-write refreshes and retain local deletion tombstones.
- [x] Show explicit refresh/reapply choices for stale writes; never automatically overwrite another user's save.
- [x] Handle loading, empty results, validation errors, forbidden comment changes, deleted resources, session expiry, and database/proxy failures.
- [x] After an uncertain mutation response, refresh before offering a deliberate retry. Do not automatically replay create/comment requests.
- [x] Repeat collaboration acceptance with independent authenticated browser sessions against live local FastAPI/MongoDB, including real stale content/comment/order responses. Atlas/production repetition remains pending.
- [x] Add a separate opt-in live browser harness (`npm run test:live`); require two existing accounts and real readiness through the development proxy, with no account seeding or fixture responses. Both live journeys pass locally.

Drafts are held only in tab memory, including closed editors and same-account reauthentication. Browser navigation/reload, explicit logout, and switching accounts discard drafts. Local writes are serialized; a failed required refresh blocks more writes until recovery. Reapplying content keeps only the user's changed fields over the latest record and still requires Save. The earlier frontend implementation did not provision accounts; this follow-up deliberately provisioned only local accounts after user authorization.

Done when two browser sessions see each other's updates without losing drafts or regressing state from late responses.

### Latest focused verification and remaining live checks

- Rechecked 78 backend contract tests and 9 frontend API/state tests: passed. Astro/TypeScript checks passed. The contract run still reports the upstream Starlette/HTTPX deprecation warning and a sandbox pytest-cache permission warning; assertions pass. Node's initial sandbox `spawn EPERM` was resolved by the approved rerun.
- The earlier 12 fixture browser tests, frontend build, and 13 Atlas integration tests remain historical results; they were not rerun during this follow-up. No live acceptance result is inferred from them.
- The live opt-in prerequisite fails safely when configuration is absent. With the authorized local setup, both journeys passed (each run once): login/HttpOnly cookies, content/order conflicts, retained drafts through polling/offline/revoked-session recovery, independent discussion updates, selector/Blocked behavior, drag order, and reload persistence; then author-only comment changes, stale comment edits, committed-but-lost response recovery without automatic replay, the 20-comment cap/slot reuse, and guarded whole-card deletion after another session's discussion update. All three account login/me/logout cycles also passed through the proxy.
- Only three marked acceptance tickets were created and removed using guarded deletes. Final local audit: three accounts retained, zero cards, zero test session tokens, ticket counter at 3 (not reset). Other data was not reset. Credentials remain in ignored `frontend/.env.live`; see [live check instructions](../frontend/README.md#live-fastapiatlas-acceptance).
- Astro initially returned a route-manifest 500 after dependency reoptimization. The documented stop/start recovered it; a real unauthenticated browser then reached login with no page errors. FastAPI readiness and proxied readiness returned 200; unauthenticated `/auth/me` returned 401. No frontend design or application behavior changes were necessary.
- Still pending: Atlas/production application acceptance, backend restart/redeploy persistence, live mobile/keyboard usability, and additional concurrent comment-deletion edge cases. Implemented throttling and origin/CSRF are detailed in `07-auth-follow-up.md`.

## 4. Deploy the complete application

Follow [05-cloudflare-deployment.md](05-cloudflare-deployment.md).

- [ ] Choose the Python backend host/tier. Render remains an option, not a confirmed deployment.
- [ ] Configure the backend's application secrets, explicit database, `APP_ENV=production`, `COOKIE_SECURE=true`, exact HTTPS `TRUSTED_ORIGINS`, Atlas access, and readiness probe.
- [ ] Add the Cloudflare Worker `/api` proxy alongside the existing static assets and preserve the configured `kanban.sneakybeak.net` hostname.
- [ ] Verify unchanged browser Origin forwarding (never synthesize trusted Origin), cookie forwarding, API error/status/Retry-After preservation, disabled API caching, and bounded proxy timeouts.
- [ ] Decide and implement backend-origin access controls as deployment work; proxy-secret validation does not exist in the current backend.
- [ ] Keep preview/test data and accounts separate from application data.
- [ ] Deploy and verify the full browser flow through the public hostname.

Done when the public frontend uses the hosted backend and Atlas, with persistent data across backend redeploys.

## 5. Complete release verification and operations

- [x] Add isolated browser tests for login, card/comment CRUD, selector moves, drag-and-drop ordering, logout, stale content/comment/order revisions, comment ownership/cap, guarded deletion, session expiry, uncertain writes, and mobile dialog/focus behavior.
- [x] Exercise multiple users, conflicting edits/moves, independent discussion updates, comment ownership, the 20-comment limit, and guarded whole-card deletion against local FastAPI/MongoDB. Repeat for production release acceptance.
- [ ] Check mobile layout, keyboard operation, focus behavior, status labels, long text, and empty/error states. Keep the selector available for column movement without a pointer; do not add a separate within-column ordering control.
- [ ] Add CI for backend lint/format/tests, TypeScript/Astro checks, frontend build, and core browser tests. CI must explicitly configure disposable MongoDB so integration tests do not silently skip.
- [ ] Decide how to make release dependency resolution reproducible; the current repository ignores `uv.lock`. Do not assume a committed backend lockfile or Dockerfile exists.
- [ ] Configure a backup policy appropriate to the selected Atlas tier and perform an isolated restore, including cards, comments, username accounts, counters, and ordering metadata.
- [ ] Document start/redeploy, password rotation, secret rotation, recovery, and rollback.
- [ ] Resolve the upstream Starlette TestClient/HTTPX deprecation warning during test dependency maintenance; it did not prevent the verified tests from passing.

Done when the multi-user browser workflow, deployment persistence, and backup recovery have been demonstrated.

## Separate authentication follow-up

- [x] Implement configurable, persistent, atomic MongoDB login throttling and frontend `429`/retry-time handling. [Policy/settings](../backend/README.md#login-throttling): all attempts count, global reservations are retained on later rejection, fixed cooldowns never extend on rejection, and database failure returns generic `503` before credential work. No client address or forwarding header selects an allowance.
- [x] Verify backend contracts and real concurrent requests against disposable local MongoDB databases: **119 passed, none skipped** (99 contract/unit + 20 integration). Ruff lint/format checks passed. The upstream Starlette/HTTPX deprecation warning remains. Atlas and live application accounts were not used; no provisioning, reset, or deployment occurred.
- [x] Verify frontend throttling: **11 API/state tests, 14 isolated Chromium journeys, Astro/TypeScript checks, and production build passed**; none skipped. Both login forms show retry guidance, clear passwords, and require explicit retry. The browser clock advances deterministically. Node's sandbox `spawn EPERM` was resolved by an approved rerun.
- [ ] Resolve Astro dev-server route-loading 500s as separate maintenance. The October 21 browser run initially failed before application scripts loaded; stop/start did not recover it. All 14 journeys passed against the built site's local `astro preview` instead. No live API proxy/production acceptance is inferred from fixture results.
- [x] Implement strict Origin/CSRF protection and its frontend contract, tracked in [07-auth-follow-up.md](07-auth-follow-up.md). All unsafe methods require one exact configured Origin; missing/null/malformed/duplicate values fail with `403 csrf_rejected` before any allowance, credential, session or data change. No Referer fallback or CSRF tokens. Frontend failures preserve drafts/sessions and require explicit retry.
- [x] Verify Origin/CSRF: **215 backend tests passed, none skipped** (192 contract/unit + 23 real disposable local MongoDB integration tests), with Ruff lint/format checks passing. Database snapshots establish no changes on rejection; existing auth/throttling/CRUD pass. Upstream Starlette/HTTPX warning remains.
- [x] Verify frontend Origin recovery: **12 API/state tests and all 17 isolated Chromium journeys passed**, plus Astro/TypeScript checks and production build. The initial browser run passed 16/17; the remaining success-message expectation was corrected and passed in a focused rerun. Approved reruns resolved Node/Playwright sandbox worker `EPERM`. Fixtures used built static preview on port 4321 and assert browser Origin on every mutation. No live API proxy or production acceptance is claimed. The live harness now supplies explicit Origin on non-browser requests but was not run; application accounts/data were not touched.
- [ ] Complete authenticated Cloudflare proxy/backend-origin protection and production acceptance. Shared limits work now; one attacker can temporarily deny new logins. Only add address-specific trust after authenticating the proxy and preventing origin bypass. Preserve `429`, `Retry-After`, cookies, and API error envelopes without caching.
