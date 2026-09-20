"""Qwen OCR Responses API image adapter; uploaded files never need public URLs."""

import base64
import logging
import time

import httpx

from app.core.exceptions import OcrError

logger = logging.getLogger(__name__)


class QwenOCRProvider:
    def __init__(self, api_key: str, base_url: str, model: str,
                 timeout: float, max_retries: int, trust_env: bool = False,
                 client: httpx.Client | None = None) -> None:
        self._api_key = api_key.strip()
        self._url = base_url.rstrip("/") + "/responses"
        self._model = model
        self._timeout = httpx.Timeout(timeout, connect=min(10.0, timeout))
        self._max_retries = max_retries
        self._client = client or httpx.Client(trust_env=trust_env)

    def recognize(self, image: bytes) -> str:
        if not self._api_key:
            raise OcrError("Qwen OCR API key is not configured")
        if not image:
            raise OcrError("OCR image is empty")
        mime = "image/jpeg" if image.startswith(b"\xff\xd8") else "image/png"
        encoded = base64.b64encode(image).decode("ascii")
        body = {"model": self._model, "input": [{"role": "user", "content": [
            {"type": "input_image", "image_url": f"data:{mime};base64,{encoded}"},
            {"type": "input_text", "text": "请只输出图片中可见的文字，保持原有阅读顺序，不添加说明。"},
        ]}]}
        for attempt in range(self._max_retries + 1):
            try:
                response = self._client.post(self._url, json=body,
                    headers={"Authorization": f"Bearer {self._api_key}"}, timeout=self._timeout)
                response.raise_for_status()
                payload = response.json()
                texts = []
                for item in payload.get("output", []):
                    for part in item.get("content", []):
                        if isinstance(part.get("text"), str):
                            texts.append(part["text"])
                        elif isinstance(part.get("ocr_result"), str):
                            texts.append(part["ocr_result"])
                result = "\n".join(texts).strip()
                if not result:
                    raise OcrError("Qwen OCR returned no text")
                return result
            except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError,
                    ValueError, KeyError, TypeError, OcrError) as exception:
                retryable = isinstance(exception, (httpx.TimeoutException, httpx.TransportError)) or (
                    isinstance(exception, httpx.HTTPStatusError) and
                    exception.response.status_code in {429, 500, 502, 503, 504})
                logger.warning("[OCR] Qwen request failed attempt=%s type=%s", attempt + 1, type(exception).__name__)
                if not retryable or attempt >= self._max_retries:
                    raise OcrError("Qwen OCR request failed") from exception
                time.sleep(min(2 ** attempt, 4))
        raise OcrError("Qwen OCR request failed")
