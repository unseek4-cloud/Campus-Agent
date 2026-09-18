import pytest

from app.core.exceptions import OcrError, OcrUnavailableError
from app.infrastructure.ocr.paddle_ocr_service import PaddleOcrService


class FakeResult:
    def __init__(self, texts: list[str]) -> None:
        self.json = {"res": {"rec_texts": texts}}


class FakeEngine:
    def __init__(self) -> None:
        self.inputs: list[object] = []

    def predict(self, image: object) -> list[FakeResult]:
        self.inputs.append(image)
        return [FakeResult([" 校园 ", "Campus", " "])]


def test_paddle_engine_is_initialized_lazily_and_reused() -> None:
    engine = FakeEngine()
    factory_calls: list[dict[str, object]] = []

    def factory(**kwargs: object) -> FakeEngine:
        factory_calls.append(kwargs)
        return engine

    service = PaddleOcrService(
        language="ch",
        device="cpu",
        engine_factory=factory,
        image_decoder=lambda image: f"decoded:{image.decode()}",
    )

    assert factory_calls == []

    assert service.recognize(b"image-1") == "校园\nCampus"
    assert service.recognize(b"image-2") == "校园\nCampus"

    assert len(factory_calls) == 1
    assert factory_calls[0]["lang"] == "ch"
    assert factory_calls[0]["device"] == "cpu"
    assert factory_calls[0]["ocr_version"] == "PP-OCRv6"
    assert factory_calls[0]["enable_mkldnn"] is False
    assert engine.inputs == ["decoded:image-1", "decoded:image-2"]


def test_paddle_initialization_failure_is_wrapped_as_unavailable() -> None:
    def failing_factory(**kwargs: object) -> object:
        raise RuntimeError("model unavailable")

    service = PaddleOcrService(
        language="ch",
        device="cpu",
        engine_factory=failing_factory,
        image_decoder=lambda image: image,
    )

    with pytest.raises(OcrUnavailableError):
        service.recognize(b"image")


def test_paddle_inference_failure_is_wrapped_as_page_error() -> None:
    class FailingEngine:
        def predict(self, image: object) -> object:
            raise RuntimeError("inference failed")

    service = PaddleOcrService(
        language="ch",
        device="cpu",
        engine_factory=lambda **kwargs: FailingEngine(),
        image_decoder=lambda image: image,
    )

    with pytest.raises(OcrError, match="RuntimeError: inference failed"):
        service.recognize(b"image")


def test_invalid_image_is_rejected_before_engine_initialization() -> None:
    factory_called = False

    def factory(**kwargs: object) -> object:
        nonlocal factory_called
        factory_called = True
        return FakeEngine()

    service = PaddleOcrService(
        language="ch",
        device="cpu",
        engine_factory=factory,
    )

    with pytest.raises(OcrError):
        service.recognize(b"not-an-image")

    assert factory_called is False
