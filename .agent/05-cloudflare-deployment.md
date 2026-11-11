# Cloudflare deployment plan

Updated October 22, 2026. **Active target: plain Python Worker + D1 + Astro Static Assets on the existing $5/month Workers Paid plan.** Follow [the migration plan](08-d1-migration.md) first. No FastAPI/ASGI server, Container, TypeScript SQL adapter or Atlas connection in the target. Current code is unchanged; Python Worker/D1 implementation and deployment remain pending.

This request is documentation only. Later implementation/deployment instructions determine execution scope. Preserve Argon2id, revocable cookie sessions, persistent throttling and strict Origin checks. Keep Paid this month; Free next month is an optional measured follow-up, not a release gate. No billing change now.

## Active Python Worker release sequence

1. Complete the migration plan's Python runtime/auth/D1/assets proof, implementation, local integration/browser checks and packaging dry-run. Record versions, CPU/memory and D1 usage. CPython/Mongo tests alone do not establish compatibility.
2. Verify account access and actual deployed state. Retain account `f7011f208b78981f9835cabb9f4c24c1`, Worker `kanban-sneakybeak-net` and domain `kanban.sneakybeak.net`; proposed D1 database is `kanban-prod`. Recorded targets are not proof of current access. Confirm production is still fresh before creating schema/accounts; preserve any discovered data.
3. Create/select the target D1 database within the authorized release scope, record its actual ID, configure the Python binding and apply reviewed numbered migrations. Development/test databases remain separate. No DDL or account seeding in request handlers.
4. Provision `sea`, `poopfart`, `sneaky` once through the tested insert-only operator tool using hidden password input and the compatible Argon2 profile. No local fixture imports or implicit resets. Supply stable `JWT_SECRET` through runtime secrets, and exact production origin/secure-cookie settings through Worker configuration.
5. Deploy one Python Worker with the Astro static build. Preserve custom-domain ownership, disabled alternate URLs, API-first routing and HTML/404 behavior. Replace the active Container configuration only after checking any deployed Durable Object migration history; retire Mongo/proxy secrets and obsolete image steps. Do not delete remote state blindly.
6. Verify HTTPS, JSON/no-store API responses, Origin rejection before side effects, cookies, login/logout/replay, shared limits and multi-user CRUD/conflicts. Use at most three marked cards and four comments total, two-account collaboration and third-account login. Clean exact acceptance records/sessions; retain counters/order increments and unrelated data.
7. Redeploy the Worker with the same D1 database/JWT secret and prove cards, comments, ordering, sessions and limits persist. Validate recovery separately on disposable data; a restore can resurrect tokens, so document revocation/rotation before restored data is exposed.
8. Record Worker/database/schema identifiers, checks, usage and cleanup. Prefer compatible forward fixes; Worker rollback does not restore database state. Review Free next month using measured CPU/traffic/D1 usage and recovery needs.

Exact new CLI commands belong in the runbook after the Python tooling/configuration is implemented and tested. Existing commands below still operate the old Container/Mongo code. Docker builds, container sleep/wake and WSL sidecar repair are not acceptance gates for this target.

## Historical Container and Atlas preparation

**All sections below are historical/current-code reference, including their pending tasks and commands. They are not release instructions for Python Worker + D1.** Keep diagnostic/test evidence intact; superseded wording such as “active,” “next” or “required” below applies only to the old topology.

## Historical path: deploy and verify on Cloudflare

The user chose to defer local WSL/sidecar repair and proceed toward hosted deployment (October 21, 2026). **Passing local Wrangler-to-container acceptance is not a deployment prerequisite.** Keep its failed result recorded; perform the remaining integration acceptance on Cloudflare after production configuration is ready.

Docker remains necessary for this project's image build/push workflow, which already works from Windows PowerShell. The failing networking sidecar belongs to local `wrangler dev`; it is not needed to build and upload the image. Cloudflare runs the deployed container on its own infrastructure. See the [deployment workflow](https://developers.cloudflare.com/containers/get-started/).

Next: prove the D1 adapter and atomic SQL operations described in [08-d1-migration.md](08-d1-migration.md), then implement and verify the migration before preparing remote approval. Existing Mongo tests and dry-runs are historical evidence, not D1 acceptance. No WSL/Docker upgrade, restart or local sidecar repair is required. This documentation update does not itself deploy or change remote configuration/data.

## Prepared topology

