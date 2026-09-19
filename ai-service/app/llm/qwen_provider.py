import httpx

from app.core.exceptions import LlmConfigurationError, LlmProviderError, LlmTimeoutError
from app.llm.base import LlmProvider


class QwenProvider(LlmProvider):
    """DashScope's OpenAI-compatible chat completions adapter."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float,
        temperature: float,
        max_tokens: int,
        client: httpx.Client | None = None,
        trust_env: bool = False,
    ) -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/")
        self._model = model.strip()
        self._timeout_seconds = timeout_seconds
        self._temperature = temperature
        self._max_tokens = max_tokens
        # A stale OS proxy can prevent access even when DashScope is reachable directly.
        self._client = client if client is not None else httpx.Client(trust_env=trust_env)

    def generate(
        self, system_prompt: str, user_prompt: str, *, temperature: float | None = None
    ) -> str:
        if not self._api_key:
            raise LlmConfigurationError("Qwen API key is not configured (AI_QWEN_API_KEY)")
        if not self._base_url or not self._model:
            raise LlmConfigurationError("Qwen base URL or model is not configured")
        try:
            response = self._client.post(
                f"{self._base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={
                    "model": self._model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": self._temperature if temperature is None else temperature,
                    "max_tokens": self._max_tokens,
                },
                timeout=self._timeout_seconds,
            )
            response.raise_for_status()
            body = response.json()
            answer = body["choices"][0]["message"]["content"]
            if not isinstance(answer, str) or not answer.strip():
                raise LlmProviderError("LLM returned empty content")
            return answer.strip()
        except httpx.TimeoutException as exception:
            raise LlmTimeoutError("Qwen request timed out") from exception
        except httpx.HTTPStatusError as exception:
            raise LlmProviderError(
                f"Qwen API returned HTTP {exception.response.status_code}"
            ) from exception
        except httpx.RequestError as exception:
            raise LlmProviderError("Qwen API connection failed") from exception

        except (ValueError, KeyError, IndexError, TypeError) as exception:
            raise LlmProviderError("Qwen API returned an invalid response") from exception
