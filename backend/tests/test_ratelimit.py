"""Login HTTP contracts and store failures without a running MongoDB."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pymongo.errors import ConnectionFailure, DuplicateKeyError, ExecutionTimeout

from app.config import Settings
from app.main import create_app
from app.ratelimit import LoginLimiter


@pytest.fixture
def login_system(monkeypatch):
    settings = Settings(jwt_secret="test-only-secret-" * 3, _env_file=None)
    app = create_app(settings)
    app.state.db = Mock()
    collection = Mock()
    app.state.db.login_limits.with_options.return_value = collection
    collection.find_one_and_update = AsyncMock(return_value={"admitted": True})
    app.state.db.users.find_one = AsyncMock(return_value=None)
    verify = AsyncMock(return_value=False)
    token = AsyncMock(return_value="test-token")
    monkeypatch.setattr("app.routes.auth.verify_password", verify)
    monkeypatch.setattr("app.routes.auth.create_token", token)
    return (
        app,
        TestClient(app, headers={"Origin": "http://localhost:4321"}),
        collection,
        verify,
        token,
    )


@pytest.mark.parametrize("known", [True, False])
def test_allowed_invalid_login_is_generic_and_normalized(login_system, known):
    app, client, collection, verify, token = login_system
    if known:
        app.state.db.users.find_one.return_value = {"_id": "chris", "password_hash": "hash"}
    response = client.post("/api/auth/login", json={"username": " CHRIS ", "password": "wrong"})
    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "code": "unauthenticated",
            "message": "Invalid username or password",
            "fields": [],
        }
    }
    app.state.db.users.find_one.assert_awaited_once_with({"_id": "chris"})
    verify.assert_awaited_once_with("hash" if known else None, "wrong")
    assert collection.find_one_and_update.await_count == 2
    token.assert_not_awaited()


@pytest.mark.parametrize("bucket", [0, 1])
def test_throttled_login_never_reads_user_verifies_or_issues_token(login_system, bucket):
    app, client, collection, verify, token = login_system
    now = datetime(2040, 1, 1, tzinfo=UTC)
    denied = {"admitted": False, "observed_at": now, "expires_at": now + timedelta(seconds=1.1)}
    collection.find_one_and_update.side_effect = [{"admitted": True}] * bucket + [denied]
    response = client.post("/api/auth/login", json={"username": "chris", "password": "secret"})
    assert response.status_code == 429
    assert response.headers["retry-after"] == "2"
    assert response.json() == {
        "error": {
            "code": "login_throttled",
            "message": "Too many login attempts; try again later",
            "fields": [],
        }
    }
    assert "set-cookie" not in response.headers
    app.state.db.users.find_one.assert_not_awaited()
    verify.assert_not_awaited()
    token.assert_not_awaited()


@pytest.mark.parametrize("failure", [ConnectionFailure, ExecutionTimeout])
@pytest.mark.parametrize("bucket", [0, 1])
def test_store_failure_fails_closed_without_sensitive_details(login_system, failure, bucket):
    app, client, collection, verify, token = login_system
    collection.find_one_and_update.side_effect = [{"admitted": True}] * bucket + [
        failure("mongodb://user:private-password@private-host")
    ]
    response = client.post("/api/auth/login", json={"username": "chris", "password": "secret"})
    assert response.status_code == 503
    assert response.json() == {
        "error": {"code": "database_unavailable", "message": "Database unavailable", "fields": []}
    }
    assert "set-cookie" not in response.headers
    app.state.db.users.find_one.assert_not_awaited()
    verify.assert_not_awaited()
    token.assert_not_awaited()


async def test_first_insert_collision_retries_and_persistent_collision_fails(login_system):
    app, _, collection, _, _ = login_system
    limiter = LoginLimiter(app.state.db, app.state.settings)
    collection.find_one_and_update.side_effect = [
        DuplicateKeyError("collision"),
        {"admitted": True},
    ]
    await limiter._reserve("global", 2, 60)
    assert collection.find_one_and_update.await_count == 2
    collection.find_one_and_update.side_effect = DuplicateKeyError("collision")
    with pytest.raises(DuplicateKeyError):
        await limiter.check("chris")


@pytest.mark.parametrize(
    "name",
    [
        "login_username_limit",
        "login_username_window_seconds",
        "login_global_limit",
        "login_global_window_seconds",
    ],
)
@pytest.mark.parametrize("value", [0, -1, 100000])
def test_invalid_settings_rejected(name, value):
    with pytest.raises(ValidationError):
        Settings(jwt_secret="test-only-secret-" * 3, _env_file=None, **{name: value})
