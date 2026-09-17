import logging
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", str(uuid4()))


def _json_error(status_code: int, response: ApiResponse[None]) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=response.model_dump(mode="json", by_alias=True),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """确保框架异常与未知异常也遵循统一响应结构。"""

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(
        request: Request, exception: StarletteHTTPException
    ) -> JSONResponse:
        message = exception.detail if isinstance(exception.detail, str) else "Request failed"
        return _json_error(
            exception.status_code,
            ApiResponse.error("HTTP_ERROR", message, _request_id(request)),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_exception(
        request: Request, exception: RequestValidationError
    ) -> JSONResponse:
        logger.info("Request validation failed: %s", exception.errors())
        return _json_error(
            422,
            ApiResponse.error("VALIDATION_ERROR", "Request validation failed", _request_id(request)),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(request: Request, exception: Exception) -> JSONResponse:
        logger.exception("Unhandled AI service exception", exc_info=exception)
        return _json_error(
            500,
            ApiResponse.error("INTERNAL_SERVER_ERROR", "Internal server error", _request_id(request)),
        )
