"""HTTP contract checks that do not need a database."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pymongo.errors import ConnectionFailure

from app.auth import current_user
from app.config import Settings
from app.main import create_app
from app.routes.cards import get_store
from app.schemas.cards import CardCreate


@pytest.fixture
def app():
    app = create_app(Settings(jwt_secret="test-only-secret-" * 3, _env_file=None))
    app.state.db = AsyncMock()
    return app


@pytest.fixture
def client(app):
    # No lifespan: these checks intentionally don't initialize MongoDB.
    return TestClient(app)


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "/api/users", None),
        ("GET", "/api/cards", None),
        ("GET", "/api/cards/missing", None),
        ("POST", "/api/cards", {"title": "A", "tag": "feature"}),
        ("PATCH", "/api/cards/a", {"title": "A", "expected_version": 1}),
        (
            "POST",
            "/api/cards/a/move",
            {"column": "done", "expected_version": 1, "expected_order_versions": {}},
        ),
        ("DELETE", "/api/cards/a?expected_version=1&expected_comments_version=0", None),
        ("POST", "/api/cards/a/comments", {"text": "hello"}),
        ("PATCH", "/api/cards/a/comments/b", {"text": "hello", "expected_comment_version": 1}),
        ("DELETE", "/api/cards/a/comments/b?expected_comment_version=1", None),
    ],
)
def test_board_requires_authentication(client, method, path, body):
    response = client.request(method, path, json=body)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


INVALID_CREATES = [
    {"tag": None},
    {"tag": ""},
    {"tag": "  "},
    {"tag": []},
    {"tag": "a" * 33},
    {"title": ""},
    {"title": "  "},
    {"title": "a" * 201},
    {"title": None},
    {"description": "a" * 20001},
    {"description": None},
    {"column": "in-progress"},
    {"column": None},
    {"difficulty": "Medium"},
    {"health": "Healthy"},
    {"assignees": None},
    {"assignees": ["chris"] * 2},
    {"assignees": ["a", "b", "c", "d"]},
    {"assignees": [1]},
    {"column": "blocked", "health": "healthy"},
    {"column": "blocked", "health": "at_risk"},
    *[
        {name: value}
        for name, value in {
            "tags": ["feature"],
            "id": "spoofed",
            "ticket_number": 1,
            "position": 0,
            "creator": "sean",
            "created_at": "now",
            "updated_at": "now",
            "version": 1,
            "comments_version": 0,
            "comments": [],
            "expected_version": 1,
        }.items()
    ],
]


@pytest.mark.parametrize("changes", INVALID_CREATES)
def test_invalid_create_never_reaches_store(app, client, changes):
    app.dependency_overrides[current_user] = lambda: {"_id": "chris"}
    store = AsyncMock()
    app.dependency_overrides[get_store] = lambda: store
    response = client.post("/api/cards", json={"title": "A", "tag": "feature", **changes})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"
    store.create.assert_not_awaited()


@pytest.mark.parametrize(
    "body",
    [
        {"title": "A"},
        {"tag": "feature"},
    ],
)
def test_create_requires_title_and_tag(app, client, body):
    app.dependency_overrides[current_user] = lambda: {"_id": "chris"}
    assert client.post("/api/cards", json=body).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"expected_version": 1},
        {"title": "new"},
        {"expected_version": 0, "title": "new"},
        {"expected_version": True, "title": "new"},
        {"expected_version": "1", "title": "new"},
        *[
            {"expected_version": 1, field: None}
            for field in ("title", "tag", "description", "difficulty", "health", "assignees")
        ],
        *[
            {"expected_version": 1, field: value}
            for field, value in {
                "column": "done",
                "position": 2,
                "comments": [],
                "creator": "sean",
                "tag": "",
                "tags": ["feature"],
                "version": 2,
                "comments_version": 1,
            }.items()
        ],
    ],
)
def test_invalid_patch_never_reaches_store(app, client, body):
    app.dependency_overrides[current_user] = lambda: {"_id": "chris"}
    store = AsyncMock()
    app.dependency_overrides[get_store] = lambda: store
    response = client.patch("/api/cards/a", json=body)
    assert response.status_code == 422, response.text
    store.patch.assert_not_awaited()


@pytest.mark.parametrize(
    "body",
    [
        {"text": ""},
        {"text": "  "},
        {"text": "a" * 4001},
        {"text": None},
        {"text": "ok", "author": "sean"},
    ],
)
def test_comment_input_validation(app, client, body):
    app.dependency_overrides[current_user] = lambda: {"_id": "chris"}
    assert client.post("/api/cards/a/comments", json=body).status_code == 422


def test_defaults_and_boundaries():
    card = CardCreate(title="  title  ", tag="  FeAtUrE  ")
    assert (card.title, card.tag, card.column, card.health, card.difficulty, card.assignees) == (
        "title",
        "feature",
        "review",
        "healthy",
        "medium",
        [],
    )
    assert CardCreate(title="a" * 200, tag="a" * 32, description="a" * 20000)
    assert CardCreate(title="a", tag="b", column="blocked").health == "blocked"


def test_health_and_generic_database_errors(app, client):
    assert client.get("/api/health/live").json() == {"status": "ok"}
    assert client.get("/api/health/ready").status_code == 200
    app.state.db.command.side_effect = ConnectionFailure("private database connection details")
    response = client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json() == {
        "error": {"code": "database_unavailable", "message": "Database unavailable", "fields": []}
    }
    app.dependency_overrides[current_user] = lambda: {"_id": "chris"}
    app.state.db.cards.find_one.side_effect = ConnectionFailure("private details")
    assert client.get("/api/cards/a").status_code == 503


@pytest.mark.parametrize("username", [None, 1, [], {}, "   "])
def test_login_validation_does_not_echo_password(client, username):
    response = client.post(
        "/api/auth/login", json={"username": username, "password": "private-password"}
    )
    assert response.status_code == 422
    assert "private-password" not in response.text


def test_openapi_contract(client):
    spec = client.get("/openapi.json").json()
    schemas = spec["components"]["schemas"]
    assert set(schemas["UserOut"]["properties"]) == {"username"}
    assert set(schemas["CardCreate"]["required"]) == {"title", "tag"}
    assert schemas["CardPatch"]["required"] == ["expected_version"]
    assert "parameters" not in spec["paths"]["/api/cards"]["get"]
    assert spec["paths"]["/api/cards/{card_id}"]["delete"]["responses"].get("204")


def test_atlas_uri_alias_and_secret_redaction(monkeypatch):
    monkeypatch.delenv("MONGO_URL", raising=False)
    monkeypatch.setenv("MONGODB_URI", "mongodb://user:private-password@localhost")
    settings = Settings(jwt_secret="test-only-secret-" * 3, _env_file=None)
    assert settings.mongo_url == "mongodb://user:private-password@localhost"
    assert "private-password" not in repr(settings)
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27018")
    assert (
        Settings(jwt_secret="test-only-secret-" * 3, _env_file=None).mongo_url
        == "mongodb://localhost:27018"
    )
