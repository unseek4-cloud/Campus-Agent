from collections.abc import Sequence
from dataclasses import replace

from app.domain.document import VectorSearchResult
from app.services.rerank_service import RerankService
from app.services.temporal_evidence_service import TemporalEvidenceService


class EvidenceAwareRerankService(RerankService):
    """Combine model relevance with narrowly scoped temporal answer evidence."""

    def __init__(
        self,
        base_reranker: RerankService,
        temporal_evidence: TemporalEvidenceService,
        evidence_weight: float,
    ) -> None:
        if evidence_weight < 0:
            raise ValueError("evidence_weight must not be negative")
        self._base_reranker = base_reranker
        self._temporal_evidence = temporal_evidence
        self._evidence_weight = evidence_weight

    @property
    def model_name(self) -> str:
        return self._base_reranker.model_name

    def rerank(
        self,
        query: str,
        candidates: Sequence[VectorSearchResult],
        top_k: int,
    ) -> list[VectorSearchResult]:
        if top_k <= 0:
            raise ValueError("top_k must be greater than zero")
        if not candidates:
            return []

        model_ranked = self._base_reranker.rerank(query, candidates, len(candidates))
        assessed = [
            (candidate, self._temporal_evidence.assess(query, candidate.content))
            for candidate in model_ranked
        ]
        has_matching_evidence = any(evidence.score == 1.0 for _, evidence in assessed)
        results = [
            replace(
                candidate,
                evidence_score=evidence.score,
                evidence_text=evidence.text,
                final_score=(candidate.rerank_score or 0.0)
                + self._evidence_weight * (
                    evidence.score if has_matching_evidence else 0.0
                ),
            )
            for candidate, evidence in assessed
        ]
        results.sort(
            key=lambda candidate: (
                candidate.final_score
                if candidate.final_score is not None
                else float("-inf")
            ),
            reverse=True,
        )
        return results[:top_k]
