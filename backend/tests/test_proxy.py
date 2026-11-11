from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pymongo.errors import InvalidURI

from app.config import Settings
from app.main import create_app

SECRET = "isolated-proxy-test-secret-" * 2
ORIGIN = "https://board.example"


def settings(**extra):
    return Settings(jwt_secret="test-jwt-secret-" * 3, _env_file=None, **extra)


@pytest.mark.parametrize("secret", [None, "", "short"])
def test_production_requires_proxy_secret(secret):
    with pytest.raises(ValidationError):
        settings(
            app_env="production", cookie_secure=True, trusted_origins=(ORIGIN,), proxy_secret=secret
        )


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/auth/login"),
        ("POST", "/api/auth/logout"),
        ("GET", "/api/auth/me"),
        ("GET", "/api/cards"),
        ("POST", "/api/cards"),
        ("PATCH", "/api/cards/a"),
        ("DELETE", "/api/cards/a"),
        ("GET", "/api/health/ready"),
        ("GET", "/docs"),
    ],
)
@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"X-Kanban-Proxy-Secret": "wrong"},
        [("X-Kanban-Proxy-Secret", SECRET), ("X-Kanban-Proxy-Secret", SECRET)],
        {
            "Host": "board.example",
            "Forwarded": "host=board.example;proto=https",
            "X-Forwarded-Host": "board.example",
            "X-Forwarded-For": "127.0.0.1",
        },
    ],
)
def test_direct_requests_rejected_before_any_work(method, path, headers):
    app = create_app(settings(proxy_secret=SECRET))
    app.state.db = AsyncMock()
    client = TestClient(app)
    client.cookies.set("access_token", "keep-session")
    response = client.request(method, path, headers=headers)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "proxy_forbidden"
    assert "set-cookie" not in response.headers
    assert "keep-session" not in response.text and SECRET not in response.text
    assert client.cookies.get("access_token") == "keep-session"
    assert app.state.db.mock_calls == []


def test_authenticated_proxy_still_requires_origin_and_user_authentication():
    config = settings(
        app_env="production", cookie_secure=True, trusted_origins=(ORIGIN,), proxy_secret=SECRET
    )
    assert SECRET not in repr(config)
    app = create_app(config)
    app.state.db = AsyncMock()
    client = TestClient(app, headers={"X-Kanban-Proxy-Secret": SECRET})
    assert client.get("/api/cards").status_code == 401
    denied = client.post("/api/auth/logout")
    assert denied.json()["error"]["code"] == "csrf_rejected"
    assert "set-cookie" not in denied.headers
    allowed = client.post("/api/auth/logout", headers={"Origin": ORIGIN})
    assert allowed.status_code == 204
    assert "Secure" in allowed.headers["set-cookie"]
    assert client.get("/api/health/ready").status_code == 200
    app.state.db.command.assert_awaited_once_with("ping")


def test_only_exact_get_liveness_bypasses_proxy_authentication():
    app = create_app(settings(proxy_secret=SECRET))
    app.state.db = AsyncMock()
    client = TestClient(app)
    assert client.get("/api/health/live").json() == {"status": "ok"}
    assert client.get("/api/health/live/").status_code == 403
    assert client.post("/api/health/live").status_code == 403
    assert app.state.db.mock_calls == []


async def test_startup_configuration_failure_redacts_database_credentials(monkeypatch):
    def invalid_client(*args, **kwargs):
        raise InvalidURI("mongodb://user:private-password@host")

    monkeypatch.setattr("app.main.AsyncMongoClient", invalid_client)
    app = create_app(settings())
    with pytest.raises(RuntimeError, match="^Database initialization failed$") as error:
        async with app.router.lifespan_context(app):
            pytest.fail("Invalid configuration must not start")
    assert error.value.__suppress_context__
