# Remaining backend CRUD API plan

Status: backend implementation and verification completed October 20, 2026: 78 contract tests and 13 real Atlas integration tests passed, along with lint/format checks. Only generated test databases were created/dropped; no application database was reset. The user initially deferred local MongoDB setup, then supplied working Atlas credentials locally.

This is the authoritative scope document for the API. Confirmed decisions supersede conflicting assumptions in earlier plans. The resolutions below finalize the historical proposals retained later in this document. See [backend/README.md](../backend/README.md) for the executable contract and setup.

## Implementation resolutions

- Username is the primary key; public users contain only username. Creation/login share trim/lowercase normalization. JWT subjects and token ownership use username, and old UUID tokens fail. Startup refuses legacy accounts. Any reset must explicitly target identified disposable development data.
- All planned card/comment/user/health routes are implemented. Singular required tags are trimmed/lowercased. IDs are opaque strings; unknown or malformed-looking IDs return `404`. The proposed error envelope is adopted for CRUD, authentication, and validation.
- Ordering uses integer positions and per-column revisions. Moves renumber destination positions in a transaction, without floating-point ranks. Neighbor position maintenance does not change their content versions/timestamps. Source gaps are harmless. Creates append; creates/deletes/moves advance affected ordering revisions.
- Moves require `expected_order_versions` for source/destination (the full map is accepted) and `expected_version`. Stale arrangements return `409`. Board responses contain full cards plus all ordering revisions; move responses contain `card` plus all revisions. Refresh the board after ordering changes to obtain neighbor positions.
- Snapshot transactions and majority writes coordinate persistence, with PyMongo retries and a 15-second transaction deadline. A replica set or Atlas is required. Ticket allocation happens once outside the transaction, with majority acknowledgement; failures may leave gaps. Aborted transactions leave no partial card/order changes.
- Independent card/discussion/comment versions, guarded whole-card deletion, parent timestamp semantics, full-card comment responses, and atomic 20-comment enforcement are adopted. Every valid submitted content edit/move advances its version once, even for unchanged values/placement. The frontend disables the current-column selector option.
- Focused contract tests and a disposable real-MongoDB integration suite pass, including live persistence/concurrency checks on Atlas. `MONGODB_URI` is accepted as an alias for `MONGO_URL`. No frontend files, throttling, or origin/CSRF implementation were changed. Application secret/account setup and any legacy development reset remain operator tasks.

## Original implementation baseline (before this change)

- FastAPI and PyMongo's asynchronous client are configured in `backend/app/main.py`.
- Login, current-user lookup, and logout exist under `/api/auth`. Authentication uses an HttpOnly JWT cookie backed by revocable records in the `tokens` collection.
- `current_user` supplies the authenticated database user and can protect the new endpoints.
- Card, comment, user-list, and health route files are empty. Card/comment schemas, `cards_store.py`, `errors.py`, `middleware.py`, and `ratelimit.py` are also placeholders.
- Users currently have a generated UUID `_id`, `username`, `display_name`, and `password_hash`. Tokens refer to that UUID. This must change before building new user references.
- The frontend board uses static sample data. It currently uses one `tag`, capitalized person names, display labels for enums, and `in-progress`; the older API plan assumes multiple `tags`, canonical account identifiers, and `in_progress`.
- No backend tests are present in the inspected project files.

## Confirmed decisions

