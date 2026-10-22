# Kanban API

FastAPI and PyMongo Async implement a shared board with cookie authentication, card and comment CRUD, manual ordering, and read-only accounts. Run commands from `backend/`.

## Setup

Requires Python 3.12+, uv, and MongoDB with transactions: a replica set (one local node is enough) or Atlas. Standalone `mongod` is rejected at startup. MongoDB is not installed by this project.

For a fresh local installation, these PowerShell commands assume `mongod` and `mongosh` are on PATH. Use separate terminals for the server and shell:

```powershell
New-Item -ItemType Directory -Force .mongo-data
mongod --dbpath .mongo-data --replSet rs0 --bind_ip localhost --port 27017
```

```powershell
mongosh 'mongodb://localhost:27017' --eval 'rs.initiate({_id: "rs0", members: [{_id: 0, host: "localhost:27017"}]})'
mongosh 'mongodb://localhost:27017/?replicaSet=rs0' --eval 'db.hello().isWritablePrimary'
```

Initialize once, then wait for `isWritablePrimary` to be true. On subsequent starts use the same data directory and `--replSet rs0`. An existing Windows MongoDB service needs equivalent `replication.replSetName: rs0` configuration; do not start a second server on its port. Linux/macOS use `mkdir -p .mongo-data` and the same MongoDB commands. Keep this unauthenticated local server bound to localhost.

```powershell
uv sync
Copy-Item .env.example .env
uv run python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Put the generated value into `.env` as `JWT_SECRET`. On Linux/macOS use `cp .env.example .env`. The example selects the explicit development database `kanban_dev`; the code's backward-compatible default is `kanban` if `MONGO_DB` is omitted.

For Atlas, a complete credential-bearing `MONGODB_URI` is accepted as an alias for `MONGO_URL`; `MONGO_URL` takes precedence if both exist. Separate `MONGODB_USERNAME`/`MONGODB_PASSWORD` values are not needed when credentials are already in the URI. Settings representations hide the URI and JWT secret. The current repository ignores `uv.lock`; `uv sync` generates/resolves it locally.

Create accounts, each prompting for an 8–256 character password, then start the API:

```powershell
uv run python -m app.create_user chris
uv run python -m app.create_user sean
uv run python -m app.create_user james
uv run uvicorn app.main:create_app --factory --reload
```

API: <http://127.0.0.1:8000/api>. Interactive OpenAPI: <http://127.0.0.1:8000/docs>.

| Setting | Default | Meaning |
| --- | --- | --- |
| `JWT_SECRET` | required | At least 32 characters; use a random secret |
| `MONGO_URL` | `mongodb://localhost:27017` | Replica-set URI or Atlas URI |
| `MONGO_DB` | `kanban` | Explicit database name; example uses `kanban_dev` |
| `COOKIE_SECURE` | `false` | Set true over HTTPS |
| `APP_ENV` | `development` | Set `production` explicitly for deployment; requires secure cookies and explicit HTTPS origins |
| `TRUSTED_ORIGINS` | `["http://localhost:4321","http://127.0.0.1:4321"]` | JSON array of exact serialized browser origins; see policy below |
| `TOKEN_DAYS` | `7` | JWT/cookie lifetime in days |
| `LOGIN_USERNAME_LIMIT` | `5` | Attempts per canonical username per window; integer 1–10,000 |
| `LOGIN_USERNAME_WINDOW_SECONDS` | `900` | Username window; integer 1–86,400 seconds |
| `LOGIN_GLOBAL_LIMIT` | `30` | Attempts shared across all clients/usernames per window; integer 1–10,000 |
| `LOGIN_GLOBAL_WINDOW_SECONDS` | `300` | Shared window; integer 1–86,400 seconds |

## Login throttling

After Origin validation, every schema-valid login reserves an allowance **before account lookup and Argon2 verification**. The default is 5 attempts per canonical username per 15 minutes, plus 30 across the entire application per 5 minutes. This permits ordinary logins and typos for three users while bounding both targeted guessing and attempts spread across usernames. Limits cannot be disabled with zero. Invalid request bodies return the existing `422` without consuming allowances or checking credentials.

