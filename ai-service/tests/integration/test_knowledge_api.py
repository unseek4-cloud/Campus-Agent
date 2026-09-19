from fastapi.testclient import TestClient

from app.core.dependencies import get_retrieval_service
from app.domain.document import VectorSearchResult
from app.main import app


class SuccessfulRetrievalService:
    def search(
        self, query: str, top_k: int, knowledge_base_id: str | None = None
    ) -> list[VectorSearchResult]:
        assert top_k == 3
        assert knowledge_base_id == "kb-1"
        return [
            VectorSearchResult(
                content="国家奖学金申请人应当学习成绩优异。",
                score=0.89,
                rerank_score=0.96,
                evidence_score=1.0,
                evidence_text="调查时间\n2026年9月19日—22日。",
                final_score=1.31,
                metadata={
                    "document_id": "doc-1",
                    "knowledge_base_id": "kb-1",
                    "file_name": "学生手册.pdf",
                    "file_type": "pdf",
                    "page_number": 12,
                    "chunk_index": 18,
                    "source": "学生手册.pdf",
                },
            )
        ]


def test_search_knowledge_returns_ranked_chunks() -> None:
    app.dependency_overrides[get_retrieval_service] = SuccessfulRetrievalService
    try:
        with TestClient(app) as client:
            response = client.post(
                "/internal/v1/knowledge/search",
                json={
                    "query": "国家奖学金条件？",
                    "topK": 3,
                    "knowledgeBaseId": "kb-1",
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["results"][0] == {
        "rank": 1,
        "content": "国家奖学金申请人应当学习成绩优异。",
        "score": 0.89,
        "rerankScore": 0.96,
        "evidenceScore": 1.0,
        "evidenceText": "调查时间\n2026年9月19日—22日。",
        "finalScore": 1.31,
        "documentId": "doc-1",
        "knowledgeBaseId": "kb-1",
        "fileName": "学生手册.pdf",
        "fileType": "pdf",
        "pageNumber": 12,
        "chunkIndex": 18,
        "source": "学生手册.pdf",
    }


def test_search_knowledge_rejects_blank_query() -> None:
    app.dependency_overrides[get_retrieval_service] = SuccessfulRetrievalService
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post(
                "/internal/v1/knowledge/search",
                json={"query": "   ", "topK": 5},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
