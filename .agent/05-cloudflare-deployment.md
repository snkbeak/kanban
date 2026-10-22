# Cloudflare deployment plan

Updated October 21, 2026. The user selected **Cloudflare Workers Paid + Cloudflare Containers**, with **MongoDB Atlas**, and confirmed Workers Paid is enabled and Docker Desktop is installed. Keep username/password authentication, Argon2id, HttpOnly cookies, revocable tokens, login limits and strict Origin checks. No GitHub SSO or backend rewrite is planned.

## Prepared topology

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

Checked-in nonsecret vars are `DEPLOYMENT_ENV=production`, `PUBLIC_ORIGIN=https://kanban.sneakybeak.net`, and proposed `MONGO_DB=kanban_prod`. **Confirm that database name before deployment.** Runtime translation sets `APP_ENV=production`, `COOKIE_SECURE=true`, and an exact `TRUSTED_ORIGINS` array. Default token lifetime and login limits remain unchanged. Preview/local configurations must not use production credentials or data.

## Reproducible container build

`backend/Dockerfile` uses digest-pinned Python 3.13 slim and uv images, a committed `backend/uv.lock`, and `uv sync --locked --no-dev`. Dependencies are installed before app files for cache reuse. Run as UID/GID 10001, one Uvicorn worker on port 8000. `.dockerignore` allowlists only pyproject, lockfile and Python app sources: .env files, local MongoDB data, tests and development environments never enter the build context/image.

Build from repository root:

```powershell
docker build --platform linux/amd64 -t kanban-api:local backend
```

Update the lockfile and image digests deliberately with verification. Do not rebuild against floating dependencies. The image never provisions or resets accounts. Startup initializes indexes/metadata idempotently and requires a transaction-capable database.

## Local checks before publishing

Run the container smoke test from `backend/` using the existing virtual environment (or equivalent `uv run python`). Run the Worker smoke test in **Linux/WSL** with Linux Node dependencies and Docker integration; Wrangler rejects local Container development directly on Windows:

```powershell
.venv/Scripts/python.exe tests/container_smoke.py
```

In Linux/WSL, with the required Python and Linux Node dependencies installed, run `python3 tests/worker_smoke.py` from `backend/`.

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

No Atlas configuration, secrets upload, application account provisioning or deployment has been performed by this preparation.

1. Confirm the intended Cloudflare account and `kanban_prod` (or choose another explicit database name).
2. Select a least-privilege Atlas database user for that database. Runtime needs transactions, indexes and application CRUD; it does not need permission to drop databases.
3. Resolve Atlas network access for Cloudflare Container egress. Do not assume the container has a fixed outbound IP, or that Cloudflare's published reverse-proxy IP ranges are its egress addresses. Confirm a supported network policy for the actual Atlas tier. No allowlist is broadened automatically.
4. After explicit authorization, set Worker secrets using `npx wrangler secret put MONGO_URL`, `JWT_SECRET`, and `PROXY_SECRET` from `frontend/`. Enter secrets interactively or through secure local input, never chat, source control, build arguments or command-line literals. Secret operations change remote configuration and are not part of the dry-run.
5. Deliberately provision the intended production accounts once using the existing operator command with the production environment selected. Repeating `app.create_user` resets a password and revokes sessions. Do not seed at startup or reuse test accounts.
6. Deploy only when requested using `npm run deploy`. First provisioning may take minutes. Verify readiness, all three login/me/logout flows, secure cookies, Origin rejection, ingress rejection, throttling/Retry-After, card/comment CRUD, conflicts and ordering through the public hostname.
7. Verify persistence after an actual container sleep/wake and deployment. Local restart tests are not production acceptance.

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

The smallest next system action is an approved **WSL update and restart**, then rerun both probes before full acceptance. Microsoft's [6.6 kernel configuration](https://github.com/microsoft/WSL2-Linux-Kernel/blob/linux-msft-wsl-6.6.y/arch/x86/configs/config-wsl) includes both Xtables features as modules, unlike the current running kernel. This supports testing a newer WSL kernel; it does not establish that an arbitrary Docker upgrade fixes the issue or guarantee module availability in the Docker runtime after updating.

Before any update/restart, save WSL work and coordinate Docker downtime: `wsl --shutdown` terminates **all** WSL distributions and the shared VM. With explicit authorization, use Microsoft's documented `wsl --update`, then restart WSL/Docker Desktop in the agreed window. Recheck `wsl --version`, Ubuntu `uname -r`, and Docker's kernel version, confirm the two probes pass, and rerun:

```powershell
wsl -d Ubuntu -- env PATH=/mnt/c/Users/cjmga/Code/kanban/frontend/.wrangler/wsl-tools/node-v24.19.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin PYTHONPATH=/mnt/c/Users/cjmga/Code/kanban/frontend/.wrangler/wsl-tools/python WRANGLER_CLI=/mnt/c/Users/cjmga/Code/kanban/frontend/.wrangler/wsl-tools/node_modules/wrangler/bin/wrangler.js python3 /mnt/c/Users/cjmga/Code/kanban/backend/tests/worker_smoke.py
```

Microsoft documents [update and shutdown behavior](https://learn.microsoft.com/en-us/windows/wsl/basic-commands). No update, restart, custom kernel installation, global network change, or sidecar bypass was performed. If updating is unsuitable, use a separate Linux development environment whose Docker kernel passes the same probes. Only a full successful harness run accepts Worker routing; passing kernel probes alone is insufficient. MongoDB connectivity through the sidecar remains untested beyond startup.

Follow-up verification: **8 diagnostics/cleanup guard tests passed**, none skipped; Ruff lint and format checks passed for all three changed Python files. The updated real WSL run (`kanban-worker-test-99e870a20e77`) failed promptly on the stopped sidecar and retained its sanitized state under `frontend/.wrangler/<project>/runtime-state.json`. Its generated secrets, sidecar and Compose resources were removed. The baseline rerun's stopped sidecar was explicitly removed. No application acceptance assertion ran in either attempt. The earlier 257 backend, 12 frontend, 6 Worker and 17 browser results remain historical; those suites were not rerun for these harness-only changes.
