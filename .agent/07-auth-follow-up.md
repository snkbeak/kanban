# Authentication follow-up

Updated October 21, 2026. Login throttling and origin/CSRF protection are implemented; Cloudflare Worker/container ingress protection is prepared, while remote deployment and production acceptance remain pending. Existing JWT cookies, revocable token records, canonical username identity, and CRUD contracts are preserved.

The user explicitly separated login throttling and origin/CSRF protection from the [backend CRUD plan](06-backend-crud.md). These tasks are not part of CRUD delivery or its acceptance checks. Keep the existing JWT cookie authentication and revocable token records; this follow-up does not propose a different authentication system.

## Implementation status

- [x] MongoDB login throttling in `backend/app/ratelimit.py`, enforced before account lookup/password verification. Configurable defaults: 5 attempts per canonical username per 900 seconds; 30 shared across the application per 300 seconds.
- [x] Strict Origin middleware protects every unsafe HTTP request before routing/body parsing/dependencies, including login/logout. Exact configured origins; missing, null, malformed and duplicate headers fail closed.
- [x] CSRF defense: strict Origin validation without Referer fallback or tokens. SameSite remains defense in depth. Browser fetch mutations supply Origin automatically; non-browser callers must supply a trusted Origin explicitly.
- [x] Both login screens explain throttling, retry time, and temporary unavailability; password fields clear after submission. No automatic retries or persistent credential storage.
- [x] Shared frontend client uses same-origin mode and explains `403 csrf_rejected` in both login forms and board/logout flows. No replay, password retention, or draft loss on rejection.
- [x] Documentation: [login throttling](../backend/README.md#login-throttling) and [Origin policy/settings and operational limitations](../backend/README.md#origin--csrf-protection).
- [x] Prepare Cloudflare Worker/container routing and shared-secret backend ingress validation; see [deployment](05-cloudflare-deployment.md).
- [ ] Deploy and verify authenticated ingress and existing login behavior in production.

## Implemented policy and limitations

The global bucket is reserved first, followed by a SHA-256 key of the normalized username. Known and unknown accounts consume identical allowances. Every admitted credential check counts, including successes; successful login does not clear failures. A username rejection or later failure still consumes the preceding global reservation. Globally rejected attempts create no username buckets. After Origin admission, malformed requests retain `422` and do not reserve allowance. Origin rejection takes precedence and consumes no allowance.

Each bucket uses a single atomic MongoDB update, majority writes, and database time. Two sequential reservations may conservatively consume partial allowance; they never oversubscribe under concurrency. Fixed windows start at first reservation, reset on expiry even if TTL cleanup is delayed, and do not extend on rejection. Counters survive restarts and are shared across processes using the same database/settings. Use identical configuration on all workers; existing window expiry persists through configuration changes.

`429 login_throttled` uses the API error envelope and rounded-up `Retry-After` seconds for the rejecting window, without naming the key or revealing account existence. Another limit or subsequent traffic can still reject the next attempt. Database failure/timeout fails closed with generic `503 database_unavailable`; no password verification, tokens, cookie, or sensitive error details. There is no in-memory fallback.

No client address or forwarding header is trusted or used as a key. The application-wide allowance covers direct traffic and the current local proxy, even if server middleware rewrites peer addresses. One attacker can temporarily exhaust shared/username allowances; existing sessions remain usable. Fixed-window boundary bursts and general HTTP/DDoS protection remain limitations. Before adding per-address limits, authenticate the future Worker, prevent direct origin bypass, overwrite caller-supplied address headers, and configure middleware trust accordingly. Preserve `429`/`Retry-After` and disable API caching. Proxy authentication is now implemented for the Container path; CSRF is enforced independently by the middleware below.

## Origin / CSRF policy

`TRUSTED_ORIGINS` is a nonempty JSON array of exact serialized HTTP(S) origins. Development defaults are `http://localhost:4321` and `http://127.0.0.1:4321`. No wildcard, substring/suffix matching or reflected trust. Settings reject malformed URLs, credentials, paths, query/fragment, whitespace, duplicates, default-port spellings and arbitrary HTTP hosts. Production must explicitly set `APP_ENV=production`, `COOKIE_SECURE=true`, and `TRUSTED_ORIGINS=["https://kanban.sneakybeak.net"]`; HTTP and loopback production origins fail validation. Never deploy with the development settings.

All HTTP methods except GET/HEAD/OPTIONS require exactly one matching Origin, across all paths. Missing, empty, opaque `null`, malformed, duplicate, multi-value and untrusted origins return `403 csrf_rejected` using the existing envelope, without reflecting submitted values. Referer, Host, forwarding headers and Fetch Metadata cannot grant trust. Safe methods keep existing route/authentication behavior; no mutation GET endpoint is introduced. Rejection happens before body parsing, login reservations, account lookup/password checking, token creation/revocation, Set-Cookie, and data writes. Rejected logout keeps the session usable.

Strict validation is sufficient for this application's same-origin fetch mutations because browsers control Origin and absence fails closed. An additional token would introduce session binding, delivery, rotation and recovery state without a required client use case. There are no CSRF secrets/tokens to store, rotate or synchronize across tabs. Existing JWT/HttpOnly/SameSite=Lax behavior, normalization, generic invalid credentials, expiry/revocation, login limits and CRUD contracts are preserved. See the backend policy for the OWASP reference and limitations: this is browser CSRF prevention, not protection from XSS, stolen credentials or direct callers forging headers.

The shared client does not fabricate Origin. Both login forms use the explicit security-check message and clear passwords. Board/logout errors retain drafts and do not masquerade as comment ownership failures. Keep the tab open during operator correction of URL/proxy/configuration, then retry explicitly; there is no automatic replay, page reload or draft discard. Session restoration remains GET `/auth/me`. Non-browser clients, including the opt-in live harness's APIRequestContext calls, must send the configured Origin themselves.

The prepared Worker rejects unsafe requests with missing/null/untrusted Origin before container startup, forwards accepted browser Origin unchanged, and never substitutes a trusted value. It preserves cookies, errors, statuses and Retry-After without caching. The private container binding and required production PROXY_SECRET check are implemented; deployment/live ingress acceptance remain pending. No forwarding headers are trusted. No credential/body/cookie/database-URL logging is added.

## Verification for this follow-up

October 21 origin/CSRF verification: **215 backend tests passed, none skipped** (192 contract/unit + 23 real local MongoDB integration tests). Ruff lint and format checks passed. Only generated `kanban_test_<uuid>` databases on the explicitly selected loopback replica set were created and dropped. The upstream Starlette/HTTPX deprecation warning remains.

Coverage includes local and production configuration, exact matching, missing/null/malformed/duplicate Origin, spoofed Host/forwarding headers, Referer rejection, every mutation route and supported method, unsupported methods, router redirects and safe health/session reads. Rejections do not read request bodies or call authentication/store dependencies. Real database snapshots prove allowances, users, token records, cards, comments, counters and order metadata stay intact; existing cookies and sessions remain usable. Existing login throttling/concurrency, username normalization, generic errors, token expiry/revocation and CRUD tests pass.

Frontend: **12 API/state tests and all 17 isolated Chromium journeys passed**, none skipped; Astro/TypeScript checks and production build passed. Browser fixtures assert real automatic Origin headers on mutations and exercise both login forms, explicit retry, password clearing, no persistent credential storage, retained content/comment drafts and rejected logout. The initial browser run passed 16/17; its remaining success-message assertion was corrected and passed in a focused rerun. Sandbox Node/Playwright worker spawning required approved reruns. Fixtures used built `astro preview` at port 4321, which does not provide a live API proxy. Astro dev-server route-loading maintenance remains pending.

Earlier throttling verification (119 backend, 11 frontend unit/state, 14 browser tests) is superseded by this expanded suite. The live application browser harness was adjusted for explicit non-browser Origin headers but **not run**. No application accounts/data were provisioned/reset/altered, no Atlas application acceptance was attempted, and nothing was deployed. Authenticated proxy/backend-origin protection, production configuration/acceptance, and host restart/redeploy verification remain pending in [next steps](next-steps.md).

The CRUD implementation still requires authentication for board/user data, author-only comment modifications, input validation, and conflict handling. Those existing requirements stay in the CRUD plan.


## Container ingress follow-up

Production now also requires `PROXY_SECRET`. Every request except exact GET liveness
must have one matching `X-Kanban-Proxy-Secret` value; rejection is `403 proxy_forbidden`
before Origin/routing/credentials/database work and never changes cookies or sessions.
The Worker replaces this header and removes caller-supplied forwarding headers.
Direct Astro development remains supported when no proxy secret is configured.
The frontend never receives this secret. Existing username/password login stays;
GitHub SSO was explored but is not selected. See the deployment guide for rotation,
Docker/WSL verification and release prerequisites.


## Container preparation verification (October 21, 2026)

- **257 backend tests passed, none skipped**: 234 contract/unit and 23 integration tests using disposable local MongoDB databases. Ruff lint/format passed; the upstream Starlette/HTTPX warning remains.
- **12 frontend API/state tests, 6 Worker tests and 17 isolated Chromium journeys passed**. Astro/TypeScript checks, production build and Wrangler deployment dry-run passed. Browser fixtures used built static preview, not a live API proxy.
- The production Docker image passed auth, ingress/Origin rejection, throttling, CRUD, non-root/no-.env checks and restart persistence against a disposable Docker MongoDB replica set.
- **Full local Worker-to-container acceptance did not pass**: native Windows Wrangler rejects container development; WSL reached image build but its `cloudflare/proxy-everything` networking sidecar exited with status 1 and readiness timed out. The exact cause remains undiagnosed. Environment: Docker Desktop 4.29.0 / engine 26.0.0, Wrangler 4.151.2. Check/update the local Docker/WSL environment and rerun `tests/worker_smoke.py` before considering local routing accepted. Test MongoDB containers/volumes and the stopped test sidecar were removed.
- No application accounts/data, Atlas settings, remote secrets or deployments were changed. Production ingress, Atlas connectivity, sleep/wake, rollout persistence, backups and public-hostname acceptance remain pending.
