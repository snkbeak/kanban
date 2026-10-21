"""Real MongoDB tests. Set MONGO_TEST_URL to an isolated local replica set.

Only a generated kanban_test_<uuid> database is created/dropped. A configured
but unreachable/incompatible MongoDB fails the suite instead of being skipped.
"""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import jwt
import pytest
import pytest_asyncio
from dotenv import dotenv_values
from pymongo.errors import DuplicateKeyError

from app.auth import ALGORITHM, COOKIE, create_token, hasher
from app.cards_store import CardsStore, initialize_database
from app.config import Settings
from app.create_user import set_password
from app.errors import APIError
from app.main import create_app

TEST_URL = os.getenv("MONGO_TEST_URL") or dotenv_values(
    Path(__file__).resolve().parents[1] / ".env"
).get("MONGO_TEST_URL")
pytestmark = pytest.mark.skipif(
    not TEST_URL, reason="MONGO_TEST_URL is not set; real MongoDB replica set required"
)
PASSWORD = "integration-test-password"


@pytest_asyncio.fixture
async def system():
    # Atlas shared tiers limit names to 38 bytes; retain 96 random bits.
    database = "kanban_test_" + uuid4().hex[:24]
    settings = Settings(
        mongo_url=TEST_URL,
        mongo_db=database,
        jwt_secret="integration-only-secret-" * 3,
        _env_file=None,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        db = app.state.db
        clients = {}
        try:
            password_hash = hasher.hash(PASSWORD)
            await db.users.insert_many(
                [
                    {"_id": name, "password_hash": password_hash}
                    for name in ("chris", "sean", "james")
                ]
            )
            for name in ("chris", "sean"):
                client = httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test"
                )
                clients[name] = client
                response = await client.post(
                    "/api/auth/login", json={"username": name, "password": PASSWORD}
                )
                assert response.status_code == 200, response.text
            yield app, db, clients
        finally:
            for client in clients.values():
                await client.aclose()
            assert database.startswith("kanban_test_") and len(database) == len("kanban_test_") + 24
            await db.client.drop_database(database)


async def create(client, **fields):
    response = await client.post("/api/cards", json={"title": "Card", "tag": "feature", **fields})
    assert response.status_code == 201, response.text
    return response.json()


async def board(client):
    response = await client.get("/api/cards")
    assert response.status_code == 200, response.text
    return response.json()


def move_body(card, state, column, before=None):
    return {
        "column": column,
        "before_card_id": before,
        "expected_version": card["version"],
        "expected_order_versions": state["order_versions"],
    }


async def move(client, card, column, before=None):
    response = await client.post(
        f"/api/cards/{card['id']}/move", json=move_body(card, await board(client), column, before)
    )
    assert response.status_code == 200, response.text
    return response.json()["card"]


def delete_url(card):
    return f"/api/cards/{card['id']}?expected_version={card['version']}&expected_comments_version={card['comments_version']}"


