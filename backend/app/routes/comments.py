from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth import current_user
from app.routes.cards import get_store
from app.schemas.cards import CardOut
from app.schemas.comments import CommentCreate, CommentPatch

router = APIRouter(prefix="/api/cards/{card_id}/comments", tags=["comments"])


@router.post("", response_model=CardOut, status_code=201)
async def add_comment(
    card_id: str, body: CommentCreate, user=Depends(current_user), store=Depends(get_store)
):
    return await store.add_comment(card_id, body, user["_id"])


@router.patch("/{comment_id}", response_model=CardOut)
async def patch_comment(
    card_id: str,
    comment_id: str,
    body: CommentPatch,
    user=Depends(current_user),
    store=Depends(get_store),
):
    return await store.change_comment(
        card_id, comment_id, user["_id"], body.expected_comment_version, body.text
    )


@router.delete("/{comment_id}", response_model=CardOut)
async def delete_comment(
    card_id: str,
    comment_id: str,
    expected_comment_version: Annotated[int, Query(ge=1)],
    user=Depends(current_user),
    store=Depends(get_store),
):
    return await store.change_comment(card_id, comment_id, user["_id"], expected_comment_version)
