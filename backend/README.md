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
| `TOKEN_DAYS` | `7` | JWT/cookie lifetime in days |

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
| `403` | Another author's comment; `forbidden` |
| `404` | Missing resource; `not_found` |
| `409` | `version_conflict`, `order_conflict` |
| `422` | `validation_error`, `invalid_assignees`, `blocked_health`, `invalid_anchor`, `missing_order_versions`, `comment_limit_reached` |
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

Before running the application with an Atlas-only `.env`, add a random `JWT_SECRET`, explicitly select `MONGO_DB` (for example `kanban_dev`), and create the intended accounts. Test fixtures use their own secrets and accounts and do not provision the application database.

## Frontend handoff and remaining scope

The static frontend is unchanged. Map `review` to “Review / Brainstorm”, `in_progress` to “In Progress”, `at_risk` to “At risk”, and tickets to `KAN-{number}`. Key account references, pictures, and initials by canonical username.

The column selector appends to another column and disables its current option. Drag-and-drop is the only UI control for within-column ordering and supplies the drop anchor. Disable reordering while filters hide cards; allow selector moves. Keep the complete board for local search/filter/count/display-pagination behavior.

Login throttling and origin/CSRF protection remain outside this delivery, tracked in [the authentication follow-up](../.agent/07-auth-follow-up.md). Frontend wiring and hosting changes are separate work.
