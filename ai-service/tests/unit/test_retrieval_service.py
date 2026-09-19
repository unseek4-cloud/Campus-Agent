from collections.abc import Sequence
from dataclasses import replace

import pytest

from app.core.exceptions import InvalidRetrievalRequestError
from app.domain.document import VectorRecord, VectorSearchResult
from app.services.embedding_service import EmbeddingService
from app.services.rerank_service import RerankService
from app.services.retrieval_service import RetrievalService
from app.vector_store.base import VectorStore


class RecordingEmbeddingService(EmbeddingService):
    def __init__(self) -> None:
        self.texts: list[str] = []

    @property
    def model_name(self) -> str:
        return "fake"

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        self.texts.extend(texts)
        return [[0.2, 0.8] for _ in texts]


class RecordingVectorStore(VectorStore):
    def __init__(self) -> None:
        self.query: tuple[list[float], int, str | None] | None = None

    def replace_document(
        self, document_id: str, records: Sequence[VectorRecord]
    ) -> None:
        pass

    def delete_document(self, document_id: str) -> int:
        return 0

    def similarity_search(
        self,
        query_embedding: Sequence[float],
        top_k: int,
        knowledge_base_id: str | None = None,
    ) -> list[VectorSearchResult]:
        self.query = (list(query_embedding), top_k, knowledge_base_id)
        return [
            VectorSearchResult(
                content="奖学金申请条件",
                score=0.91,
                metadata={"document_id": "doc-1"},
            )
        ]


class PsychologicalAssessmentVectorStore(RecordingVectorStore):
    def similarity_search(
        self,
        query_embedding: Sequence[float],
        top_k: int,
        knowledge_base_id: str | None = None,
    ) -> list[VectorSearchResult]:
        self.query = (list(query_embedding), top_k, knowledge_base_id)
        return [
            VectorSearchResult(
                content="心理测评 待完成测评 截止时间 查看详情",
                score=0.6508,
                metadata={"page_number": 4},
            ),
            VectorSearchResult(
                content="心理健康教育中心组织心理测评，请同学按要求完成。",
                score=0.6041,
                metadata={"page_number": 3},
            ),
            VectorSearchResult(
                content="一、调查时间\n2026年9月19日—22日。",
                score=0.4939,
                metadata={"page_number": 1},
            ),
        ]


class PsychologicalAssessmentRerankService(RerankService):
    def __init__(self) -> None:
        self.call: tuple[str, int, int] | None = None

    @property
    def model_name(self) -> str:
        return "fake-chinese-reranker"

    def rerank(
        self,
        query: str,
        candidates: Sequence[VectorSearchResult],
        top_k: int,
    ) -> list[VectorSearchResult]:
        self.call = (query, len(candidates), top_k)
        scores = {1: 0.98, 3: 0.42, 4: 0.16}
        reranked = [
            replace(
                candidate,
                rerank_score=scores[int(candidate.metadata["page_number"])],
            )
            for candidate in candidates
        ]
        return sorted(
            reranked,
            key=lambda candidate: candidate.rerank_score or float("-inf"),
            reverse=True,
        )[:top_k]


def test_retrieval_service_embeds_query_and_delegates_search() -> None:
    embedding = RecordingEmbeddingService()
    store = RecordingVectorStore()
    service = RetrievalService(embedding, store, max_top_k=10)

    results = service.search("  国家奖学金条件  ", 5, " kb-1 ")

    assert embedding.texts == ["国家奖学金条件"]
    assert store.query == ([0.2, 0.8], 5, "kb-1")
    assert results[0].score == 0.91


def test_retrieval_service_reranks_psychological_assessment_time_to_top_one() -> None:
    store = PsychologicalAssessmentVectorStore()
    reranker = PsychologicalAssessmentRerankService()
    service = RetrievalService(
        RecordingEmbeddingService(),
        store,
        max_top_k=20,
        rerank_service=reranker,
        candidate_top_k=10,
    )

    results = service.search("心理测评的时间是什么时候？", 5)

    assert store.query == ([0.2, 0.8], 10, None)
    assert reranker.call == ("心理测评的时间是什么时候？", 3, 5)
    assert results[0].metadata["page_number"] == 1
    assert "2026年9月19日—22日" in results[0].content
    assert results[0].score == 0.4939
    assert results[0].rerank_score == 0.98


@pytest.mark.parametrize("top_k", [0, 11])
def test_retrieval_service_validates_top_k(top_k: int) -> None:
    service = RetrievalService(
        RecordingEmbeddingService(), RecordingVectorStore(), max_top_k=10
    )

    with pytest.raises(InvalidRetrievalRequestError):
        service.search("query", top_k)
