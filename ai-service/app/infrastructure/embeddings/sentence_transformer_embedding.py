from collections.abc import Sequence
from threading import Lock
from typing import Any

from app.core.exceptions import EmbeddingGenerationError
from app.services.embedding_service import EmbeddingService


class SentenceTransformerEmbeddingService(EmbeddingService):
    """Lazy-loading Sentence Transformers adapter."""

    def __init__(self, model_name: str, device: str, batch_size: int) -> None:
        self._model_name = model_name
        self._device = device
        self._batch_size = batch_size
        self._model: Any | None = None
        self._model_lock = Lock()
        self._encode_lock = Lock()

    @property
    def model_name(self) -> str:
        return self._model_name

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []

        try:
            model = self._get_model()
            with self._encode_lock:
                embeddings = model.encode(
                    list(texts),
                    batch_size=self._batch_size,
                    show_progress_bar=False,
                    convert_to_numpy=True,
                    normalize_embeddings=True,
                )
            return embeddings.tolist()
        except EmbeddingGenerationError:
            raise
        except Exception as exception:
            raise EmbeddingGenerationError("Failed to generate document embeddings") from exception

    def _get_model(self) -> Any:
        if self._model is not None:
            return self._model

        with self._model_lock:
            if self._model is None:
                try:
                    from sentence_transformers import SentenceTransformer

                    self._model = SentenceTransformer(
                        self._model_name,
                        device=self._device,
                    )
                except Exception as exception:
                    raise EmbeddingGenerationError(
                        f"Failed to load embedding model: {self._model_name}"
                    ) from exception
        return self._model
