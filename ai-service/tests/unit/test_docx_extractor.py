from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from app.infrastructure.docx.docx_extractor import DocxDocumentExtractor


def build_docx(document_xml: str) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", document_xml)
    return buffer.getvalue()


def test_docx_extractor_preserves_paragraph_order_without_fake_page_number() -> None:
    content = build_docx(
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>第一段。</w:t></w:r></w:p>
            <w:p><w:r><w:t>第二段</w:t><w:tab/><w:t>表格值</w:t></w:r></w:p>
          </w:body>
        </w:document>"""
    )

    pages = DocxDocumentExtractor().extract(content)

    assert len(pages) == 1
    assert pages[0].page_number is None
    assert pages[0].text == "第一段。\n\n第二段\t表格值"
