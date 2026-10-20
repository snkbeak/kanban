from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongo_url: str = "mongodb://localhost:27017"
    mongo_db: str = "kanban"
    jwt_secret: str = Field(min_length=32)  # app refuses to start without it
    token_days: int = 7
    cookie_secure: bool = False  # set COOKIE_SECURE=true behind HTTPS