1. One shared board. Implement card CRUD, comment CRUD, and a read-only account list.
2. Columns stay fixed: Review / Brainstorm, Backlog, In Progress, Done, Blocked. Tags are edited directly on cards; there is no separate tag or column management API.
3. Accounts have username and password only. **Implemented: removed `display_name` from the user schema and account creation/response paths. Username is the primary key; there is no separate generated user ID.** Store passwords as hashes.
4. Existing development data can be reset for the account identity change; a migration preserving old UUID references is unnecessary. Reset only the explicitly identified development database during implementation.
5. Every signed-in user can edit/delete any card. Deleting a card also deletes its complete discussion, including other users' comments.
6. Everyone signed in can read/add comments. Only the original author can edit/delete an individual comment. The server derives authorship from authentication.
7. Accounts are read-only through the application API. No signup, profile editing, or account CRUD endpoints.
8. Reject a save if the card's editable content changed since it was loaded. Require a version precondition and return `409` for a stale save; never silently overwrite newer changes. Comment changes are independent, as clarified below.
9. Exactly one required tag per card, represented by singular `tag`. Untagged cards are not allowed.
10. Support persistent manual ordering within each column as well as movement between columns. Creation time no longer determines board order.
11. Newly created cards appear at the bottom of their column.
12. Handle comments independently from editing card title/body. Adding, editing, or deleting comments must not invalidate an otherwise current title/body save, and title/body edits must not invalidate comment writes.
13. New-card defaults are Review / Brainstorm, Medium, Healthy, and no assignees. The caller must still supply a title and the required tag.
14. Moving a card into the Blocked column automatically sets its health to `blocked`. The backend applies this in the same operation as the move.
15. No backend search, filters, or pagination. The board is small; return all cards and let the frontend handle searching, filtering, counts, and any display pagination. This is the intended CRUD scope, not deferred backend functionality.
16. Leaving the Blocked column preserves `health=blocked`. The user can change health manually after moving the card out; do not reset or restore a previous value automatically.
17. While a card is in the Blocked column, health is locked to `blocked`. Enforce this in the API as well as the frontend, including cards created directly in that column. Outside Blocked, health is manually editable.
18. Maximum 20 comments per card. Enforce the limit on the backend, including concurrent comment creation.
19. Moving an existing card through the column selector appends it to the bottom of the destination column. Drag-and-drop uses the chosen drop position and is the only UI mechanism for rearranging cards within a column.
20. Keep automatic ticket numbers displayed as `KAN-1`, `KAN-2`, etc. Character limits are title 200, description 20,000, comment text 4,000, and tag 32.
21. Track login throttling and origin/CSRF protection separately from CRUD in [Authentication follow-up](07-auth-follow-up.md). CRUD reuses existing JWT authentication and still enforces authentication and comment ownership.

## Clarification status

All product and scope questions are answered. Automatic ticket numbering and character limits are confirmed; login throttling and origin/CSRF protection are separate follow-up work. Technical choices are finalized in Implementation resolutions above. The historical proposals below explain the requirements behind those choices.

## Account cleanup prerequisite

- Store the canonical username as MongoDB `_id`, e.g. `{ "_id": "chris", "password_hash": "..." }`. `_id` is the database representation of username, not an additional account attribute.
- Public user shape: `{ "username": "chris" }`. Login still accepts `{ "username", "password" }`; passwords/hashes never appear in responses.
- Change `UserOut` and `from_doc` in `app/schemas/users.py` to return username only.
- Change `app/create_user.py` to take username only, remove the optional display-name argument and UUID generation, and upsert by canonical username `_id`. Preserve deliberate password reset and token revocation behavior.
- Use the same username normalization in account creation and login; proposed: strip surrounding whitespace and lowercase, consistent with current login behavior. Usernames are immutable through the API.
- Change login lookup to `_id`; use username in JWT `sub` and token ownership references. `current_user` can continue looking up users by `_id`.
- Remove the redundant unique `username` index when username lives solely in `_id`; MongoDB's primary key enforces uniqueness.
- Reset affected development records after identifying the target database, recreate accounts, and clear old token records. Old UUID-based sessions must no longer authenticate. Do not build a production migration for this development reset.
- Update account command examples in `backend/README.md` and identity references in earlier planning documents when the contract is finalized.
- Bundled pictures/initials can be keyed by username in the frontend; they do not require extra account properties.

## Proposed data contracts

### Cards

| Field | Contract |
| --- | --- |
| `id` | Server-generated card ID, serialized as a string; independent of user identity |
| `ticket_number` | Unique positive integer; display as `KAN-{number}` |
| `title` | Trimmed, 1-200 characters |
| `description` | Plain text, up to 20,000 characters; empty allowed |
| `column` | `review`, `backlog`, `in_progress`, `done`, `blocked`; defaults to `review` |
| `position` | Server-managed ordering value within the column; clients request placement through the move endpoint rather than assigning raw values |
| `difficulty` | `easy`, `medium`, `hard`; defaults to `medium` |
| `health` | `healthy`, `at_risk`, `blocked`; normally defaults to `healthy`; always `blocked` while in the Blocked column; leaving Blocked preserves `blocked` until manually changed |
| `tag` | Exactly one required nonblank string, 1-32 characters; proposed normalization: trim and lowercase; null and arrays rejected |
| `assignees` | Distinct existing usernames, maximum three; defaults to `[]` (unassigned) |
| `creator` | Authenticated username, immutable |
| `created_at`, `updated_at` | Server-owned UTC timestamps, ISO 8601 in JSON |
| `version` | Starts at 1; advances on successful card-content changes and moves; never advances for comment mutations |
| `comments_version` | Proposed discussion revision, starts at 0 and advances on comment create/edit/delete; used to refresh discussion state and guard whole-card deletion, not title/body edits |
| `comments` | Embedded comment records, oldest first; proposed to include in both list and detail responses for the small board |

