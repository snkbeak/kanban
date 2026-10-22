# Implementation plans

Source: [project rough draft](../README.md). Backend CRUD/authentication and frontend API integration are implemented against MongoDB. Isolated browser fixtures and two real multi-session browser journeys against local `kanban_dev` pass; the three local accounts were deliberately provisioned with user authorization. Production is not deployed. The user has requested a D1 migration plan; intended hosted usernames are `sea`, `poopfart`, `sneaky`.

Start here: [Next steps](next-steps.md) records the completed baseline and the remaining setup, frontend integration, collaboration, deployment, and release checks. Frontend, delivery, and deployment plans were reconciled with the implemented backend on October 20, 2026.

Current backend contract: [Backend CRUD plan and implementation resolutions](06-backend-crud.md). Username identity and CRUD are implemented; 78 contract tests and 13 real Atlas integration tests pass. Its decisions supersede conflicting assumptions in earlier plans. Setup and payload examples are in [backend/README.md](../backend/README.md).

Active direction (October 21, 2026): follow the [MongoDB to D1 migration plan](08-d1-migration.md) before deployment. Proposed topology retains FastAPI/Argon2id in Cloudflare Containers and reaches D1 through a private Worker outbound adapter. Prove that path and transactional API behavior before replacing persistence. Target no additional D1 usage charges within the existing paid-plan allowances; there is no verified hard spending cap. Atlas access/gateway work is superseded. Local WSL/sidecar repair remains deferred, not a deployment gate; historical Windows builds/dry-runs do not establish D1 acceptance.

Separate follow-up: [Authentication follow-up](07-auth-follow-up.md) records implemented MongoDB login throttling, strict Origin/CSRF protection and frontend recovery handling (October 21). The Cloudflare Container/Worker and shared-secret ingress check are prepared; remote deployment and production acceptance remain pending.

Supporting plans:

1. [Original scope and decisions](01-scope.md): historical requirements and defaults; conflicting assumptions are superseded by the current backend contract.
2. [Backend and data](02-backend.md): current FastAPI/MongoDB baseline, accounts, API contracts and D1 migration direction.
3. [Frontend](03-frontend.md): Astro, TypeScript, and board interactions.
4. [Delivery and verification](04-delivery.md): implementation milestones, checks, and operation.
5. [Deployment](05-cloudflare-deployment.md): D1 deployment direction plus historical Worker/Container/Atlas preparation and verification.
6. [D1 migration](08-d1-migration.md): active architecture, schema, atomicity, security, cost, implementation milestones, acceptance and recovery plan.

The proposed target is one shared board, Cloudflare Workers Static Assets/API Worker, FastAPI on Cloudflare Containers (Workers Paid), and D1. Current code still uses MongoDB; the migration is not implemented. The user enabled Workers Paid and has Docker Desktop. Deployment remains pending; the existing password/session system is retained. Use periodic refreshes; no queue, Redis, or WebSockets are required for this migration.

Cloudflare/Wrangler frontend deployment, the yellow label “At risk,” and author-only comment modification are confirmed requirements. Decisions marked as assumptions can be revisited during implementation. They are proposed defaults, not additional requirements from the rough draft.
