"""Create a user, or reset their password if they already exist.

    python -m app.create_user chris
"""

import asyncio
import getpass
import sys
import uuid

from pymongo import AsyncMongoClient

from app.auth import hasher
from app.config import Settings


async def main(username: str) -> None:
    password = getpass.getpass(f"Password for {username}: ")
    if len(password) < 8:
        sys.exit("password must be at least 8 characters")

    settings = Settings()
    client = AsyncMongoClient(settings.mongo_url)
    try:
        users = client[settings.mongo_db].users
        await users.create_index("username", unique=True)
        result = await users.update_one(
            {"username": username.lower()},
            {
                "$set": {"password_hash": hasher.hash(password)},
                "$setOnInsert": {
                    "_id": uuid.uuid4().hex,
                    "username": username.lower(),
                },
            },
            upsert=True,
        )
        if result.upserted_id:
            print("created")
        else:
            # Password reset: sign the user out everywhere by deleting their tokens.
            user = await users.find_one({"username": username.lower()}, {"_id": 1})
            revoked = await client[settings.mongo_db].tokens.delete_many({"user_id": user["_id"]})
            print(f"password updated, {revoked.deleted_count} login(s) signed out")
    finally:
        await client.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit('usage: python -m app.create_user <username>')
    name = sys.argv[1]
    asyncio.run(main(name))
