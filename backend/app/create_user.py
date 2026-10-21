"""Create a user, or reset their password if they already exist.

python -m app.create_user chris
"""

import asyncio
import getpass
import sys

from pymongo import AsyncMongoClient

from app.auth import hasher
from app.config import Settings
from app.schemas.users import normalize_username


async def set_password(db, username: str, password: str) -> tuple[bool, int]:
    username = normalize_username(username)
    if not 8 <= len(password) <= 256:
        raise ValueError("password must contain 8-256 characters")
    result = await db.users.update_one(
        {"_id": username},
        {"$set": {"password_hash": await asyncio.to_thread(hasher.hash, password)}},
        upsert=True,
    )
    revoked = await db.tokens.delete_many({"username": username})
    return result.upserted_id is not None, revoked.deleted_count


async def main(username: str) -> None:
    username = normalize_username(username)
    password = getpass.getpass(f"Password for {username}: ")
    if not 8 <= len(password) <= 256:
        sys.exit("password must contain 8-256 characters")

    settings = Settings()
    client = AsyncMongoClient(settings.mongo_url)
    try:
        created, revoked = await set_password(client[settings.mongo_db], username, password)
        if created:
            print("created")
        else:
            print(f"password updated, {revoked} login(s) signed out")
    finally:
        await client.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.create_user <username>")
    asyncio.run(main(sys.argv[1]))
