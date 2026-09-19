from fastapi.testclient import TestClient

from app.core.dependencies import get_rag_service
from app.core.exceptions import LlmConfigurationError, LlmProviderError, LlmTimeoutError
from app.domain.document import VectorSearchResult
from app.main import app
from app.services.context_builder import ContextSource
from app.services.rag_service import RagResult


class FakeRagService:
    def answer(self, query: str, knowledge_base_id: str | None = None) -> RagResult:
        assert query == "心理测评时间是什么时候？"
        assert knowledge_base_id == "kb-1"
        match = VectorSearchResult(
            content="调查时间：2026年9月20日至9月30日。",
            score=0.6,
            rerank_score=0.9,
            metadata={
                "document_id": "doc-1",
                "file_name": "心理测评通知.pdf",
                "chunk_index": 4,
                "page_number": 1,
            },
        )
        return RagResult(
            "测评时间为2026年9月20日至9月30日。",
            [ContextSource(match, match.content)],
            10,
            5,
        )


def test_rag_api_returns_answer_and_actual_source() -> None:
    app.dependency_overrides[get_rag_service] = FakeRagService
    try:
        with TestClient(app) as client:
            response = client.post(
                "/internal/v1/rag/chat",
                json={"query": "心理测评时间是什么时候？", "knowledgeBaseId": "kb-1"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["answer"] == "测评时间为2026年9月20日至9月30日。"
    assert data["retrievalCount"] == 10
    assert data["rerankCount"] == 5
    assert data["usedContextCount"] == 1
    assert data["sources"][0]["documentId"] == "doc-1"
    assert data["sources"][0]["chunkIndex"] == 4
    assert data["sources"][0]["content"] == "调查时间：2026年9月20日至9月30日。"


def test_rag_api_rejects_blank_question() -> None:
    with TestClient(app) as client:
        response = client.post("/internal/v1/rag/chat", json={"query": "   "})
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_rag_api_maps_provider_errors() -> None:
    for error, status, code in [
        (LlmConfigurationError("Qwen API key is not configured"), 503, "LLM_NOT_CONFIGURED"),
        (LlmTimeoutError("Qwen request timed out"), 504, "LLM_TIMEOUT"),
        (LlmProviderError("LLM returned empty content"), 502, "LLM_REQUEST_FAILED"),
    ]:
        class FailingRagService:
            def answer(self, query: str, knowledge_base_id: str | None = None) -> RagResult:
                raise error

        app.dependency_overrides[get_rag_service] = FailingRagService
        try:
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.post("/internal/v1/rag/chat", json={"query": "问题"})
        finally:
            app.dependency_overrides.clear()
        assert response.status_code == status
        assert response.json()["code"] == code
