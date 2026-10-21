# Authentication follow-up

Status: separately tracked future work, not implemented. Scope confirmed October 20, 2026.

The user explicitly separated login throttling and origin/CSRF protection from the [backend CRUD plan](06-backend-crud.md). These tasks are not part of CRUD delivery or its acceptance checks. Keep the existing JWT cookie authentication and revocable token records; this follow-up does not propose a different authentication system.

## Work to plan and implement separately

- [ ] Login throttling: define limits, keys, cooldown behavior, and deployment assumptions; implement through `backend/app/ratelimit.py` and the login route.
- [ ] Origin checks: define trusted frontend origins and local-development behavior; apply the policy to mutating requests, including login/logout, through `backend/app/middleware.py` or suitable dependencies.
- [ ] CSRF protection: select the mechanism for the existing cookie-based authentication, define server/client token handling where applicable, and cover authenticated mutations.
- [ ] Frontend integration: update request handling for the chosen CSRF mechanism and throttling errors.
- [ ] Documentation: record settings, deployment behavior, and operational limitations in `backend/README.md`.

## Verification for this follow-up

- Requests within the configured login allowance work; excess attempts receive the agreed throttling response and can recover after the cooldown.
- Origin checks accept configured legitimate origins and reject disallowed mutation requests, with explicit behavior for absent origins and local development.
- The selected CSRF mechanism rejects missing/invalid proof where required and accepts legitimate browser mutations.
- Login, current-user lookup, logout, token expiry/revocation, and username-based identity continue to work.
- Rejected requests do not mutate card/comment data or expose credentials and tokens through responses/logs.

The CRUD implementation still requires authentication for board/user data, author-only comment modifications, input validation, and conflict handling. Those existing requirements stay in the CRUD plan.
