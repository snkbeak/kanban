from pydantic import BaseModel


class UserOut(BaseModel):
    """Public user shape. Use this for every response that includes a user."""

    id: str
    username: str
    display_name: str

    @classmethod
    def from_doc(cls, doc: dict) -> "UserOut":
        # Explicit mapping: password_hash never leaves the server.
        return cls(id=doc["_id"], username=doc["username"], display_name=doc["display_name"])
