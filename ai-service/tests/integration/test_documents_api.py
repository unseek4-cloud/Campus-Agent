from fastapi.testclient import TestClient

from app.core.dependencies import get_document_service
from app.core.exceptions import EmptyDocumentError
from app.domain.document import DocumentInput, DocumentProcessingResult
from app.main import app


class SuccessfulDocumentService:
    def process_pdf(self, document: DocumentInput) -> DocumentProcessingResult:
        return DocumentProcessingResult(
            document_id=document.document_id,
            knowledge_base_id=document.knowledge_base_id,
            file_name=document.file_name,
            page_count=2,
            chunk_count=3,
            embedding_model="fake-embedding",
            content_sha256="a" * 64,
        )


class EmptyDocumentService:
    def process_pdf(self, document: DocumentInput) -> DocumentProcessingResult:
        raise EmptyDocumentError("PDF contains no extractable text")


def test_process_document_returns_unified_success_response() -> None:
    app.dependency_overrides[get_document_service] = SuccessfulDocumentService
    try:
        with TestClient(app) as client:
            response = client.post(
                "/internal/v1/documents/process",
                data={"documentId": "doc-1", "knowledgeBaseId": "kb-1"},
                files={"file": ("rules.pdf", b"%PDF-test", "application/pdf")},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    payload = response.json()
    assert payload["code"] == "OK"
    assert payload["data"]["documentId"] == "doc-1"
    assert payload["data"]["chunkCount"] == 3
    assert response.headers["X-Request-Id"] == payload["requestId"]


def test_process_document_maps_expected_processing_error() -> None:
    app.dependency_overrides[get_document_service] = EmptyDocumentService
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post(
                "/internal/v1/documents/process",
                data={"documentId": "doc-1", "knowledgeBaseId": "kb-1"},
                files={"file": ("scan.pdf", b"%PDF-test", "application/pdf")},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json()["code"] == "DOCUMENT_HAS_NO_TEXT"
