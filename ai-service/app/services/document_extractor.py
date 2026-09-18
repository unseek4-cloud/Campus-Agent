from abc import ABC, abstractmethod

from app.domain.document import DocumentPage


class DocumentExtractor(ABC):
    """Port for converting a document binary into page-level text."""

    @abstractmethod
    def extract(self, content: bytes) -> list[DocumentPage]:
        """Extract pages while preserving their one-based page numbers."""
