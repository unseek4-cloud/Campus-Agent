from io import BytesIO
from zipfile import ZipFile

import pytest

from app.core.exceptions import DocumentExtractionError, InvalidDocumentError
from app.services.document_parsers import ImageParser, MarkdownParser, ParserRegistry, PptxParser, TextParser, XlsxParser


def package(files: dict[str, str]) -> bytes:
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return output.getvalue()


def test_utf8_text_and_markdown_preserve_meaningful_structure():
    assert TextParser().extract("通知内容".encode())[0].text == "通知内容"
    result = MarkdownParser().extract("# 奖学金\n\n- **申请时间**：九月\n[详情](https://example.org)".encode())[0].text
    assert "奖学金" in result and "申请时间：九月" in result and "详情" in result
    assert "https://" not in result and "**" not in result
    with pytest.raises(DocumentExtractionError):
        TextParser().extract(b"\xff")


def test_xlsx_keeps_sheet_name_header_and_rows():
    content = package({
        "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="课程" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c t="inlineStr"><is><t>课程</t></is></c><c t="inlineStr"><is><t>时间</t></is></c></row><row><c t="inlineStr"><is><t>高数</t></is></c><c t="inlineStr"><is><t>周一</t></is></c></row></sheetData></worksheet>',
    })
    pages = XlsxParser().extract(content)
    assert len(pages) == 1
    assert "工作表：课程" in pages[0].text
    assert "课程：高数" in pages[0].text
    assert "时间：周一" in pages[0].text


def test_pptx_keeps_slide_number_and_text():
    content = package({
        "ppt/presentation.xml": "<presentation/>",
        "ppt/slides/slide2.xml": '<p:sld xmlns:p="p" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:t>第二页</a:t></a:p></p:sld>',
        "ppt/slides/slide1.xml": '<p:sld xmlns:p="p" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:t>首页标题</a:t></a:p></p:sld>',
    })
    pages = PptxParser().extract(content)
    assert [page.page_number for page in pages] == [1, 2]
    assert "首页标题" in pages[0].text and "第二页" in pages[1].text


def test_image_uses_existing_ocr_and_signature_is_checked():
    class Ocr:
        def recognize(self, image: bytes) -> str:
            assert image.startswith(b"\x89PNG")
            return "校历通知"
    parser = ImageParser(Ocr())
    registry = ParserRegistry({"png": parser})
    image = b"\x89PNG\r\n\x1a\ncontent"
    assert registry.select("png", "image/png", image).extract(image)[0].text == "校历通知"
    with pytest.raises(InvalidDocumentError):
        registry.select("png", "image/png", b"not an image")
    with pytest.raises(InvalidDocumentError):
        registry.select("png", "application/zip", image)
