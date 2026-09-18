import logging

from app.core.exceptions import (
    OcrError,
    OcrPageLimitExceededError,
    OcrUnavailableError,
    PdfPageRenderingError,
)
from app.domain.document import DocumentPage
from app.services.document_extractor import DocumentExtractor
from app.services.ocr_service import OcrService
from app.services.pdf_page_renderer import PdfPageRenderer
from app.services.text_cleaner import TextCleaner

logger = logging.getLogger(__name__)


class OcrFallbackDocumentExtractor(DocumentExtractor):
    """Uses embedded PDF text first and OCRs only pages without usable text."""

    def __init__(
        self,
        text_extractor: DocumentExtractor,
        cleaner: TextCleaner,
        page_renderer: PdfPageRenderer,
        ocr_service: OcrService,
        enabled: bool,
        dpi: int,
        max_ocr_pages_per_document: int,
    ) -> None:
        if dpi <= 0:
            raise ValueError("dpi must be greater than zero")
        if max_ocr_pages_per_document <= 0:
            raise ValueError("max_ocr_pages_per_document must be greater than zero")

        self._text_extractor = text_extractor
        self._cleaner = cleaner
        self._page_renderer = page_renderer
        self._ocr_service = ocr_service
        self._enabled = enabled
        self._dpi = dpi
        self._max_ocr_pages_per_document = max_ocr_pages_per_document

    def extract(self, content: bytes) -> list[DocumentPage]:
        pages = self._text_extractor.extract(content)
        if not self._enabled:
            return pages

        ocr_candidates = [
            page for page in pages if not self._cleaner.clean(page.text)
        ]
        if len(ocr_candidates) > self._max_ocr_pages_per_document:
            raise OcrPageLimitExceededError(
                "PDF requires OCR for "
                f"{len(ocr_candidates)} pages, exceeding the configured limit of "
                f"{self._max_ocr_pages_per_document}"
            )

        candidate_page_numbers = {page.page_number for page in ocr_candidates}
        merged_pages: list[DocumentPage] = []
        ocr_available = True

        for page in pages:
            if page.page_number not in candidate_page_numbers or not ocr_available:
                merged_pages.append(page)
                continue

            text = ""
            try:
                rendered_page = self._page_renderer.render_page(
                    content=content,
                    page_number=page.page_number,
                    dpi=self._dpi,
                )
                text = self._ocr_service.recognize(rendered_page.image)
            except OcrUnavailableError as exception:
                ocr_available = False
                logger.warning(
                    "OCR is unavailable; remaining empty pages will be skipped "
                    "(page_number=%s): %s",
                    page.page_number,
                    exception,
                )
            except (OcrError, PdfPageRenderingError) as exception:
                logger.warning(
                    "OCR fallback failed for PDF page %s: %s",
                    page.page_number,
                    exception,
                )

            merged_pages.append(
                DocumentPage(page_number=page.page_number, text=text or "")
            )

        return merged_pages
