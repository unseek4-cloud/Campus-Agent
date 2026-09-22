from fastapi import APIRouter

from app.api.v1.endpoints.documents import router as documents_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.knowledge import router as knowledge_router
from app.api.v1.endpoints.rag import router as rag_router
from app.api.v1.endpoints.service_guide import router as service_guide_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(documents_router)
api_router.include_router(knowledge_router)
api_router.include_router(rag_router)
api_router.include_router(service_guide_router)
