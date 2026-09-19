import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.domain.document import VectorSearchResult


@dataclass(frozen=True)
class ContextSource:
    match: VectorSearchResult
    content: str


@dataclass(frozen=True)
class BuiltContext:
    text: str
    sources: list[ContextSource]


class ContextBuilder:
    """Build a bounded, ordered context and retain exactly the text sent to the LLM."""

    def __init__(self, max_chars: int) -> None:
        if max_chars < 500:
            raise ValueError("max_chars must be at least 500")
        self._max_chars = max_chars

    def build(self, matches: Sequence[VectorSearchResult]) -> BuiltContext:
        ordered = sorted(
            matches,
            key=lambda match: (
                match.final_score
                if match.final_score is not None
                else match.rerank_score
                if match.rerank_score is not None
                else float("-inf")
            ),
            reverse=True,
        )
        parts: list[str] = []
        sources: list[ContextSource] = []
        seen: set[str] = set()
        used = 0
        for match in ordered:
            content = match.content.strip()
            normalized = re.sub(r"\s+", "", content)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            document_id = str(match.metadata.get("document_id", ""))
            chunk_index = str(match.metadata.get("chunk_index", "0"))
            chunk_id = f"{document_id}:{chunk_index}"
            file_name = str(match.metadata.get("file_name", "")) or "未知文档"
            header = (
                f"[Source {len(sources) + 1}]\n"
                f"Document: {file_name}\n"
                f"Chunk ID: {chunk_id}\nContent:\n"
            )
            separator = "\n\n" if parts else ""
            available = self._max_chars - used - len(separator) - len(header)
            if available <= 0:
                break
            selected_content = content[:available]
            part = separator + header + selected_content
            parts.append(part)
            sources.append(ContextSource(match, selected_content))
            used += len(part)
            if len(selected_content) < len(content):
                break
        return BuiltContext("".join(parts), sources)
