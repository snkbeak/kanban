# Delivery and verification plan

October 21 update: the [D1 migration milestones](08-d1-migration.md#ordered-implementation-milestones) supersede Mongo/Atlas setup and deployment work in the historical roadmap below. Preserve the API/authentication contract; add real D1 transaction/concurrency tests, private adapter verification, measured usage, authorized hosted acceptance and D1 recovery. Historical passing Mongo tests are not D1 acceptance. Follow [next steps](next-steps.md) for the active checklist.

Updated October 20, 2026. Use [next-steps.md](next-steps.md) as the active execution checklist. [06-backend-crud.md](06-backend-crud.md) and [backend/README.md](../backend/README.md) define the implemented backend; this roadmap no longer assumes backend pagination, shared card/comment versions, optional ordering, or automatic account seeding.

## Completed backend milestone

Username-only accounts, cookie/JWT authentication, read-only users, card/comment CRUD, transactional ordering, independent versions, validation, and health endpoints are implemented. Recorded verification: 78 contract tests, 13 real Atlas integration tests, and Ruff lint/format checks passed.

The Atlas tests created and removed only generated test databases. Application accounts, application database setup, public browser integration, and deployment recovery were not verified by those tests.

## Remaining milestones

| Milestone | Work | Acceptance |
| --- | --- | --- |
| Application setup | Local secret/database configured; three local accounts created once with user authorization; readiness/login verified | Local `kanban_dev` runs; production accounts remain operator-managed |
| Frontend integration | 9 API/state tests, 12 fixture journeys, type checks/build, and two live local journeys pass | Local FastAPI/MongoDB browser workflow and reload/order persistence verified; Atlas application acceptance pending |
| Collaboration | Independent revisions, polling, drafts, conflicts, uncertain writes, and session/network recovery verified with live local sessions | Repeat against the production path before release |
| Deployment | Python service, Cloudflare API proxy, Atlas access, cookies, origin-access decisions | Public hostname uses the complete backend and persists across redeploys |
| Release/operations | Browser coverage, CI, usability, backups, isolated restore, runbook | Multi-user browser flow and recovery are demonstrated |

Details belong in [03-frontend.md](03-frontend.md), [05-cloudflare-deployment.md](05-cloudflare-deployment.md), and the active checklist. Login throttling and origin/CSRF remain separate in [07-auth-follow-up.md](07-auth-follow-up.md), including their later browser/proxy integration.

## Verification matrix

| Area | Contract to preserve and remaining checks |
| --- | --- |
| Accounts | Username primary key and public username only; operator command deliberately resets passwords/revokes sessions when repeated; no signup/profile API |
| Authentication | Browser login/me/logout, expired/revoked sessions, cookies through the proxy; throttling and origin/CSRF tests tracked separately |
| Cards | Required single tag, defaults, confirmed lengths, enums, canonical assignees, immutable server fields |
| Ordering | Creates/selector moves append; drag-and-drop supplies anchors; source/destination revisions prevent stale arrangement writes; order survives reloads/redeploys |
| Health | Enter/create in Blocked sets blocked health; lock while there; preserve it when leaving; allow manual health edits outside |
| Concurrency | Content saves use card version, comments use individual versions, discussion advances separately; deletion checks both card/discussion revisions |
| Comments | Author-only individual edits/deletes, 20-comment cap, independent content saves, whole-card removal includes all discussion |
| Queries | Full board is fetched once per refresh; frontend search/filter/count/display-pagination preserves the complete dataset |
| Browser recovery | Drafts survive polls/errors; late responses do not regress content/discussion/order or resurrect deleted cards; uncertain writes are not automatically replayed |
| Usability | Mobile/keyboard/focus behavior, long text, empty states, clear health text/colors, assignment controls |
| Operations | Proxy status/cookie forwarding, no API caching, implemented origin-access checks, redeploy persistence, consistent isolated backup restore |

## Automation and handoff

Run existing backend lint/format/tests; explicitly set `MONGO_TEST_URL` for real integration checks. Use only disposable generated test databases, never destructive application-data fixtures. Add repeatable TypeScript/Astro checks, frontend production build, and focused multi-user browser journeys in CI.

The current repository ignores `uv.lock`; choose a reproducible release dependency strategy instead of assuming a committed backend lockfile. Document how to configure secrets, start/redeploy, rotate passwords/secrets, back up, restore, and roll back. Resolve the TestClient/HTTPX deprecation warning during dependency maintenance.

Only mark the release complete after public browser workflows and backup restoration have passed; backend test success alone does not establish those outcomes.
