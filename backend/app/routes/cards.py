from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response

from app.auth import current_user
from app.cards_store import CardsStore
from app.schemas.cards import BoardOut, CardCreate, CardMove, CardOut, CardPatch, MoveOut

router = APIRouter(prefix="/api/cards", tags=["cards"], dependencies=[Depends(current_user)])


def get_store(request: Request):
    return CardsStore(request.app.state.db)


@router.get("", response_model=BoardOut)
async def list_cards(store=Depends(get_store)):
    return await store.board()


@router.post("", response_model=CardOut, status_code=201)
async def create_card(body: CardCreate, user=Depends(current_user), store=Depends(get_store)):
    return await store.create(body, user["_id"])


@router.get("/{card_id}", response_model=CardOut)
async def get_card(card_id: str, store=Depends(get_store)):
    return await store.get(card_id)


@router.patch("/{card_id}", response_model=CardOut)
async def patch_card(card_id: str, body: CardPatch, store=Depends(get_store)):
    return await store.patch(card_id, body)


@router.post("/{card_id}/move", response_model=MoveOut)
async def move_card(card_id: str, body: CardMove, store=Depends(get_store)):
    return await store.move(card_id, body)


@router.delete("/{card_id}", status_code=204)
async def delete_card(
    card_id: str,
    expected_version: Annotated[int, Query(ge=1)],
    expected_comments_version: Annotated[int, Query(ge=0)],
    store=Depends(get_store),
):
    await store.delete(card_id, expected_version, expected_comments_version)
    return Response(status_code=204)
