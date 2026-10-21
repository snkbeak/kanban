from pydantic import BaseModel


class UserOut(BaseModel):
    """Public user shape. Use this for every response that includes a user."""

    username: str

    @classmethod
    def from_doc(cls, doc: dict) -> "UserOut":
        # Explicit mapping: password_hash never leaves the server.
        return cls(username=doc["_id"])


def normalize_username(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("username must be a string")
    value = value.strip().lower()
    if not 1 <= len(value) <= 64:
        raise ValueError("username must contain 1-64 characters")
    return value
