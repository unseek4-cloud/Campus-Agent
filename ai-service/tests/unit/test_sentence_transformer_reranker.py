from collections.abc import Sequence
from typing import Any

from app.domain.document import VectorSearchResult
from app.infrastructure.rerankers.sentence_transformer_reranker import (
    SentenceTransformerRerankService,
)


class FakeCrossEncoder:
    def __init__(self) -> None:
        self.pairs: list[tuple[str, str]] = []
        self.options: dict[str, Any] = {}

    def predict(
        self,
        pairs: Sequence[tuple[str, str]],
        **options: Any,
    ) -> list[float]:
        self.pairs = list(pairs)
        self.options = options
        return [0.1, 0.9]


def test_cross_encoder_reranker_preserves_cosine_score_and_adds_rerank_score(
    monkeypatch: Any,
) -> None:
    model = FakeCrossEncoder()
    service = SentenceTransformerRerankService(
        model_name="fake-reranker",
        device="cpu",
        batch_size=4,
        max_length=256,
    )
    monkeypatch.setattr(service, "_get_model", lambda: model)
    candidates = [
        VectorSearchResult("page 4", 0.6508, {"page_number": 4}),
        VectorSearchResult("page 1 answer", 0.4939, {"page_number": 1}),
    ]

    results = service.rerank("query", candidates, top_k=2)

    assert model.pairs == [("query", "page 4"), ("query", "page 1 answer")]
    assert model.options["batch_size"] == 4
    assert results[0].metadata["page_number"] == 1
    assert results[0].score == 0.4939
    assert results[0].rerank_score == 0.9
    assert candidates[1].rerank_score is None