async def test_identity_login_logout_reset_and_old_sessions(system):
    app, db, clients = system
    client = clients["chris"]
    assert (await client.get("/api/auth/me")).json() == {"username": "chris"}
    assert (await client.get("/api/users")).json() == [
        {"username": name} for name in ("chris", "james", "sean")
    ]
    assert set(await db.users.find_one({"_id": "chris"})) == {"_id", "password_hash"}
    claims = jwt.decode(
        client.cookies[COOKIE], app.state.settings.jwt_secret, algorithms=[ALGORITHM]
    )
    assert claims["sub"] == "chris"
    assert (await db.tokens.find_one({"jti": claims["jti"]}))["username"] == "chris"
    token = client.cookies[COOKIE]
    assert (await client.post("/api/auth/logout")).status_code == 204
    client.cookies.set(COOKIE, token)
    assert (await client.get("/api/auth/me")).status_code == 401
    client.cookies.clear()
    assert (
        await client.post("/api/auth/login", json={"username": " CHRIS ", "password": PASSWORD})
    ).json() == {"username": "chris"}
    created, revoked = await set_password(db, " CHRIS ", "replacement-password")
    assert not created and revoked == 1
    assert (await client.get("/api/auth/me")).status_code == 401
    assert (
        await client.post("/api/auth/login", json={"username": "chris", "password": PASSWORD})
    ).status_code == 401
    assert (
        await client.post(
            "/api/auth/login", json={"username": "chris", "password": "replacement-password"}
        )
    ).status_code == 200
    assert (
        await client.post("/api/auth/login", json={"username": "unknown", "password": PASSWORD})
    ).status_code == 401
    old_id = uuid4().hex
    old_jti = uuid4().hex
    expires = datetime.now(UTC) + timedelta(days=1)
    await db.tokens.insert_one({"jti": old_jti, "user_id": old_id, "expires_at": expires})
    client.cookies.clear()
    client.cookies.set(
        COOKIE,
        jwt.encode(
            {"sub": old_id, "jti": old_jti, "exp": expires},
            app.state.settings.jwt_secret,
            algorithm=ALGORITHM,
        ),
    )
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_expiry_revocation_and_token_ownership(system):
    app, db, clients = system
    client = clients["chris"]
    settings = app.state.settings
    for subject, record_owner, expiry in [("chris", "chris", -1), ("chris", "sean", 3600)]:
        jti = uuid4().hex
        await db.tokens.insert_one(
            {
                "jti": jti,
                "username": record_owner,
                "expires_at": datetime.now(UTC) + timedelta(hours=1),
            }
        )
        token = jwt.encode(
            {"sub": subject, "jti": jti, "exp": datetime.now(UTC) + timedelta(seconds=expiry)},
            settings.jwt_secret,
            algorithm=ALGORITHM,
        )
        client.cookies.clear()
        client.cookies.set(COOKIE, token)
        assert (await client.get("/api/auth/me")).status_code == 401
    token = await create_token(db.tokens, "chris", settings)
    await db.tokens.update_many(
        {"username": "chris"}, {"$set": {"expires_at": datetime.now(UTC) - timedelta(seconds=1)}}
    )
    client.cookies.clear()
    client.cookies.set(COOKIE, token)
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_card_crud_defaults_validation_and_shared_permissions(system):
    _, db, clients = system
    client = clients["chris"]
    card = await create(client, title=" title ", tag=" FeAtUrE ")
    assert (
        card["title"],
        card["tag"],
        card["column"],
        card["difficulty"],
        card["health"],
        card["assignees"],
    ) == ("title", "feature", "review", "medium", "healthy", [])
    assert card["creator"] == "chris" and card["version"] == 1 and card["comments_version"] == 0
    path = f"/api/cards/{card['id']}"
    assert (await clients["sean"].get(path)).json() == card
    assert (
        await client.post("/api/cards", json={"title": "a", "tag": "b", "assignees": ["missing"]})
    ).status_code == 422
    assert (
        await client.patch(path, json={"expected_version": 1, "assignees": ["CHRIS"]})
    ).status_code == 422
    response = await clients["sean"].patch(
        path,
        json={
            "expected_version": 1,
            "title": "b" * 200,
            "description": "x" * 20000,
            "tag": "t" * 32,
            "assignees": ["chris", "sean", "james"],
        },
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["creator"] == "chris" and updated["version"] == 2
    for field, value in [("title", "a" * 201), ("description", "a" * 20001), ("tag", "a" * 33)]:
        assert (
            await client.patch(path, json={"expected_version": 2, field: value})
        ).status_code == 422
        assert (await client.get(path)).json() == updated
    response = await client.patch(
        path, json={"expected_version": 2, "description": "", "assignees": []}
    )
    assert response.status_code == 200
    assert response.json()["tag"] == updated["tag"] and response.json()["assignees"] == []
    assert (await clients["sean"].delete(delete_url(response.json()))).status_code == 204
    assert await db.cards.find_one({"_id": card["id"]}) is None
    assert (await client.get(path)).status_code == 404
    assert (await client.get("/api/cards/not-a-uuid")).status_code == 404


async def test_ordering_and_blocked_health(system):
    _, _, clients = system
    client = clients["chris"]
    a, b, c = [await create(client, title=name) for name in ("A", "B", "C")]
    c = await move(client, c, "review", a["id"])
    assert [item["id"] for item in (await board(client))["cards"]] == [c["id"], a["id"], b["id"]]
    d = await create(client, title="D")
    assert [item["id"] for item in (await board(clients["sean"]))["cards"]] == [
        c["id"],
        a["id"],
        b["id"],
        d["id"],
    ]
    c = await move(client, c, "review")
    assert [item["id"] for item in (await board(client))["cards"]] == [
        a["id"],
        b["id"],
        d["id"],
        c["id"],
    ]
    blocked = await create(client, column="blocked")
    assert blocked["health"] == "blocked"
    c = await move(client, c, "blocked", blocked["id"])
    assert c["health"] == "blocked" and c["version"] == 4
    c = await move(client, c, "blocked")
    path = f"/api/cards/{c['id']}"
    for health in ("healthy", "at_risk"):
        assert (
            await client.patch(
                path,
                json={"expected_version": c["version"], "health": health, "title": "must not save"},
            )
        ).status_code == 422
        assert (await client.get(path)).json() == c
    response = await client.patch(path, json={"expected_version": c["version"], "title": "allowed"})
    assert response.status_code == 200
    c = await move(client, response.json(), "done")
    assert c["health"] == "blocked"
    response = await client.patch(
        path, json={"expected_version": c["version"], "health": "at_risk"}
    )
    assert response.status_code == 200
    c = await move(client, response.json(), "backlog")
    assert c["health"] == "at_risk"
    # Reopening the board through a new store sees the persisted order.
    assert [item.id for item in (await CardsStore(system[1]).board()).cards] == [
        item["id"] for item in (await board(client))["cards"]
    ]


async def test_concurrent_creates_tickets_indexes_and_no_reuse(system):
    _, db, clients = system
    client = clients["chris"]
    first = await create(client)
    cards = await asyncio.gather(*(create(client) for _ in range(8)))
    state = await board(client)
    assert len(state["cards"]) == 9 and state["cards"][0]["id"] == first["id"]
    assert len({card["ticket_number"] for card in state["cards"]}) == 9
    assert len({card["position"] for card in state["cards"]}) == 9
    assert state["order_versions"]["review"] == 9
    assert (await client.delete(delete_url(cards[-1]))).status_code == 204
    new = await create(client)
    assert new["ticket_number"] > max(card["ticket_number"] for card in state["cards"])
    duplicate = await db.cards.find_one({"_id": new["id"]})
    duplicate["_id"] = uuid4().hex
    with pytest.raises(DuplicateKeyError):
        await db.cards.insert_one(duplicate)
    await initialize_database(db)
    assert (await create(client))["ticket_number"] > new["ticket_number"]


async def test_competing_card_edits_and_move_health_race(system):
    _, _, clients = system
    client = clients["chris"]
    card = await create(client)
    path = f"/api/cards/{card['id']}"
    responses = await asyncio.gather(
        *(client.patch(path, json={"expected_version": 1, "title": name}) for name in ("A", "B"))
    )
    assert sorted(r.status_code for r in responses) == [200, 409]
    card = (await client.get(path)).json()
    state = await board(client)
    responses = await asyncio.gather(
        client.patch(path, json={"expected_version": card["version"], "health": "healthy"}),
        client.post(path + "/move", json=move_body(card, state, "blocked")),
    )
    assert sorted(r.status_code for r in responses) == [200, 409]
    card = (await client.get(path)).json()
    assert card["column"] != "blocked" or card["health"] == "blocked"


async def test_stale_orders_anchors_and_simultaneous_reorders(system):
    _, _, clients = system
    client = clients["chris"]
    a, b, c = [await create(client) for _ in range(3)]
    state = await board(client)
    responses = await asyncio.gather(
        client.post(f"/api/cards/{c['id']}/move", json=move_body(c, state, "review", a["id"])),
        client.post(f"/api/cards/{b['id']}/move", json=move_body(b, state, "review", a["id"])),
    )
    assert sorted(r.status_code for r in responses) == [200, 409]
    state = await board(client)
    a = await move(client, a, "done")
    b = (await client.get(f"/api/cards/{b['id']}")).json()
    response = await client.post(
        f"/api/cards/{b['id']}/move", json=move_body(b, state, "review", a["id"])
    )
    assert response.status_code == 409
    current = await board(client)
    for anchor in (a["id"], b["id"], "missing"):
        response = await client.post(
            f"/api/cards/{b['id']}/move", json=move_body(b, current, "review", anchor)
        )
        assert response.status_code == 422
        assert await board(client) == current
    assert (await client.delete(delete_url(a))).status_code == 204
    response = await client.post(
        f"/api/cards/{b['id']}/move", json=move_body(b, current, "done", a["id"])
    )
    assert response.status_code == 409


async def test_creates_and_deletes_racing_with_moves(system):
    _, _, clients = system
    client = clients["chris"]
    a, b = [await create(client) for _ in range(2)]
    state = await board(client)
    moved, created = await asyncio.gather(
        client.post(f"/api/cards/{b['id']}/move", json=move_body(b, state, "review", a["id"])),
        client.post("/api/cards", json={"title": "New", "tag": "feature"}),
    )
    assert moved.status_code in (200, 409) and created.status_code == 201
    state = await board(client)
    assert len({item["position"] for item in state["cards"]}) == 3
    b = next(item for item in state["cards"] if item["id"] == b["id"])
    moved, deleted = await asyncio.gather(
        client.post(f"/api/cards/{b['id']}/move", json=move_body(b, state, "review", a["id"])),
        client.delete(delete_url(a)),
    )
    assert moved.status_code in (200, 409) and deleted.status_code == 204
    state = await board(client)
    assert len(state["cards"]) == 2 and len({item["position"] for item in state["cards"]}) == 2


async def test_order_transaction_rolls_back_on_failure(system, monkeypatch):
    _, _, clients = system
    client = clients["chris"]
    card = await create(client)
    state = await board(client)
    original = CardsStore._bump_order

    async def fail_after_write(self, *args, **kwargs):
        await original(self, *args, **kwargs)
        raise APIError(503, "injected_failure", "Test rollback")

    monkeypatch.setattr(CardsStore, "_bump_order", fail_after_write)
    assert (
        await client.post(f"/api/cards/{card['id']}/move", json=move_body(card, state, "blocked"))
    ).status_code == 503
    assert await board(client) == state
    assert (await client.delete(delete_url(card))).status_code == 503
    assert await board(client) == state
    assert (
        await client.post("/api/cards", json={"title": "Fail", "tag": "feature"})
    ).status_code == 503
    assert await board(client) == state
    monkeypatch.setattr(CardsStore, "_bump_order", original)
    assert (await create(client))["ticket_number"] == card["ticket_number"] + 2


async def test_comment_permissions_independent_versions_and_deletion_guard(system):
    _, db, clients = system
    client, other = clients["chris"], clients["sean"]
    card = await create(client)
    path = f"/api/cards/{card['id']}"
    response = await client.post(path + "/comments", json={"text": "a" * 4000})
    assert response.status_code == 201
    discussed = response.json()
    comment = discussed["comments"][0]
    assert discussed["version"] == 1 and discussed["comments_version"] == 1
    assert discussed["updated_at"] == card["updated_at"]
    comment_path = path + f"/comments/{comment['id']}"
    assert (await client.post(path + "/comments", json={"text": "a" * 4001})).status_code == 422
    assert (
        await other.patch(comment_path, json={"text": "no", "expected_comment_version": 99})
    ).status_code == 403
    assert (await other.delete(comment_path + "?expected_comment_version=99")).status_code == 403
    assert (await client.get(path)).json() == discussed
    response = await other.patch(path, json={"title": "Content edit", "expected_version": 1})
    assert response.status_code == 200 and response.json()["comments_version"] == 1
    response = await client.patch(
        comment_path, json={"text": " edited ", "expected_comment_version": 1}
    )
    assert response.status_code == 200
    edited = response.json()
    assert edited["version"] == 2 and edited["comments_version"] == 2
    assert (
        edited["comments"][0]["author"] == "chris"
        and edited["comments"][0]["created_at"] == comment["created_at"]
    )
    assert edited["comments"][0]["text"] == "edited"
    assert (await client.delete(comment_path + "?expected_comment_version=1")).status_code == 409
    assert (
        await client.delete(path + "?expected_version=2&expected_comments_version=1")
    ).status_code == 409
    assert (await other.delete(delete_url(edited))).status_code == 204
    assert await db.cards.count_documents({"_id": card["id"]}) == 0
    assert (await client.post(path + "/comments", json={"text": "orphan"})).status_code == 404


async def test_concurrent_comments_and_content_changes(system):
    _, _, clients = system
    client = clients["chris"]
    card = await create(client)
    path = f"/api/cards/{card['id']}"
    responses = await asyncio.gather(
        client.patch(path, json={"expected_version": 1, "title": "new title"}),
        client.post(path + "/comments", json={"text": "one"}),
    )
    assert sorted(r.status_code for r in responses) == [200, 201]
    card = (await client.post(path + "/comments", json={"text": "two"})).json()
    a, b = card["comments"]
    responses = await asyncio.gather(
        client.patch(
            path + f"/comments/{a['id']}", json={"expected_comment_version": 1, "text": "A"}
        ),
        client.patch(
            path + f"/comments/{b['id']}", json={"expected_comment_version": 1, "text": "B"}
        ),
        client.patch(path, json={"expected_version": 2, "description": "independent"}),
    )
    assert [r.status_code for r in responses] == [200, 200, 200]
    card = (await client.get(path)).json()
    assert card["version"] == 3 and card["comments_version"] == 4
    assert card["title"] == "new title" and [item["text"] for item in card["comments"]] == [
        "A",
        "B",
    ]
    responses = await asyncio.gather(
        *(
            client.patch(
                path + f"/comments/{a['id']}", json={"expected_comment_version": 2, "text": text}
            )
            for text in ("X", "Y")
        )
    )
    assert sorted(r.status_code for r in responses) == [200, 409]
    responses = await asyncio.gather(
        client.delete(path + f"/comments/{b['id']}?expected_comment_version=2"),
        client.patch(path, json={"expected_version": 3, "title": "still independent"}),
    )
    assert [r.status_code for r in responses] == [200, 200]
    card = (await client.get(path)).json()
    assert card["version"] == 4 and card["comments_version"] == 6 and len(card["comments"]) == 1


async def test_comment_cap_is_atomic_and_deletion_frees_slot(system):
    _, _, clients = system
    client = clients["chris"]
    card = await create(client)
    path = f"/api/cards/{card['id']}"
    for index in range(19):
        assert (await client.post(path + "/comments", json={"text": str(index)})).status_code == 201
    responses = await asyncio.gather(
        *(client.post(path + "/comments", json={"text": "race"}) for _ in range(2))
    )
    assert sorted(r.status_code for r in responses) == [201, 422]
    assert (
        next(r for r in responses if r.status_code == 422).json()["error"]["code"]
        == "comment_limit_reached"
    )
    card = (await client.get(path)).json()
    assert len(card["comments"]) == 20 and card["comments_version"] == 20 and card["version"] == 1
    assert (await client.post(path + "/comments", json={"text": "21st"})).status_code == 422
    assert (await client.get(path)).json() == card
    comment_path = path + f"/comments/{card['comments'][0]['id']}"
    assert (
        await client.patch(
            comment_path, json={"text": "allowed at cap", "expected_comment_version": 1}
        )
    ).status_code == 200
    assert (await client.delete(comment_path + "?expected_comment_version=2")).status_code == 200
    response = await client.post(path + "/comments", json={"text": "replacement"})
    assert response.status_code == 201 and len(response.json()["comments"]) == 20


async def test_comment_racing_with_whole_card_deletion(system):
    _, db, clients = system
    client = clients["chris"]
    card = await create(client)
    deleted, added = await asyncio.gather(
        client.delete(delete_url(card)),
        client.post(f"/api/cards/{card['id']}/comments", json={"text": "new discussion"}),
    )
    assert (deleted.status_code, added.status_code) in ((204, 404), (409, 201))
    stored = await db.cards.find_one({"_id": card["id"]})
    assert (stored is None) if deleted.status_code == 204 else len(stored["comments"]) == 1
