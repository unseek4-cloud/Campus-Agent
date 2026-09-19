import httpx
import pytest

from app.core.exceptions import LlmConfigurationError, LlmProviderError, LlmTimeoutError
from app.llm.qwen_provider import QwenProvider


def provider(handler, api_key: str = "test-only") -> QwenProvider:
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return QwenProvider(api_key, "https://example.test/v1", "qwen-test", 4, 0.2, 100, client)


def test_openai_compatible_request_and_answer() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-only"
        assert b'"temperature":0.2' in request.content
        return httpx.Response(200, json={"choices": [{"message": {"content": "  答案  "}}]})

    assert provider(handler).generate("system", "user") == "答案"


def test_missing_api_key() -> None:
    with pytest.raises(LlmConfigurationError):
        provider(lambda _: httpx.Response(200), "").generate("system", "user")


@pytest.mark.parametrize("response", [httpx.Response(500), httpx.Response(200, json={"choices": [{"message": {"content": ""}}]})])
def test_provider_rejects_error_or_empty_content(response: httpx.Response) -> None:
    with pytest.raises(LlmProviderError):
        provider(lambda _: response).generate("system", "user")


def test_provider_timeout() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timeout")

    with pytest.raises(LlmTimeoutError):
        provider(handler).generate("system", "user")
