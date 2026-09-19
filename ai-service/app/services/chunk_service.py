from abc import ABC, abstractmethod
from collections.abc import Sequence

from app.domain.document import DocumentPage, TextChunk

_BOUNDARIES = ("\n\n", "\n", "。", "！", "？", ".", "!", "?", "；", ";")


class ChunkService(ABC):
    """Port for replacing the chunking strategy independently of ingestion."""

    @abstractmethod
    def split(self, pages: Sequence[DocumentPage]) -> list[TextChunk]:
        """Split cleaned pages into ordered, page-aware chunks."""


class BoundaryAwareChunkService(ChunkService):
    """Character-based chunker that prefers paragraph and sentence boundaries."""

    def __init__(self, chunk_size: int, chunk_overlap: int) -> None:
        if chunk_size <= 0:
            raise ValueError("chunk_size must be greater than zero")
        if chunk_overlap < 0 or chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be non-negative and smaller than chunk_size")
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap

    def split(self, pages: Sequence[DocumentPage]) -> list[TextChunk]:
        chunks: list[TextChunk] = []
        for page in pages:
            for text in self._split_text(page.text):
                chunks.append(
                    TextChunk(
                        chunk_index=len(chunks),
                        page_number=page.page_number,
                        text=text,
                    )
                )
        return chunks

    def _split_text(self, text: str) -> list[str]:
        text = text.strip()
        if not text:
            return []

        chunks: list[str] = []
        start = 0
        text_length = len(text)

        while start < text_length:
            hard_end = min(start + self._chunk_size, text_length)
            end = hard_end

            if hard_end < text_length:
                lower_bound = start + max(self._chunk_size // 2, 1)
                boundary_end = self._find_boundary(text, lower_bound, hard_end)
                if boundary_end is not None:
                    end = boundary_end

            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)

            if end >= text_length:
                break

            next_start = self._find_overlap_start(text, start, end)
            start = next_start

        return chunks

    @staticmethod
    def _find_boundary(text: str, lower_bound: int, upper_bound: int) -> int | None:
        candidates = []
        for boundary in _BOUNDARIES:
            position = text.rfind(boundary, lower_bound, upper_bound)
            if position >= 0:
                candidates.append(position + len(boundary))
        return max(candidates) if candidates else None

    def _find_overlap_start(self, text: str, start: int, end: int) -> int:
        if self._chunk_overlap == 0:
            return end

        target = max(end - self._chunk_overlap, start + 1)
        earlier_boundaries: list[int] = []
        later_boundaries: list[int] = []
        for boundary in _BOUNDARIES:
            earlier_position = text.rfind(boundary, start + 1, target)
            if earlier_position >= 0:
                earlier_boundaries.append(earlier_position + len(boundary))

            later_position = text.find(boundary, target, end)
            if later_position >= 0:
                later_boundaries.append(later_position + len(boundary))

        if earlier_boundaries:
            return max(earlier_boundaries)
        if later_boundaries:
            return min(later_boundaries)
        return target
