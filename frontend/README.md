# Kanban frontend

Astro frontend configured for Cloudflare Workers Static Assets at
`https://kanban.sneakybeak.net`, deployed with Wrangler. The Worker name is
`kanban-sneakybeak-net`. Only the subdomain is configured; the root domain's
existing site is separate.

The board uses the FastAPI contract for cookie authentication, users, cards,
comments, and manual ordering. Astro still emits static assets; browser code
loads the complete board and applies search/filter/counts locally. The production
Cloudflare `/api` proxy and backend hosting remain pending in
[the deployment plan](../.agent/05-cloudflare-deployment.md).

## Local development

Use Node.js 22.22.0 or newer. From the repository root:

```powershell
cd frontend
npm ci
npm run dev -- --background
```

Manage the Astro background server with `npm run astro -- dev status`,
`npm run astro -- dev logs`, and `npm run astro -- dev stop`.

Start FastAPI separately using [backend setup](../backend/README.md). Development
requests to `/api` proxy to `http://127.0.0.1:8000` with the same path and cookies.
To select another development backend, set `$env:API_ORIGIN = 'http://127.0.0.1:8001'`
before starting Astro. This is a server-side process variable, not a browser URL
or a MongoDB setting. Use `COOKIE_SECURE=false` and `APP_ENV=development` for local HTTP. The backend defaults trust browser origins `http://localhost:4321` and `http://127.0.0.1:4321`; explicitly update `TRUSTED_ORIGINS` for another port. `API_ORIGIN` does not configure browser trust. No frontend command
creates accounts or changes application secrets.

