from dataclasses import dataclass

from app.core.exceptions import InvalidRetrievalRequestError
from app.domain.document import VectorSearchResult
from app.services.embedding_service import EmbeddingService
from app.services.rerank_service import RerankService
from app.vector_store.base import VectorStore


@dataclass(frozen=True)
class RetrievalRun:
    results: list[VectorSearchResult]
    retrieval_count: int
    rerank_count: int


class RetrievalService:
    """Coordinates query embedding and provider-neutral similarity search."""

    def __init__(
        self,
        embedding_service: EmbeddingService,
        vector_store: VectorStore,
        max_top_k: int,
        rerank_service: RerankService | None = None,
        candidate_top_k: int | None = None,
    ) -> None:
        if max_top_k <= 0:
            raise ValueError("max_top_k must be greater than zero")
        if candidate_top_k is not None and candidate_top_k <= 0:
            raise ValueError("candidate_top_k must be greater than zero")
        self._embedding_service = embedding_service
        self._vector_store = vector_store
        self._max_top_k = max_top_k
        self._rerank_service = rerank_service
        self._candidate_top_k = candidate_top_k or max_top_k

    def search(
        self,
        query: str,
        top_k: int,
        knowledge_base_id: str | None = None,
    ) -> list[VectorSearchResult]:
        return self.search_with_counts(query, top_k, knowledge_base_id).results

    def search_with_counts(
        self,
        query: str,
        top_k: int,
        knowledge_base_id: str | None = None,
    ) -> RetrievalRun:
        normalized_query = query.strip()
        if not normalized_query:
            raise InvalidRetrievalRequestError("query must not be blank")
        if top_k <= 0 or top_k > self._max_top_k:
            raise InvalidRetrievalRequestError(
                f"topK must be between 1 and {self._max_top_k}"
            )

        query_embedding = self._embedding_service.embed_query(normalized_query)
        candidate_count = (
            max(top_k, self._candidate_top_k)
            if self._rerank_service is not None
            else top_k
        )
        candidates = self._vector_store.similarity_search(
            query_embedding=query_embedding,
            top_k=candidate_count,
            knowledge_base_id=(knowledge_base_id or "").strip() or None,
        )
        if self._rerank_service is None:
            return RetrievalRun(candidates, len(candidates), 0)
        results = self._rerank_service.rerank(
            query=normalized_query,
            candidates=candidates,
            top_k=top_k,
        )
        return RetrievalRun(results, len(candidates), len(results))
