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


def test_rewrite_can_override_temperature_on_same_provider() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert b'"temperature":0' in request.content
        return httpx.Response(200, json={"choices": [{"message": {"content": "独立问题？"}}]})

    assert provider(handler).generate("rewrite", "question", temperature=0) == "独立问题？"


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


def test_connection_failure_is_not_labeled_invalid_response() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("proxy is unavailable")

    with pytest.raises(LlmProviderError, match="connection failed"):
        provider(handler).generate("system", "user")


@pytest.mark.parametrize("trust_env", [False, True])
def test_provider_proxy_setting_is_explicit(monkeypatch: pytest.MonkeyPatch, trust_env: bool) -> None:
    options: list[dict] = []

    class StubClient:
        def __init__(self, **kwargs) -> None:
            options.append(kwargs)

    monkeypatch.setattr(httpx, "Client", StubClient)
    QwenProvider("key", "https://example.test/v1", "model", 4, 0.2, 100, trust_env=trust_env)
    assert options == [{"trust_env": trust_env}]
