from collections.abc import Sequence
from pathlib import Path

import chromadb

from app.core.exceptions import VectorStoreOperationError
from app.domain.document import VectorRecord
from app.vector_store.base import VectorStore


class ChromaVectorStore(VectorStore):
    """Local persistent Chroma adapter with externally generated embeddings."""

    def __init__(self, path: Path, collection_name: str, batch_size: int) -> None:
        if batch_size <= 0:
            raise ValueError("batch_size must be greater than zero")

        try:
            path.mkdir(parents=True, exist_ok=True)
            self._client = chromadb.PersistentClient(path=str(path))
            self._collection = self._client.get_or_create_collection(
                name=collection_name,
                embedding_function=None,
                configuration={"hnsw": {"space": "cosine"}},
            )
        except Exception as exception:
            raise VectorStoreOperationError("Failed to initialize Chroma") from exception
        self._batch_size = batch_size

    def replace_document(
        self, document_id: str, records: Sequence[VectorRecord]
    ) -> None:
        try:
            self._collection.delete(where={"document_id": document_id})
            for start in range(0, len(records), self._batch_size):
                batch = records[start : start + self._batch_size]
                self._collection.upsert(
                    ids=[record.record_id for record in batch],
                    embeddings=[record.embedding for record in batch],
                    documents=[record.document for record in batch],
                    metadatas=[record.metadata for record in batch],
                )
        except Exception as exception:
            raise VectorStoreOperationError("Failed to persist document vectors") from exception
