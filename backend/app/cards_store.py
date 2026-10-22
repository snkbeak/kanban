"""Persistence for the shared board. Ordering changes commit with card changes.

All transaction callbacks may be retried by PyMongo. They have no external side
effects; ticket allocation deliberately happens once, outside the transaction.
"""

from datetime import UTC, datetime
from uuid import uuid4

from pymongo import ReturnDocument, UpdateOne, timeout
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern

from app.errors import APIError
from app.schemas.cards import COLUMNS, BoardOut, CardOut, MoveOut


async def initialize_database(db):
    hello = await db.command("hello")
    if not (hello.get("setName") or hello.get("msg") == "isdbgrid"):
        raise RuntimeError("Kanban requires MongoDB with transactions (replica set or mongos)")
    if await db.users.find_one(
        {"$or": [{"username": {"$exists": True}}, {"display_name": {"$exists": True}}]}
    ):
        raise RuntimeError(
            "Legacy accounts found. Reset the explicitly selected development database; see backend/README.md"
        )
    for index in await (await db.users.list_indexes()).to_list():
        if index["key"] == {"username": 1}:
            await db.users.drop_index(index["name"])
    await db.tokens.create_index("jti", unique=True)
    await db.tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.tokens.create_index("username")
    await db.login_limits.create_index("expires_at", expireAfterSeconds=0)
    await db.cards.create_index("ticket_number", unique=True)
    await db.cards.create_index([("column", 1), ("position", 1), ("_id", 1)])
    await db.counters.update_one({"_id": "tickets"}, {"$setOnInsert": {"value": 0}}, upsert=True)
    for column in COLUMNS:
        await db.column_orders.update_one(
            {"_id": column}, {"$setOnInsert": {"version": 0}}, upsert=True
        )


