"""Insert one approved account; never reset passwords or revoke sessions.

python -m app.provision_user --database kanban_prod <approved-username>
The URI and password are read without echo. No .env or implicit database is used.
"""

import argparse
import asyncio
import getpass
import sys
import warnings

from pymongo import AsyncMongoClient
from pymongo.errors import DuplicateKeyError
from pymongo.write_concern import WriteConcern

from app.auth import hasher
from app.schemas.users import normalize_username


async def insert_user(db, username: str, password: str) -> None:
    username = normalize_username(username)
    if not 8 <= len(password) <= 256:
        raise ValueError("password must contain 8-256 characters")
    # _id uniqueness protects against an account appearing after the preflight.
    # Do not upsert, and do not touch tokens even on a duplicate or uncertain write.
    await db.users.with_options(write_concern=WriteConcern("majority")).insert_one(
        {"_id": username, "password_hash": await asyncio.to_thread(hasher.hash, password)}
    )


def hidden_input(prompt: str) -> str:
    # getpass otherwise falls back to echoed stdin on unsupported terminals.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        return getpass.getpass(prompt)


async def provision(database: str, username: str, uri: str, password: str) -> None:
    # TLS is mandatory for this hosted operator path. Never start FastAPI here.
    async with AsyncMongoClient(
        uri,
        tls=True,
        tlsAllowInvalidCertificates=False,
        tlsAllowInvalidHostnames=False,
        retryWrites=False,
        serverSelectionTimeoutMS=10000,
        timeoutMS=15000,
    ) as client:
        await insert_user(client[database], username, password)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username")
    parser.add_argument("--database", required=True)
    args = parser.parse_args(argv)
    try:
        username = normalize_username(args.username)
        if not args.database.strip():
            raise ValueError("database is required")
        print(f"Insert-only target: database={args.database}, username={username}")
        uri = hidden_input("Approved Atlas URI: ")
        if not uri.startswith(("mongodb://", "mongodb+srv://")):
            raise ValueError("MongoDB URI is required")
        password = hidden_input("New password (8-256 characters): ")
        if not 8 <= len(password) <= 256 or password != hidden_input("Confirm password: "):
            raise ValueError("invalid password or confirmation")
        asyncio.run(provision(args.database, username, uri, password))
    except DuplicateKeyError:
        print("Account exists; no password or sessions changed.", file=sys.stderr)
        return 2
    except (KeyboardInterrupt, EOFError, getpass.GetPassWarning):
        print("Cancelled; secure interactive input is required.", file=sys.stderr)
        return 1
    except Exception:
        # Driver/validation exceptions can contain credentials or document contents.
        print(
            "Provisioning failed or result uncertain. Inspect account existence privately "
            "before retrying; no automatic retry or reset was performed.",
            file=sys.stderr,
        )
        return 1
    print("created")
    return 0


if __name__ == "__main__":
    sys.exit(main())
