# Scope and decisions

October 22 direction: [plain Python Worker + D1](08-d1-migration.md), Astro/browser TypeScript, and the existing $5/month Workers Paid plan. Replace FastAPI/Containers with direct Python handlers while preserving API/authentication/CRUD behavior. Free is optional next month after measurement. Hosted usernames are `sea`, `poopfart`, `sneaky`; local account references are not production provisioning instructions. Documentation only; no implementation in this pass.

## Required outcome

Three users can sign in, manage a shared Kanban board, assign work and discuss tickets. The deployment target is one plain Python Worker with a direct D1 binding and Astro Static Assets. Preserve the implemented product contract in [06-backend-crud.md](06-backend-crud.md), including one required tag, manual ordering, Blocked health rules and independent revisions.

## Original scope record

The sections below preserve the original draft and its assumptions. Conflicting defaults (tags, health, ordering and accounts) were resolved in `06-backend-crud.md`; hosting choices were superseded by `08-d1-migration.md`. They are not instructions to reverse implemented behavior or choose another host.

## Board and cards

Display five fixed columns in the order given in the rough draft:

1. Review / Brainstorm
2. Backlog
3. In Progress
4. Done
5. Blocked

Each card has a title, description, unique ticket number, difficulty, health label, tags, assignees, creator, creation time, last update time, and comments. Comments contain text, author, creation time, and last update time.

Users can create, view, edit, move, and delete cards and add comments. Users can edit or delete only their own comments. Account details are fixed. Use a confirmation dialog before destructive actions.

## Decisions and defaults

Confirmed after the initial draft: deploy the frontend to Cloudflare using Wrangler; label yellow as “At risk”; restrict individual comment editing and deletion to the original author. The remaining product defaults below are retained from the initial plan.

| Topic | Implementation default | Reason |
| --- | --- | --- |
| Access | One private board shared by all three accounts | No workspace or role management is needed |
| Accounts | Fixed usernames `chris`, `sean`, `james` and bundled profile pictures | Matches the rough draft |
| Passwords | Deployment-provided passwords stored as hashes | Fixed accounts do not require credentials in source code |
| Card permissions | All three users can edit and delete any card | Supports a small trusted team |
| Comment permissions | Everyone can read/add comments; only the author can edit/delete their own comment | Confirmed user requirement; enforce in the API as well as the UI |
| Yellow health label | `at_risk` displayed as “At risk” | Confirmed by the user |
| Other health labels | `healthy` is green; `blocked` is red | Matches the draft |
| Workflow vs. health | Column and health are independently editable | The draft specifies both; moving a card does not silently rewrite its health |
| Difficulty | Easy, Medium, Hard; no hour conversion | The draft supplies categories but no time ranges |
| Tags | Zero or more editable text tags; suggest bugfix, feature, refactor | Allows the draft's “etc.” without a tag administration screen |
| Assignees | Zero to three distinct fixed accounts | Supports unassigned and shared work |
| New card | Review / Brainstorm, Healthy, Medium, no tags or assignees | Keeps creation short |
| Ticket numbers | Server-generated `KAN-1`, `KAN-2`, etc.; never reused | Stable references; gaps are acceptable |
| Metadata | Server owns IDs, ticket numbers, creator/author, and timestamps | Interprets “CRUD all fields” as editable content while retaining trustworthy attribution |
| Ordering | Newest creation time first within each column | Avoids manual ranking logic in the first release |
| Synchronization | Refresh visible board data every 15 seconds and on window focus | Adequate for three users |
| Deletion | Permanent card deletion includes its comments | Simple behavior with a clear confirmation |

The retained shared card-deletion rule removes the entire card and its discussion, including other users' comments. Author-only permissions apply to individual comment operations; card deletion remains a separate destructive action with an explicit warning.

Health and column names must be visually distinct: a red health badge can appear in any column, and the Blocked column does not force a red badge. Revisit this default if the team wants a single source of blocking state.

## First-release boundaries

Include login/logout, persistent cards and comments, card movement, shared editing, title/ticket search, filters for assignee/tag/health/difficulty, responsive layouts, and visible loading/error/conflict states.

Defer multiple boards, invitations, signup, account/profile editors, self-service password reset, attachments, rich text, notifications, audit history, manual ordering, due dates, time tracking, and integrations. Drag-and-drop is optional polish after a reliable “Move to” control works.

## Inputs to settle during implementation

- Obtain the three profile pictures; use bundled initials placeholders until available.
- Select the Cloudflare frontend hostname and backend/database hosting tiers. The recommendation is Render for FastAPI and MongoDB Atlas for storage; see the [deployment plan](05-cloudflare-deployment.md).
- Supply initial credentials through deployment configuration, never through committed planning files.

These inputs do not block scaffolding, data modeling, or the core UI.
