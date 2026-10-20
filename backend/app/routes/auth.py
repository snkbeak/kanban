from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.auth import (
    COOKIE,
    create_token,
    current_user,
    get_settings,
    get_tokens,
    get_users,
    read_claims,
    verify_password,
)
from app.config import Settings
from app.schemas.auth import LoginIn
from app.schemas.users import UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _cookie_attrs(settings: Settings) -> dict:
    # Host-only cookie (no domain attribute), not readable by page JavaScript.
    return {"path": "/", "httponly": True, "samesite": "lax", "secure": settings.cookie_secure}


@router.post("/login", response_model=UserOut)
async def login(
    body: LoginIn,
    response: Response,
    users=Depends(get_users),
    tokens=Depends(get_tokens),
    settings: Settings = Depends(get_settings),
):
    user = await users.find_one({"username": body.username.strip().lower()})
    ok = await verify_password(user["password_hash"] if user else None, body.password)
    if not (user and ok):
        # Same message for unknown user and wrong password.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")

    token = await create_token(tokens, user["_id"], settings)
    response.set_cookie(
        COOKIE, token, max_age=settings.token_days * 86400, **_cookie_attrs(settings)
    )
    return UserOut.from_doc(user)


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    return UserOut.from_doc(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    tokens=Depends(get_tokens),
    settings: Settings = Depends(get_settings),
):
    claims = read_claims(request, settings)
    if claims is not None:
        await tokens.delete_one({"jti": claims["jti"]})  # token is now invalid everywhere

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(COOKIE, **_cookie_attrs(settings))
    return response
