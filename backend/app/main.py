"""App setup. Run with:  uvicorn app.main:create_app --factory --reload"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from pymongo import AsyncMongoClient

from app.cards_store import initialize_database
from app.config import Settings
from app.errors import register_errors
from app.middleware import OriginProtectionMiddleware
from app.routes.auth import router as auth_router
from app.routes.cards import router as cards_router
from app.routes.comments import router as comments_router
from app.routes.health import router as health_router
from app.routes.users import router as users_router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = AsyncMongoClient(
            settings.mongo_url, serverSelectionTimeoutMS=5000, timeoutMS=15000, tz_aware=True
        )
        try:
            app.state.db = client[settings.mongo_db]
            await initialize_database(app.state.db)
            yield
        finally:
            await client.close()

    app = FastAPI(title="Kanban API", lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(OriginProtectionMiddleware, trusted_origins=settings.trusted_origins)

    register_errors(app)
    for router in (auth_router, cards_router, comments_router, users_router, health_router):
        app.include_router(router)
    return app
