# kanban
Custom kanban board with Astro + TypeScript. The planned deployment is a **plain Python Cloudflare Worker + D1 on the existing $5/month Workers Paid plan**; [migration plan](.agent/08-d1-migration.md). Direct Python handlers replace FastAPI/Containers; browser TypeScript remains. Consider Free next month after measurement. Executable code currently still uses FastAPI + MongoDB.

Current backend setup, CRUD contracts and tests: [backend/README.md](backend/README.md). The target uses a direct Python D1 binding, with no TypeScript SQL adapter. The frontend keeps authentication, card/comment CRUD and manual ordering through same-origin `/api`; see [frontend setup and checks](frontend/README.md). Local Mongo/browser results are historical. Python Worker/D1 implementation, verification and deployment remain pending in [next steps](.agent/next-steps.md). This update changes documentation only.

Preserve the existing password/cookie sessions, revocation, [login limits](backend/README.md#login-throttling), exact Origin protection and API behavior. Prove Python runtime authentication compatibility first, then port handlers/persistence. Container-only ingress authentication retires with that boundary. Target the Paid plan's included allowances; keep secure authentication when evaluating Free.

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
