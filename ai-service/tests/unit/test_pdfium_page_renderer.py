from io import BytesIO

import pytest
from pypdf import PdfWriter

from app.core.exceptions import PdfPageRenderingError
from app.infrastructure.pdf.pdfium_page_renderer import PdfiumPageRenderer


def one_page_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def test_pdfium_renderer_renders_requested_page_as_png() -> None:
    rendered = PdfiumPageRenderer().render_page(one_page_pdf(), 1, 144)

    assert rendered.page_number == 1
    assert rendered.image.startswith(b"\x89PNG\r\n\x1a\n")


def test_pdfium_renderer_rejects_page_outside_document() -> None:
    with pytest.raises(PdfPageRenderingError):
        PdfiumPageRenderer().render_page(one_page_pdf(), 2, 144)
