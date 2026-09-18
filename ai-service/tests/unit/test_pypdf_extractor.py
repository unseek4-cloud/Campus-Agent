from io import BytesIO

import pytest
from pypdf import PdfWriter

import app.infrastructure.pdf.pypdf_extractor as pypdf_extractor_module
from app.core.exceptions import DocumentExtractionError
from app.infrastructure.pdf.pypdf_extractor import PypdfDocumentExtractor


def test_extractor_preserves_blank_pdf_page() -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    buffer = BytesIO()
    writer.write(buffer)

    pages = PypdfDocumentExtractor().extract(buffer.getvalue())

    assert len(pages) == 1
    assert pages[0].page_number == 1
    assert pages[0].text == ""


def test_extractor_wraps_invalid_pdf_errors() -> None:
    with pytest.raises(DocumentExtractionError):
        PypdfDocumentExtractor().extract(b"%PDF-invalid")


def test_extractor_preserves_page_when_one_page_text_extraction_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class TextPage:
        def extract_text(self) -> str:
            return "第一页"

    class FailingPage:
        def extract_text(self) -> str:
            raise RuntimeError("broken content stream")

    class FakeReader:
        is_encrypted = False
        pages = [TextPage(), FailingPage()]

    monkeypatch.setattr(
        pypdf_extractor_module, "PdfReader", lambda *args, **kwargs: FakeReader()
    )

    pages = PypdfDocumentExtractor().extract(b"%PDF-fake")

    assert pages[0].text == "第一页"
    assert pages[1].page_number == 2
    assert pages[1].text == ""
