# Backend and data

October 21 direction: [migrate persistence to D1](08-d1-migration.md) while retaining FastAPI, Argon2id and the public API. This file describes the current Mongo implementation; D1 repositories, migrations, SQL atomicity and private adapter are planned, not implemented. Production usernames are `sea`, `poopfart`, `sneaky`; historical local account examples below do not authorize production seeding.

Updated October 20, 2026 to reflect implementation. Confirmed decisions in [06-backend-crud.md](06-backend-crud.md) supersede the original backend proposals. Setup, payload examples, finalized contracts, and verification commands are in [backend/README.md](../backend/README.md).

## Structure and identity

FastAPI uses PyMongo Async, Pydantic schemas, feature routes, and `cards_store.py` for persistence. Dependencies are declared in `backend/pyproject.toml`; `uv sync` resolves a local lockfile, which the current repository ignores. Startup initializes indexes and validates database compatibility; shutdown closes the shared client.

Accounts contain canonical username as MongoDB `_id` plus a password hash. Public responses contain username only. No separate user ID, display name, or avatar path is stored. `python -m app.create_user <username>` creates an account or deliberately resets its password and revokes tokens. Creation/login share trim/lowercase normalization. Intended accounts are `chris`, `sean`, and `james`; frontend pictures can be keyed by username.

Authentication retains the HttpOnly JWT cookie and revocable token records. JWT subjects and token ownership use username; old UUID sessions fail. Throttling and origin/CSRF work are tracked separately in [07-auth-follow-up.md](07-auth-follow-up.md).

## Collections

- `users`: username primary key and Argon2 hash; read-only through the API.
- `tokens`: unique JWT ID, owning username, TTL expiration. Authentication checks signature, expiry, record ownership, and record expiry.
- `cards`: generated card ID, unique ticket number, title, description, singular required tag, column, integer position, difficulty, health, assignee usernames, creator username, timestamps, content version, discussion version, embedded comments.
- `counters`: atomic ticket allocation, never decremented after failures/deletion.
- `column_orders`: internal revision for each fixed column.

Comments use generated IDs, immutable author usernames, timestamps, text, and individual versions. Maximum 20 current comments per card. Only authors can mutate individual comments; every signed-in user can edit/delete cards and their entire discussions.

`GET /cards` returns all full records and ordering revisions. No backend filtering, search, pagination, or summary/detail split is implemented. These replace the original query proposals.

## Atomicity

MongoDB must be a replica set (one local node suffices) or Atlas. Standalone MongoDB is no longer supported. Transactions coordinate card/order changes; moves renumber integer positions in the destination column. Creates append, selector moves append, and drag-and-drop supplies an anchor.

Content edits/moves require `expected_version`; moves also require source/destination ordering revisions. Entering Blocked sets blocked health atomically; leaving retains it. Non-blocked health is invalid while in Blocked.

Comments never advance card content versions or parent timestamps. Edits/deletions require the targeted comment version; every comment mutation advances the discussion revision. Whole-card deletion checks content and discussion versions. Conflicts return 409; clients preserve drafts and explicitly refresh/reapply.

## Verification and remaining work

Verification completed October 20, 2026: 78 contract tests and all 13 real Atlas integration tests passed, along with Ruff lint and formatting checks. Disposable database tests cover persistence, indexes, authentication, concurrency, ownership, limits, ordering, and rollback. The user initially deferred local MongoDB setup, then supplied Atlas access. Only generated test databases were created/dropped; no application database was reset or accounts provisioned. Existing disposable legacy data, if any, still needs an explicitly targeted reset before using the new identity model.

Frontend integration and deployment remain separate tasks. Earlier hosting recommendations in [05-cloudflare-deployment.md](05-cloudflare-deployment.md) do not override this identity/CRUD contract.
