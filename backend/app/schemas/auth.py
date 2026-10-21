from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.users import normalize_username


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)

    _normalize_username = field_validator("username", mode="before")(normalize_username)
