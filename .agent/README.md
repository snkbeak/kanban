# Implementation plans

Source: [project rough draft](../README.md). Backend CRUD/authentication and frontend API integration are implemented. Isolated browser fixtures and two real multi-session browser journeys against local `kanban_dev` pass; the three local accounts were deliberately provisioned with user authorization. Atlas application acceptance and deployment remain pending. The target audience is exactly three users: Chris, Sean, and James.

Start here: [Next steps](next-steps.md) records the completed baseline and the remaining setup, frontend integration, collaboration, deployment, and release checks. Frontend, delivery, and deployment plans were reconciled with the implemented backend on October 20, 2026.

Current backend contract: [Backend CRUD plan and implementation resolutions](06-backend-crud.md). Username identity and CRUD are implemented; 78 contract tests and 13 real Atlas integration tests pass. Its decisions supersede conflicting assumptions in earlier plans. Setup and payload examples are in [backend/README.md](../backend/README.md).

Separate follow-up: [Authentication follow-up](07-auth-follow-up.md) records implemented MongoDB login throttling, strict Origin/CSRF protection and frontend recovery handling (October 21). Deployment and authenticated proxy/backend-origin protection remain pending outside CRUD scope.

Supporting plans:

1. [Original scope and decisions](01-scope.md): historical requirements and defaults; conflicting assumptions are superseded by the current backend contract.
2. [Backend and data](02-backend.md): FastAPI, MongoDB, accounts, and API contracts.
3. [Frontend](03-frontend.md): Astro, TypeScript, and board interactions.
4. [Delivery and verification](04-delivery.md): implementation milestones, checks, and operation.
5. [Deployment](05-cloudflare-deployment.md): existing Cloudflare configuration, pending API proxy/backend hosting, Atlas setup, and recovery verification.

The target is one shared board, the existing Cloudflare static frontend configuration plus a pending API proxy Worker, a hosted FastAPI service, and Atlas. Atlas access has been verified; the Python host/tier remains unselected, with Render an option. Use periodic refreshes; three users do not require microservices, a queue, Redis, or WebSockets.

Cloudflare/Wrangler frontend deployment, the yellow label “At risk,” and author-only comment modification are confirmed requirements. Decisions marked as assumptions can be revisited during implementation. They are proposed defaults, not additional requirements from the rough draft.
