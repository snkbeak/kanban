# Authentication follow-up

Updated October 21, 2026. Login throttling is implemented; origin/CSRF protection and production deployment remain pending. Existing JWT cookies, revocable token records, canonical username identity, and CRUD contracts are preserved.

The user explicitly separated login throttling and origin/CSRF protection from the [backend CRUD plan](06-backend-crud.md). These tasks are not part of CRUD delivery or its acceptance checks. Keep the existing JWT cookie authentication and revocable token records; this follow-up does not propose a different authentication system.

## Implementation status

- [x] MongoDB login throttling in `backend/app/ratelimit.py`, enforced before account lookup/password verification. Configurable defaults: 5 attempts per canonical username per 900 seconds; 30 shared across the application per 300 seconds.
- [ ] Origin checks: define trusted frontend origins and local-development behavior; apply the policy to mutating requests, including login/logout, through `backend/app/middleware.py` or suitable dependencies.
- [ ] CSRF protection: select the mechanism for the existing cookie-based authentication, define server/client token handling where applicable, and cover authenticated mutations.
- [x] Both login screens explain throttling, retry time, and temporary unavailability; password fields clear after submission. No automatic retries or persistent credential storage.
- [ ] Frontend integration for the chosen CSRF mechanism; no token/header contract is assumed now.
- [x] Documentation: [complete policy/settings and operational limitations](../backend/README.md#login-throttling).
- [ ] Cloudflare Worker, authenticated backend-origin access, and production acceptance, tracked in [deployment](05-cloudflare-deployment.md).

## Implemented policy and limitations

The global bucket is reserved first, followed by a SHA-256 key of the normalized username. Known and unknown accounts consume identical allowances. Every admitted credential check counts, including successes; successful login does not clear failures. A username rejection or later failure still consumes the preceding global reservation. Globally rejected attempts create no username buckets. Malformed requests retain `422` and do not reserve allowance.

Each bucket uses a single atomic MongoDB update, majority writes, and database time. Two sequential reservations may conservatively consume partial allowance; they never oversubscribe under concurrency. Fixed windows start at first reservation, reset on expiry even if TTL cleanup is delayed, and do not extend on rejection. Counters survive restarts and are shared across processes using the same database/settings. Use identical configuration on all workers; existing window expiry persists through configuration changes.

`429 login_throttled` uses the API error envelope and rounded-up `Retry-After` seconds for the rejecting window, without naming the key or revealing account existence. Another limit or subsequent traffic can still reject the next attempt. Database failure/timeout fails closed with generic `503 database_unavailable`; no password verification, tokens, cookie, or sensitive error details. There is no in-memory fallback.

No client address or forwarding header is trusted or used as a key. The application-wide allowance covers direct traffic and the current local proxy, even if server middleware rewrites peer addresses. One attacker can temporarily exhaust shared/username allowances; existing sessions remain usable. Fixed-window boundary bursts and general HTTP/DDoS protection remain limitations. Before adding per-address limits, authenticate the future Worker, prevent direct origin bypass, overwrite caller-supplied address headers, and configure middleware trust accordingly. Preserve `429`/`Retry-After` and disable API caching. Proxy authentication and CSRF are not implemented by this work.

## Verification for this follow-up

October 21: **119 backend tests passed; none skipped** (99 contract/unit tests and 20 real integration tests on a local replica set). Only generated `kanban_test_<uuid>` databases were created and dropped. No application accounts/data were provisioned or reset and no deployment occurred. Ruff lint/format checks passed. The upstream Starlette/HTTPX deprecation warning remains.

New coverage includes allowed attempts, exact thresholds, successes/failures, canonical username isolation, nonexistent users, deterministic boundary/cooldown recovery without TTL deletion, concurrent HTTP requests through independent apps/database clients, spoofed forwarding headers, insert races, database failure/timeout, and no verification/token issuance for rejected requests. Existing login/cookie/revocation/CRUD contracts pass. Frontend: 11 API/state tests, 14 isolated Chromium journeys, Astro/TypeScript checks, and production build passed; none skipped. Browser tests passed on the built local preview after the dev server's route-loading 500s prevented the initial run. The dev-server issue remains separate maintenance, recorded in the active next-steps checklist.

Atlas/production acceptance and actual host restart/redeploy acceptance remain separate release work; independent-app tests establish shared persistent throttling but do not claim deployment acceptance. Pending origin/CSRF work must cover the checks below:

- Preserve the verified login allowance, throttling response, and cooldown behavior.
- Origin checks accept configured legitimate origins and reject disallowed mutation requests, with explicit behavior for absent origins and local development.
- The selected CSRF mechanism rejects missing/invalid proof where required and accepts legitimate browser mutations.
- Login, current-user lookup, logout, token expiry/revocation, and username-based identity continue to work.
- Rejected requests do not mutate card/comment data or expose credentials and tokens through responses/logs.

The CRUD implementation still requires authentication for board/user data, author-only comment modifications, input validation, and conflict handling. Those existing requirements stay in the CRUD plan.
