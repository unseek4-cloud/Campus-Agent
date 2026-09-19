from app.core.config import Settings
from app.core.exceptions import LlmConfigurationError
from app.llm.base import LlmProvider
from app.llm.qwen_provider import QwenProvider


def create_llm_provider(settings: Settings) -> LlmProvider:
    if settings.llm_provider.lower() == "qwen":
        return QwenProvider(
            api_key=settings.qwen_api_key,
            base_url=settings.qwen_base_url,
            model=settings.qwen_model,
            timeout_seconds=settings.llm_timeout_seconds,
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens,
        )
    raise LlmConfigurationError(f"Unsupported LLM provider: {settings.llm_provider}")
