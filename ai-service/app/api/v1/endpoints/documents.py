from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.core.dependencies import get_document_service
from app.core.exceptions import DocumentTooLargeError
from app.domain.document import DocumentInput
from app.schemas.common import ApiResponse
from app.schemas.document import DocumentDeleteData, DocumentProcessData
from app.services.document_service import DocumentService

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post(
    "/process",
    response_model=ApiResponse[DocumentProcessData],
    status_code=status.HTTP_201_CREATED,
)
async def process_document(
    request: Request,
    document_id: Annotated[str, Form(alias="documentId", min_length=1, max_length=128)],
    knowledge_base_id: Annotated[
        str, Form(alias="knowledgeBaseId", min_length=1, max_length=128)
    ],
    file: Annotated[UploadFile, File(description="PDF or DOCX document")],
    settings: Settings = Depends(get_settings),
    document_service: DocumentService = Depends(get_document_service),
) -> ApiResponse[DocumentProcessData]:
    max_bytes = settings.max_pdf_size_mb * 1024 * 1024
    try:
        content = await file.read(max_bytes + 1)
    finally:
        await file.close()

    if len(content) > max_bytes:
        raise DocumentTooLargeError(
            f"Uploaded document exceeds the {settings.max_pdf_size_mb} MB size limit"
        )

    result = await run_in_threadpool(
        document_service.process_document,
        DocumentInput(
            document_id=document_id,
            knowledge_base_id=knowledge_base_id,
            file_name=file.filename or "",
            content_type=file.content_type,
            content=content,
        ),
    )
    return ApiResponse.success(
        DocumentProcessData(
            documentId=result.document_id,
            knowledgeBaseId=result.knowledge_base_id,
            fileName=result.file_name,
            pageCount=result.page_count,
            chunkCount=result.chunk_count,
            embeddingModel=result.embedding_model,
            contentSha256=result.content_sha256,
        ),
        request.state.request_id,
    )


@router.delete(
    "/{document_id}/vectors",
    response_model=ApiResponse[DocumentDeleteData],
)
async def delete_document_vectors(
    document_id: str,
    request: Request,
    document_service: DocumentService = Depends(get_document_service),
) -> ApiResponse[DocumentDeleteData]:
    deleted_count = await run_in_threadpool(
        document_service.delete_document_vectors, document_id
    )
    return ApiResponse.success(
        DocumentDeleteData(
            documentId=document_id,
            deletedVectorCount=deleted_count,
        ),
        request.state.request_id,
    )