Use separate create, patch, move, and output schemas; list and detail can reuse the same card output shape. Reject unknown fields and attempts to write IDs, ticket numbers, creator, timestamps, stored versions, raw position, or nested comments. `expected_version` is a mutation precondition, not a writable stored field. PATCH changes only supplied content fields; `[]` clears assignees and `""` clears description. Create requires `tag`; omitting it on PATCH preserves the existing tag. Reject null, blank, whitespace-only, or array tags; a card cannot have its tag cleared. Other omitted fields remain unchanged. Null is rejected for non-nullable fields. Reject a patch with no editable changes supplied. Column/position changes go through the move endpoint so ordering and automatic health rules cannot be bypassed.

Proposed list payload: all full card records, including descriptions and comments, so the frontend can search/filter local data and derive counts without extra backend query features. No separate summary schema, count query, or paginated response envelope is needed. If ordering revisions are adopted, return them alongside the complete `cards` array.

### Column and health behavior

| Action | Result |
| --- | --- |
| Create with the confirmed defaults | Review / Brainstorm column, Healthy health |
| Create directly in Blocked | Blocked health; health selector locked |
| Move into Blocked from another column | Set health to Blocked atomically with the move |
| Reorder within Blocked | Keep health Blocked |
| Edit health while in Blocked | Healthy/At risk are rejected; title/body and other permitted fields remain editable |
| Move out of Blocked | Keep health Blocked; unlock the health selector |
| Edit health outside Blocked | Accept Healthy, At risk, or Blocked without changing column |
| Move between other columns | Preserve the current health |

Proposed validation detail: creating directly in Blocked with health omitted assigns `blocked`; explicitly supplying Healthy/At risk there returns `422`. A PATCH attempting Healthy/At risk while the card is in Blocked also returns `422`, with no partial changes or version increment. A stale card-version precondition still returns `409`. No previous-health field is needed. The frontend disables the health control while the card is in Blocked, but backend validation remains authoritative.

### Comments

Fields: `id` (server-generated UUID), `text` (trimmed plain text, 1-4,000 characters), `author` (authenticated username), `created_at`, `updated_at`, and proposed per-comment `version` (starts at 1, increments on edits).

Proposed storage: embedded in the parent card, with the confirmed maximum of 20 comments. Card/comment content can be changed in a single document; card deletion also needs to coordinate with ordering metadata if that design is selected. No separate comment list/detail route is needed if card details return the complete discussion. Updating a comment preserves its author and creation time. The limit counts currently stored comments: deleting one frees a slot, and editing one does not consume another slot.

Proposed independent concurrency contract:

- Adding a comment requires no card version or discussion revision precondition. Atomically check that the card exists and currently has fewer than 20 comments, append the comment, and increment `comments_version`. At 20, reject the addition with the proposed `422` error code `comment_limit_reached`; leave comments and all versions unchanged.
- Editing/deleting a comment requires that comment's `expected_comment_version`, plus author authorization. Changes to other comments or card content do not make this operation stale. Two competing changes to the same comment cannot silently overwrite each other.
- Comment mutations increment `comments_version`, never the card's `version`. Card title/body and other content patches do not match or change `comments_version`, and never replace the comments array.
- Proposed timestamp meaning: parent `updated_at` reflects card content/movement; each comment has its own timestamps. Discussion changes are tracked separately by `comments_version`, not inferred from the parent timestamp.
- Whole-card deletion removes both content and discussion. Proposed: require both `expected_version` and `expected_comments_version` so an unseen new/edited comment triggers a refresh before deleting the whole discussion. This extra guard does not apply to title/body edits.
- Comment responses may still return a full card, but clients merge content and discussion by their separate revisions. A late response must not overwrite newer content, regress the discussion, or replace an unsaved title/body draft.

### Supporting records

- Keep `users` and `tokens`, adapting account references to usernames.
- Add `cards`, with a unique `ticket_number` index and an index matching column/position/ID ordering.
- Add a counter document for atomic ticket allocation. Initialize idempotently, increment atomically, never decrement or reuse numbers after failures/deletion.
- Fixed columns, enum values, and free-text tags do not need management endpoints. Internal ordering metadata may be needed; that does not make columns user-editable.

