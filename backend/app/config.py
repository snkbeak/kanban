import ipaddress
import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, model_validator
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
    app_env: Literal["development", "production"] = "development"
    proxy_secret: str | None = Field(default=None, min_length=32, repr=False)
    trusted_origins: tuple[str, ...] = ("http://localhost:4321", "http://127.0.0.1:4321")
    login_username_limit: int = Field(default=5, ge=1, le=10000)
    login_username_window_seconds: int = Field(default=900, ge=1, le=86400)
    login_global_limit: int = Field(default=30, ge=1, le=10000)
    login_global_window_seconds: int = Field(default=300, ge=1, le=86400)

    @model_validator(mode="after")
    def validate_origins(self):
        production = self.app_env == "production"
        if production and not self.proxy_secret:
            raise ValueError("Production requires PROXY_SECRET")
        if production and not self.cookie_secure:
            raise ValueError("Production requires COOKIE_SECURE=true")
        if (production or self.cookie_secure) and "trusted_origins" not in self.model_fields_set:
            raise ValueError("HTTPS/production requires explicit TRUSTED_ORIGINS")
        if not self.trusted_origins or len(set(self.trusted_origins)) != len(self.trusted_origins):
            raise ValueError("TRUSTED_ORIGINS must be nonempty and unique")
        for origin in self.trusted_origins:
            # Require serialized origins, not URLs/patterns. Do not silently normalize mistakes.
            try:
                parsed = urlsplit(origin)
                host, port = parsed.hostname, parsed.port
                if not host:
                    raise ValueError
                try:
                    address = ipaddress.ip_address(host)
                    valid_host = host == address.compressed
                    loopback = address.is_loopback
                except ValueError:
                    loopback = host == "localhost" or host.endswith(".localhost")
                    valid_host = len(host) <= 253 and all(
                        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                        for label in host.split(".")
                    )
                authority = f"[{host}]" if ":" in host else host
                if port is not None:
                    authority += f":{port}"
                if (
                    not valid_host
                    or parsed.scheme not in ("http", "https")
                    or origin != f"{parsed.scheme}://{authority}"
                    or port == 0
                    or (parsed.scheme, port) in (("http", 80), ("https", 443))
                ):
                    raise ValueError
            except ValueError:
                raise ValueError("TRUSTED_ORIGINS requires canonical HTTP(S) origins") from None
            local = host in ("localhost", "127.0.0.1", "::1")
            if parsed.scheme == "http" and (not local or production or self.cookie_secure):
                raise ValueError("HTTP origins are allowed only for loopback development")
            if production and loopback:
                raise ValueError("Production origins must not be loopback")
        return self