The `login_limits` collection stores a single `global` key and `username:<SHA-256 of canonical username>` keys. Trimming/lowercasing happens through the existing login schema before key construction. Existing and nonexistent accounts use the same policy, with the same generic invalid-credential response and dummy password verification for admitted unknown accounts. Hashing avoids raw usernames in keys; it is not anonymization of easily guessed usernames. No passwords, JWTs, or addresses are stored in these records.

Each key has a fixed window starting with its first reservation. Exactly the configured number of attempts can proceed within that window. Once exhausted, it rejects until its stored expiry; denied requests do not extend that expiry. Successes and failures count equally and success never resets a counter. The global reservation happens first; if the username reservation rejects or a subsequent database/token operation fails, the global slot is **not refunded**. A globally rejected request never creates a username record. The two reservations are intentionally conservative, not one transaction: partial reservations can reduce availability, but cannot grant extra attempts.

Each reservation uses one atomic MongoDB `find_one_and_update` aggregation pipeline with a unique `_id`, capped counter, MongoDB `$$NOW`, and majority acknowledgement. Concurrent requests and independent processes share the same durable counters. The MongoDB server clock governs expiry; keep database clocks synchronized. Expired records reset in the update itself. The TTL index on `expires_at` is only eventual storage cleanup; delayed cleanup does not prolong cooldowns. The global-first policy also bounds new username-record creation per window, though prolonged TTL-monitor failure can still grow storage. See [MongoDB update pipelines](https://www.mongodb.com/docs/manual/tutorial/update-documents-with-aggregation-pipeline/).

Exhaustion returns `429` with the normal envelope, code `login_throttled`, and a positive integer `Retry-After` in seconds, rounded up from the rejecting key's remaining window. It does not disclose which key rejected. This is the earliest useful retry for that rejection, not a reserved future slot: another key or intervening traffic may still reject a later request. It never issues a token or cookie. A rate-limit store failure or timeout fails closed with the existing generic `503 database_unavailable`, without account lookup/password verification/token issuance. Reservations have a five-second database-operation deadline. There is no in-memory fallback; an ambiguous write may conservatively consume a slot. No connection details are exposed.

Client-address policy: **no address is used as an authorization or throttling key**. Neither socket addresses nor `Forwarded`, `X-Forwarded-For`, `X-Real-IP`, or `CF-Connecting-IP` can select another allowance. All clients share the global bucket even if an ASGI server rewrites the peer address. This is safe for the current direct/local-proxy deployment and protects against distributed guessing, but one caller can exhaust a username or the shared allowance and temporarily deny legitimate logins. Existing sessions, `/me`, logout, and CRUD are unaffected. Fixed windows permit bursts around boundaries; this is not a general HTTP/DDoS or concurrent Argon2 resource limiter.

The future Cloudflare Worker and backend-origin protection remain **pending**. Authenticate the proxy at the backend and prevent direct origin bypass before introducing any per-client-address policy. The Worker must overwrite caller-supplied forwarding headers with its authoritative address, and backend server/proxy middleware must trust only that authenticated path. Keep username/global protection if an additional address bucket is added. Preserve `429`, `Retry-After`, cookies, and error envelopes and disable API caching. Proxy authentication remains pending; the Origin policy below is enforced independently.

Use identical settings and the same application database on every backend process; separate test/preview databases. Window changes take effect on the next window for existing records; limit changes apply on the next attempt. Deploy configuration changes consistently. Startup creates the TTL index idempotently. Restarts do not reset counters; do not clear the collection as a routine recovery step. Monitor generic `429`/`503` counts without logging request bodies, passwords, JWTs, or credential-bearing database URLs.

## Origin / CSRF protection

Cookie authentication uses **strict, fail-closed Origin validation**, independent of SameSite cookies. Every HTTP method except `GET`, `HEAD`, and `OPTIONS` requires exactly one `Origin` header whose complete value equals an entry in `TRUSTED_ORIGINS`. The middleware covers every path, including login, logout, POST/PATCH/DELETE CRUD, unsupported methods, and router redirects, before reading bodies or invoking route dependencies. Safe methods retain existing routing/authentication behavior; no GET login, logout, or mutation endpoint is added. OPTIONS is not a bypass for a subsequent mutation and no CORS access is enabled.

Missing/empty, opaque `null`, malformed, duplicate (even identical), comma/space-separated, or untrusted Origin values return **403 `csrf_rejected`** in the existing error envelope, with `Cache-Control: no-store`. There is **no Referer fallback** or exemption for non-browser clients. Rejection precedes credential checks, login allowance reservations, token creation/revocation, cookie changes, and application writes. It leaves existing sessions/data intact and returns no submitted values. Once the Origin is accepted, existing validation/authentication/throttling/CRUD contracts apply, including generic invalid credentials and `429` with `Retry-After`.

This application supports same-origin browser fetch mutations, which supply Origin automatically. Failing closed when it is absent avoids a second proof mechanism. We therefore do **not** add CSRF tokens, extra cookies, token storage, rotation, or tab synchronization. Login needs the same check even before a session exists; restoration uses GET `/auth/me`; logout remains a protected POST. Multiple tabs need no CSRF synchronization. SameSite=Lax and HttpOnly remain additional cookie defenses. This choice follows the standard-header and configured-target approach in [OWASP's CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#using-standard-headers-to-verify-origin), with the stricter choice to reject requests lacking Origin instead of falling back to Referer.

Configuration is server-controlled, never derived from Host, request URL, `Forwarded`, `X-Forwarded-*`, Fetch Metadata, or a reflected caller value. The allowlist is not a wildcard, suffix, or substring match. Use lowercase ASCII hostnames (punycode if needed), scheme and optional non-default port only: no credentials, path/trailing slash, query, fragment, whitespace, wildcard, duplicate entries, or empty list. Default ports must be omitted (`https://board.example`, not `https://board.example:443`). Other ports are distinct origins. Invalid settings fail startup with generic validation messages.

Development defaults trust only `http://localhost:4321` and `http://127.0.0.1:4321`. Explicitly configure a changed Astro port or `http://[::1]:4321` if used. Plain HTTP is permitted only for these exact loopback hosts in development; arbitrary LAN HTTP origins are rejected. Astro's `/api` proxy already preserves the browser Origin; `API_ORIGIN` selects the upstream server, **not** the trusted browser origin. Direct Swagger UI at port 8000 is not trusted by default; use a deliberate development allowlist entry if needed. Tools such as curl and Playwright APIRequestContext must explicitly send `Origin: http://127.0.0.1:4321` (or the selected trusted origin) on unsafe calls, alongside their normal session cookie. Supplying Origin does not authenticate a client.

Production must set:

```dotenv
APP_ENV=production
COOKIE_SECURE=true
TRUSTED_ORIGINS=["https://kanban.sneakybeak.net"]
```

Production rejects HTTP and loopback origins and refuses implicit development defaults. Setting `COOKIE_SECURE=true` also requires explicit HTTPS origins even without production mode. Keep configuration identical across workers; restart them after changes. Each additional trusted origin authorizes that site's scripts to initiate requests and must be under the same operator's control. Do not add arbitrary preview hosts to the application allowlist. The environment cannot detect that an operator accidentally left development mode enabled; setting the production values is a release requirement.

The future authenticated Cloudflare Worker must preserve the incoming browser Origin unchanged, including absence/`null`, and preserve cookies, error/status envelopes and `Retry-After`, with API caching disabled. It must never manufacture a trusted Origin for an untrusted or missing one. Authenticate that proxy separately and prevent backend-origin bypass before trusting forwarding headers. Neither the Worker nor proxy authentication/network restrictions are implemented here. Origin validation prevents browser CSRF, **not** direct callers forging headers, stolen-session use, XSS or compromise of a trusted frontend. Such callers still face authentication and existing login limits. Do not log bodies, cookies/JWTs, credentials, database URLs or raw rejected headers. If future clients cannot supply Origin, design an explicit alternative before admitting them; do not weaken the missing/null policy.

The frontend shows a distinct security-check failure on both login forms and board/logout operations. Passwords clear, mutations are never replayed, and failed logout retains the session and unsaved drafts. Keep the tab open while the operator corrects URL/proxy/allowlist settings, then explicitly retry. Navigating/reloading still discards tab-memory drafts as before.

## Accounts and development reset

Users are stored as `{ "_id": "chris", "password_hash": "..." }`. Username is the primary key, trimmed and lowercased at creation and login. Public users contain only `{ "username": "chris" }`. There is no separate user ID, display name, avatar property, signup, or account editing API. Card `creator`/`assignees` and comment `author` use canonical usernames.

Re-running `app.create_user chris` deliberately resets the password and revokes that user's tokens. JWT subjects and token ownership use username; old UUID-based token records cannot authenticate. Login sets a host-only HttpOnly, SameSite=Lax `access_token` cookie. Logout revokes its record and clears the cookie. Both JWT and stored expiry are checked independently of TTL cleanup.

No application database was reset during implementation. The user initially deferred local MongoDB setup, then supplied Atlas credentials for isolated integration verification. Fresh databases need no migration. Startup refuses legacy account documents with `username`/`display_name` fields.

For old disposable development data, stop the API and identify the exact URI/database before resetting. For the **explicit local `kanban_dev` example only**, these commands inspect then remove its data. Do not use this for a deployed database or change the name without checking the target:

```powershell
mongosh 'mongodb://localhost:27017/?replicaSet=rs0' --eval 'db.getSiblingDB("kanban_dev").getCollectionNames()'
mongosh 'mongodb://localhost:27017/?replicaSet=rs0' --eval 'db.getSiblingDB("kanban_dev").dropDatabase()'
```

Recreate accounts afterward. Startup initializes indexes/metadata idempotently and removes an obsolete single-field `username` index from users. There is no UUID migration.

## API contract

All paths below are relative to `/api`. Board/user routes require authentication. Health is public; logout is idempotent and can clear an expired cookie. IDs are opaque strings; unknown IDs, including malformed-looking ones, return `404`.

| Method and path | Request | Response |
| --- | --- | --- |
| `POST /auth/login` | `{"username":"chris","password":"..."}` | Username only and cookie; `200` |
| `GET /auth/me` | Cookie | Username only |
| `POST /auth/logout` | Cookie if available | `204` |
| `GET /users` | — | Username-only accounts, sorted by username |
| `GET /cards` | — | `{"cards":[...],"order_versions":{...}}` |
| `POST /cards` | Required title/tag, optional initial content | Full card; `201` |
| `GET /cards/{id}` | — | Full card |
| `PATCH /cards/{id}` | Content and `expected_version` | Full card |
| `POST /cards/{id}/move` | Placement and preconditions below | `{"card":{...},"order_versions":{...}}` |
| `DELETE /cards/{id}` | Query `expected_version=N&expected_comments_version=M` | `204` |
| `POST /cards/{id}/comments` | `{"text":"..."}` | Full card; `201` |
| `PATCH /cards/{id}/comments/{comment_id}` | `{"text":"...","expected_comment_version":1}` | Full card |
| `DELETE /cards/{id}/comments/{comment_id}` | Query `expected_comment_version=N` | Full card |
| `GET /health/live` | — | `{"status":"ok"}` |
| `GET /health/ready` | — | Same after database ping; generic `503` otherwise |

Lists include every full description and comment, ordered by fixed column order, position, and ID. There are no backend search/filter/pagination features or hidden limits. Unrecognized list query parameters have no effect.

Example create:

```json
{
  "title": "Fix the settings dialog",
  "tag": "bugfix",
  "description": "Plain text details",
  "assignees": ["chris"]
}
```

Full card response:

```json
{
  "id": "server-generated-opaque-id",
  "ticket_number": 1,
  "title": "Fix the settings dialog",
  "tag": "bugfix",
  "description": "Plain text details",
  "column": "review",
  "position": 0,
  "difficulty": "medium",
  "health": "healthy",
  "assignees": ["chris"],
  "creator": "chris",
  "created_at": "2026-10-20T12:00:00Z",
  "updated_at": "2026-10-20T12:00:00Z",
  "version": 1,
  "comments_version": 0,
  "comments": []
}
```

Defaults: `review`, `medium`, `healthy`, empty description, no assignees. Tag is required. Title is trimmed, maximum 200 characters; description allows 20,000; tag is trimmed/lowercased, maximum 32; comment text is trimmed, maximum 4,000. Required strings reject blanks. Assignees must be distinct existing canonical usernames, maximum three; user references are not automatically normalized.

PATCH permits only `title`, `description`, `tag`, `difficulty`, `health`, and `assignees`, with positive integer `expected_version`. Omitted fields remain unchanged; `""` clears description and `[]` clears assignees. Explicit nulls, empty patches, obsolete `tags`, unknown/server-owned fields, and nested comments are rejected. Column/position changes require `/move`.

```json
{"expected_version":1,"description":"Updated details","assignees":[]}
```

## Ordering, versions, and health

Supply the board's `order_versions` in move requests: at least source and destination revisions; the whole map is accepted. `before_card_id` inserts before that destination card; omitted/null appends. Self-anchors and anchors outside the destination are invalid. Body versions must be integers, not strings or booleans.

```json
{
  "column": "blocked",
  "before_card_id": null,
  "expected_version": 2,
  "expected_order_versions": {"review":5,"blocked":0}
}
```

Columns: `review`, `backlog`, `in_progress`, `done`, `blocked`. Difficulty: `easy`, `medium`, `hard`. Health: `healthy`, `at_risk`, `blocked`.

Creating in Blocked without explicit health assigns blocked; explicitly requesting another health returns `422`. Moving into Blocked sets blocked health atomically. While there, other health values are rejected. Leaving preserves blocked health until a later content edit changes it.

Content edits/moves require the current card version and increment it once, including saves with identical values or placement. Any signed-in user can edit/delete a card. A same-column move is a reorder; the frontend must disable the current-column selector option.

Creates append. `column_orders` holds revisions incremented by creates/deletes/moves. Positions are integer ranks; moves renumber destination neighbors atomically. Departure/deletion gaps are harmless. Neighbor rank changes do not advance their content versions or timestamps. Board reads use snapshot transactions to return coherent cards and revisions. Refresh the full board after create/move/delete; do not merge neighbor positions using content versions alone.

Transactions coordinate card/order changes with snapshot isolation and majority writes. PyMongo retries transient conflicts and rechecks the original client preconditions; stale requests return `409`. Rejected transactions roll back all changes. Transactions have a 15-second client deadline. Ticket allocation happens once outside the transaction with majority acknowledgement; failures/deletions can leave gaps, and numbers are never deliberately recycled. See [PyMongo transaction behavior](https://www.mongodb.com/docs/languages/python/pymongo-driver/current/crud/transactions/).

## Discussion

Embedded comments have `id`, `text`, `author`, `created_at`, `updated_at`, and `version` (initially 1). Server timestamps are UTC at MongoDB millisecond precision. Only the original author can edit/delete an individual comment. Ownership is checked before reporting version conflicts. Whole-card deletion removes everyone's comments.

Comment writes increment only `comments_version`, never card `version` or parent `updated_at`. Edits advance the individual comment version; edits/deletes require `expected_comment_version`. Creates require no version. The atomic append predicate enforces 20 current comments; deletion frees a slot. Different comments and card-content saves use independent preconditions. Whole-card deletion checks both content and discussion versions to guard unseen discussion changes.

Full-card responses must be merged by independent content/discussion revisions. Late responses must not regress either or replace an unsaved draft. On `409`, preserve the draft and let the user refresh/reapply. After an uncertain create/comment response, refresh before a deliberate retry; automatic HTTP replay may create duplicates. Idempotency keys are outside scope.

## Errors

Handled API errors use this envelope. Validation details contain paths/messages and never echo input values:

```json
{"error":{"code":"version_conflict","message":"Resource changed; refresh before reapplying your changes","fields":[]}}
```

| Status | Meaning / codes |
| --- | --- |
| `401` | Missing/invalid/expired/revoked authentication; `unauthenticated` |
| `403` | Origin security check: `csrf_rejected`; another author's comment: `forbidden` |
| `404` | Missing resource; `not_found` |
| `409` | `version_conflict`, `order_conflict` |
| `422` | `validation_error`, `invalid_assignees`, `blocked_health`, `invalid_anchor`, `missing_order_versions`, `comment_limit_reached` |
| `429` | `login_throttled`; login only, with `Retry-After` seconds |
| `503` | `database_unavailable`; no connection details exposed |

Startup fails for unavailable MongoDB, unsupported topology, or legacy accounts. At runtime readiness/database failures return generic `503`; liveness remains independent of MongoDB.

## Verification

```powershell
uv run pytest -q
uv run ruff check app tests
uv run ruff format --check app tests
```

Without `MONGO_TEST_URL` in the environment or `backend/.env`, real-database tests explicitly skip; contract tests still run. Set it to a local replica set or an Atlas URI authorized for disposable test databases:

```powershell
$env:MONGO_TEST_URL = 'mongodb://localhost:27017/?replicaSet=rs0'
uv run pytest -q
```

Linux/macOS: `MONGO_TEST_URL='mongodb://localhost:27017/?replicaSet=rs0' uv run pytest -q`.

Each integration test creates and finally drops only its generated `kanban_test_<uuid>` database. It ignores `MONGO_DB` and never resets application data. An explicitly supplied but unavailable/incompatible URI fails instead of skipping. Tests cover authentication lifecycle, indexes, ordering persistence, stale versions, concurrent writes, ownership, caps, deletion races, and rollback.

Verification on October 20, 2026: **78 contract tests passed; all 13 real Atlas integration tests passed; Ruff lint and formatting checks passed.** Integration databases were removed afterward. No application database was inspected or reset. The contract suite reports an upstream Starlette TestClient deprecation warning about its HTTPX adapter; test assertions pass.

Login-throttling verification on October 21, 2026: **99 contract/unit tests and 20 real local MongoDB integration tests passed (119 total; none skipped)**, using an explicit loopback `MONGO_TEST_URL` and generated disposable databases only. Ruff lint/format checks passed. New coverage includes exact thresholds, success/failure accounting, normalized/existing/nonexistent usernames, key isolation, deterministic cooldown recovery without TTL deletion, concurrent HTTP requests across independent apps/database clients, spoofed forwarding headers, insert collisions, and fail-closed database failures/timeouts. Tests assert rejected requests do not verify passwords or issue tokens/cookies. Existing authentication/revocation/CRUD checks also passed. The upstream Starlette/HTTPX deprecation warning remains. Atlas, live application accounts, production proxy, deployment, and origin/CSRF acceptance were not run as part of this change.

Before running the application with an Atlas-only `.env`, add a random `JWT_SECRET`, explicitly select `MONGO_DB` (for example `kanban_dev`), and create the intended accounts. Test fixtures use their own secrets and accounts and do not provision the application database.

Local application verification on October 20: the user configured a loopback development `MONGO_URL`, explicit `MONGO_DB=kanban_dev`, a valid JWT secret, and `COOKIE_SECURE=false`. With explicit user authorization, a one-off insert created the three previously absent local accounts; no startup seed or password reset was added. All three login/me/logout checks and two real browser journeys through Astro's proxy passed, covering conflicts, recovery, card/comment CRUD, and reload/order persistence. Only their three acceptance tickets were removed, leaving the accounts and normal counter/order advances. The production `MONGODB_URI` was not contacted. Atlas application provisioning remains manual and outside this local verification.

Origin/CSRF verification on October 21, 2026: **215 backend tests passed, none skipped** (192 contract/unit + 23 real local MongoDB integration tests), plus Ruff lint/format checks. Explicit loopback `MONGO_TEST_URL` selected generated disposable databases only. Tests cover exact origins, malformed/missing/null/duplicate values, spoofed Host/forwarding headers, no Referer fallback, production settings, all mutation routes/methods, and rejection before body/dependency/database work. Full database snapshots confirm rejected login/logout/CRUD preserve allowances, tokens, accounts, cards, counters and ordering; existing session restoration, expiry/revocation, throttling and CRUD pass. The upstream Starlette/HTTPX warning remains. No application accounts/data, Atlas, live application browser acceptance, deployment, or production proxy were used. Frontend results are recorded in its README.

## Frontend handoff and remaining scope

The frontend now connects these routes while preserving the existing Astro design; see [frontend setup and checks](../frontend/README.md). Local provisioning and live FastAPI/MongoDB browser acceptance pass; Atlas/production application acceptance remains pending. Map `review` to “Review / Brainstorm”, `in_progress` to “In Progress”, `at_risk` to “At risk”, and tickets to `KAN-{number}`. Key account references, pictures, and initials by canonical username.

The column selector appends to another column and disables its current option. Drag-and-drop is the only UI control for within-column ordering and supplies the drop anchor. Disable reordering while filters hide cards; allow selector moves. Keep the complete board for local search/filter/count/display-pagination behavior.

Login throttling, strict Origin/CSRF protection, and frontend recovery messaging are implemented in [the authentication follow-up](../.agent/07-auth-follow-up.md). Frontend wiring is covered by isolated browser fixtures; hosting and production application verification remain separate work.
