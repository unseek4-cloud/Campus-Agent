from io import BytesIO
from zipfile import BadZipFile, ZipFile
from xml.etree import ElementTree

from app.core.exceptions import DocumentExtractionError
from app.domain.document import DocumentPage
from app.services.document_extractor import DocumentExtractor

_WORD_NAMESPACE = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class DocxDocumentExtractor(DocumentExtractor):
    """Extracts ordered paragraph/table text from an OOXML Word document."""

    def extract(self, content: bytes) -> list[DocumentPage]:
        try:
            with ZipFile(BytesIO(content)) as archive:
                document_xml = archive.read("word/document.xml")
        except (BadZipFile, KeyError, OSError) as exception:
            raise DocumentExtractionError("DOCX could not be parsed") from exception

        try:
            root = ElementTree.fromstring(document_xml)
        except ElementTree.ParseError as exception:
            raise DocumentExtractionError("DOCX document XML is invalid") from exception

        paragraphs: list[str] = []
        for paragraph in root.iter(f"{_WORD_NAMESPACE}p"):
            parts: list[str] = []
            for node in paragraph.iter():
                if node.tag == f"{_WORD_NAMESPACE}t" and node.text:
                    parts.append(node.text)
                elif node.tag == f"{_WORD_NAMESPACE}tab":
                    parts.append("\t")
                elif node.tag in {
                    f"{_WORD_NAMESPACE}br",
                    f"{_WORD_NAMESPACE}cr",
                }:
                    parts.append("\n")
            text = "".join(parts).strip()
            if text:
                paragraphs.append(text)

        # DOCX does not store stable rendered page numbers. None prevents us from
        # presenting a fabricated page in later citations.
        return [DocumentPage(page_number=None, text="\n\n".join(paragraphs))]
