from abc import ABC, abstractmethod
from collections.abc import Sequence

from app.domain.document import VectorSearchResult


class RerankService(ABC):
    """Provider-neutral interface for ordering retrieved candidates."""

    @property
    @abstractmethod
    def model_name(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def rerank(
        self,
        query: str,
        candidates: Sequence[VectorSearchResult],
        top_k: int,
    ) -> list[VectorSearchResult]:
        raise NotImplementedError