This section describes the current Mongo implementation. The proposed D1 topology is in [the migration plan](08-d1-migration.md#proposed-architecture).

Browser -> `kanban.sneakybeak.net` Worker -> private Container binding -> FastAPI -> Atlas. The Worker also serves Astro static assets. `frontend/wrangler.jsonc` preserves the Worker name, custom domain, HTML/404 behavior, disabled workers.dev and preview URLs. `/api` and `/api/*` always run the Worker first; API errors never fall through to HTML.

`frontend/worker/index.ts` uses the supported `@cloudflare/containers` class/default scheduling policy and one named instance (`shared-board`). The initial instance is **basic: 1 GiB RAM, 1/4 vCPU**, with **max_instances=1** and **2 minutes idle sleep**. This gives more room for Argon2 than the 256 MiB lite tier. It is a starting configuration, not a production performance guarantee. Image rollout can temporarily interrupt this single instance. MongoDB holds every persistent application record; container disk is disposable.

The Worker forwards each API call once, with a 20-second deadline covering startup and response body, inside the frontend's existing 25-second timeout. No write is replayed. Startup/transport failures and unexpected HTML/redirects become generic API error envelopes; slow requests return `504 gateway_timeout`. A timed-out write may have committed: refresh before any explicit retry. Cookies, statuses, JSON envelopes and Retry-After survive; all API responses use `Cache-Control: no-store`.

## Ingress and secret handling

Production FastAPI requires a random `PROXY_SECRET` of at least 32 characters. The Worker replaces the incoming `X-Kanban-Proxy-Secret` header with its secret and forwards only selected browser headers. It does not forward arbitrary Host, forwarding, client-IP or upstream-destination headers. The backend compares exactly one secret header in constant time before routing, authentication, rate-limit reservations or database operations. Only exact GET `/api/health/live` bypasses this check for local container health; readiness and all other paths require it. This authenticates the Worker, not the user.

The container is addressed through its Durable Object binding, not a configured public backend URL. There is no public container administration/restart route. Production alternate Worker URLs remain disabled. Validate the deployed ingress configuration before claiming live bypass protection. Uvicorn has proxy-header processing and access logging disabled. Database initialization failures are logged generically; no secrets, request bodies or JWTs should be logged.

Accepted browser Origin is preserved unchanged. The Worker rejects unsafe requests without the exact public Origin before waking the container; FastAPI repeats its full check. Missing/null/duplicate/untrusted Origin cannot be repaired with Referer, Host or forwarding headers. GET restoration still needs no Origin. All existing user authentication and CRUD authorization remain in FastAPI.

Worker secrets, supplied only at runtime:

- `MONGO_URL`: Atlas connection URI with database credentials and TLS. Never put it in Wrangler vars or assets.
- `JWT_SECRET`: random stable signing secret; preserve across restarts to preserve sessions.
- `PROXY_SECRET`: a separate random secret for ingress authentication.

Checked-in nonsecret vars are `DEPLOYMENT_ENV=production`, `PUBLIC_ORIGIN=https://kanban.sneakybeak.net`, and `MONGO_DB=kanban_prod`. The user confirmed this is a fresh production database on October 21. Runtime translation sets `APP_ENV=production`, `COOKIE_SECURE=true`, and an exact `TRUSTED_ORIGINS` array. Default token lifetime and login limits remain unchanged. Preview/local configurations must not use production credentials or data.

## Reproducible container build

`backend/Dockerfile` uses digest-pinned Python 3.13 slim and uv images, a committed `backend/uv.lock`, and `uv sync --locked --no-dev`. Dependencies are installed before app files for cache reuse. Run as UID/GID 10001, one Uvicorn worker on port 8000. `.dockerignore` allowlists only pyproject, lockfile and Python app sources: .env files, local MongoDB data, tests and development environments never enter the build context/image.

Build from repository root:

```powershell
docker build --platform linux/amd64 -t kanban-api:local backend
```

Update the lockfile and image digests deliberately with verification. Do not rebuild against floating dependencies. The image never provisions or resets accounts. Startup initializes indexes/metadata idempotently and requires a transaction-capable database.

## Available checks and optional local development

The production-image smoke test already passed. To rerun it after relevant backend/container changes, use the existing virtual environment from `backend/` (or equivalent `uv run python`):

```powershell
.venv/Scripts/python.exe tests/container_smoke.py
```

The full local Worker smoke test is **optional and currently deferred**. If local development is revisited, run `python3 tests/worker_smoke.py` from `backend/` in Linux/WSL with Linux Node dependencies and Docker integration; Wrangler rejects local Container development directly on Windows. Do not repair WSL or rerun this harness as a gate before deployment.

The first builds the production image and runs real auth, proxy/CSRF, throttling and CRUD checks on an isolated Docker MongoDB replica set, then restarts the API and verifies sessions, allowances and content survive. The second uses local Wrangler, the actual container, built static assets, generated fixture credentials and a separate disposable MongoDB replica set. Both use uniquely named Compose projects and remove only their own containers/volumes. Neither reads application .env files or contacts Atlas. The Worker check requires frontend `npm run build` first and free port 8787. Test logs/config live under ignored `.wrangler/`. The Worker harness now detects stopped sidecars during readiness, records only nonsecret state in `runtime-state.json`, removes its generated `.dev.vars`, and removes leftover Worker containers/sidecars by exact generated project/name and immutable Docker ID after stopping Wrangler. It does not prune images or build cache.

From `frontend/`:

```powershell
npm test
npm run test:worker
npm run check
npm run deploy:check
```

`deploy:check` builds the frontend, bundles the Worker and builds the container image with `wrangler deploy --dry-run`; it does not publish. Isolated browser fixtures can still run against Astro static preview. The existing Astro dev-server route-loading issue is separate maintenance.

For manual container development, copy `.dev.vars.example` to ignored `.dev.vars`, supply only development secrets and a deliberately selected development replica-set URL, then run `npm run preview:cloudflare`. Run this command in Linux/WSL. It uses `wrangler.local.jsonc`, `http://127.0.0.1:8787`, insecure local cookies, and `kanban_container_dev`. It does not seed users. Do not use the production Wrangler configuration with local secrets. Static `npm run preview` still has no API proxy.

## Atlas and release prerequisites

**Superseded for the active D1 path.** Retained to explain the earlier preparation; do not create Atlas access entries, gateways or credentials for this migration.

These are the active next steps. No Atlas configuration, secrets upload, application account provisioning or deployment has been performed by this preparation.

The coordinated plan below supersedes the earlier preparation reports. Targets are confirmed; remote mutation authorization, Atlas access/credentials and hosted acceptance remain pending. First deployment will supply secrets with the application, and account creation will use the insert-only operator path.

## Coordinated release plan (October 21, 2026)

Historical Mongo release proposal, superseded by [D1 migration and release](08-d1-migration.md). Confirmed Cloudflare identity/hostname and intended usernames still apply. Atlas network/secret/provisioning instructions do not.

### Confirmed targets and preflight evidence

| Item | Selection / evidence |
| --- | --- |
| Cloudflare | User confirmed `christopher.mitchell027@gmail.com`; account `f7011f208b78981f9835cabb9f4c24c1` is pinned in Wrangler |
| Hostname | User owns `sneakybeak.net` and selected `kanban.sneakybeak.net` |
| Zone | Authenticated read-only API confirms the zone is active in the selected account |
| Existing hostname | No matching Worker Custom Domain; public A/CNAME lookups returned NXDOMAIN. DNS record API returned 403, so administrative DNS inventory remains unverified. Stop on any deployment conflict; do not replace/delete a record automatically |
| Existing deployment | Worker deployment lookup returned 404; user confirms never deployed. Treat as first deployment, not a rollback target |
| Atlas | User selected Project 0 / Cluster0, free tier, AWS N. Virginia (`us-east-1`); project ID, connection hostname, credential permissions and network entries remain unverified |
| Database | `kanban_prod`, confirmed fresh; verify absence/compatibility before writes |
| Application accounts | User selected `sea`, `poopfart`, `sneaky`; this confirms names, not permission to create/reset them |

Read-only Cloudflare API calls used the existing local login and printed only nonsecret metadata. No Atlas connection, secret upload, account creation, remote configuration change or application request has occurred in this coordination pass.

### Atlas proposal for approval

Use the existing Cluster0; no cluster creation, tier upgrade, private endpoint or peering is proposed. Require the Atlas TLS URI with certificate and hostname verification and a dedicated credential restricted to `kanban_prod` and Cluster0. `MONGO_URL` selects the URI independently of `MONGO_DB`; never fall back to the local `.env` database. Confirm replica-set/mongos topology and transaction support before launch.

Proposed custom role `kanban_runtime`: `FIND`, `INSERT`, `UPDATE`, `REMOVE`, `CREATE_COLLECTION`, `CREATE_INDEX`, and `LIST_INDEXES` on the six collections `users`, `tokens`, `login_limits`, `cards`, `counters`, `column_orders`; `DROP_INDEX` on `users` only for the startup removal of the obsolete username index. No database/collection deletion, admin, user-management or cross-database privileges. Confirm these resources/actions in the selected Atlas project before applying the role. Any broader built-in-role substitution requires a new explicit scope decision. [Atlas custom role actions](https://www.mongodb.com/docs/atlas/reference/custom-role-actions/).

**User correction (October 21): internet-wide Atlas access is rejected, including temporary `0.0.0.0/0`.** Production connectivity must remain restricted and must not expire after seven days. The only proposed temporary entry is the user's exact current public IPv4 address (`/32`) for one-time preflight/account provisioning; remove that entry afterward. The running application needs a separate permanent, restricted network path. Confirm any existing entry's ownership before removal, close the provisioning client's connections, and verify a new direct connection from the computer is denied after removal. Access-list removal may not immediately terminate existing connections. [Atlas access lists](https://www.mongodb.com/docs/atlas/security/ip-access-list/).

Cloudflare's non-HTTP egress requires `enableInternet=true`, already configured. HTTP outbound handlers do not route normal MongoDB traffic. No documented dedicated fixed egress IP for standard Containers was found in the current documentation review; an observed IP or Cloudflare reverse-proxy ranges do not establish an address exclusive to this application. Atlas's network access list accepts source addresses, not a Worker name, account ID, hostname or application secret. FastAPI/PyMongo in the container is the database client; the Worker currently forwards HTTP only. [Container outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/).

### Restricted connectivity design required before deployment

Desired steady state: `Cloudflare Container -> authenticated encrypted egress gateway -> Atlas`, with Atlas allowing only the gateway's dedicated permanent source IP(s), and only this application's credentials permitted to use the gateway for Cluster0. The user's temporary `/32` is removed after seeding; removing it must not affect hosted connectivity. Database TLS hostname/certificate verification and scoped database credentials remain mandatory. Do not replace internet-wide Atlas access with an unauthenticated public database relay.

This is a candidate architecture, not a validated implementation or purchase authorization. A gateway adds a service, operating cost and a failure dependency. Before selecting it, confirm exclusive static source IPs, authenticated encrypted transport from the container, restriction to all Cluster0 replica-set destinations/ports, SRV discovery, primary changes, transactions, reconnects after sleep/rollout, and no direct-egress fallback. Verify the source IP actually observed by Atlas. Preserve the existing FastAPI authentication and CRUD contracts.

The installed asynchronous PyMongo code has no `proxyHost`/SOCKS configuration path; MongoDB's generic SOCKS specification does not prove this driver's support. Do not claim that setting `HTTPS_PROXY` or adding a SOCKS URI solves connectivity. A tested TCP tunnel/forwarding integration is required. OpenSSH offers authenticated encrypted TCP forwarding, but a production design must cover every replica-set host while retaining original TLS hostnames; a single localhost forward or disabled certificate checking is insufficient. [OpenSSH forwarding](https://man.openbsd.org/ssh).

Other evaluated paths:

- Workers VPC now supports raw TCP via its Worker binding and can route through Gateway, but does not automatically reroute PyMongo sockets inside this container. Cloudflare's dedicated Gateway egress IPs require a Zero Trust Enterprise add-on; Workers Paid alone does not include that capability. [VPC Networks](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/), [dedicated egress IPs](https://developers.cloudflare.com/cloudflare-one/traffic-controls/egress-policies/dedicated-egress-ips/).
- Atlas Free has neither network peering nor private endpoints. Private endpoints require M10+ and an actual private network connection; an Atlas upgrade alone does not connect the Cloudflare container. No upgrade is authorized. [Free-tier limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [private endpoints](https://www.mongodb.com/docs/atlas/security-private-endpoint/).
- Moving the existing FastAPI container to a host with dedicated fixed outbound IPs could simplify the route while retaining Cloudflare for the frontend/Worker. This changes the selected hosting architecture and requires the user's decision; it is not being implemented automatically.

### Execution order and authorization boundaries

1. Resolve and validate the permanent restricted egress design above, including its cost and operating requirements. Then obtain approval for that concrete network setup, a temporary computer-only `/32` entry and its removal, scoped database role/user, read-only database preflight, insert-only accounts, secret upload, publication, startup writes, bounded acceptance and one replacement rollout. The user chooses a quiet test window. Internet-wide Atlas access is excluded. No password resets, DNS-record replacement, database resets, system upgrades or WSL repair are included.
2. Prepare an access-restricted local secrets file outside this repository and all build/static contexts, using hidden local input. Never send credentials in chat or command arguments. Identify the actual Cluster0 connection hostname and project ID from the Atlas console; do not infer a URI from its display name. Generate independent random JWT and ingress secrets (at least 32 characters; prefer 48 random bytes). Preserve any existing JWT secret if previous sessions are discovered. Save durable copies in the approved password manager, then remove the temporary upload copy after deployment. Verify only key presence/lengths, never values. First upload needs `MONGO_URL`, `JWT_SECRET`, `PROXY_SECRET`; no secret file exists from this preparation.
3. Apply only the approved Atlas entries and role/user, recording IDs/expiry without credentials. With the explicitly selected database, perform read-only preflight without importing/starting FastAPI: inspect topology and collection/index metadata, query approved canonical usernames with inclusion projection `{_id: 1}`, and check legacy-field existence without retrieving hashes/tokens/documents. If data unexpectedly exists, stop for schema/index/backup review. FastAPI startup is not a read-only preflight: it creates indexes, initializes counters/order metadata and may remove the obsolete users index.
4. Report absent/existing account names. Skip existing accounts. For each approved absent name, run `.venv/Scripts/python.exe -m app.provision_user --database kanban_prod <username>` from `backend/` in a secure interactive terminal. It reads URI/password without echo, confirms the password, performs a single majority-acknowledged Argon2id insert, disables write retries and refuses duplicates. It does not touch sessions. On an uncertain result, check existence privately before retrying. `app.create_user` remains a reset command and must not be substituted.
5. From `frontend/`, run `npm.cmd run build`, then `npx.cmd wrangler deploy --secrets-file "<protected-file-path>"` only after authorization. Required secret names are declared in Wrangler. `secret put` immediately deploys a version; it is not harmless prerequisite setup. Existing deployments can later use `npm.cmd run deploy` to retain secrets. [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
6. Record the source commit, Worker deployment/version ID, container application/image identity and UTC time. Confirm custom domain and certificate readiness, disabled alternate URLs, private container binding and no public backend/admin route. Cloudflare creates the Custom Domain DNS record and certificate; no manual origin-IP record is needed. An existing CNAME blocks attachment and requires separately scoped resolution. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
7. Wait for real container readiness. Worker activation precedes image processing and a deployment can partially succeed. Do not interpret a CLI failure as proof nothing changed. Inspect actual state before recovery or retry. A first deployment may take minutes. [Deployment behavior](https://developers.cloudflare.com/containers/guides/deploy/).
8. Execute and record the bounded acceptance below, clean up only the approved test records/sessions, and record any unverified checks. A hosted failure does not justify resuming local WSL troubleshooting. Update this runbook and commit actual results locally after execution.

### Hosted acceptance scope

- **Record budget:** at most three cards and four comments total, marked `hosted-acceptance-<UTC>-<random>`, with exact IDs tracked in a sanitized ledger. Use `sea` and `poopfart` for collaboration and check `sneaky` login separately. Only marked IDs may be deliberately edited/moved/deleted. Ordering can renumber existing card positions; preserve their relative order. Ticket counters and shared column revisions advance permanently and are never reset. Stop cleanup if another user has contributed to a test card.
- **Public/readiness checks:** HTTPS `/`, `/login` and referenced JS/CSS; exact `200 {"status":"ok"}` liveness/readiness; JSON 404 for unknown API paths; unauthenticated board/me 401; API `Cache-Control: no-store`. API reads can wake the container, incur usage and trigger startup writes.
- **Origin/ingress:** bounded unsafe requests with missing, null, foreign, malformed and duplicate Origin plus spoofed Referer/forwarding headers must yield `403 csrf_rejected` without cookies. Use nonexistent IDs for mutation probes. Public forged proxy headers are overwritten, but this does not prove direct ingress rejection. Inspect private binding configuration. Test missing/wrong/duplicate ingress secrets only if an approved private diagnostic path exists; otherwise explicitly record direct hosted ingress rejection as unverified. Do not expose a diagnostic endpoint.
- **Accounts/sessions:** each approved account logs in, restores through reload and GET `/api/auth/me` without Origin, and logs out. Check host-only `Secure; HttpOnly; SameSite=Lax; Path=/` attributes without saving values; no JWT/password in browser storage and cleared password field. Rejected logout preserves the session; valid logout clears its cookie, and private replay of the old cookie returns 401. Keep one session for persistence checks before its final logout. Disable screenshots/traces/state exports that could capture secrets.
- **Throttle:** confirm one unused synthetic username, make five invalid attempts then a sixth expecting `429 login_throttled` and positive `Retry-After`. The global bucket is 30 attempts per five minutes; username buckets are five per 15 minutes. Track all test logins, avoid real-user throttling and stop on unexpected limits. Existing sessions must remain usable. After persistence intervals, make at most one additional synthetic attempt per interval while the original username window remains active; do not reset buckets or automatically retry. If the window has elapsed, record that persistence assertion as unverified.
- **CRUD/concurrency:** create/read/edit the three cards and use no more than four comments across all scenarios. Verify author-only comment edits/deletes, stale content/comment/order 409s, retained drafts and explicit refresh/reapply, selector moves, within-column order, Blocked behavior and reload persistence. Guard card deletion with both content and discussion revisions. An uncertain write requires refresh before any explicit retry.
- **Sleep and rollout:** retain marked records, one session and the unused-name allowance. Stop all board polling; observe actual sleep after the configured two-minute idle period using platform state/metrics, then wake via readiness. Verify session, cards/comments/order and any unexpired throttle state. Repeat after one authorized actual container replacement while preserving Atlas/JWT. An unchanged deployment can skip rollout: record actual instance/image replacement, not just CLI success. Prepare the specific replacement action/image before executing; use a harmless image metadata change if needed, with the diff recorded. Never alter auth or database content to force a rollout. [Container rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/).
- **Cleanup/recovery:** delete only ledger IDs using freshly fetched revision guards, log out test sessions, let limits expire, remove temporary secret upload material, and remove the approved computer-only Atlas entry. Verify the computer's new direct connections are rejected while container connectivity survives sleep/rollout through the permanent restricted route. Halt for security failures, lost persistence, unexplained writes or sustained readiness failure. Recovery/rollback must be explicitly authorized and restore compatible Worker/container/config while preserving Atlas. With no previous deployment, there is no proven prior version to roll back to. Recheck readiness, sessions, ingress and persistence after recovery.

Existing smoke harnesses seed disposable databases and delete their resources, the container probe can persist a raw cookie, and the live browser suite assumes localhost. **Do not retarget them unchanged.** Hosted interactions must implement the limits above; until those run, historical fixture/smoke results are not hosted acceptance.

### Coordination verification and remaining dependencies

- Preserved all six pre-existing deployment-first documentation edits from commit `2381450`; local WSL acceptance remains deferred.
- Added required-secret declarations and pinned the confirmed Cloudflare account. Added a separate insert-only provisioning command; password authentication, Argon2id settings, cookies, revocation, Origin/CSRF, throttling and CRUD runtime code remain unchanged.
- Eight focused provisioning tests passed without MongoDB access; Ruff lint/format passed. The initial run had seven passes plus a pytest cache warning and one lint issue, corrected before the final eight-test run with cache disabled.
- Wrangler 4.151.2 deployment dry-run passed with required secrets declared: Worker bundle, 14 existing static files and Windows Docker image build. It published nothing. The account pin was added after this dry-run and matches the authenticated active-zone read. No frontend source changed; historical frontend/browser/backend suites were not repeated.
- Cloudflare zone ownership is verified; DNS administrative inventory is not readable with the current login. Atlas credentials/network permissions, database preflight, production provisioning, upload, publication and every hosted acceptance result remain pending. No remote cleanup was needed because no remote mutation occurred. The local dry-run removed its temporary image tag; no system upgrade or sidecar repair occurred.
- User rejected the seven-day internet-wide access proposal before any remote changes. Smallest next action: choose and validate a permanent authenticated fixed-egress service compatible with the current container, or obtain a decision to change backend hosting. Provider selection/cost and the TCP integration remain unresolved. Computer-only seeding access can be removed independently once that route works. Do not paste credentials into chat.

## Costs and operations

Workers Paid's $5 monthly subscription is a base, not a spending cap. Container memory/disk usage accrues while awake; CPU and other platform usage are also billed. Two-minute idle sleep limits idle time only: a visible signed-in board polls every 15 seconds and keeps the instance awake; API probes/scanners can also wake it. Static assets do not require the API container. Do not schedule frequent readiness probes if idle sleep is desired. Configure billing alerts and inspect usage after launch. No billing settings were changed here.

For restart/redeploy, preserve the database and JWT secret. For `PROXY_SECRET` rotation, update the Worker secret and roll/restart the container so both ends receive the same value; a mixed rollout may temporarily reject requests, so use a maintenance window. JWT rotation intentionally invalidates all sessions. Password rotation uses the existing operator command and revokes that user's records.

Rollback must restore a compatible Worker **and** container image/configuration, preserving Atlas data. Keep the previous source commit/image identity; do not assume rolling back only the Worker also rolls back the container. No destructive database rollback is automated.

Back up `users`, `tokens`, `login_limits`, `cards`, `counters`, and `column_orders` consistently. Choose backup/retention for the actual Atlas tier and test restoration into an isolated database. Revoke restored sessions or rotate JWT secrets before exposing a restore. Production backups, restore acceptance, CI, mobile/keyboard acceptance and operational runbook exercises remain pending.

References: [Containers getting started](https://developers.cloudflare.com/containers/get-started/), [Container class](https://developers.cloudflare.com/containers/api/container-class/), [pricing](https://developers.cloudflare.com/containers/platform/pricing/), [outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/), [Atlas backup/restore](https://www.mongodb.com/docs/atlas/backup-restore-cluster/).


## Container preparation verification (October 21, 2026)

- **257 backend tests passed, none skipped**: 234 contract/unit and 23 integration tests using disposable local MongoDB databases. Ruff lint/format passed; the upstream Starlette/HTTPX warning remains.
- **12 frontend API/state tests, 6 Worker tests and 17 isolated Chromium journeys passed**. Astro/TypeScript checks, production build and Wrangler deployment dry-run passed. Browser fixtures used built static preview, not a live API proxy.
- The production Docker image passed auth, ingress/Origin rejection, throttling, CRUD, non-root/no-.env checks and restart persistence against a disposable Docker MongoDB replica set.
- **Full local Worker-to-container acceptance remains blocked**: the WSL kernel lacks the sidecar's socket-match and TPROXY features. The follow-up below establishes this with isolated rule probes and the running kernel configuration. It is not an application, Atlas, billing, or ARM64 image-selection diagnosis. Test MongoDB containers/volumes and stopped sidecars were removed.
- No application accounts/data, Atlas settings, remote secrets or deployments were changed. Production ingress, Atlas connectivity, sleep/wake, rollout persistence, backups and public-hostname acceptance remain pending.

## WSL networking diagnosis (October 21, 2026)

**Deferred reference only:** this diagnosis explains the failed local test. The user selected hosted deployment/verification instead; the repair instructions below are optional future local-development work, not additional deployment requirements.

Environment: Windows 10 build 19045, WSL 2.1.5.0, Ubuntu and Docker sharing kernel `5.15.146.1-microsoft-standard-WSL2`, Docker Desktop 4.29.0 / Engine 26.0.0, Linux AMD64, cgroup v1. Wrangler 4.151.2 and `@cloudflare/containers` 0.3.7 use isolated Linux Node 24.19.0 under `frontend/.wrangler/wsl-tools/`.

The exact cached sidecar is `cloudflare/proxy-everything:3cb1195@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8`; Docker confirms `amd64`. An unmodified harness rerun (`kanban-worker-test-8e5e0e0b0075`) built the application image, then timed out before readiness. Workerd explicitly reported `started sidecar not running`. The stopped sidecar had exit 1, `OOMKilled=false`, empty Docker state error, and `NET_ADMIN`. Its command enabled DNS/TLS interception and disabled IPv6. MongoDB was healthy; FastAPI never launched. Empty Wrangler-sidecar logs did not identify the cause.

Running that cached image directly with `NET_ADMIN` in a disposable, separate network namespace produced the missing diagnostic: the IPv4 socket-match rule failed with `Extension socket revision 0 not supported, missing kernel module?` and `RULE_APPEND failed (No such file or directory)`; the sidecar exited 1. An independent TPROXY rule probe also failed (iptables exit 4). The running kernel's `/proc/config.gz` confirms:

```text
# CONFIG_NETFILTER_XT_MATCH_SOCKET is not set
# CONFIG_NETFILTER_XT_TARGET_TPROXY is not set
# CONFIG_NF_TPROXY_IPV4 is not set
# CONFIG_NF_TPROXY_IPV6 is not set
```

These are compiled-out capabilities; installing an Ubuntu userspace package or calling `modprobe` cannot add them to this running kernel. Cloudflare's [exact sidecar source](https://github.com/cloudflare/proxy-everything/blob/3cb1195/main.go#L978-L1009) requires the failing socket rule before its TPROXY rules. [Workers SDK issue 14056](https://github.com/cloudflare/workers-sdk/issues/14056) independently reports the WSL socket-module prerequisite, although that issue's subsequent HTTPS-reset problem was **not** reproduced here. [Sandbox issue 522](https://github.com/cloudflare/sandbox-sdk/issues/522) concerns ARM64 image selection; its workaround does not address this AMD64 kernel failure. Keep Cloudflare's [local development guidance](https://developers.cloudflare.com/containers/guides/local-dev/) as the general setup reference.

Repeat the capability probes from PowerShell (cached image only; each container removes itself, and rules are confined to its own namespace):

```powershell
$sidecarImage = 'cloudflare/proxy-everything:3cb1195@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8'
docker run --rm --pull=never --cap-add NET_ADMIN --entrypoint iptables $sidecarImage -t mangle -A PREROUTING -p tcp -m socket -j ACCEPT
docker run --rm --pull=never --cap-add NET_ADMIN --entrypoint iptables $sidecarImage -t mangle -A PREROUTING -p tcp -j TPROXY --tproxy-mark 0x1/0x1 --on-port 41209
```

If local development is revisited, the proposed repair is an approved **WSL update and restart**, then both probes before full local acceptance. Microsoft's [6.6 kernel configuration](https://github.com/microsoft/WSL2-Linux-Kernel/blob/linux-msft-wsl-6.6.y/arch/x86/configs/config-wsl) includes both Xtables features as modules, unlike the current running kernel. This supports testing a newer WSL kernel; it does not establish that an arbitrary Docker upgrade fixes the issue or guarantee module availability in the Docker runtime after updating.

Before any update/restart, save WSL work and coordinate Docker downtime: `wsl --shutdown` terminates **all** WSL distributions and the shared VM. With explicit authorization, use Microsoft's documented `wsl --update`, then restart WSL/Docker Desktop in the agreed window. Recheck `wsl --version`, Ubuntu `uname -r`, and Docker's kernel version, confirm the two probes pass, and rerun:

```powershell
wsl -d Ubuntu -- env PATH=/mnt/c/Users/cjmga/Code/kanban/frontend/.wrangler/wsl-tools/node-v24.19.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin PYTHONPATH=/mnt/c/Users/cjmga/Code/kanban/frontend/.wrangler/wsl-tools/python WRANGLER_CLI=/mnt/c/Users/cjmga/Code/kanban/frontend/.wrangler/wsl-tools/node_modules/wrangler/bin/wrangler.js python3 /mnt/c/Users/cjmga/Code/kanban/backend/tests/worker_smoke.py
```

Microsoft documents [update and shutdown behavior](https://learn.microsoft.com/en-us/windows/wsl/basic-commands). No update, restart, custom kernel installation, global network change, or sidecar bypass was performed. A separate Linux development environment whose Docker kernel passes the same probes is another optional local-development route. Only a full successful harness run accepts the local Worker path; passing kernel probes alone is insufficient. MongoDB connectivity through the local sidecar remains untested beyond startup. Hosted Worker/Container/Atlas acceptance will be evaluated separately on Cloudflare.

Follow-up verification: **8 diagnostics/cleanup guard tests passed**, none skipped; Ruff lint and format checks passed for all three changed Python files. The updated real WSL run (`kanban-worker-test-99e870a20e77`) failed promptly on the stopped sidecar and retained its sanitized state under `frontend/.wrangler/<project>/runtime-state.json`. Its generated secrets, sidecar and Compose resources were removed. The baseline rerun's stopped sidecar was explicitly removed. No application acceptance assertion ran in either attempt. The earlier 257 backend, 12 frontend, 6 Worker and 17 browser results remain historical; those suites were not rerun for these harness-only changes.
