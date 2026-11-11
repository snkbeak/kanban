from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.schemas.comments import CommentOut, Revision, Version

Column = Literal["review", "backlog", "in_progress", "done", "blocked"]
COLUMNS = ("review", "backlog", "in_progress", "done", "blocked")
Difficulty = Literal["easy", "medium", "hard"]
Health = Literal["healthy", "at_risk", "blocked"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Tag = Annotated[
    str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=1, max_length=32)
]
Description = Annotated[str, StringConstraints(max_length=20000)]
Username = Annotated[str, StringConstraints(min_length=1, max_length=64)]
Assignees = Annotated[list[Username], Field(max_length=3)]


class CardContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("assignees", check_fields=False)
    @classmethod
    def distinct_assignees(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("assignees must be distinct canonical usernames")
        return value


class CardCreate(CardContent):
    title: Title
    tag: Tag
    description: Description = ""
    column: Column = "review"
    difficulty: Difficulty = "medium"
    health: Health = "healthy"
    assignees: Assignees = Field(default_factory=list)

    @model_validator(mode="after")
    def blocked_health(self):
        if self.column == "blocked":
            if "health" in self.model_fields_set and self.health != "blocked":
                raise ValueError("health must be blocked in the Blocked column")
            self.health = "blocked"
        return self


class CardPatch(CardContent):
    expected_version: Version
    # None is only an internal omitted-field sentinel; explicit null is rejected.
    title: Title = None
    tag: Tag = None
    description: Description = None
    difficulty: Difficulty = None
    health: Health = None
    assignees: Assignees = None

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set - {"expected_version"}:
            raise ValueError("supply at least one editable field")
        return self


class CardMove(BaseModel):
    model_config = ConfigDict(extra="forbid")
    column: Column
    before_card_id: str | None = None
    expected_version: Version
    expected_order_versions: dict[Column, Revision]


class CardOut(BaseModel):
    id: str
    ticket_number: int
    title: str
    description: str
    column: Column
    position: int
    difficulty: Difficulty
    health: Health
    tag: str
    assignees: list[str]
    creator: str
    created_at: datetime
    updated_at: datetime
    version: int
    comments_version: int
    comments: list[CommentOut]

    @classmethod
    def from_doc(cls, doc):
        return cls(id=doc["_id"], **{key: value for key, value in doc.items() if key != "_id"})


class BoardOut(BaseModel):
    cards: list[CardOut]
    order_versions: dict[Column, int]


class MoveOut(BaseModel):
    card: CardOut
    order_versions: dict[Column, int]
