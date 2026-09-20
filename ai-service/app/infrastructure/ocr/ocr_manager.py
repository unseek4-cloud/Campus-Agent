"""OCR provider selection. Cloud failures remain local to a page in hybrid mode."""

import logging
from dataclasses import dataclass
from typing import Protocol

from app.core.exceptions import OcrError
from app.services.ocr_service import OcrService

logger = logging.getLogger(__name__)


class OCRProvider(Protocol):
    def recognize(self, image: bytes) -> str: ...


@dataclass(frozen=True)
class OCRResult:
    text: str
    provider: str


class OCRManager(OcrService):
    def __init__(self, qwen: OCRProvider, paddle: OCRProvider, mode: str,
                 allow_cloud: bool, qwen_enabled: bool) -> None:
        self._qwen = qwen
        self._paddle = paddle
        self._mode = mode
        self._allow_cloud = allow_cloud
        self._qwen_enabled = qwen_enabled

    def recognize(self, image: bytes) -> str:
        return self.recognize_with_provider(image).text

    def recognize_with_provider(self, image: bytes) -> OCRResult:
        use_qwen = self._allow_cloud and self._qwen_enabled and self._mode != "paddle"
        if use_qwen:
            try:
                text = self._qwen.recognize(image).strip()
                if not text:
                    raise OcrError("Qwen returned empty text")
                return OCRResult(text, "qwen")
            except Exception as exception:
                if self._mode == "qwen":
                    raise OcrError("Qwen OCR failed") from exception
                logger.warning("[OCR] Qwen failed; fallback=paddle reason=%s", type(exception).__name__)
                fallback = "qwen_to_paddle"
        elif self._mode == "qwen" and self._allow_cloud:
            raise OcrError("Qwen OCR is disabled or not configured")
        else:
            fallback = "paddle"
        try:
            text = self._paddle.recognize(image).strip()
            if not text:
                raise OcrError("PaddleOCR returned empty text")
            return OCRResult(text, fallback)
        except Exception as exception:
            raise OcrError("Local OCR failed") from exception
