from abc import ABC, abstractmethod
from collections.abc import Sequence


class EmbeddingService(ABC):
    """Model-agnostic port used by the application layer."""

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Return the configured model identifier for traceability."""

    @abstractmethod
    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        """Generate one dense vector for every input text, preserving order."""

    def embed_query(self, text: str) -> list[float]:
        """Generate the query vector using the same vector space as documents."""
        embeddings = self.embed_documents([text])
        return embeddings[0] if embeddings else []
