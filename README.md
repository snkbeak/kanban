# kanban
Custom kanban board built using FastAPI + MongoDB and Astro + TypeScript. A [migration to Cloudflare D1](.agent/08-d1-migration.md) is now planned; executable code still uses MongoDB.

Backend setup, CRUD contracts, and tests: [backend/README.md](backend/README.md). Current code requires a MongoDB replica set; the proposed D1 migration retains FastAPI and uses a private Worker adapter. The frontend connects authentication, card/comment CRUD, and manual ordering through same-origin `/api`; see [frontend setup and checks](frontend/README.md). Local Mongo accounts and two live browser journeys are historically verified. D1 implementation, verification and production deployment remain pending in [next steps](.agent/next-steps.md).

Login throttling is implemented with configurable MongoDB limits and frontend retry guidance; see [the policy](backend/README.md#login-throttling). Origin/CSRF protection and authenticated Worker/container ingress are implemented; their hosted acceptance remains pending. The D1 migration must preserve these contracts and target no additional D1 charges within the existing Workers Paid allowance.

# sections:
1. review/brainstorm: 
2. backlog:
3. in progress:
4. done:
5. blocked:

# tag:
* bugfix
* feature
* refactor
* etc... (custom text allowed)

# status label:
* green: healthy
* yellow: at-risk
* red: blocked

# difficulty estimate: (aka time estimate)
* hard
* medium
* easy

# Cards:
* title
* description
* unique ticket number
* difficulty estimate
* status label
* tag
* assignees
* creator
* timestamp created
* timestamp last updated
* comments

# Comments:
* text content
* author
* timestamp created
* last updated

# Accounts:
* hardcode 3 accounts for chris, sean, james
* hardcode our profile pictures
* simple username + password

# CRUD:
* create, read, update, delete all fields except for account details
* only comment author can create/update/delete their own comments
