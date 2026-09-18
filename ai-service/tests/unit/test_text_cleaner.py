from app.domain.document import DocumentPage
from app.services.text_cleaner import TextCleaner


def test_cleaner_normalizes_whitespace_and_control_characters() -> None:
    cleaner = TextCleaner()

    cleaned = cleaner.clean("  校园\u00a0服务\r\n\r\n\r\n办理\t说明\x00  ")

    assert cleaned == "校园 服务\n\n办理 说明"


def test_cleaner_preserves_page_numbers_and_empty_pages() -> None:
    cleaner = TextCleaner()

    pages = cleaner.clean_pages(
        [DocumentPage(page_number=1, text=" 第一页 "), DocumentPage(2, " \x00 ")]
    )

    assert pages == [
        DocumentPage(page_number=1, text="第一页"),
        DocumentPage(page_number=2, text=""),
    ]
