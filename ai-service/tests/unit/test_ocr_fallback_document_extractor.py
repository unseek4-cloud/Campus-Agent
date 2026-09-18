from collections.abc import Sequence

import pytest

from app.core.exceptions import (
    EmptyDocumentError,
    OcrError,
    OcrPageLimitExceededError,
    OcrUnavailableError,
    PdfPageRenderingError,
)
from app.domain.document import DocumentInput, DocumentPage, VectorRecord
from app.services.chunk_service import BoundaryAwareChunkService
from app.services.document_extractor import DocumentExtractor
from app.services.document_service import DocumentService
from app.services.embedding_service import EmbeddingService
from app.services.ocr_fallback_document_extractor import OcrFallbackDocumentExtractor
from app.services.ocr_service import OcrService
from app.services.pdf_page_renderer import PdfPageRenderer, RenderedPage
from app.services.text_cleaner import TextCleaner
from app.vector_store.base import VectorStore


class FakeTextExtractor(DocumentExtractor):
    def __init__(self, pages: list[DocumentPage]) -> None:
        self.pages = pages

    def extract(self, content: bytes) -> list[DocumentPage]:
        return self.pages


class RecordingPageRenderer(PdfPageRenderer):
    def __init__(self, failures: set[int] | None = None) -> None:
        self.failures = failures or set()
        self.calls: list[tuple[int, int]] = []

    def render_page(
        self, content: bytes, page_number: int, dpi: int
    ) -> RenderedPage:
        self.calls.append((page_number, dpi))
        if page_number in self.failures:
            raise PdfPageRenderingError("fake render failure")
        return RenderedPage(
            page_number=page_number,
            image=f"page-{page_number}".encode(),
        )


class FakeOcrService(OcrService):
    def __init__(self, outcomes: dict[bytes, str | Exception]) -> None:
        self.outcomes = outcomes
        self.calls: list[bytes] = []

    def recognize(self, image: bytes) -> str:
        self.calls.append(image)
        outcome = self.outcomes.get(image, "")
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeEmbeddingService(EmbeddingService):
    @property
    def model_name(self) -> str:
        return "fake-embedding"

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [[float(index), float(len(text))] for index, text in enumerate(texts)]


class RecordingVectorStore(VectorStore):
    def __init__(self) -> None:
        self.records: list[VectorRecord] = []

    def replace_document(
        self, document_id: str, records: Sequence[VectorRecord]
    ) -> None:
        self.records = list(records)


def build_extractor(
    pages: list[DocumentPage],
    outcomes: dict[bytes, str | Exception] | None = None,
    *,
    enabled: bool = True,
    max_ocr_pages: int = 50,
    render_failures: set[int] | None = None,
) -> tuple[OcrFallbackDocumentExtractor, RecordingPageRenderer, FakeOcrService]:
    renderer = RecordingPageRenderer(render_failures)
    ocr_service = FakeOcrService(outcomes or {})
    extractor = OcrFallbackDocumentExtractor(
        text_extractor=FakeTextExtractor(pages),
        cleaner=TextCleaner(),
        page_renderer=renderer,
        ocr_service=ocr_service,
        enabled=enabled,
        dpi=300,
        max_ocr_pages_per_document=max_ocr_pages,
    )
    return extractor, renderer, ocr_service


def build_document_service(
    extractor: DocumentExtractor,
) -> tuple[DocumentService, RecordingVectorStore]:
    vector_store = RecordingVectorStore()
    return (
        DocumentService(
            extractor=extractor,
            cleaner=TextCleaner(),
            chunk_service=BoundaryAwareChunkService(
                chunk_size=100, chunk_overlap=10
            ),
            embedding_service=FakeEmbeddingService(),
            vector_store=vector_store,
            max_file_size_bytes=1024,
        ),
        vector_store,
    )


def valid_input() -> DocumentInput:
    return DocumentInput(
        document_id="doc-ocr",
        knowledge_base_id="kb-1",
        file_name="scan.pdf",
        content_type="application/pdf",
        content=b"%PDF-fake",
    )


