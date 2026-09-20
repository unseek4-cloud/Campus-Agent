from uuid import uuid4
import logging

from fastapi import FastAPI, Request

from app.api.error_handlers import register_exception_handlers
from app.api.v1.router import api_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """为一次 AI 服务调用建立独立追踪标识。"""
    request_id = str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    return response


register_exception_handlers(app)
app.include_router(api_router, prefix=settings.api_v1_prefix)

logging.getLogger("uvicorn.error").info(
    "[OCR] mode=%s qwen_enabled=%s allow_cloud=%s paddle_fallback=lazy concurrency=%d",
    settings.ocr_mode, settings.qwen_ocr_enabled, settings.ocr_allow_cloud,
    settings.ocr_max_concurrency,
)
