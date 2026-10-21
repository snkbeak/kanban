from fastapi import APIRouter, Depends

from app.auth import current_user, get_users
from app.schemas.users import UserOut

router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(current_user)])


@router.get("", response_model=list[UserOut])
async def list_users(users=Depends(get_users)):
    return [UserOut.from_doc(user) async for user in users.find({}, {"_id": 1}).sort("_id", 1)]
