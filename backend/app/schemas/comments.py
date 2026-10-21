from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

CommentText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
]
Version = Annotated[int, Field(strict=True, ge=1)]
Revision = Annotated[int, Field(strict=True, ge=0)]


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: CommentText


class CommentPatch(CommentCreate):
    expected_comment_version: Version


class CommentOut(BaseModel):
    id: str
    text: str
    author: str
    created_at: datetime
    updated_at: datetime
    version: int
