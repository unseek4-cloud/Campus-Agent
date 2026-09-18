from collections.abc import Callable, Iterable
from threading import Lock
from typing import Any

from app.core.exceptions import OcrError, OcrUnavailableError
from app.services.ocr_service import OcrService

EngineFactory = Callable[..., Any]
ImageDecoder = Callable[[bytes], Any]


class PaddleOcrService(OcrService):
    """PaddleOCR adapter with lazy, thread-safe model initialization."""

    def __init__(
        self,
        language: str,
        device: str,
        enable_mkldnn: bool = False,
        engine_factory: EngineFactory | None = None,
        image_decoder: ImageDecoder | None = None,
    ) -> None:
        self._language = language
        self._device = device
        self._enable_mkldnn = enable_mkldnn
        self._engine_factory = engine_factory or self._create_engine
        self._image_decoder = image_decoder or self._decode_image
        self._engine: Any | None = None
        self._initialization_lock = Lock()
        self._inference_lock = Lock()

    def recognize(self, image: bytes) -> str:
        if not image:
            return ""

        try:
            image_array = self._image_decoder(image)
        except Exception as exception:
            raise OcrError("OCR page image could not be decoded") from exception

        engine = self._get_engine()
        try:
            with self._inference_lock:
                results = engine.predict(image_array)
            texts = self._collect_texts(results)
            return "\n".join(text for text in texts if text)
        except OcrError:
            raise
        except Exception as exception:
            raise OcrError(
                "PaddleOCR page recognition failed: "
                f"{self._exception_summary(exception)}"
            ) from exception

    def _get_engine(self) -> Any:
        if self._engine is not None:
            return self._engine

        with self._initialization_lock:
            if self._engine is not None:
                return self._engine
            try:
                self._engine = self._engine_factory(
                    lang=self._language,
                    device=self._device,
                    ocr_version="PP-OCRv6",
                    enable_mkldnn=self._enable_mkldnn,
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
            except Exception as exception:
                raise OcrUnavailableError(
                    "PaddleOCR could not be initialized: "
                    f"{self._exception_summary(exception)}"
                ) from exception
            return self._engine

    @staticmethod
    def _create_engine(**kwargs: Any) -> Any:
        # Importing here keeps Paddle and its models out of the FastAPI startup path.
        from paddleocr import PaddleOCR

        return PaddleOCR(**kwargs)

    @staticmethod
    def _exception_summary(exception: Exception) -> str:
        detail = str(exception).strip().splitlines()
        return f"{type(exception).__name__}: {detail[0] if detail else 'no details'}"

    @staticmethod
    def _decode_image(image: bytes) -> Any:
        import cv2
        import numpy as np

        decoded = cv2.imdecode(
            np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_COLOR
        )
        if decoded is None:
            raise ValueError("Unsupported or corrupt image data")
        return decoded

    @classmethod
    def _collect_texts(cls, results: Iterable[Any]) -> list[str]:
        texts: list[str] = []
        for result in results:
            payload = result if isinstance(result, dict) else getattr(result, "json", {})
            if callable(payload):
                payload = payload()
            if not isinstance(payload, dict):
                continue

            result_data = payload.get("res", payload)
            if not isinstance(result_data, dict):
                continue
            recognized = result_data.get("rec_texts", [])
            if not isinstance(recognized, (list, tuple)):
                continue
            texts.extend(
                text.strip()
                for text in recognized
                if isinstance(text, str) and text.strip()
            )
        return texts
