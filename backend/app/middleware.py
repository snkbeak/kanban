"""Fail closed before routing, body parsing, authentication, or database access."""

from secrets import compare_digest

from starlette.types import ASGIApp, Receive, Scope, Send

from app.errors import error_response


class OriginProtectionMiddleware:
    def __init__(self, app: ASGIApp, trusted_origins: tuple[str, ...]):
        self.app = app
        self.trusted_origins = frozenset(origin.encode("ascii") for origin in trusted_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        # Protect all unsafe methods/paths, including future routes and router redirects.
        if scope["type"] == "http" and scope["method"] not in ("GET", "HEAD", "OPTIONS"):
            origins = [value for name, value in scope["headers"] if name.lower() == b"origin"]
            if len(origins) != 1 or origins[0] not in self.trusted_origins:
                response = error_response(
                    403,
                    "csrf_rejected",
                    "Request origin is not trusted",
                    headers={"Cache-Control": "no-store"},
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


class ProxyAuthenticationMiddleware:
    """Authenticate the ingress before any API work; only process liveness is public."""

    def __init__(self, app: ASGIApp, secret: str):
        self.app = app
        self.secret = secret.encode("utf-8")

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] == "http" and not (
            scope["method"] == "GET" and scope["path"] == "/api/health/live"
        ):
            values = [v for k, v in scope["headers"] if k.lower() == b"x-kanban-proxy-secret"]
            if len(values) != 1 or not compare_digest(values[0], self.secret):
                await error_response(
                    403,
                    "proxy_forbidden",
                    "Request is not authorized",
                    headers={"Cache-Control": "no-store"},
                )(scope, receive, send)
                return
        await self.app(scope, receive, send)
