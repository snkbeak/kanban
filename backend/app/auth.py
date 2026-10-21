"""Password checking, token handling and the `current_user` dependency.

Other route files protect themselves with:

    from app.auth import current_user
    async def handler(user: dict = Depends(current_user)): ...
"""

import asyncio
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request, status

from app.config import Settings

COOKIE = "access_token"
ALGORITHM = "HS256"

hasher = PasswordHasher()  # Argon2id
# Checked when the username doesn't exist, so response time doesn't reveal valid usernames.
DUMMY_HASH = hasher.hash("not-a-real-password")


# ---------- dependencies ----------


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_users(request: Request):
    return request.app.state.db.users


def get_tokens(request: Request):
    return request.app.state.db.tokens


# ---------- passwords ----------


async def verify_password(password_hash: str | None, password: str) -> bool:
    """Pass None for an unknown user: the slow check still runs, and the result is always False."""

    def _check() -> bool:
        try:
            return (
                hasher.verify(password_hash or DUMMY_HASH, password) and password_hash is not None
            )
        except (VerificationError, InvalidHashError):
            return False

    # Argon2 is CPU-heavy: keep it off the event loop.
    return await asyncio.to_thread(_check)


# ---------- tokens ----------


async def create_token(tokens, username: str, settings: Settings) -> str:
    """Signs a JWT and records its ID in MongoDB. The token only works while that record exists.

    Only the ID (`jti`) is stored, not the JWT itself, so a database leak exposes no usable tokens.
    """
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=settings.token_days)
    jti = secrets.token_urlsafe(16)
    await tokens.insert_one({"jti": jti, "username": username, "expires_at": expires_at})
    claims = {"sub": username, "jti": jti, "iat": now, "exp": expires_at}
    return jwt.encode(claims, settings.jwt_secret, algorithm=ALGORITHM)


def read_claims(request: Request, settings: Settings) -> dict | None:
    """Verified claims from the cookie, or None if missing, tampered or expired."""
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],  # pinned: never trust the token's own alg header
            options={"require": ["exp", "sub", "jti"]},
        )
    except jwt.PyJWTError:
        return None


async def current_user(
    request: Request,
    users=Depends(get_users),
    tokens=Depends(get_tokens),
    settings: Settings = Depends(get_settings),
) -> dict:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    claims = read_claims(request, settings)
    if claims is None:
        raise unauthorized
    # A valid signature isn't enough: the token must still exist in MongoDB.
    if (
        await tokens.find_one(
            {
                "jti": claims["jti"],
                "username": claims["sub"],
                "expires_at": {"$gt": datetime.now(UTC)},
            },
            {"_id": 1},
        )
        is None
    ):
        raise unauthorized
    user = await users.find_one({"_id": claims["sub"]})
    if user is None:
        await tokens.delete_one({"jti": claims["jti"]})
        raise unauthorized
    return user
