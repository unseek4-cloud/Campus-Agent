"""Hybrid OCR behavior without external models or paid API calls."""

from threading import Lock
from time import sleep

import httpx
import pytest

from app.core.exceptions import OcrError
from app.domain.document import DocumentPage
from app.infrastructure.ocr.ocr_manager import OCRManager
from app.infrastructure.ocr.qwen_ocr_provider import QwenOCRProvider
from app.services.document_progress import ProgressStore
from app.services.document_parsers import ImageParser
from app.services.ocr_fallback_document_extractor import OcrFallbackDocumentExtractor
from app.services.text_cleaner import TextCleaner
from tests.unit.test_ocr_fallback_document_extractor import (
    FakeTextExtractor, RecordingPageRenderer, build_document_service, valid_input,
)


class Provider:
    def __init__(self, value: str | Exception):
        self.value = value
        self.calls = 0

    def recognize(self, image: bytes) -> str:
        self.calls += 1
        if isinstance(self.value, Exception):
            raise self.value
        return self.value


def manager(qwen: Provider, paddle: Provider, *, mode="hybrid", cloud=True) -> OCRManager:
    return OCRManager(qwen, paddle, mode, cloud, True)


def test_qwen_success_and_bad_key_falls_back() -> None:
    qwen, paddle = Provider("云端文字"), Provider("本地文字")
    assert manager(qwen, paddle).recognize_with_provider(b"image").provider == "qwen"
    qwen.value = OcrError("HTTP 401")
    result = manager(qwen, paddle).recognize_with_provider(b"image")
    assert (result.text, result.provider) == ("本地文字", "qwen_to_paddle")
    assert paddle.calls == 1


def test_timeout_falls_back_and_qwen_mode_fails() -> None:
    qwen, paddle = Provider(TimeoutError()), Provider("本地文字")
    assert manager(qwen, paddle).recognize(b"image") == "本地文字"
    with pytest.raises(OcrError):
        manager(qwen, paddle, mode="qwen").recognize(b"image")


@pytest.mark.parametrize("mode,cloud", [("paddle", True), ("hybrid", False), ("qwen", False)])
def test_local_modes_never_call_cloud(mode: str, cloud: bool) -> None:
    qwen, paddle = Provider("云端文字"), Provider("本地文字")
    assert manager(qwen, paddle, mode=mode, cloud=cloud).recognize(b"image") == "本地文字"
    assert qwen.calls == 0


def test_both_providers_fail() -> None:
    with pytest.raises(OcrError):
        manager(Provider(OcrError("cloud")), Provider(OcrError("local"))).recognize(b"image")


def test_qwen_payload_uses_responses_image_and_parses_result() -> None:
    requests = []
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"output": [{"content": [{"type": "output_text", "text": "识别成功"}]}]})
    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = QwenOCRProvider("example-key", "https://example.test/v1", "qwen3.5-ocr", 3, 0, client=client)
    assert provider.recognize(b"\x89PNG\r\n\x1a\nimage") == "识别成功"
    assert requests[0].url.path == "/v1/responses"
    assert b"data:image/png;base64," in requests[0].content


def test_twenty_scanned_pages_run_with_bounded_concurrency_and_order() -> None:
    class SlowProvider:
        def __init__(self):
            self.active = self.maximum = 0
            self.lock = Lock()
        def recognize(self, image: bytes) -> str:
            with self.lock:
                self.active += 1
                self.maximum = max(self.maximum, self.active)
            sleep(0.005 * (21-int(image.decode().split("-")[1])) / 20)
            with self.lock:
                self.active -= 1
            return image.decode()
    qwen = SlowProvider()
    extractor = OcrFallbackDocumentExtractor(FakeTextExtractor([DocumentPage(i, "") for i in range(1, 21)]),
        TextCleaner(), RecordingPageRenderer(), manager(qwen, Provider("local")), True, 200, 50,
        max_concurrency=4, strict_ocr=True)
    updates = []
    pages = extractor.extract_with_progress(b"pdf", lambda stage, current, total, provider: updates.append((stage, current, total)))
    assert [page.text for page in pages] == [f"page-{i}" for i in range(1, 21)]
    assert 1 < qwen.maximum <= 4
    assert sorted(current for stage, current, _ in updates if stage == "OCR_PROCESSING") == list(range(21))


def test_mixed_pdf_only_sends_scanned_page() -> None:
    qwen = Provider("扫描文字")
    renderer = RecordingPageRenderer()
    extractor = OcrFallbackDocumentExtractor(FakeTextExtractor([
        DocumentPage(1, "有文字" * 20), DocumentPage(2, ""), DocumentPage(3, "末页文字" * 20)]),
        TextCleaner(), renderer, manager(qwen, Provider("local")), True, 200, 50,
        max_concurrency=4, text_threshold=50, strict_ocr=True)
    assert [page.text for page in extractor.extract(b"pdf")] == ["有文字" * 20, "扫描文字", "末页文字" * 20]
    assert renderer.calls == [(2, 200)]
    assert qwen.calls == 1


def test_three_scanned_pages_reach_chunks_embeddings_and_index() -> None:
    qwen = Provider("Qwen 识别的校园规章文字。")
    extractor = OcrFallbackDocumentExtractor(FakeTextExtractor([DocumentPage(i, "") for i in range(1, 4)]),
        TextCleaner(), RecordingPageRenderer(), manager(qwen, Provider("local")), True, 200, 50,
        max_concurrency=3, strict_ocr=True)
    service, vectors = build_document_service(extractor)
    result = service.process_document(valid_input())
    assert result.page_count == 3
    assert result.ocr_provider == "qwen"
    assert result.chunk_count == len(vectors.records) == 3
    assert [record.metadata["page_number"] for record in vectors.records] == [1, 2, 3]
    assert all(record.embedding for record in vectors.records)
    assert qwen.calls == 3


def test_failed_scan_has_no_partial_page_output() -> None:
    extractor = OcrFallbackDocumentExtractor(FakeTextExtractor([DocumentPage(1, ""), DocumentPage(2, "")]),
        TextCleaner(), RecordingPageRenderer(), manager(Provider(OcrError("cloud")), Provider(OcrError("local"))),
        True, 200, 50, max_concurrency=2, strict_ocr=True)
    with pytest.raises(OcrError):
        extractor.extract(b"pdf")


def test_image_parser_reports_actual_ocr_provider() -> None:
    parser = ImageParser(manager(Provider(OcrError("cloud")), Provider("本地图片文字")))
    events = []
    pages = parser.extract_with_progress(b"\x89PNG\r\n\x1a\nimage", lambda *event: events.append(event))
    assert pages == [DocumentPage(1, "本地图片文字")]
    assert events[-1] == ("OCR_PROCESSING", 1, 1, "qwen_to_paddle")


def test_progress_never_regresses_and_reprocess_resets() -> None:
    store = ProgressStore()
    store.start("doc")
    store.update("doc", "OCR_PROCESSING", 4, 10)
    first = store.get("doc")["progress"]
    store.update("doc", "OCR_PROCESSING", 2, 10)
    assert store.get("doc")["progress"] == first
    store.update("doc", "COMPLETED")
    assert store.get("doc")["progress"] == 100
    store.start("doc")
    assert store.get("doc")["progress"] == 5
