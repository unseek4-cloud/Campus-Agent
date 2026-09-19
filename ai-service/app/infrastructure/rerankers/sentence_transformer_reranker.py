from collections.abc import Sequence
from dataclasses import replace
from threading import Lock
from typing import Any

from app.core.exceptions import RerankError
from app.domain.document import VectorSearchResult
from app.services.rerank_service import RerankService


class SentenceTransformerRerankService(RerankService):
    """Lazy-loading Sentence Transformers CrossEncoder adapter."""

    def __init__(
        self,
        model_name: str,
        device: str,
        batch_size: int,
        max_length: int,
    ) -> None:
        if batch_size <= 0:
            raise ValueError("batch_size must be greater than zero")
        if max_length <= 0:
            raise ValueError("max_length must be greater than zero")

        self._model_name = model_name
        self._device = device
        self._batch_size = batch_size
        self._max_length = max_length
        self._model: Any | None = None
        self._model_lock = Lock()
        self._predict_lock = Lock()

    @property
    def model_name(self) -> str:
        return self._model_name

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

        try:
            model = self._get_model()
            pairs = [(query, candidate.content) for candidate in candidates]
            with self._predict_lock:
                scores = model.predict(
                    pairs,
                    batch_size=self._batch_size,
                    show_progress_bar=False,
                    convert_to_numpy=True,
                )

            score_values = [float(score) for score in scores]
            if len(score_values) != len(candidates):
                raise RerankError("Reranker returned an unexpected number of scores")

            reranked = [
                replace(candidate, rerank_score=rerank_score)
                for candidate, rerank_score in zip(
                    candidates, score_values, strict=True
                )
            ]
            reranked.sort(
                key=lambda candidate: (
                    candidate.rerank_score
                    if candidate.rerank_score is not None
                    else float("-inf")
                ),
                reverse=True,
            )
            return reranked[:top_k]
        except RerankError:
            raise
        except Exception as exception:
            raise RerankError("Failed to rerank retrieval candidates") from exception

    def _get_model(self) -> Any:
        if self._model is not None:
            return self._model

        with self._model_lock:
            if self._model is None:
                try:
                    from sentence_transformers import CrossEncoder

                    self._model = CrossEncoder(
                        self._model_name,
                        device=self._device,
                        max_length=self._max_length,
                    )
                except Exception as exception:
                    raise RerankError(
                        f"Failed to load rerank model: {self._model_name}"
                    ) from exception
        return self._model
