from io import BytesIO

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.core.exceptions import DocumentExtractionError
from app.domain.document import DocumentPage
from app.services.document_extractor import DocumentExtractor


class PypdfDocumentExtractor(DocumentExtractor):
    def extract(self, content: bytes) -> list[DocumentPage]:
        try:
            reader = PdfReader(BytesIO(content), strict=False)
            if reader.is_encrypted and not reader.decrypt(""):
                raise DocumentExtractionError("Password-protected PDFs are not supported")

            return [
                DocumentPage(page_number=index, text=page.extract_text() or "")
                for index, page in enumerate(reader.pages, start=1)
            ]
        except DocumentExtractionError:
            raise
        except (PdfReadError, ValueError, OSError) as exception:
            raise DocumentExtractionError("PDF could not be parsed") from exception
        except Exception as exception:
            raise DocumentExtractionError("PDF text extraction failed") from exception