### Manual ordering design checkpoint

- Store shared order in the backend, persist it across reloads, and return list results in that order. Use card ID as a deterministic tie-breaker.
- Append every newly created card after the current last card in its column. Coordinate concurrent creations so both receive valid, deterministic placements without changing existing cards' relative order.
- Proposed move input: destination `column`, `before_card_id` (insert immediately before this card; `null` means append), and the moved card's `expected_version`. Resolve placement on the server; never trust client-supplied numeric positions or a replacement array of full cards.
- Column-selector moves target another column and send `before_card_id=null` to append. Selecting the current column must not move a card to the bottom; disable that selector option or treat it as no action. Within-column rearrangement is available only through drag-and-drop, which supplies the drop anchor (or `null` for a drop at the bottom). Both interactions can use the same backend move endpoint; the UI interaction rule does not require separate persistence logic.
- Apply the moved card's column, position, automatic health change, timestamp, and version together. A move into Blocked sets `health=blocked` with one card-version increment; leaving Blocked preserves that health and makes it manually editable again. A rejected move changes neither health nor position. Reject stale card versions. Validate that the anchor exists, belongs to the destination column, and is not the moved card.
- Proposed additional protection: an ordering revision for each affected column. A move supplies the revisions the client saw; reject a stale arrangement with `409`. Creation/deletion also participate in updating the affected ordering revision.
- Before implementation, select the storage and atomicity strategy: spaced ranks versus ordered ID lists, how to rebalance ranks, and how to commit card/order revisions together. If selecting a transaction-based design, verify driver/database support and document the required local/test/deployment MongoDB configuration. Do not assume the previous single-document-only persistence design covers column-wide ordering.
- Cover simultaneous reorders, moved/deleted anchors, cross-column moves, and creates/deletes racing with moves. Define rollback/retry behavior before shipping the move endpoint; never leave a card's column and order inconsistent.
- Return the complete board in persisted manual order; there are no pagination cursors or backend filter/search parameters.
- Proposed UI rule: disable reordering while frontend search/filters hide cards; continue allowing a column-selector move. The frontend retains the complete fetched dataset even when only some cards are visible. Confirm this behavior during frontend handoff.

The ordering revision, endpoint shape, and storage strategy above are proposals. The confirmed product requirement is manual ordering with stale-card-save rejection.

## Proposed endpoint contract

All paths below are relative to `/api`. All user/card/comment endpoints require the existing `current_user` dependency.

| Method and path | Input / result |
| --- | --- |
| `GET /users` | Return a deterministic list of public users containing username only |
| `GET /cards` | Return `{cards: [...]}` containing all full card records in manual order; add ordering revisions if the proposed guard is adopted; no search/filter/pagination parameters |
| `POST /cards` | Editable fields including required `tag`; append at the bottom of the selected/default column; return full created card, `201` |
| `GET /cards/{id}` | Full card including comments, `200` |
| `PATCH /cards/{id}` | Supplied editable content fields plus `expected_version`; return updated full card, `200` |
| `POST /cards/{id}/move` | Destination column, placement anchor, `expected_version`, and proposed column-order preconditions; entering Blocked sets health to blocked, leaving preserves it; return updated full card and applicable ordering revisions, `200` |
| `DELETE /cards/{id}?expected_version=N&expected_comments_version=M` | Proposed guard checks card and discussion revisions; delete card and its comments; `204` |
| `POST /cards/{id}/comments` | `text`; no card-version precondition; return updated full card, `201` |
| `PATCH /cards/{id}/comments/{comment_id}` | `text` plus `expected_comment_version`; author only; return updated full card, `200` |
| `DELETE /cards/{id}/comments/{comment_id}?expected_comment_version=N` | Author only; check the targeted comment version; return updated full card, `200` |
| `GET /health/live` | Generic process health; no authentication |
| `GET /health/ready` | Database availability; generic `200` or `503`; no authentication |

Assignment and single-tag changes are card patches. Both within-column reordering and cross-column movement use the move endpoint. Create requests may select an initial column; new cards always start at the bottom. Column-selector moves append to the destination column; drag-and-drop places cards at the chosen position and is the only UI action for within-column reordering. Accounts, tokens, counters, and internal ordering metadata do not get generic mutation endpoints.

