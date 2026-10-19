# Delivery and verification plan

## Milestone 1: runnable foundation

- Create `backend/`, `frontend/`, and `infra/` with minimal project configuration and committed dependency lockfiles.
- Add a local Compose setup for MongoDB, a persistent data volume, and an example environment file containing placeholders only.
- Configure FastAPI startup/shutdown, validated settings, indexes, readiness checks, and the Astro shell/development API proxy.
- Add the Cloudflare Worker proxy and Wrangler configuration for Astro static assets. Verify local routing through Wrangler before production deployment.
- Extend `.gitignore` for Node/Astro output, local environment overrides, database dumps, and generated test artifacts. Keep example configuration and lockfiles tracked.
- Document setup/run commands for PowerShell as well as environment variables and required runtimes.

Acceptance: a fresh checkout can start the frontend, API, and database using documented commands; readiness fails clearly when the database is unavailable.

## Milestone 2: fixed accounts and login

- Implement idempotent account seeding, bundled avatar placeholders, password hashing, session storage, authentication dependencies, and the user-list API.
- Add login/logout UI, origin and CSRF protection, bounded login throttling, and the password-rotation operator command.
- Verify session expiry explicitly rather than relying on MongoDB's cleanup timing.

Acceptance: each of the three accounts can sign in and out; unauthenticated requests cannot read or mutate board data; no account-management UI or API exists.

## Milestone 3: persistent shared board

- Implement card schemas, ticket counter, summary/detail queries, versioned mutations, and validation.
- Build columns, card summaries, create/edit/details forms, assignee/tag controls, movement, and deletion confirmation.
- Add per-column pagination and the specified search/filters.

Acceptance: two signed-in browsers see persistent changes; concurrent creates receive unique ticket numbers; a stale edit or delete returns a visible conflict instead of losing newer data. Cards survive service/database restarts with the persistent volume intact.

## Milestone 4: comments and collaboration behavior

- Implement embedded comment creation/edit/deletion, author-only edit/delete authorization, and the atomic comment-count cap.
- Add comments UI, periodic refresh, window-focus refresh, unsaved-draft protection, and expired-session handling.
- Complete keyboard, mobile, loading, empty, and network-error states.
- Add drag-and-drop only if the required flows are already complete.

Acceptance: Chris, Sean, and James can manage the same ticket and add to its discussion in separate sessions, but cannot edit or individually delete another person's comments. Polling reveals changes without destroying a draft, and a conflicting comment operation is recoverable.

## Milestone 5: deploy and hand off

- Follow the [Cloudflare deployment plan](05-cloudflare-deployment.md): deploy Astro assets and the API proxy with Wrangler, provision one FastAPI service on the recommended Render host, and connect it to MongoDB Atlas.
- Route `/api` to FastAPI over HTTPS while preserving the frontend origin, cookies, CSRF header, and response status. Keep API responses out of caches.
- Configure an Atlas database user and allowlist the backend's outbound IP ranges. Store the MongoDB URI and account credentials only in backend secrets; keep the Worker-to-backend proxy secret in both providers' secret stores.
- Configure production cookies, allowed origin, authenticated proxy forwarding, health checks, and isolated preview/development settings.
- Add structured request/error logs without credentials or card/comment bodies. Cloudflare and backend service logs plus health checks are enough initially.
- Configure backups for the selected Atlas tier and document its actual restore guarantees. Target daily backups with seven daily and four weekly retention; if that policy is unavailable, use an encrypted scheduled logical backup stored separately. Quiesce application writes during logical dumps so counters and cards remain consistent.
- Restore a backup into an isolated database and verify users, cards, comments, and subsequent ticket allocation. Restarting from a backup may lose changes since that backup; communicate the daily recovery window.
- Document deployment, restart, password rotation, backup/restore, and rollback. Before schema changes, back up data and confirm the previous release remains compatible or document the required restore.

Acceptance: all three users can access the Cloudflare URL, log in with their assigned credentials, complete the core workflow, and return after a backend redeployment without losing stored work in Atlas. Deployment requires backend/database provider selection, the frontend hostname, and secrets to be supplied.

## Verification strategy

Use backend integration tests against a disposable real MongoDB database for behavior that depends on atomic updates or indexes. Never point tests at the deployed database. Keep UI end-to-end tests focused on user journeys rather than testing every component in isolation.

| Area | Required checks |
| --- | --- |
| Accounts | Seeding twice preserves identities/passwords; unknown users fail; account data cannot be edited through API payloads |
| Authentication | Correct/incorrect passwords, protected routes, login throttling, logout revocation, expiry even before TTL cleanup, CSRF/origin rejection |
| Cards | Defaults, editable fields, validation limits, invalid assignees/enums, read-only field rejection, persistence and deletion |
| Ticket allocation | Concurrent creates get distinct increasing numbers; deletions and failures do not recycle numbers |
| Concurrency | Two writes with the same version yield one success and one conflict; cover edits, moves, deletion, and comment mutations |
| Comments | Author can edit/delete own comment; another user gets `403` with no data/version change; spoofed authors and nested comment replacement are rejected; immutable author/creation time, updated parent version, card deletion removes comments, concurrent requests cannot exceed the cap |
| Queries | Filter combinations, literal search characters, ticket search, pagination without duplicate records on unchanged data, accurate filtered counts |
| Browser workflows | Login, create, assign, tag, move, comment, edit, delete, logout; repeat with multiple authenticated browser contexts and check that other authors' comment controls are absent |
| Recovery | Failed reads/writes, uncertain write outcome, stale versions, deleted open card, expired session, drafts preserved during polling |
| Usability | Keyboard flow, focus management, readable status labels, mobile scrolling, long text, empty states |
| Operations | Fresh setup, Wrangler preview/build, production proxy login/logout and cookie forwarding, no API caching, direct-origin rejection, redeploy persistence, isolated backup restore, no secrets in generated client assets |

Automate Python formatting/linting and backend tests, TypeScript/Astro checks, frontend production build, and the core browser journey in CI. Run concurrent-writer and backup-restore checks before the first deployment. Three simultaneous sessions are the relevant collaboration target; distributed load testing is unnecessary at this stage.

## Completion checklist

- [ ] Every field and column in the original rough draft is represented.
- [ ] The three fixed accounts and pictures work, with secrets outside source control.
- [ ] Card and comment CRUD persists and reports conflicts clearly.
- [ ] Search, filters, periodic refresh, and keyboard/mobile interactions work.
- [ ] Automated checks pass and the three-session workflow has been exercised.
- [ ] Deployment and backup restoration have been verified and documented.
- [ ] The project README explains how to run and operate the finished application.

These checkboxes describe future implementation work; creating these planning documents does not mark them complete.
