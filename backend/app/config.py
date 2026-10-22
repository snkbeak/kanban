from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", populate_by_name=True, hide_input_in_errors=True
    )

    mongo_url: str = Field(
        default="mongodb://localhost:27017",
        validation_alias=AliasChoices("MONGO_URL", "MONGODB_URI"),
        repr=False,
    )
    mongo_db: str = "kanban"
    jwt_secret: str = Field(min_length=32, repr=False)  # app refuses to start without it
    token_days: int = 7
    cookie_secure: bool = False  # set COOKIE_SECURE=true behind HTTPS
    login_username_limit: int = Field(default=5, ge=1, le=10000)
    login_username_window_seconds: int = Field(default=900, ge=1, le=86400)
    login_global_limit: int = Field(default=30, ge=1, le=10000)
    login_global_window_seconds: int = Field(default=300, ge=1, le=86400)
