# Implementation plans

Source: [project rough draft](../README.md). These documents plan the implementation; no application code exists yet. The target audience is exactly three users: Chris, Sean, and James.

Read and implement in this order:

1. [Scope and decisions](01-scope.md): requirements, assumptions, and boundaries.
2. [Backend and data](02-backend.md): FastAPI, MongoDB, accounts, and API contracts.
3. [Frontend](03-frontend.md): Astro, TypeScript, and board interactions.
4. [Delivery and verification](04-delivery.md): implementation milestones, checks, and operation.
5. [Cloudflare deployment](05-cloudflare-deployment.md): Wrangler frontend deployment, recommended backend/database hosting, and alternatives.

The baseline is one shared board and a static Astro frontend deployed to Cloudflare with Wrangler. The recommended hosting arrangement is Cloudflare Workers Static Assets plus a small API proxy Worker, one FastAPI service on Render, and MongoDB Atlas. Backend/database providers remain recommendations, not confirmed user choices. Use periodic refreshes; three users do not require microservices, a queue, Redis, or WebSockets.

Cloudflare/Wrangler frontend deployment, the yellow label “At risk,” and author-only comment modification are confirmed requirements. Decisions marked as assumptions can be revisited during implementation. They are proposed defaults, not additional requirements from the rough draft.