`GET /cards` fetches the entire shared board in one request, ordered by fixed column order, then persisted position and ID. Do not implement `q`, column/assignee/tag/health/difficulty filters, `limit`, offsets, cursors, separate per-column fetches, or matching-count queries. The frontend groups, searches, filters, and counts the returned data locally. No default response cap may silently omit cards.

## Mutation rules and errors

- For card-content edits/moves, match card ID and expected card version in the database write itself. On success, update card timestamps and increment card version atomically; do not implement read-then-unconditional-write. Comments use the independent preconditions above.
- Entering Blocked must update column and health together on the server, including moves initiated by any frontend control. While in Blocked, reject non-blocked health values. Leaving Blocked preserves health; later manual edits can change it without moving the card. Use the card-version guard for both moves and health edits so racing requests cannot violate the lock.
- Comment edits/deletions must match the same embedded comment's ID, authenticated author, and expected comment version together. Check ownership before returning a version conflict for an existing comment. Update only the targeted comment and the discussion revision.
- Enforce the 20-comment cap in the atomic append condition. Do not allow shared card PATCH to replace comments or spoof authorship.
- Validate assignees against existing accounts. Creator and author always come from the authenticated user.
- Proposed error shape: `{ "error": { "code": "...", "message": "...", "fields": [] } }`, with field details only when useful. Apply consistently to validation and existing auth errors when adopted.
- Use `401` for unauthenticated requests, `403` for forbidden comment mutations, `404` for missing resources, `409` for stale versions, `422` for invalid input/limits, and generic `503` for database unavailability. Decide malformed-ID handling consistently when finalizing schemas.
- After an uncertain create/comment response, the client refreshes before a deliberate retry; automatic replay could create duplicates. Idempotency keys are outside the proposed first pass.

## Implementation sequence

1. **Finalize technical contracts and account identity.** Use the confirmed product requirements, freeze request/response examples, remove `display_name` and generated account IDs, perform the agreed development reset, and verify login/me/logout/password reset with username identity.
2. **Schemas and shared behavior.** Resolve the ordering storage/atomicity checkpoint, fill card/comment/move schemas and shared errors, define database access, serialization, startup indexes/counter/order metadata, and register new routers in `main.py`.
3. **Read endpoints and card CRUD.** Implement `/users`, card creation/detail/full-board list, version-checked edits, persistent manual reordering/cross-column movement with automatic Blocked health, and coordinated deletion in `cards_store.py` and `routes/cards.py`. Search, filters, pagination, and display counts stay in the frontend.
4. **Comment CRUD.** Implement author checks, atomic append/edit/remove, the 20-comment cap, independent comment/discussion versions, comment timestamps, and updated-card responses in `routes/comments.py` plus persistence helpers. Verify that content edits and comment writes preserve each other; implement the agreed whole-card-deletion guard.
5. **Operational endpoints and documentation.** Fill health routes and document all routes and payload examples in `backend/README.md`. Keep login throttling and origin/CSRF implementation and tests in the separate [authentication follow-up](07-auth-follow-up.md), outside CRUD completion criteria.
6. **Verification and handoff.** Run focused API/integration tests against an isolated disposable database, review OpenAPI, and document mappings needed by the static frontend. Frontend wiring and hosting changes are separate tasks.

## Acceptance checks for implementation

