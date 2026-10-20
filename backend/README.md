# Auth API

FastAPI + MongoDB. Login, current user, and logout using a JWT stored in an HttpOnly cookie.

Run every command below from this folder (the one that contains `app/`, `pyproject.toml` and `.env`).

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- A MongoDB server (local `mongod` or a MongoDB Atlas cluster)
- `mongosh` (optional, for looking at the data)

Fedora:

```bash
sudo dnf install python3 uv
```

MongoDB is not in Fedora's own repos. Either create a free Atlas cluster, or add MongoDB's repo and install `mongodb-org-server` and `mongodb-mongosh`.

## Setup

1. Start MongoDB (skip for Atlas):

   ```bash
   sudo systemctl enable --now mongod
   ```

2. Install dependencies:

   ```bash
   uv sync
   ```

3. Create `.env` with a secret:

   ```bash
   cp .env.example .env
   sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')|" .env
   ```

   For Atlas, also set `MONGO_URL` in `.env` to your connection string.

4. Create a user (prompts for a password, minimum 8 characters):

   ```bash
   uv run python -m app.create_user jame "Jame"
   ```

## Run

```bash
uv run uvicorn app.main:create_app --factory --reload
```

The API is at <http://127.0.0.1:8000>. Interactive docs are at <http://127.0.0.1:8000/docs>.

## Endpoints

| Method and route       | What it does                                                     |
| ---------------------- | ---------------------------------------------------------------- |
| `POST /api/auth/login`  | Body `{"username", "password"}`. Sets the cookie, returns the user |
| `GET /api/auth/me`      | Returns the current user, or `401`                               |
| `POST /api/auth/logout` | Invalidates the token and clears the cookie (`204`)              |

Try it:

```bash
curl -i -c jar.txt -H 'Content-Type: application/json' \
  -d '{"username":"jame","password":"YOUR_PASSWORD"}' \
  http://127.0.0.1:8000/api/auth/login

curl -b jar.txt http://127.0.0.1:8000/api/auth/me
curl -b jar.txt -X POST http://127.0.0.1:8000/api/auth/logout
curl -b jar.txt http://127.0.0.1:8000/api/auth/me     # now 401
```

## How auth works

- Login checks the password (Argon2id), creates a JWT, and sets it in an HttpOnly, SameSite=Lax cookie named `access_token`.
- Each token's ID (`jti`) is saved in the `tokens` collection. A token only works while its record exists, so logout deletes the record and the token stops working immediately.
- MongoDB removes records automatically once their token has expired (TTL index).
- Resetting a user's password with `create_user` deletes their tokens, which signs them out everywhere.
- Changing `JWT_SECRET` and restarting invalidates every token.

## Configuration (`.env`)

| Variable        | Default                     | Notes                                          |
| --------------- | --------------------------- | ---------------------------------------------- |
| `JWT_SECRET`    | none (required)             | At least 32 characters. The app won't start without it |
| `MONGO_URL`     | `mongodb://localhost:27017` | Local MongoDB or an Atlas `mongodb+srv://` URL |
| `MONGO_DB`      | `kanban`                    | Database name                                  |
| `COOKIE_SECURE` | `false`                     | Set to `true` when served over HTTPS           |

## Common tasks

Reset a password (also signs that user out everywhere):

```bash
uv run python -m app.create_user jame "Jame"
```

Look at the data:

```bash
mongosh
```

```js
use kanban
show collections
db.users.find({}, { password_hash: 0 })
db.tokens.find()
```

## Troubleshooting

- **`No module named 'app'`**: you are not in the folder that contains `app/`. `cd` there and try again.
- **`jwt_secret Field required`**: `.env` is missing or `JWT_SECRET` is empty. Redo step 3.
- **`ServerSelectionTimeoutError`**: MongoDB isn't running or `MONGO_URL` is wrong. Check `sudo systemctl status mongod`.
- **`401` right after logging in with curl**: pass the cookie file on every request (`-c jar.txt` to save it, `-b jar.txt` to send it).

## Project layout

```
app/
├── main.py          creates the app, registers routers, sets up indexes
├── config.py        settings (read from .env)
├── auth.py          password check, token create/verify, current_user
├── create_user.py   create a user / reset a password
├── errors.py        (empty) shared error format
├── middleware.py    (empty) origin and proxy checks
├── ratelimit.py     (empty) login throttle
├── cards_store.py   (empty) card database code
├── routes/
│   ├── auth.py      login, me, logout
│   ├── cards.py     (empty)
│   ├── comments.py  (empty)
│   ├── users.py     (empty)
│   └── health.py    (empty)
└── schemas/
    ├── auth.py      login request body
    ├── users.py     UserOut, the public user shape
    ├── cards.py     (empty)
    └── comments.py  (empty)
```

The empty files are placeholders for the rest of the API. To add a route, fill in its file and register it with `app.include_router(...)` inside `create_app` in `main.py`.

To require a logged-in user on a route, add `user: dict = Depends(current_user)` (imported from `app.auth`). It checks the cookie, the signature, that the token still exists in MongoDB, and that the user exists, and returns `401` otherwise. Return `UserOut` from `app/schemas/users.py` whenever a response includes a user, so password hashes can't leak.
