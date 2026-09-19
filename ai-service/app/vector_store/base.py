from abc import ABC, abstractmethod
from collections.abc import Sequence

from app.domain.document import VectorRecord, VectorSearchResult


class VectorStore(ABC):
    """Provider-neutral vector persistence port."""

    @abstractmethod
    def replace_document(
        self, document_id: str, records: Sequence[VectorRecord]
    ) -> None:
        """Replace all vectors belonging to one document."""

    @abstractmethod
    def delete_document(self, document_id: str) -> int:
        """Delete all vectors belonging to one document and return the count."""

    @abstractmethod
    def similarity_search(
        self,
        query_embedding: Sequence[float],
        top_k: int,
        knowledge_base_id: str | None = None,
    ) -> list[VectorSearchResult]:
        """Return the nearest chunks ordered from most to least similar."""
