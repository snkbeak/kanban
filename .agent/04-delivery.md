# Delivery and verification plan

October 22 update: follow the [Python Worker + D1 milestones](08-d1-migration.md#ordered-implementation-milestones) and [next steps](next-steps.md). Use direct Python handlers, Astro Static Assets and the existing $5/month Paid plan. First prove Python packages/Argon2/JWT/D1; then port HTTP and persistence, verify, and deploy when requested. No FastAPI/Containers or TypeScript adapter in the target. Free next month is optional after measurement. This pass is documentation only.

Updated October 20, 2026. Use [next-steps.md](next-steps.md) as the active execution checklist. [06-backend-crud.md](06-backend-crud.md) and [backend/README.md](../backend/README.md) define the implemented backend; this roadmap no longer assumes backend pagination, shared card/comment versions, optional ordering, or automatic account seeding.

## Completed backend milestone

Username-only accounts, cookie/JWT authentication, read-only users, card/comment CRUD, transactional ordering, independent versions, validation, and health endpoints are implemented. Recorded verification: 78 contract tests, 13 real Atlas integration tests, and Ruff lint/format checks passed.

The Atlas tests created and removed only generated test databases. Application accounts, application database setup, public browser integration, and deployment recovery were not verified by those tests.

## Remaining milestones

| Milestone | Work | Acceptance |
| --- | --- | --- |
| Runtime proof | Plain Python handler, supported packages, Argon2/JWT/cookies, D1 query/batch and assets | Works in actual Python Workers runtime with measured CPU/memory |
| Backend migration | Direct handlers, D1 schema/repositories, auth/limits, CRUD and operator tools | Existing API/security/revision semantics pass real Worker/D1 tests |
| Frontend/collaboration | Retain Astro/TypeScript, polling and drafts; adapt runtime fixtures | Multi-session conflict/recovery and reload journeys pass against Worker/D1 |
| Deployment | One Python Worker with assets/D1, secrets, migrations and deliberate account provisioning | Public hostname works and data/sessions survive Worker redeploy |
| Release/operations | CI, usability, bounded acceptance, isolated recovery, runbook and usage measurement | Hosted behavior/recovery demonstrated on Paid; Free reviewed separately next month |

Details belong in [03-frontend.md](03-frontend.md), [05-cloudflare-deployment.md](05-cloudflare-deployment.md), and the active checklist. Login throttling and origin/CSRF remain separate in [07-auth-follow-up.md](07-auth-follow-up.md), including their later browser/proxy integration.

## Verification matrix

| Area | Contract to preserve and remaining checks |
| --- | --- |
| Accounts | Username primary key and public username only; insert-only provisioning rejects duplicates; reset explicitly replaces hash and revokes sessions; no signup/profile API |
| Authentication | Real Python runtime hashing/JWT/cookies, login/me/logout, revoked/expired sessions, atomic throttling and Origin rejection before side effects |
| Cards | Required single tag, defaults, confirmed lengths, enums, canonical assignees, immutable server fields |
| Ordering | Creates/selector moves append; drag-and-drop supplies anchors; source/destination revisions prevent stale arrangement writes; order survives reloads/redeploys |
| Health | Enter/create in Blocked sets blocked health; lock while there; preserve it when leaving; allow manual health edits outside |
| Concurrency | Content saves use card version, comments use individual versions, discussion advances separately; deletion checks both card/discussion revisions |
| Comments | Author-only individual edits/deletes, 20-comment cap, independent content saves, whole-card removal includes all discussion |
| Queries | Full board is fetched once per refresh; frontend search/filter/count/display-pagination preserves the complete dataset |
| Browser recovery | Drafts survive polls/errors; late responses do not regress content/discussion/order or resurrect deleted cards; uncertain writes are not automatically replayed |
| Usability | Mobile/keyboard/focus behavior, long text, empty states, clear health text/colors, assignment controls |
| Operations | Direct Worker status/cookie/error behavior, no API caching, host/Origin checks, D1 schema readiness, redeploy persistence and isolated restore |

## Automation and handoff

Adapt existing backend assertions to plain Python handlers and real D1 fixtures; run lint/format, Worker runtime integration, packaging/dry-run, TypeScript/Astro checks/build and focused multi-user browser journeys. Use disposable test databases. Generic SQLite or CPython checks alone do not establish Worker/D1 compatibility. Do not require Docker/WSL sidecar repair or rerun Mongo suites as evidence of D1 acceptance.

The backend lockfile is committed; update it deliberately for supported Python Worker dependencies. Document secrets, local startup, migration/provisioning, deployment, password/secret rotation, recovery and rollback. Retire obsolete FastAPI/TestClient/Container tooling after replacement verification; preserve historical results as historical.

Only mark the release complete after public browser workflows and backup restoration have passed; backend test success alone does not establish those outcomes.
