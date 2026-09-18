import logging
from io import BytesIO

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.core.exceptions import DocumentExtractionError
from app.domain.document import DocumentPage
from app.services.document_extractor import DocumentExtractor

logger = logging.getLogger(__name__)


class PypdfDocumentExtractor(DocumentExtractor):
    def extract(self, content: bytes) -> list[DocumentPage]:
        try:
            reader = PdfReader(BytesIO(content), strict=False)
            if reader.is_encrypted and not reader.decrypt(""):
                raise DocumentExtractionError("Password-protected PDFs are not supported")

            pages: list[DocumentPage] = []
            for page_index in range(len(reader.pages)):
                page_number = page_index + 1
                try:
                    text = reader.pages[page_index].extract_text() or ""
                except Exception as exception:
                    logger.warning(
                        "pypdf text extraction failed for page %s; OCR fallback may be used: %s",
                        page_number,
                        exception,
                    )
                    text = ""
                pages.append(DocumentPage(page_number=page_number, text=text))
            return pages
        except DocumentExtractionError:
            raise
        except (PdfReadError, ValueError, OSError) as exception:
            raise DocumentExtractionError("PDF could not be parsed") from exception
        except Exception as exception:
            raise DocumentExtractionError("PDF text extraction failed") from exception
