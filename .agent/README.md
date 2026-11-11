# Implementation plans

Updated October 22, 2026. **Active target: plain Python Cloudflare Worker + D1, with Astro/browser TypeScript and the existing $5/month Workers Paid plan.** No FastAPI, ASGI/Uvicorn, Containers or TypeScript API rewrite in the target runtime. Consider Free next month only after measurement. This update is documentation only; executable code remains FastAPI/MongoDB and production deployment is not verified.

Start here: [Next steps](next-steps.md) is the active execution checklist. [Python Workers + D1 migration](08-d1-migration.md) defines architecture, compatibility proof, schema, atomicity, auth, cost and acceptance. [Deployment](05-cloudflare-deployment.md) defines the release sequence. These supersede earlier Container/adapter and Atlas plans.

Current backend contract: [Backend CRUD plan and implementation resolutions](06-backend-crud.md). Username identity and CRUD are implemented; 78 contract tests and 13 real Atlas integration tests pass. Its decisions supersede conflicting assumptions in earlier plans. Setup and payload examples are in [backend/README.md](../backend/README.md).

First future implementation milestone: prove Python runtime packages, Argon2/JWT/cookies, direct D1 queries/batch rollback and Astro assets in one Worker deployment. Then port the HTTP boundary and persistence, retaining Python business rules and the API/security contracts. Do not weaken password hashing for Free. No Docker build or WSL Container-sidecar repair is required by the target.

[Authentication follow-up](07-auth-follow-up.md) records the security contract and historical Mongo/Container evidence. Preserve revocable cookie sessions, persistent login limits, exact Origin checks and frontend recovery. Container-only shared-secret ingress is retired with that boundary.

Supporting plans:

1. [Original scope and decisions](01-scope.md): historical requirements and defaults; conflicting assumptions are superseded by the current backend contract.
2. [Backend and data](02-backend.md): current FastAPI/MongoDB baseline, accounts, API contracts and D1 migration direction.
3. [Frontend](03-frontend.md): Astro, TypeScript, and board interactions.
4. [Delivery and verification](04-delivery.md): implementation milestones, checks, and operation.
5. [Deployment](05-cloudflare-deployment.md): Python Worker/D1 release sequence plus clearly separated historical Container/Atlas evidence.
6. [Python Workers + D1 migration](08-d1-migration.md): active architecture, schema, atomicity, security, cost, milestones, acceptance and recovery.

Keep one shared board and periodic refreshes. Intended production usernames are `sea`, `poopfart`, `sneaky`; preserve local Mongo accounts/data and do not import fixtures. Earlier passing backend/browser/Container checks remain historical, not Python Worker/D1 acceptance. No implementation, resource/account creation, secrets, deployment or billing change occurred in this documentation pass.

Cloudflare/Wrangler frontend deployment, the yellow label “At risk,” and author-only comment modification are confirmed requirements. Decisions marked as assumptions can be revisited during implementation. They are proposed defaults, not additional requirements from the rough draft.
