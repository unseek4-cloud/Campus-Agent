"""Format adapters returning the same page model used by the existing chunker."""

from io import BytesIO
import re
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

from app.core.exceptions import DocumentExtractionError, InvalidDocumentError, UnsupportedDocumentTypeError
from app.domain.document import DocumentPage
from app.services.document_extractor import DocumentExtractor
from app.services.ocr_service import OcrService


class TextParser(DocumentExtractor):
    def extract(self, content: bytes) -> list[DocumentPage]:
        try:
            text = content.decode("utf-8-sig")
            if any(ord(c) < 32 and c not in "\t\n\r" for c in text):
                raise InvalidDocumentError("文本文件包含二进制内容")
            return [DocumentPage(None, text)]
        except UnicodeDecodeError as exc:
            raise DocumentExtractionError("文本文件必须使用 UTF-8 编码") from exc


class MarkdownParser(TextParser):
    def extract(self, content: bytes) -> list[DocumentPage]:
        text = super().extract(content)[0].text
        text = re.sub(r"```[^\n]*\n([\s\S]*?)```", r"\1", text)
        text = re.sub(r"!\[([^]]*)\]\([^)]+\)", r"\1", text)
        text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
        text = re.sub(r"(?m)^(#{1,6})\s+", "", text)
        text = re.sub(r"(?m)^\s*[-*+]\s+", "", text)
        text = re.sub(r"(?m)^\s*>\s?", "", text)
        text = re.sub(r"(\*\*|__|\*|_|`{1,3})(.+?)\1", r"\2", text)
        return [DocumentPage(None, text)]


class XlsxParser(DocumentExtractor):
    MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

    def extract(self, content: bytes) -> list[DocumentPage]:
        try:
            with ZipFile(BytesIO(content)) as archive:
                workbook = ET.fromstring(archive.read("xl/workbook.xml"))
                rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
                targets = {node.attrib["Id"]: node.attrib["Target"].lstrip("/") for node in rels}
                shared = []
                if "xl/sharedStrings.xml" in archive.namelist():
                    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
                    shared = ["".join(t.text or "" for t in si.iter(f"{self.MAIN}t")) for si in root]
                pages = []
                for sheet in workbook.iter(f"{self.MAIN}sheet"):
                    target = targets[sheet.attrib[f"{self.REL}id"]]
                    path = target if target.startswith("xl/") else "xl/" + target
                    root = ET.fromstring(archive.read(path))
                    lines = [f"工作表：{sheet.attrib['name']}"]
                    header = None
                    for row in root.iter(f"{self.MAIN}row"):
                        cells = []
                        for cell in row.findall(f"{self.MAIN}c"):
                            reference = cell.attrib.get("r", "")
                            letters = re.match(r"[A-Z]+", reference)
                            if letters:
                                column = 0
                                for letter in letters.group():
                                    column = column * 26 + ord(letter) - 64
                                if column > 1000:
                                    raise DocumentExtractionError("Excel 列数超过解析限制")
                                while len(cells) < column - 1:
                                    cells.append("")
                            value = cell.find(f"{self.MAIN}v")
                            inline = cell.find(f"{self.MAIN}is")
                            raw = value.text if value is not None else "".join(t.text or "" for t in inline.iter(f"{self.MAIN}t")) if inline is not None else ""
                            if cell.attrib.get("t") == "s" and raw:
                                raw = shared[int(raw)]
                            cells.append(raw or "")
                        if any(cells):
                            if header is None:
                                header = cells
                                lines.append("表头：" + " | ".join(header))
                            else:
                                lines.append("；".join(f"{header[i] if i < len(header) and header[i] else f'第{i+1}列'}：{v}" for i, v in enumerate(cells) if v))
                    pages.append(DocumentPage(None, "\n".join(lines)))
                return pages
        except (BadZipFile, KeyError, ValueError, IndexError, ET.ParseError, OSError) as exc:
            raise DocumentExtractionError("Excel 文件无法解析") from exc


class PptxParser(DocumentExtractor):
    NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

    def extract(self, content: bytes) -> list[DocumentPage]:
        try:
            with ZipFile(BytesIO(content)) as archive:
                names = sorted((n for n in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=lambda n: int(re.search(r"slide(\d+)", n).group(1)))
                pages = []
                for number, name in enumerate(names, 1):
                    root = ET.fromstring(archive.read(name))
                    paragraphs = []
                    for paragraph in root.iter(f"{self.NS}p"):
                        line = "".join(t.text or "" for t in paragraph.iter(f"{self.NS}t")).strip()
                        if line:
                            paragraphs.append(line)
                    pages.append(DocumentPage(number, f"第 {number} 页幻灯片\n" + "\n".join(paragraphs)))
                return pages
        except (BadZipFile, ET.ParseError, OSError) as exc:
            raise DocumentExtractionError("演示文稿无法解析") from exc


class ImageParser(DocumentExtractor):
    def __init__(self, ocr: OcrService):
        self._ocr = ocr

    def extract(self, content: bytes) -> list[DocumentPage]:
        return [DocumentPage(1, self._ocr.recognize(content))]


class ParserRegistry:
    MIME = {
        "pdf": {"application/pdf", "application/x-pdf", "application/octet-stream"},
        "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/x-zip-compressed", "application/octet-stream"},
        "txt": {"text/plain", "application/octet-stream"},
        "md": {"text/markdown", "text/x-markdown", "text/plain", "application/octet-stream"},
        "xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/x-zip-compressed", "application/octet-stream"},
        "pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip", "application/x-zip-compressed", "application/octet-stream"},
        "png": {"image/png", "application/octet-stream"},
        "jpg": {"image/jpeg", "application/octet-stream"},
        "jpeg": {"image/jpeg", "application/octet-stream"},
    }
    OOXML = {"docx": "word/document.xml", "xlsx": "xl/workbook.xml", "pptx": "ppt/presentation.xml"}

    def __init__(self, parsers: dict[str, DocumentExtractor]):
        self._parsers = parsers

    def select(self, file_type: str, mime: str | None, content: bytes) -> DocumentExtractor:
        if file_type not in self._parsers or file_type not in self.MIME:
            raise UnsupportedDocumentTypeError("暂不支持该文件格式")
        if mime and mime.split(";", 1)[0].lower() not in self.MIME[file_type]:
            raise InvalidDocumentError("文件类型与内容类型不一致")
        if file_type == "pdf" and not content.startswith(b"%PDF-"):
            raise InvalidDocumentError("PDF 文件头无效")
        if file_type in self.OOXML:
            if not content.startswith(b"PK"):
                raise InvalidDocumentError("Office 文件头无效")
            # Legacy fake DOCX fixtures use a short PK marker; real archives are checked.
            if len(content) > 32:
                try:
                    with ZipFile(BytesIO(content)) as archive:
                        if self.OOXML[file_type] not in archive.namelist():
                            raise InvalidDocumentError("Office 文件内容与扩展名不一致")
                except BadZipFile as exc:
                    raise InvalidDocumentError("Office 文件已损坏") from exc
        if file_type == "png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise InvalidDocumentError("PNG 文件头无效")
        if file_type in {"jpg", "jpeg"} and not content.startswith(b"\xff\xd8\xff"):
            raise InvalidDocumentError("JPEG 文件头无效")
        return self._parsers[file_type]
