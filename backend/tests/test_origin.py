"""Origin policy and early rejection contracts; no database required."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth import COOKIE, current_user
from app.config import Settings
from app.main import create_app
from app.routes.cards import get_store

TRUSTED = "http://localhost:4321"


def settings(**values):
    return Settings(jwt_secret="origin-test-secret-" * 3, _env_file=None, **values)


@pytest.fixture
def system(monkeypatch):
    app = create_app(settings())
    app.state.db = AsyncMock()
    verify, issue, authenticate, store = (AsyncMock() for _ in range(4))
    monkeypatch.setattr("app.routes.auth.verify_password", verify)
    monkeypatch.setattr("app.routes.auth.create_token", issue)

    async def user():
        return await authenticate()

    app.dependency_overrides[current_user] = user
    app.dependency_overrides[get_store] = lambda: store
    client = TestClient(app)
    client.cookies.set(COOKIE, "existing-session")
    return app, client, verify, issue, authenticate, store


BAD_ORIGINS = [
    None,
    "",
    "null",
    "https://evil.example",
    "http://localhost:43210",
    "http://localhost:4321.evil.example",
    "http://localhost.evil.example:4321",
    "http://sub.localhost:4321",
    "https://localhost:4321",
    "http://localhost",
    "http://localhost:4321/",
    "http://localhost:4321/path",
    "http://localhost:4321?x=1",
    "http://localhost:4321#fragment",
    "http://user@localhost:4321",
    "http://localhost:4321@evil.example",
    "HTTP://LOCALHOST:4321",
    " http://localhost:4321",
    "http://localhost:4321 ",
    "localhost:4321",
    "http://localhost:4321, https://evil.example",
    "http://localhost:4321 null",
    "http://localhost:04321",
    "http://localhost.:4321",
    "file://localhost:4321",
]


def assert_rejected(response, system):
    app, client, verify, issue, authenticate, store = system
    assert response.status_code == 403
    assert response.json() == {
        "error": {
            "code": "csrf_rejected",
            "message": "Request origin is not trusted",
            "fields": [],
        }
    }
    assert "set-cookie" not in response.headers
    assert response.headers["cache-control"] == "no-store"
    assert client.cookies.get(COOKIE) == "existing-session"
    assert app.state.db.mock_calls == []  # Includes allowance, account, token and data access.
    verify.assert_not_called()
    issue.assert_not_called()
    authenticate.assert_not_called()
    assert store.mock_calls == []


@pytest.mark.parametrize("origin", BAD_ORIGINS)
def test_login_rejects_before_any_credential_or_allowance_work(system, origin):
    headers = {} if origin is None else {"Origin": origin}
    response = system[1].post(
        "/api/auth/login",
        headers=headers,
        json={"username": " CHRIS ", "password": "private-password"},
    )
    assert_rejected(response, system)
    assert "private-password" not in response.text


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/auth/logout"),
        ("POST", "/api/cards"),
        ("PATCH", "/api/cards/a"),
        ("DELETE", "/api/cards/a"),
        ("POST", "/api/cards/a/move"),
        ("POST", "/api/cards/a/comments"),
        ("PATCH", "/api/cards/a/comments/b"),
        ("DELETE", "/api/cards/a/comments/b"),
        ("PUT", "/api/cards/a"),
        ("POST", "/api/auth/login/"),
        ("POST", "/outside-api"),
        ("TRACE", "/api/cards"),
    ],
)
@pytest.mark.parametrize("origin", [None, "null", "https://evil.example"])
def test_all_mutations_reject_even_before_body_validation(system, method, path, origin):
    headers = {} if origin is None else {"Origin": origin}
    response = system[1].request(method, path, headers=headers, content="broken json")
    assert_rejected(response, system)


@pytest.mark.parametrize(
    "headers",
    [
        {"Referer": TRUSTED + "/board"},
        {"Origin": "null", "Referer": TRUSTED + "/"},
        {"Origin": "https://evil.example", "Referer": TRUSTED + "/"},
        {
            "Host": "localhost:4321",
            "X-Forwarded-Host": "localhost:4321",
            "X-Forwarded-Proto": "http",
            "Forwarded": "host=localhost:4321;proto=http",
            "X-Forwarded-Origin": TRUSTED,
            "Sec-Fetch-Site": "same-origin",
        },
        [("Origin", TRUSTED), ("Origin", TRUSTED)],
        [("Origin", TRUSTED), ("Origin", "https://evil.example")],
    ],
)
def test_no_referer_forwarding_or_duplicate_header_bypass(system, headers):
    assert_rejected(system[1].post("/api/auth/logout", headers=headers), system)


@pytest.mark.parametrize("origin", [TRUSTED, "http://127.0.0.1:4321"])
def test_local_origins_and_nonbrowser_explicit_header(origin):
    app = create_app(settings())
    app.state.db = AsyncMock()
    client = TestClient(app)
    # Host/proxy headers neither grant nor withdraw trust. No auth needed for idempotent logout.
    response = client.post(
        "/api/auth/logout",
        headers={
            "Origin": origin,
            "Host": "backend.internal:8000",
            "X-Forwarded-Host": "evil.example",
            "X-Forwarded-Proto": "https",
        },
    )
    assert response.status_code == 204
    assert "HttpOnly" in response.headers["set-cookie"]


@pytest.mark.parametrize("origin", [None, "null", "https://evil.example"])
def test_safe_requests_remain_usable_and_do_not_set_cookies(origin):
    app = create_app(settings())
    app.state.db = AsyncMock()
    client = TestClient(app, headers={} if origin is None else {"Origin": origin})
    for method, path, status in [
        ("GET", "/api/health/live", 200),
        ("GET", "/api/health/ready", 200),
        ("GET", "/api/auth/me", 401),
        ("GET", "/api/auth/logout", 405),
        ("GET", "/api/auth/login", 405),
        ("HEAD", "/api/cards", 405),
        ("OPTIONS", "/api/cards", 405),
    ]:
        response = client.request(method, path)
        assert response.status_code == status
        assert "set-cookie" not in response.headers
        assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize(
    "origins",
    [
        (),
        (TRUSTED, TRUSTED),
        ("*",),
        ("null",),
        ("https://*.example.com",),
        ("https://example.com/",),
        ("https://user:secret@example.com",),
        ("https://example.com?x=1",),
        ("https://example.com#x",),
        ("https://example.com:443",),
        ("https://EXAMPLE.com",),
        ("https://example.com:0",),
        ("https://example.com:99999",),
        ("https://example.com.",),
        ("https://example_com",),
        ("https://example.com\n",),
        ("http://example.com",),
        ("https://example.com https://other.example",),
        ("https://[broken",),
    ],
)
def test_unsafe_configuration_rejected(origins):
    with pytest.raises(ValidationError):
        settings(trusted_origins=origins)


def test_production_configuration_and_exact_allowlist(monkeypatch):
    for values in [
        {"app_env": "production"},
        {"app_env": "production", "cookie_secure": True},
        {"cookie_secure": True},
        {"app_env": "production", "cookie_secure": True, "trusted_origins": (TRUSTED,)},
        {"app_env": "production", "cookie_secure": True, "trusted_origins": ("https://localhost",)},
        {"app_env": "production", "cookie_secure": True, "trusted_origins": ("https://127.0.0.2",)},
        {"app_env": "production", "cookie_secure": True, "trusted_origins": ("https://[::1]",)},
    ]:
        with pytest.raises(ValidationError):
            settings(proxy_secret="test-proxy-secret-" * 3, **values)
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("PROXY_SECRET", "test-proxy-secret-" * 3)
    monkeypatch.setenv("TRUSTED_ORIGINS", '["https://board.example","https://board.example:8443"]')
    app = create_app(settings())
    app.state.db = AsyncMock()
    client = TestClient(app, headers={"X-Kanban-Proxy-Secret": "test-proxy-secret-" * 3})
    for origin in ["https://board.example", "https://board.example:8443"]:
        assert client.post("/api/auth/logout", headers={"Origin": origin}).status_code == 204
    for origin in [
        TRUSTED,
        "http://board.example",
        "https://board.example:443",
        "https://sub.board.example",
        "https://board.example.evil.example",
    ]:
        assert client.post("/api/auth/logout", headers={"Origin": origin}).status_code == 403


async def test_rejection_does_not_read_request_body():
    app = create_app(settings())
    receive, send = AsyncMock(), AsyncMock()
    await app(
        {"type": "http", "method": "POST", "path": "/api/auth/login", "headers": []}, receive, send
    )
    receive.assert_not_called()
    assert send.call_args_list[0].args[0]["status"] == 403
