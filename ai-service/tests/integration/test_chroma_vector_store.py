from pathlib import Path

import chromadb

from app.domain.document import VectorRecord
from app.vector_store.chroma_store import ChromaVectorStore


def record(record_id: str, document_id: str, value: float) -> VectorRecord:
    return VectorRecord(
        record_id=record_id,
        document=f"document-{record_id}",
        embedding=[value, 1.0 - value, 0.5],
        metadata={
            "document_id": document_id,
            "knowledge_base_id": "kb-1",
            "page_number": 1,
            "chunk_index": 0,
        },
    )


def test_chroma_store_replaces_all_records_for_document(tmp_path: Path) -> None:
    collection_name = "test_documents"
    store = ChromaVectorStore(tmp_path, collection_name, batch_size=1)
    store.replace_document(
        "doc-1",
        [record("record-1", "doc-1", 0.1), record("record-2", "doc-1", 0.2)],
    )
    store.replace_document("doc-1", [record("record-3", "doc-1", 0.3)])

    client = chromadb.PersistentClient(path=str(tmp_path))
    collection = client.get_collection(collection_name, embedding_function=None)
    result = collection.get(where={"document_id": "doc-1"})

    assert result["ids"] == ["record-3"]


def test_chroma_store_searches_filters_and_deletes_vectors(tmp_path: Path) -> None:
    store = ChromaVectorStore(tmp_path, "search_documents", batch_size=10)
    store.replace_document(
        "doc-1",
        [
            record("nearest", "doc-1", 1.0),
            record("farther", "doc-1", 0.0),
        ],
    )

    results = store.similarity_search([1.0, 0.0, 0.5], top_k=2, knowledge_base_id="kb-1")

    assert [result.content for result in results] == [
        "document-nearest",
        "document-farther",
    ]
    assert results[0].score > results[1].score
    assert store.delete_document("doc-1") == 2
    assert store.similarity_search([1.0, 0.0, 0.5], top_k=2) == []
