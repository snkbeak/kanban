"""Persistent, conservative login reservations; no client-address trust required."""

from hashlib import sha256
from math import ceil

from fastapi import HTTPException, Request
from pymongo import ReturnDocument, timeout
from pymongo.errors import DuplicateKeyError
from pymongo.write_concern import WriteConcern

from app.config import Settings


class LoginLimiter:
    def __init__(self, db, settings: Settings):
        self.db = db
        self.settings = settings

    def _now(self):
        # MongoDB time, shared across processes; overridden only by deterministic tests.
        return "$$NOW"

    async def _reserve(self, key: str, limit: int, seconds: int):
        collection = self.db.login_limits.with_options(write_concern=WriteConcern("majority"))
        now = self._now()
        expired = {"$lte": [{"$ifNull": ["$expires_at", now]}, now]}
        pipeline = [
            {
                "$set": {
                    "count": {"$cond": [expired, 0, "$count"]},
                    "expires_at": {
                        "$cond": [expired, {"$add": [now, seconds * 1000]}, "$expires_at"]
                    },
                    "observed_at": now,
                }
            },
            {"$set": {"admitted": {"$lt": ["$count", limit]}}},
            {"$set": {"count": {"$cond": ["$admitted", {"$add": ["$count", 1]}, "$count"]}}},
        ]
        # Exact unique _id + atomic pipeline: concurrent callers cannot oversubscribe.
        # Retry an initial upsert collision; persistent errors fail closed via the API handler.
        for attempt in range(3):
            try:
                doc = await collection.find_one_and_update(
                    {"_id": key}, pipeline, upsert=True, return_document=ReturnDocument.AFTER
                )
                break
            except DuplicateKeyError:
                if attempt == 2:
                    raise
        if not doc["admitted"]:
            retry = max(1, ceil((doc["expires_at"] - doc["observed_at"]).total_seconds()))
            raise HTTPException(
                429,
                "Too many login attempts; try again later",
                headers={"Retry-After": str(retry)},
            )

    async def check(self, username: str):
        # Global first bounds password work AND creation of arbitrary username buckets.
        # Reservations are not refunded if a later bucket or credential check rejects.
        with timeout(5):
            await self._reserve(
                "global",
                self.settings.login_global_limit,
                self.settings.login_global_window_seconds,
            )
            await self._reserve(
                "username:" + sha256(username.encode()).hexdigest(),
                self.settings.login_username_limit,
                self.settings.login_username_window_seconds,
            )


def get_login_limiter(request: Request) -> LoginLimiter:
    # Deliberately ignore peer addresses and ALL forwarding headers. Until an
    # authenticated proxy exists, all clients share the global allowance.
    return LoginLimiter(request.app.state.db, request.app.state.settings)