The Astro 7.4 Windows development runner required explicit pre-bundling of
`picomatch`, `yaml`, and `p-queue` to load the server correctly. The targeted
configuration follows [Astro's dependency optimizer reference](https://github.com/withastro/astro/blob/main/reference/optimize-deps.md).
Recheck this workaround when upgrading Astro/Vite. After changing this setting,
stop/start the dev server if its old failed route manifest remains cached.

## Board behavior

The existing card/column design is retained. Expand a ticket for its column
selector or open **Edit / discuss**. Create requires a title and one tag; accounts
and initials use canonical usernames. Selectors append to another column;
drag-and-drop chooses a position, including within the same column. Dragging is
disabled when filters hide any cards. Entering Blocked locks health to Blocked;
leaving retains that health until a deliberate content edit.

The board refreshes every 15 seconds while visible and on focus, with one refresh
in flight. Local writes are serialized. Content, discussion, and order revisions
are tracked independently. Refreshes retain open content/comment drafts and their
original preconditions. A stale draft offers the latest saved values and explicit
load/reapply actions; reapplying still requires Save. Moves do not silently rebase
an open content draft. Individual comment controls belong to their author;
whole-card deletion confirms removal of everyone's comments and guards both revisions.

Drafts live only in this tab's memory, including closed editors and same-account
session recovery. They are not persisted across a browser reload, navigation,
explicit logout, or login as another account. JWTs and passwords are never stored
in browser storage. After an uncertain write, editing stays blocked until a
successful refresh; inspect the result before explicitly authorizing another
write. Creates/comments are never automatically retried.

Both the login page and the expired-session dialog explain `429` throttling using
`Retry-After`: they show the wait in seconds and a local retry time. If the header
is missing or invalid, they ask the user to wait a few minutes. A `503` explains
that login is temporarily unavailable. Password fields clear after every submitted
attempt; credentials are never retained in persistent browser storage. There are
no automatic login replays or timer-triggered retries; the user must submit again.
Retry time is guidance, not a reservation; other traffic may exhaust the allowance.
The default backend policy is 5 attempts per canonical username per 15 minutes
and 30 shared across everyone per 5 minutes, counting successes and failures.
See [backend policy and settings](../backend/README.md#login-throttling).
Origin/CSRF protection uses an exact backend allowlist on every unsafe request,
including login and logout. The shared client uses same-origin fetch mode and
credentials; the browser supplies Origin automatically. No CSRF token, extra
cookie, browser storage, or manual Origin header is needed. Missing, malformed,
null, duplicate and untrusted origins return `403 csrf_rejected`; Referer is not
a fallback. This error is distinct from comment ownership and explains that the
operator should check the site URL, allowlist and proxy, then the user can retry
explicitly. Both login forms clear passwords. Board and failed logout requests
retain content/comment drafts and the session, without automatic replay. Keep
the tab open during configuration repair; page reload/navigation still loses
in-memory drafts. See the [complete policy and production settings](../backend/README.md#origin--csrf-protection).

The future Worker must preserve the browser Origin unchanged, never synthesize
it, and preserve cookies, error envelopes, statuses and Retry-After without API
caching. Strict Origin checks do not authenticate this proxy or prevent direct
backend access. Deployment, proxy authentication/backend-origin protection and
production acceptance remain pending.

## Focused checks

From `frontend/`:

```powershell
npm run check
npm test
npm run build
npx playwright install chromium
npm run dev -- --background --host 127.0.0.1 --port 4321
npm run test:browser -- --workers=2
npm run astro -- dev stop
```

The browser suite intercepts `/api` with isolated HTTP fixtures. It tests the real
page scripts, request payloads, reloads, conflict/recovery interactions, and mobile
dialog/focus behavior without reading secrets, provisioning users, or accessing
Atlas. It supplements the backend's contract/Atlas tests; it does not establish a
live FastAPI/Atlas browser session or production cookie/proxy behavior. Complete
those checks after deliberately selecting and provisioning the application database.

October 21 throttling verification: **11 API/state tests and 14 isolated Chromium
journeys passed; Astro/TypeScript checks and the production build passed**. Browser
coverage includes both login forms' retry guidance, clearing passwords, empty
browser storage, and explicit retries after advancing the test clock. No tests
were skipped. Node's sandbox `spawn EPERM` was resolved by an approved rerun.

The initial browser run failed because the Astro dev server returned route-loading
500s before application scripts loaded. Stop/start did not recover it this time.
All 14 tests subsequently passed against the built static site using
`npm run preview -- --host 127.0.0.1 --port 4321` (stop the dev server first).
This is valid for the intercepted HTTP fixtures, which do not need an API proxy;
it does not establish live proxy acceptance. The dev-server route issue remains
separate maintenance work. No live accounts, Atlas, or deployment were used.

Origin/CSRF verification on October 21: **12 API/state tests and all 17 isolated
Chromium journeys passed**, with no skips; Astro/TypeScript checks and production
build passed. Every fixture mutation asserts the real browser-generated Origin.
New journeys cover both login forms, explicit recovery, password clearing, empty
browser storage, content/comment draft retention and rejected logout without
session loss or replay. The initial browser run passed 16/17; the remaining test
had a case-sensitive success-message expectation, corrected before its passing
focused rerun. Node/Playwright worker `EPERM` failures were resolved by approved
reruns. Fixtures ran against built `astro preview` on port 4321, not the broken
dev runner; this establishes neither live API-proxy nor production acceptance.
The opt-in live harness now explicitly supplies Origin on its non-browser HTTP
mutations; it was **not run** against application accounts/data in this change.

## Live FastAPI/Atlas acceptance

The separate `npm run test:live` command uses real HTTP requests through the local
Astro proxy at `http://127.0.0.1:4321`. It does not start services or seed/reset
accounts. First set an explicit `MONGO_DB` and a valid random `JWT_SECRET` in the
backend environment, start FastAPI and Astro, and verify readiness. Preserve any
existing secret unless deliberately rotating it. Repeating `app.create_user`
resets that user's password and revokes sessions; provision accounts manually only
when intended. The October 20 setup blockers were resolved by the user's environment
update and explicitly authorized one-time local account creation. No account seed
was added to application startup. Keep production provisioning manual.

Provide credentials for **two different existing accounts** using process
environment variables or a local, gitignored `frontend/.env.live` file:

```dotenv
KANBAN_LIVE=1
KANBAN_LIVE_USER_A=chris
KANBAN_LIVE_PASSWORD_A=<existing password, supplied locally>
KANBAN_LIVE_USER_B=sean
KANBAN_LIVE_PASSWORD_B=<existing password, supplied locally>
```

Replace the password placeholders locally; do not paste secrets into chat, commit
the file, or copy backend secrets into it. The deliberately created local accounts
use A=chris, B=sean, and C=james in this ignored file; the browser suite uses A/B.
Then, from `frontend/`, run:

```powershell
npm run test:live
```

Missing opt-in/credentials or failed readiness is a failing prerequisite, not a
skipped/passing acceptance result. The runner uses one worker, no retries, and no
saved traces, screenshots, or video. Keep diagnostic logging disabled when using
real credentials. No deployment or remote URL is selected by this command.

The two journeys create three uniquely tagged acceptance tickets and use independent
browser contexts to exercise login/cookies, content and ordering conflicts,
retained content/comment drafts, offline and revoked-session recovery, independent
discussion updates, Blocked/selector moves, drag ordering, and reload persistence.
They also cover comment ownership and stale edits, the 20-comment cap and slot
reuse, guarded whole-card deletion, and a committed comment whose HTTP response is
lost without automatically replaying the write.
Conflict timing is controlled by forwarding a paused request after a second real
session writes; responses come from FastAPI, never HTTP fixtures. Cleanup deletes
only those known run-owned tickets with both version guards and logs out only the
test sessions. Ticket numbers and ordering revisions advance normally; they are
never restored/reset. If interrupted or cleanup fails, inspect the reported run
marker/card IDs before manually removing leftover acceptance tickets.

Both live journeys passed on October 20, 2026 against local `kanban_dev`, alongside
all three account login/me/logout checks. Their three tickets were removed; the
accounts remain and the ticket counter is 3. This does **not** establish Atlas or
production acceptance: the selected development `MONGO_URL` is loopback, and the
production `MONGODB_URI` was not contacted. Production/restart persistence and
remaining release checks are tracked in [next steps](../.agent/next-steps.md).

## Cloudflare login

Run these commands inside `frontend/`. First check your existing authentication:

```powershell
npx wrangler whoami
```

Wrangler normally stores OAuth credentials in its global user configuration, so
a login from another repository under the same Windows user can already work
here. If `whoami` shows the correct account, skip login. If it says you are not
authenticated, open the browser login flow with:

```powershell
npx wrangler login
npx wrangler whoami
```

Choose the Cloudflare account that owns the active `sneakybeak.net` zone. If you
have multiple accounts, set the intended `account_id` in `wrangler.jsonc` before
deployment. An explicitly configured API token or authentication profile may
override the default browser login. See [Wrangler authentication commands](https://developers.cloudflare.com/workers/wrangler/commands/general/).

## Build and preview without publishing

```powershell
npm run build
npm run preview
```

To build and preview using Cloudflare's local runtime instead of Astro's preview
server:

```powershell
npm run preview:cloudflare
```

Stop either foreground preview with Ctrl+C. Neither preview publishes the site.

These static previews do not provide the development API proxy. Use `npm run dev`
for a working local API connection until the production Worker proxy is implemented.

## Deploy when ready

The following command builds Astro and then publishes to Cloudflare. Run it only
when you intend to deploy:

```powershell
npm run deploy
```

Wrangler uses `wrangler.jsonc` to upload `dist/` and attach the custom domain
`kanban.sneakybeak.net`. Cloudflare provisions the custom-domain DNS record and
certificate during setup. The domain must belong to an active zone in the same
account; resolve a conflicting record for that exact subdomain if Cloudflare
reports one. See [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

The configuration disables `workers.dev` and preview URLs, and matches your
other project's trailing-slash and 404 handling. Static output does not require
an Astro Cloudflare SSR adapter. See [Cloudflare's Astro guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/).

No deployment or DNS changes are performed by installing dependencies or editing
these files. Keep local secrets in ignored `.dev.vars` files; never put them in
`wrangler.jsonc` or browser-visible assets.
