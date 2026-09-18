from collections.abc import Sequence

import pytest

from app.core.exceptions import EmptyDocumentError, InvalidDocumentError
from app.domain.document import DocumentInput, DocumentPage, VectorRecord
from app.services.chunk_service import BoundaryAwareChunkService
from app.services.document_extractor import DocumentExtractor
from app.services.document_service import DocumentService
from app.services.embedding_service import EmbeddingService
from app.services.text_cleaner import TextCleaner
from app.vector_store.base import VectorStore


class FakeExtractor(DocumentExtractor):
    def __init__(self, pages: list[DocumentPage]) -> None:
        self.pages = pages

    def extract(self, content: bytes) -> list[DocumentPage]:
        return self.pages


class FakeEmbeddingService(EmbeddingService):
    @property
    def model_name(self) -> str:
        return "fake-embedding"

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [[float(index), float(len(text))] for index, text in enumerate(texts)]


class RecordingVectorStore(VectorStore):
    def __init__(self) -> None:
        self.document_id: str | None = None
        self.records: list[VectorRecord] = []

    def replace_document(
        self, document_id: str, records: Sequence[VectorRecord]
    ) -> None:
        self.document_id = document_id
        self.records = list(records)


def build_service(
    pages: list[DocumentPage], store: RecordingVectorStore | None = None
) -> tuple[DocumentService, RecordingVectorStore]:
    vector_store = store or RecordingVectorStore()
    return (
        DocumentService(
            extractor=FakeExtractor(pages),
            cleaner=TextCleaner(),
            chunk_service=BoundaryAwareChunkService(chunk_size=20, chunk_overlap=4),
            embedding_service=FakeEmbeddingService(),
            vector_store=vector_store,
            max_file_size_bytes=1024,
        ),
        vector_store,
    )


def valid_input() -> DocumentInput:
    return DocumentInput(
        document_id="doc-1",
        knowledge_base_id="kb-1",
        file_name="rules.pdf",
        content_type="application/pdf",
        content=b"%PDF-test-content",
    )


def test_document_service_runs_pipeline_and_builds_metadata() -> None:
    service, store = build_service(
        [DocumentPage(1, "第一部分。第二部分。"), DocumentPage(2, "办理流程。")]
    )

    result = service.process_pdf(valid_input())

    assert result.document_id == "doc-1"
    assert result.page_count == 2
    assert result.chunk_count == len(store.records)
    assert store.document_id == "doc-1"
    assert store.records[0].metadata["knowledge_base_id"] == "kb-1"
    assert store.records[0].metadata["embedding_model"] == "fake-embedding"
    assert all(record.embedding for record in store.records)


def test_document_service_uses_stable_record_ids() -> None:
    pages = [DocumentPage(1, "校历和办事说明。")]
    first_service, first_store = build_service(pages)
    second_service, second_store = build_service(pages)

    first_service.process_pdf(valid_input())
    second_service.process_pdf(valid_input())

    assert [record.record_id for record in first_store.records] == [
        record.record_id for record in second_store.records
    ]


def test_document_service_rejects_non_pdf_content() -> None:
    service, _ = build_service([DocumentPage(1, "text")])
    document = valid_input()
    invalid = DocumentInput(
        document_id=document.document_id,
        knowledge_base_id=document.knowledge_base_id,
        file_name=document.file_name,
        content_type=document.content_type,
        content=b"not-a-pdf",
    )

    with pytest.raises(InvalidDocumentError):
        service.process_pdf(invalid)


def test_document_service_rejects_pdf_without_extractable_text() -> None:
    service, _ = build_service([DocumentPage(1, " \x00 ")])

    with pytest.raises(EmptyDocumentError):
        service.process_pdf(valid_input())
