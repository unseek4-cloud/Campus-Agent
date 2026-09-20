from collections.abc import Sequence
from pathlib import Path

import chromadb

from app.core.exceptions import VectorStoreOperationError
from app.domain.document import VectorRecord, VectorSearchResult
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

    def delete_document(self, document_id: str) -> int:
        try:
            existing = self._collection.get(
                where={"document_id": document_id},
                include=[],
            )
            deleted_count = len(existing["ids"])
            if deleted_count:
                self._collection.delete(where={"document_id": document_id})
            return deleted_count
        except Exception as exception:
            raise VectorStoreOperationError("Failed to delete document vectors") from exception

    def rename_document(self, document_id: str, file_name: str) -> int:
        try:
            existing = self._collection.get(where={"document_id": document_id}, include=["metadatas"])
            ids = existing["ids"]
            metadata = [{**item, "file_name": file_name, "source": file_name} for item in existing["metadatas"]]
            for start in range(0, len(ids), self._batch_size):
                self._collection.update(ids=ids[start:start+self._batch_size], metadatas=metadata[start:start+self._batch_size])
            return len(ids)
        except Exception as exception:
            raise VectorStoreOperationError("Failed to rename document vectors") from exception

    def similarity_search(
        self,
        query_embedding: Sequence[float],
        top_k: int,
        knowledge_base_id: str | None = None,
    ) -> list[VectorSearchResult]:
        if not query_embedding:
            return []
        if top_k <= 0:
            raise ValueError("top_k must be greater than zero")

        try:
            if self._collection.count() == 0:
                return []

            where = (
                {"knowledge_base_id": knowledge_base_id}
                if knowledge_base_id
                else None
            )
            result = self._collection.query(
                query_embeddings=[list(query_embedding)],
                n_results=top_k,
                where=where,
                include=["documents", "metadatas", "distances"],
            )
            documents = result.get("documents") or [[]]
            metadatas = result.get("metadatas") or [[]]
            distances = result.get("distances") or [[]]

            matches: list[VectorSearchResult] = []
            for document, metadata, distance in zip(
                documents[0], metadatas[0], distances[0], strict=True
            ):
                matches.append(
                    VectorSearchResult(
                        content=document or "",
                        score=1.0 - float(distance),
                        metadata=dict(metadata or {}),
                    )
                )
            return matches
        except Exception as exception:
            raise VectorStoreOperationError("Failed to search document vectors") from exception
