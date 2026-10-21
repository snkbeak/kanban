# Deployment plan

Updated October 20, 2026 to match the finalized backend and existing frontend configuration. Follow [next-steps.md](next-steps.md) for remaining work and [backend/README.md](../backend/README.md) for executable API/setup details. This document plans deployment; editing it does not provision or publish services.

## Current state and target

- Cloudflare Workers Static Assets configuration already exists for `kanban.sneakybeak.net`, Worker name `kanban-sneakybeak-net`. The root domain's existing site is separate. `workers.dev` and preview URLs are disabled; preserve these settings.
- The frontend scaffold is static. The `/api` proxy and production backend connection remain to be implemented.
- FastAPI CRUD and authentication are implemented and tested. Atlas connectivity and transactions were verified using disposable test databases; application data/accounts were not provisioned.
- Atlas is the available database service. Select the application database, permissions, production network access, and backup policy.
- The Python host/tier remains unselected. Render is an option from the earlier plan, not a confirmed deployment. Keep a conventional Python process unless a separate hosting evaluation justifies another runtime.

Target request flow: browser -> Cloudflare static assets/API proxy -> FastAPI -> Atlas. MongoDB credentials belong only to the backend. The Worker forwards HTTP and contains no card or ordering business logic.

## 1. Backend environment and startup

Use Python 3.12+ with the dependencies in `backend/pyproject.toml`. There is currently no project Dockerfile or committed backend lockfile; `uv.lock` is ignored. Before release, choose a reproducible build mechanism rather than assuming either artifact exists.

For a conventional Python service, use `backend/` as the working directory, install uv in the build environment, and run `uv sync --no-dev`. The current application is a factory:

```sh
uv run --no-sync uvicorn app.main:create_app --factory --host 0.0.0.0 --port "$PORT" --workers 1
```

