import logging
from collections import Counter
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Event, Semaphore
from time import monotonic

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
        max_concurrency: int = 1,
        text_threshold: int = 1,
        work_limit: Semaphore | None = None,
        strict_ocr: bool = False,
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
        self._max_concurrency = max_concurrency
        self._text_threshold = text_threshold
        self._work_limit = work_limit
        self._strict_ocr = strict_ocr

    def extract(self, content: bytes) -> list[DocumentPage]:
        return self.extract_with_progress(content)

    def extract_with_progress(self, content: bytes,
                              progress: Callable[[str, int, int, str], None] | None = None) -> list[DocumentPage]:
        started = monotonic()
        pages = self._text_extractor.extract(content)
        logger.info("[PDF] pages=%d text_extract_seconds=%.2f", len(pages), monotonic()-started)
        if progress:
            progress("PARSING", 0, len(pages), "none")
        if not self._enabled:
            return pages

        ocr_candidates = [
            page for page in pages if len(self._cleaner.clean(page.text)) < self._text_threshold
        ]
        if len(ocr_candidates) > self._max_ocr_pages_per_document:
            raise OcrPageLimitExceededError(
                "PDF requires OCR for "
                f"{len(ocr_candidates)} pages, exceeding the configured limit of "
                f"{self._max_ocr_pages_per_document}"
            )

        if not ocr_candidates:
            logger.info("[OCR] pages=%d scanned=0 ocr_seconds=0", len(pages))
            return pages
        ocr_started = monotonic()
        if progress:
            progress("OCR_PROCESSING", len(pages)-len(ocr_candidates), len(pages), "none")
        results: dict[int, DocumentPage] = {}
        providers: Counter[str] = Counter()
        errors: list[Exception] = []
        unavailable = Event()

        def recognize(page: DocumentPage) -> tuple[DocumentPage, str]:
            if unavailable.is_set():
                return DocumentPage(page.page_number, ""), "skipped"
            if self._work_limit:
                self._work_limit.acquire()
            try:
                if unavailable.is_set():
                    return DocumentPage(page.page_number, ""), "skipped"
                rendered_page = self._page_renderer.render_page(
                    content=content,
                    page_number=page.page_number,
                    dpi=self._dpi,
                )
                recognize_with_provider = getattr(self._ocr_service, "recognize_with_provider", None)
                if callable(recognize_with_provider):
                    result = recognize_with_provider(rendered_page.image)
                    return DocumentPage(page.page_number, result.text), result.provider
                try:
                    return DocumentPage(page.page_number, self._ocr_service.recognize(rendered_page.image)), "paddle"
                except OcrUnavailableError:
                    unavailable.set()
                    raise
            finally:
                if self._work_limit:
                    self._work_limit.release()

        with ThreadPoolExecutor(max_workers=self._max_concurrency) as executor:
            futures = {executor.submit(recognize, page): page for page in ocr_candidates}
            for future in as_completed(futures):
                page = futures[future]
                try:
                    result, provider = future.result()
                    results[page.page_number] = result
                    providers[provider] += 1
                    logger.info("[OCR] page=%s provider=%s success", page.page_number, provider)
                except (OcrError, OcrUnavailableError, PdfPageRenderingError) as exception:
                    errors.append(exception)
                    results[page.page_number] = DocumentPage(page.page_number, "")
                    logger.warning("[OCR] page=%s failed type=%s", page.page_number, type(exception).__name__)
                if progress:
                    progress("OCR_PROCESSING", len(pages)-len(ocr_candidates)+len(results), len(pages),
                             "qwen_to_paddle" if providers["qwen_to_paddle"] else
                             "mixed" if providers["qwen"] and providers["paddle"] else
                             "qwen" if providers["qwen"] else "paddle")

        if errors and self._strict_ocr:
            raise OcrError("One or more PDF pages could not be recognized") from errors[0]
        logger.info("[OCR] pages=%d scanned=%d qwen=%d paddle=%d fallback=%d ocr_seconds=%.2f",
                    len(pages), len(ocr_candidates), providers["qwen"],
                    providers["paddle"] + providers["qwen_to_paddle"],
                    providers["qwen_to_paddle"], monotonic()-ocr_started)
        return [results.get(page.page_number, page) for page in pages]
