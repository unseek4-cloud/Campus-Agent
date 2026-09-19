from abc import ABC, abstractmethod


class LlmProvider(ABC):
    @abstractmethod
    def generate(
        self, system_prompt: str, user_prompt: str, *, temperature: float | None = None
    ) -> str:
        """Return the model's answer text, or raise a typed provider error."""
