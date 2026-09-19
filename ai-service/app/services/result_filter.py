from collections.abc import Sequence

from app.domain.document import VectorSearchResult


class RerankResultFilter:
    """Select evidence by the model's raw score, then preserve final ranking."""

    def __init__(self, min_rerank_score: float, top_k: int, min_relative_score: float = 0.0) -> None:
        if top_k <= 0:
            raise ValueError("top_k must be greater than zero")
        if not 0 <= min_relative_score <= 1:
            raise ValueError("min_relative_score must be between 0 and 1")
        self._threshold = min_rerank_score
        self._top_k = top_k
        self._relative_threshold = min_relative_score

    def select(self, matches: Sequence[VectorSearchResult]) -> list[VectorSearchResult]:
        eligible = [
            match for match in matches
            if match.rerank_score is not None
            and match.rerank_score >= self._threshold
            and match.evidence_score != -1.0
            and match.content.strip()
        ]
        if eligible:
            best_score = max(match.rerank_score for match in eligible)
            if best_score > 0:
                eligible = [
                    match for match in eligible
                    if match.rerank_score >= best_score * self._relative_threshold
                ]
        eligible.sort(
            key=lambda match: (
                match.final_score
                if match.final_score is not None
                else match.rerank_score
            ),
            reverse=True,
        )
        return eligible[: self._top_k]
