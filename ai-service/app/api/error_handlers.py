import logging
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.exceptions import (
    DocumentExtractionError,
    DocumentTooLargeError,
    EmbeddingGenerationError,
    EmptyDocumentError,
    InvalidDocumentError,
    OcrPageLimitExceededError,
    UnsupportedDocumentTypeError,
    VectorStoreOperationError,
)
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

    @app.exception_handler(DocumentTooLargeError)
    async def handle_document_too_large(
        request: Request, exception: DocumentTooLargeError
    ) -> JSONResponse:
        return _json_error(
            413,
            ApiResponse.error("DOCUMENT_TOO_LARGE", str(exception), _request_id(request)),
        )

    @app.exception_handler(UnsupportedDocumentTypeError)
    async def handle_unsupported_document_type(
        request: Request, exception: UnsupportedDocumentTypeError
    ) -> JSONResponse:
        return _json_error(
            415,
            ApiResponse.error(
                "UNSUPPORTED_DOCUMENT_TYPE", str(exception), _request_id(request)
            ),
        )

    @app.exception_handler(InvalidDocumentError)
    async def handle_invalid_document(
        request: Request, exception: InvalidDocumentError
    ) -> JSONResponse:
        return _json_error(
            422,
            ApiResponse.error("INVALID_DOCUMENT", str(exception), _request_id(request)),
        )

    @app.exception_handler(DocumentExtractionError)
    async def handle_document_extraction(
        request: Request, exception: DocumentExtractionError
    ) -> JSONResponse:
        return _json_error(
            422,
            ApiResponse.error(
                "DOCUMENT_EXTRACTION_FAILED", str(exception), _request_id(request)
            ),
        )

    @app.exception_handler(EmptyDocumentError)
    async def handle_empty_document(
        request: Request, exception: EmptyDocumentError
    ) -> JSONResponse:
        return _json_error(
            422,
            ApiResponse.error(
                "DOCUMENT_HAS_NO_TEXT", str(exception), _request_id(request)
            ),
        )

    @app.exception_handler(OcrPageLimitExceededError)
    async def handle_ocr_page_limit(
        request: Request, exception: OcrPageLimitExceededError
    ) -> JSONResponse:
        return _json_error(
            422,
            ApiResponse.error(
                "OCR_PAGE_LIMIT_EXCEEDED", str(exception), _request_id(request)
            ),
        )

    @app.exception_handler(EmbeddingGenerationError)
    async def handle_embedding_failure(
        request: Request, exception: EmbeddingGenerationError
    ) -> JSONResponse:
        logger.exception("Embedding generation failed", exc_info=exception)
        return _json_error(
            503,
            ApiResponse.error(
                "EMBEDDING_UNAVAILABLE",
                "Embedding service is unavailable",
                _request_id(request),
            ),
        )

    @app.exception_handler(VectorStoreOperationError)
    async def handle_vector_store_failure(
        request: Request, exception: VectorStoreOperationError
    ) -> JSONResponse:
        logger.exception("Vector store operation failed", exc_info=exception)
        return _json_error(
            503,
            ApiResponse.error(
                "VECTOR_STORE_UNAVAILABLE",
                "Vector store is unavailable",
                _request_id(request),
            ),
        )

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