This is a POSIX hosting command; the service supplies `PORT`. For local PowerShell use the backend README's command. Render supports ordinary Python/FastAPI services; adapt its setup to this project's factory rather than copying a `main:app` example unchanged. [Render FastAPI documentation](https://render.com/docs/deploy-fastapi).

| Current setting | Deployment use |
| --- | --- |
| `MONGO_URL` or `MONGODB_URI` | Complete Atlas connection URI; `MONGO_URL` wins if both are set |
| `MONGO_DB` | Explicit application database name; do not rely on the default `kanban` |
| `JWT_SECRET` | Random secret of at least 32 characters, stable across restarts |
| `COOKIE_SECURE` | `true` for the HTTPS frontend |
| `TOKEN_DAYS` | Optional, defaults to 7 |

Separate MongoDB username/password settings are unnecessary when the URI contains credentials. Do not expose configuration in frontend build variables, generated assets, logs, or committed files.

Startup checks transaction-capable topology and legacy account shape, creates indexes, and initializes counters/column revisions idempotently. It closes the client on shutdown. Probe `/api/health/ready` for database readiness and `/api/health/live` for process liveness; runtime database failures yield generic 503 responses.

Provision `chris`, `sean`, and `james` once with `uv run python -m app.create_user <username>`. Repeating this command resets the password and revokes tokens; never run it automatically on every deploy. The API has no signup or account editing endpoint.

Fresh databases need no migration. If old disposable development records exist, stop the app and identify the exact database before the documented reset. Never perform a deployment-wide cluster reset.

## 2. Cloudflare assets and API proxy

Extend the existing `frontend/wrangler.jsonc` and scripts. Preserve its custom domain, static HTML handling, 404 behavior, Worker name, and disabled alternate URLs.

Add a Worker entry point such as `frontend/worker/index.ts`, `main`, an `ASSETS` binding, and a configured backend `API_ORIGIN`. Route `/api` and `/api/*` through the Worker first; serve other requests through the assets binding. Cloudflare supports this selective routing via `assets.run_worker_first`. [Worker/static-asset routing documentation](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).

Proxy requirements:

- Use only the configured backend origin; preserve the `/api` path, query string, method, request body, cookie, content type, and relevant browser headers.
- Preserve upstream status, JSON response bodies, and all Set-Cookie headers. Handle 204 responses without trying to parse JSON. API failures must not fall through to the static HTML page.
- Preserve the host-only HttpOnly, SameSite=Lax cookie with Path=/; production responses use Secure. Do not set a backend-domain cookie.
- Disable caching for every API response, including authentication and errors.
- Bound upstream request time and report gateway failures clearly. Account for the backend's transaction deadline; on an uncertain write, let the client refresh instead of automatically retrying it.
- Do not follow upstream redirects with credentials or accept client-supplied upstream destinations.
- Keep preview environments separate or their API disabled. Do not reuse production accounts/secrets for arbitrary previews.

Validate locally before publishing using existing `npm run build` and `npm run preview:cloudflare` commands from `frontend/`. Once deployment is explicitly requested, `npm run deploy` builds and publishes the assets/proxy.

## 3. Backend-origin access and deferred authentication

A Worker-to-backend shared secret and rejection of direct-origin application traffic were earlier deployment proposals. Neither a `PROXY_SECRET` setting nor header validation currently exists in FastAPI. Decide the origin-access mechanism during deployment and implement/test both ends before claiming direct-origin protection. A proxy secret authenticates the proxy, not the signed-in user.

Do not trust forwarded client-IP headers until the proxy path authenticates and replaces them. This matters when the separate throttling implementation selects its client keys.

Login throttling and origin/CSRF protection remain in [07-auth-follow-up.md](07-auth-follow-up.md). The current backend has no allowed-origin setting or CSRF token/header contract; adding environment variables alone cannot enable them. Coordinate proxy/header handling with that follow-up when defined. These pending controls do not change the completed CRUD verification results.

## 4. Atlas and persistence

Use the existing Atlas service; verify the chosen application database and tier rather than creating another cluster by default. Provide the backend with appropriate database permissions and permit its outbound network access. Keep test credentials/access separate where practical; integration tests need permission to create/drop generated test databases, which is not an application runtime requirement.

Transactions are mandatory: a local alternative must be a replica set, even if it has only one node. Standalone MongoDB is unsupported. Card/order writes commit together; do not replace this with process-local locks or independent writes.

Persist and restore all application collections together: `users`, `tokens`, `cards`, `counters`, and `column_orders`. Username is the account primary key; there is no generated account ID to migrate. Cards embed comments and carry independent content/discussion versions. Ticket counters and ordering revisions are application data, not disposable caches.

Test readiness, a create/read/move/comment cycle, and ordering persistence across backend restart/redeploy. Separate application verification from the previously completed disposable integration tests.

## 5. Backups, recovery, and release checks

Select and document backup frequency, retention, and recovery expectations for the actual Atlas tier. The earlier target of daily backups with seven daily and four weekly retention remains a planning target, not a provisioned guarantee. Check available mechanisms; if using logical dumps, quiesce application writes so cards, counters, and column orders form a consistent backup. Atlas backup availability and restore behavior depend on the cluster type/tier. [Atlas backup and restore documentation](https://www.mongodb.com/docs/atlas/backup-restore-cluster/).

Restore into an isolated database and verify username identities, cards/comments, positions, revisions, and subsequent ticket allocation. A backup can restore old token records; rotate the JWT secret or revoke restored tokens before exposing a recovered environment. Document possible data loss since the backup and the supported rollback procedure.

Release checks:

- All three provisioned accounts can log in, restore a session, and log out through the public Cloudflare hostname.
- The full board loads without server filters/pagination; card/comment CRUD, selector moves, and drag-and-drop ordering persist.
- Stale content/comment/order preconditions still return 409 through the proxy; comment activity does not invalidate a current content save.
- Comment ownership, the 20-comment cap, Blocked health rules, and guarded whole-card deletion behave consistently in the browser.
- Cookies and JSON/status responses survive the proxy; API responses are not cached.
- Backend-origin access controls are tested once implemented, and authentication-follow-up status is reported separately.
- Application data survives redeployment; an isolated restore succeeds.
- CI runs backend and browser checks with isolated data; credentials stay out of assets and logs.

Hosting references were checked October 20, 2026. Provider pricing, tier selection, and provisioning remain separate decisions.