class CardsStore:
    def __init__(self, db):
        self.db = db

    async def transaction(self, callback):
        with timeout(15):
            async with self.db.client.start_session() as session:
                return await session.with_transaction(
                    callback,
                    read_concern=ReadConcern("snapshot"),
                    write_concern=WriteConcern("majority"),
                    max_commit_time_ms=5000,
                )

    async def _card(self, card_id, session=None):
        card = await self.db.cards.find_one({"_id": card_id}, session=session)
        if card is None:
            raise APIError(404, "not_found", "Card not found")
        return card

    @staticmethod
    def _version(actual, expected):
        if actual != expected:
            raise APIError(
                409, "version_conflict", "Resource changed; refresh before reapplying your changes"
            )

    async def _assignees(self, usernames, session):
        count = await self.db.users.count_documents({"_id": {"$in": usernames}}, session=session)
        if count != len(usernames):
            raise APIError(
                422, "invalid_assignees", "Assignees must be existing canonical usernames"
            )

    async def _orders(self, session):
        docs = await self.db.column_orders.find({}, session=session).to_list()
        return {doc["_id"]: doc["version"] for doc in docs}

    async def _bump_order(self, column, session, expected=None):
        query = {"_id": column}
        if expected is not None:
            query["version"] = expected
        result = await self.db.column_orders.update_one(
            query, {"$inc": {"version": 1}}, session=session
        )
        if result.matched_count != 1:
            raise APIError(
                409, "order_conflict", "Column order changed; refresh before moving the card"
            )

    async def _column(self, column, session):
        return (
            await self.db.cards.find({"column": column}, session=session)
            .sort([("position", 1), ("_id", 1)])
            .to_list()
        )

    async def board(self):
        async def read(session):
            cards = await self.db.cards.find({}, session=session).to_list()
            cards.sort(
                key=lambda card: (COLUMNS.index(card["column"]), card["position"], card["_id"])
            )
            return BoardOut(
                cards=[CardOut.from_doc(card) for card in cards],
                order_versions=await self._orders(session),
            )

        return await self.transaction(read)

    async def get(self, card_id):
        return CardOut.from_doc(await self._card(card_id))

    async def create(self, body, username):
        counter = await self.db.counters.with_options(
            write_concern=WriteConcern("majority")
        ).find_one_and_update(
            {"_id": "tickets"},
            {"$inc": {"value": 1}},
            return_document=ReturnDocument.AFTER,
        )
        card_id = uuid4().hex

        async def write(session):
            await self._assignees(body.assignees, session)
            await self._bump_order(body.column, session)
            last = await self.db.cards.find_one(
                {"column": body.column}, sort=[("position", -1)], session=session
            )
            now = datetime.now(UTC)
            # BSON dates have millisecond precision; return the persisted value.
            now = now.replace(microsecond=now.microsecond // 1000 * 1000)
            card = dict(
                body.model_dump(),
                _id=card_id,
                ticket_number=counter["value"],
                position=last["position"] + 1 if last else 0,
                creator=username,
                created_at=now,
                updated_at=now,
                version=1,
                comments_version=0,
                comments=[],
            )
            await self.db.cards.insert_one(card, session=session)
            return CardOut.from_doc(card)

        return await self.transaction(write)

    async def patch(self, card_id, body):
        changes = body.model_dump(exclude_unset=True, exclude={"expected_version"})

        async def write(session):
            card = await self._card(card_id, session)
            self._version(card["version"], body.expected_version)
            if card["column"] == "blocked" and changes.get("health", "blocked") != "blocked":
                raise APIError(
                    422, "blocked_health", "Health is locked to blocked in the Blocked column"
                )
            if "assignees" in changes:
                await self._assignees(changes["assignees"], session)
            updated = await self.db.cards.find_one_and_update(
                {"_id": card_id, "version": body.expected_version},
                {"$set": {**changes, "updated_at": datetime.now(UTC)}, "$inc": {"version": 1}},
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            return CardOut.from_doc(updated)

        return await self.transaction(write)

    async def move(self, card_id, body):
        async def write(session):
            card = await self._card(card_id, session)
            self._version(card["version"], body.expected_version)
            columns = {card["column"], body.column}
            if not columns.issubset(body.expected_order_versions):
                raise APIError(
                    422,
                    "missing_order_versions",
                    "Supply order versions for source and destination columns",
                )
            # Check both revisions before checking an anchor that might have moved.
            for column in sorted(columns):
                await self._bump_order(column, session, body.expected_order_versions[column])
            destination = [
                item for item in await self._column(body.column, session) if item["_id"] != card_id
            ]
            ids = [item["_id"] for item in destination]
            if body.before_card_id is not None and body.before_card_id not in ids:
                raise APIError(
                    422, "invalid_anchor", "Anchor must be another card in the destination column"
                )
            position = (
                ids.index(body.before_card_id) if body.before_card_id is not None else len(ids)
            )
            destination.insert(position, card)
            # Dense integer ranks avoid floating-point exhaustion and rebalance
            # complexity. Neighbor ranks are ordering metadata, not content edits.
            updates = [
                UpdateOne({"_id": item["_id"]}, {"$set": {"position": index}})
                for index, item in enumerate(destination)
                if item["_id"] != card_id and item["position"] != index
            ]
            if updates:
                await self.db.cards.bulk_write(updates, session=session)
            updated = await self.db.cards.find_one_and_update(
                {"_id": card_id, "version": body.expected_version},
                {
                    "$set": {
                        "column": body.column,
                        "position": position,
                        "health": "blocked" if body.column == "blocked" else card["health"],
                        "updated_at": datetime.now(UTC),
                    },
                    "$inc": {"version": 1},
                },
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            return MoveOut(
                card=CardOut.from_doc(updated), order_versions=await self._orders(session)
            )

        return await self.transaction(write)

    async def delete(self, card_id, expected_version, expected_comments_version):
        async def write(session):
            card = await self._card(card_id, session)
            self._version(card["version"], expected_version)
            self._version(card["comments_version"], expected_comments_version)
            await self._bump_order(card["column"], session)
            await self.db.cards.delete_one(
                {
                    "_id": card_id,
                    "version": expected_version,
                    "comments_version": expected_comments_version,
                },
                session=session,
            )

        await self.transaction(write)

    async def add_comment(self, card_id, body, username):
        comment_id = uuid4().hex

        async def write(session):
            await self._card(card_id, session)
            now = datetime.now(UTC)
            comment = dict(
                id=comment_id,
                text=body.text,
                author=username,
                created_at=now,
                updated_at=now,
                version=1,
            )
            updated = await self.db.cards.find_one_and_update(
                {"_id": card_id, "comments.19": {"$exists": False}},
                {"$push": {"comments": comment}, "$inc": {"comments_version": 1}},
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            if updated is None:
                raise APIError(
                    422, "comment_limit_reached", "A card can contain at most 20 comments"
                )
            return CardOut.from_doc(updated)

        return await self.transaction(write)

    async def change_comment(self, card_id, comment_id, username, expected_version, text=None):
        async def write(session):
            card = await self._card(card_id, session)
            comment = next((item for item in card["comments"] if item["id"] == comment_id), None)
            if comment is None:
                raise APIError(404, "not_found", "Comment not found")
            if comment["author"] != username:
                raise APIError(403, "forbidden", "Only the comment author can change this comment")
            self._version(comment["version"], expected_version)
            match = {"id": comment_id, "author": username, "version": expected_version}
            if text is None:
                update = {"$pull": {"comments": match}, "$inc": {"comments_version": 1}}
            else:
                update = {
                    "$set": {"comments.$.text": text, "comments.$.updated_at": datetime.now(UTC)},
                    "$inc": {"comments.$.version": 1, "comments_version": 1},
                }
            updated = await self.db.cards.find_one_and_update(
                {"_id": card_id, "comments": {"$elemMatch": match}},
                update,
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            return CardOut.from_doc(updated)

        return await self.transaction(write)