def test_text_pdf_does_not_trigger_rendering_or_ocr() -> None:
    extractor, renderer, ocr_service = build_extractor(
        [DocumentPage(1, "普通文字 PDF")]
    )

    pages = extractor.extract(b"pdf")

    assert pages == [DocumentPage(1, "普通文字 PDF")]
    assert renderer.calls == []
    assert ocr_service.calls == []


def test_scanned_pdf_page_triggers_ocr() -> None:
    extractor, renderer, ocr_service = build_extractor(
        [DocumentPage(1, "")], {b"page-1": "扫描识别结果 OCR"}
    )

    pages = extractor.extract(b"pdf")

    assert pages == [DocumentPage(1, "扫描识别结果 OCR")]
    assert renderer.calls == [(1, 300)]
    assert ocr_service.calls == [b"page-1"]


def test_mixed_pdf_only_ocrs_pages_without_usable_text() -> None:
    extractor, renderer, ocr_service = build_extractor(
        [
            DocumentPage(1, "第一页文字"),
            DocumentPage(2, " \x00 "),
            DocumentPage(3, "第三页文字"),
        ],
        {b"page-2": "第二页扫描文字"},
    )

    pages = extractor.extract(b"pdf")

    assert pages == [
        DocumentPage(1, "第一页文字"),
        DocumentPage(2, "第二页扫描文字"),
        DocumentPage(3, "第三页文字"),
    ]
    assert renderer.calls == [(2, 300)]
    assert ocr_service.calls == [b"page-2"]


def test_one_page_ocr_failure_does_not_stop_later_pages() -> None:
    extractor, _, _ = build_extractor(
        [DocumentPage(1, ""), DocumentPage(2, "")],
        {
            b"page-1": OcrError("fake OCR failure"),
            b"page-2": "第二页成功",
        },
    )

    pages = extractor.extract(b"pdf")

    assert pages == [DocumentPage(1, ""), DocumentPage(2, "第二页成功")]


def test_ocr_unavailable_stops_retries_for_current_document() -> None:
    extractor, renderer, ocr_service = build_extractor(
        [DocumentPage(1, ""), DocumentPage(2, "")],
        {b"page-1": OcrUnavailableError("fake unavailable")},
    )

    pages = extractor.extract(b"pdf")

    assert pages == [DocumentPage(1, ""), DocumentPage(2, "")]
    assert renderer.calls == [(1, 300)]
    assert ocr_service.calls == [b"page-1"]


def test_ocr_page_limit_is_checked_before_rendering() -> None:
    extractor, renderer, ocr_service = build_extractor(
        [DocumentPage(1, ""), DocumentPage(2, "")], max_ocr_pages=1
    )

    with pytest.raises(OcrPageLimitExceededError):
        extractor.extract(b"pdf")

    assert renderer.calls == []
    assert ocr_service.calls == []


def test_disabled_ocr_returns_original_empty_pages_without_rendering() -> None:
    extractor, renderer, ocr_service = build_extractor(
        [DocumentPage(1, "")], enabled=False
    )

    assert extractor.extract(b"pdf") == [DocumentPage(1, "")]
    assert renderer.calls == []
    assert ocr_service.calls == []


def test_ocr_page_number_reaches_chunk_metadata() -> None:
    extractor, _, _ = build_extractor(
        [DocumentPage(1, ""), DocumentPage(2, "")],
        {b"page-1": "", b"page-2": "第二页 OCR 文字"},
    )
    service, vector_store = build_document_service(extractor)

    service.process_pdf(valid_input())

    assert [record.metadata["page_number"] for record in vector_store.records] == [2]


def test_all_ocr_pages_failing_returns_empty_document_error() -> None:
    extractor, _, _ = build_extractor(
        [DocumentPage(1, ""), DocumentPage(2, "")],
        {
            b"page-1": OcrError("fake failure"),
            b"page-2": OcrError("fake failure"),
        },
    )
    service, _ = build_document_service(extractor)

    with pytest.raises(EmptyDocumentError):
        service.process_pdf(valid_input())
