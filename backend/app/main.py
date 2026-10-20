"""App setup. Run with:  uvicorn app.main:create_app --factory --reload"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from pymongo import AsyncMongoClient

from app.config import Settings
from app.routes.auth import router as auth_router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = AsyncMongoClient(settings.mongo_url, serverSelectionTimeoutMS=5000)
        db = client[settings.mongo_db]
        app.state.db = db
        await db.users.create_index("username", unique=True)
        await db.tokens.create_index("jti", unique=True)
        # MongoDB deletes each token record once the token would have expired anyway.
        await db.tokens.create_index("expires_at", expireAfterSeconds=0)
        yield
        await client.close()

    app = FastAPI(title="Auth API", lifespan=lifespan)
    app.state.settings = settings

    # Register new routers here, e.g. app.include_router(cards_router)
    app.include_router(auth_router)
    return app
