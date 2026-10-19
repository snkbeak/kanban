# Backend and data plan

## Structure

Create `backend/` with a Python project, dependency lockfile, `app/main.py`, configuration, database access, request/response schemas, authentication helpers, route modules, and focused tests. Keep persistence operations close to their feature; a generic repository framework is unnecessary.

Use FastAPI with a supported asynchronous MongoDB driver. Select compatible versions at implementation time and commit the lockfile. Validate configuration at startup and use a shared database client through the application lifecycle. Store timestamps in UTC and return ISO 8601 values.

Target a normal Python process on the recommended Render web service, connecting to MongoDB Atlas. Cloudflare serves the frontend and proxies `/api` to this process. Keep local MongoDB in Compose. See [Cloudflare deployment](05-cloudflare-deployment.md) for routing, secrets, and alternative backend runtimes.

## Collections

### Users

Fields: stable string ID, username, display name, bundled avatar path, password hash.

Seed exactly `chris`, `sean`, and `james` with an idempotent setup command. Obtain initial passwords from local/deployment secrets, hash them with Argon2id, and reject missing credentials during initial setup. Re-running setup must preserve existing passwords. Provide a separate operator command for deliberate password rotation and session revocation. Do not expose account mutation routes.

Create a unique username index. Public user responses contain only ID, username, display name, and avatar path.

### Cards

| Field | Contract |
| --- | --- |
| `_id` | Internal MongoDB ID, serialized as `id` |
| `ticket_number` | Unique positive integer, displayed as `KAN-{number}` |
| `title` | Trimmed, 1–200 characters |
| `description` | Plain text, up to 20,000 characters; empty allowed |
| `column` | `review`, `backlog`, `in_progress`, `done`, `blocked` |
| `difficulty` | `easy`, `medium`, `hard` |
| `health` | `healthy`, `at_risk`, `blocked` |
| `tags` | Up to 10 unique normalized lowercase strings, each 1–32 characters |
| `assignee_ids` | Distinct known user IDs, maximum three |
| `creator_id` | Authenticated creator; immutable |
| `created_at`, `updated_at` | Server timestamps |
| `version` | Integer starting at 1, incremented on every card or comment mutation |
| `comments` | Embedded comment records, oldest first |

Embed comments so card/comment changes and deletion remain single-document operations on a standalone MongoDB instance. Each comment has a server-generated UUID, plain text (1–4,000 characters after trimming), immutable `author_id`, and server-owned creation/update timestamps.

Proposed first-release limit: 200 comments per card. Enforce this atomically when adding comments, show the limit in the UI, and return a clear validation error when reached. Together with the other field limits this keeps documents comfortably below MongoDB's document limit. If the team needs longer discussions, migrate comments into their own collection before raising the limit substantially.

Create a unique index on `ticket_number` and an index supporting column/creation-time queries. Exclude comment bodies and full descriptions from board-list responses; retrieve them with card details.

### Counters

Use one counter document and atomic increment to allocate ticket numbers. Initialize it idempotently before accepting traffic. Concurrent creates must receive distinct numbers, backed by the unique card index. A failed card insert may leave a gap; never decrement the counter or recycle deleted ticket numbers.

### Sessions

Store a hash of a cryptographically random session token, user ID, creation time, and expiration time. Use a unique token-hash index and TTL expiration index. Explicitly check expiry on every request because TTL cleanup is asynchronous.

## Authentication

- Serve the frontend and `/api` from the same origin.
- In production, require the proxy's secret header on application routes before trusting its forwarded client address. Keep only generic health endpoints exempt for hosting probes. The secret authenticates the proxy, not the user; all user/session checks still apply. Use a host-only cookie with Path=/ and no backend-domain attribute, and mark API responses `Cache-Control: no-store`.
- Login verifies a username and password and creates a fresh opaque session. Return its token only in an HttpOnly, SameSite=Lax cookie; use Secure in HTTPS environments and a fixed seven-day expiry.
- Expose the current user through `/api/auth/me`. Logout deletes the session and expires the cookie.
- Require authentication for all board, card, comment, and user-list routes. A static frontend shell may be public; its data must not be.
- Reject untrusted origins on all mutating requests, including login/logout; accept JSON bodies for mutations that carry data. Keep CORS closed by default and require a session-bound CSRF token on authenticated mutations.
- Apply bounded login throttling by username and client IP. A single-process limiter is enough for the planned single API worker; document that it resets on restart.
- Use generic failed-login messages. Never log passwords, session cookies, CSRF tokens, or password hashes.

## API contract

All routes below use the `/api` prefix. Create separate input/output schemas and reject unknown or read-only mutation fields.

| Method and route | Behavior |
| --- | --- |
| `POST /auth/login` | Authenticate, issue cookie, return public user and CSRF token |
| `GET /auth/me` | Return public current user and session CSRF token |
| `POST /auth/logout` | Revoke session and clear cookie |
| `GET /users` | Return the three public user records |
| `GET /cards` | List summaries; filter by column, assignee, tag, health, difficulty, and title/ticket query |
| `POST /cards` | Create card; return full record with `201` |
| `GET /cards/{id}` | Return card details and comments |
| `PATCH /cards/{id}` | Update supplied editable fields, including column; require `expected_version` |
| `DELETE /cards/{id}?expected_version=N` | Delete card and embedded comments with version check; return `204` |
| `POST /cards/{id}/comments` | Add text; require `expected_version`; return updated card with `201` |
| `PATCH /cards/{id}/comments/{comment_id}` | Author only: edit text with version check; return updated card |
| `DELETE /cards/{id}/comments/{comment_id}?expected_version=N` | Author only: delete comment with version check; return updated card |
| `GET /health/live` | Process health, no private information |
| `GET /health/ready` | Database readiness, generic failure response |

Use bounded pagination (default 50, maximum 100 per request), stable descending creation-time/ID ordering, and a cursor for continuation. The frontend loads each column separately so one long Done column cannot hide active work. Return matching total counts for column headings. Treat title searches as escaped literal text, never raw user-supplied regular expressions; parse ticket queries explicitly.

## Concurrent edits and errors

Every mutation of an existing card must atomically match both its ID and `version`, perform the change, increment `version`, and update `updated_at`. Apply comment operations with the same guard; edits also update the comment timestamp. Check comment existence and the comment-count cap within the mutation conditions.

For comment edits/deletion, compare the stored `author_id` with the authenticated user and return `403` for another user's comment. Also include comment ID and author ID together in the atomic mutation predicate (for embedded comments, use a matching element condition so separate comments cannot satisfy each half). Reject comment arrays and author fields in card PATCH payloads; otherwise shared card editing could bypass comment permissions. Derive a new comment's author from the session. Verify authorization before reporting a version conflict for an existing comment.

Return `409` for a stale version, `404` for an absent card/comment, `401` for a missing/expired session, `403` for failed comment ownership, proxy, CSRF, or origin checks, `422` for invalid input, and `429` for login throttling. Use one JSON error shape with a code, message, and optional field errors. Normalize FastAPI validation errors to that shape. Distinguish a database outage from missing data with a generic `503` response.

Do not silently retry a conflicting write or automatically retry a timed-out create/comment request. After an ambiguous response, refresh the data before the user chooses whether to retry, avoiding accidental duplicates.
