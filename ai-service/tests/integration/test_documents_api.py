from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.core.dependencies import get_document_service
from app.core.exceptions import EmptyDocumentError, OcrPageLimitExceededError
from app.domain.document import DocumentInput, DocumentProcessingResult
from app.main import app


class SuccessfulDocumentService:
    def process_document(self, document: DocumentInput) -> DocumentProcessingResult:
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
    def process_document(self, document: DocumentInput) -> DocumentProcessingResult:
        raise EmptyDocumentError("PDF contains no extractable text")


class OcrLimitDocumentService:
    def process_document(self, document: DocumentInput) -> DocumentProcessingResult:
        raise OcrPageLimitExceededError("PDF requires OCR for too many pages")


class DeletingDocumentService:
    def delete_document_vectors(self, document_id: str) -> int:
        assert document_id == "doc-1"
        return 7


class RenamingDocumentService:
    def rename_document_vectors(self, document_id: str, file_name: str) -> int:
        assert document_id == "doc-1"
        assert file_name == "新名称.pdf"
        return 3


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
    assert payload["timestamp"].endswith("+08:00")
    assert datetime.fromisoformat(payload["timestamp"]).utcoffset() == timedelta(hours=8)
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
    payload = response.json()
    assert payload["code"] == "DOCUMENT_HAS_NO_TEXT"
    assert payload["timestamp"].endswith("+08:00")
    assert datetime.fromisoformat(payload["timestamp"]).utcoffset() == timedelta(hours=8)


def test_process_document_maps_ocr_page_limit_error() -> None:
    app.dependency_overrides[get_document_service] = OcrLimitDocumentService
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
    assert response.json()["code"] == "OCR_PAGE_LIMIT_EXCEEDED"


def test_delete_document_vectors_returns_deleted_count() -> None:
    app.dependency_overrides[get_document_service] = DeletingDocumentService
    try:
        with TestClient(app) as client:
            response = client.delete("/internal/v1/documents/doc-1/vectors")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["data"] == {
        "documentId": "doc-1",
        "deletedVectorCount": 7,
    }


def test_rename_document_vectors_updates_citation_metadata() -> None:
    app.dependency_overrides[get_document_service] = RenamingDocumentService
    try:
        with TestClient(app) as client:
            response = client.patch("/internal/v1/documents/doc-1/name", json={"fileName": "新名称.pdf"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["data"] == {"documentId": "doc-1", "updatedVectorCount": 3}
