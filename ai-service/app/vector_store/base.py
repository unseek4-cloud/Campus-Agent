from abc import ABC, abstractmethod
from collections.abc import Sequence

from app.domain.document import VectorRecord


class VectorStore(ABC):
    """Provider-neutral vector persistence port."""

    @abstractmethod
    def replace_document(
        self, document_id: str, records: Sequence[VectorRecord]
    ) -> None:
        """Replace all vectors belonging to one document."""
