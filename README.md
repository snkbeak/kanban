# kanban
custom kanban board built using fastapi + mongo for backend and astro + typescript for frontend

Backend setup, CRUD contracts, and tests: [backend/README.md](backend/README.md). The API requires a MongoDB replica set (one local node is sufficient). The frontend still uses sample data; wiring it to the API is separate work.

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