- Public account responses contain only username; no `id`, `display_name`, password, or password hash. Token subjects and all card/comment user references use username.
- Existing login/logout/expiry/revocation and operator password reset still work after identity changes; old UUID sessions are rejected.
- Unauthenticated requests cannot access board data or users. Public health checks reveal no credentials or database details.
- Card create/read/list/update/move/delete persist; defaults, limits, enums, unknown fields, immutable fields, and invalid assignees behave as specified.
- Validate the confirmed character boundaries: title 200, description 20,000, comment text 4,000, and tag 32 are accepted when otherwise valid; one character over is rejected without changing data. Required text fields reject blank input.
- Creating with just the required title and tag yields Review / Brainstorm, Medium, Healthy, and no assignees, at the bottom of the column.
- Moving into Blocked atomically sets health to blocked and increments card version once. A stale/invalid move changes neither column, position, nor health. Leaving Blocked retains blocked health, which can then be edited manually without changing column.
- Direct creation in Blocked yields blocked health. Reordering within Blocked preserves it. Attempts to set Healthy/At risk while in Blocked fail without partial changes; title/body edits still work. Racing moves and health edits cannot leave a card in Blocked with non-blocked health. Moves between other columns preserve health.
- Concurrent creates receive distinct ticket numbers; deleted numbers are not reused.
- Competing card edits/moves using one card version produce one success and one conflict, with no lost update. Competing edits to the same comment likewise check its own version. Conflict responses preserve the client's unsaved draft and require an explicit refresh/reapply decision.
- Concurrent title/body edits and comment creation/edit/deletion both succeed when their own preconditions hold; neither overwrites the other's changes or advances the other's version. Changes to different comments proceed independently. Failed comment authorization leaves all versions unchanged.
- Manual order survives reloads and is shared across users. Exercise empty columns, first/last positions, same-column and cross-column moves, simultaneous reorders, stale anchors/revisions, rank maintenance if used, and failures during coordinated persistence.
- Selector moves append to the destination column. Frontend handoff specifies no reordering through the selector and no alternate within-column reorder controls; drag-and-drop persists the chosen position through the move endpoint.
- Valid single-tag payloads work. Create without a tag, blank/whitespace-only tags, null tags, tag arrays, and the obsolete `tags` field fail validation. PATCH without `tag` preserves it; attempts to clear it fail.
- New cards appear at the bottom, including concurrent creates; existing manually arranged cards keep their relative order.
- A comment author can edit/delete their comment; another user cannot, and failed attempts change neither data nor version. Spoofed authors and comment replacement through card PATCH fail.
- Card deletion removes all embedded comments. Under the proposed deletion guard, unseen discussion changes cause a conflict; a comment write racing with successful deletion cannot leave an orphaned comment.
- The 20th comment succeeds and the 21st is rejected without changing data or versions. With 19 comments, two concurrent additions yield exactly one success and one limit error. At 20, edits remain allowed; deleting an owned comment frees one slot for a new comment.
- `GET /cards` returns every card exactly once in persisted manual order, including all columns, with no hidden default limit or pagination. Frontend search/filter/count behavior is outside backend CRUD acceptance tests.
- Missing resources, malformed inputs, conflicts, and database outages produce the agreed statuses and error format.
- Use a disposable real MongoDB database for index/atomic-update/concurrency checks. Add API tests for observable behavior rather than tests that mirror helper implementations.

## Decision log

| Date | Decision |
| --- | --- |
| 2026-10-20 | Implemented username identity and CRUD with transactional integer positions, column revisions, independent discussion versions, and consistent errors. All 78 contract and 13 real Atlas integration tests passed. No application development reset performed. |
| 2026-10-20 | User requested collaborative planning in `.agent/`, with clarification questions before finalizing implementation. |
| 2026-10-20 | User confirmed username/password-only accounts, username primary key, and removal of `display_name`. |
| 2026-10-20 | User confirmed one shared board, card/comment CRUD, read-only account list, fixed columns, and tags edited on cards. |
| 2026-10-20 | User confirmed development data can be reset for the identity change. |
| 2026-10-20 | User confirmed shared card edit/delete permissions, deletion of the entire discussion with its card, and author-only individual comment edit/delete. |
| 2026-10-20 | User confirmed rejecting a save when the card changed since it was loaded. |
| 2026-10-20 | User confirmed one tag per card; subsequently clarified that the tag is required. |
| 2026-10-20 | User confirmed manual ordering within columns; this replaces the earlier newest-created-first assumption. |
| 2026-10-20 | User confirmed newly created cards appear at the bottom of their column. |
| 2026-10-20 | User confirmed comments are handled independently from title/body edits; comment activity must not invalidate a content save. |
| 2026-10-20 | User confirmed new-card defaults: Review / Brainstorm, Medium, Healthy, and no assignees. |
| 2026-10-20 | User confirmed entering the Blocked column automatically changes health to blocked. |
| 2026-10-20 | User excluded backend search, filters, and pagination entirely: the dataset is small and these behaviors belong in the frontend. |
| 2026-10-20 | User confirmed leaving Blocked preserves blocked health until manually changed, and health is locked to blocked while the card remains in that column. |
| 2026-10-20 | User set a maximum of 20 comments per card, replacing the proposed 200-comment limit. |
| 2026-10-20 | User confirmed selector moves append to the destination column and only drag-and-drop rearranges cards within a column. |
| 2026-10-20 | User confirmed automatic ticket numbers and character limits: title 200, description 20,000, comment 4,000, tag 32. |
| 2026-10-20 | User confirmed login throttling and origin/CSRF protection should be tracked separately from CRUD. |
