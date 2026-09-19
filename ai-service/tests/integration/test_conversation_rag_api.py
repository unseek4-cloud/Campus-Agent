from fastapi.testclient import TestClient

from app.conversation.query_rewriter import QueryRewriter
from app.core.dependencies import get_rag_service
from app.core.exceptions import LlmTimeoutError
from app.domain.document import VectorSearchResult
from app.llm.base import LlmProvider
from app.llm.prompts import QUERY_REWRITE_SYSTEM_PROMPT
from app.main import app
from app.services.context_builder import ContextBuilder
from app.services.rag_service import NO_INFORMATION, RagService
from app.services.result_filter import RerankResultFilter
from app.services.retrieval_service import RetrievalRun


class ConversationLlm(LlmProvider):
    def __init__(self, rewrite_answer: str | Exception) -> None:
        self.rewrite_answer = rewrite_answer
        self.answer_prompts: list[str] = []
        self.rewrite_prompts: list[str] = []

    def generate(
        self, system_prompt: str, user_prompt: str, *, temperature: float | None = None
    ) -> str:
        if system_prompt == QUERY_REWRITE_SYSTEM_PROMPT:
            self.rewrite_prompts.append(user_prompt)
            if isinstance(self.rewrite_answer, Exception):
                raise self.rewrite_answer
            return self.rewrite_answer
        self.answer_prompts.append(user_prompt)
        if "用户问题：2026级新生心理测评什么时候？" in user_prompt:
            return "测评时间是2026年9月19日至22日。"
        return "对象是2026级新生。"


class RecordingRetrieval:
    def __init__(self, text: str | dict[str, str] | None) -> None:
        self.text = text
        self.queries: list[str] = []

    def search_with_counts(self, query: str, top_k: int, knowledge_base_id: str | None):
        self.queries.append(query)
        text = self.text.get(query) if isinstance(self.text, dict) else self.text
        if text is None:
            return RetrievalRun([], 0, 0)
        result = VectorSearchResult(
            content=text,
            score=0.8,
            rerank_score=0.9,
            final_score=0.9,
            metadata={
                "document_id": "doc-2026",
                "file_name": "心理测评通知.pdf",
                "chunk_index": 2,
            },
        )
        return RetrievalRun([result], 1, 1)


def service(retrieval: RecordingRetrieval, llm: ConversationLlm) -> RagService:
    return RagService(
        retrieval, RerankResultFilter(0.5, 3), ContextBuilder(1000), llm, 10,
        QueryRewriter(llm, 0), conversation_max_messages=2,
    )


def post(payload: dict, rag_service: RagService) -> dict:
    app.dependency_overrides[get_rag_service] = lambda: rag_service
    try:
        with TestClient(app) as client:
            response = client.post("/internal/v1/rag/chat", json=payload)
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    return response.json()["data"]


def test_first_turn_then_elliptical_object_question_uses_only_new_context() -> None:
    retrieval = RecordingRetrieval({
        "2026级新生心理测评什么时候？": "调查时间：2026年9月19日至22日。",
        "2026级新生心理测评对象是谁？": "测评对象：2026级新生。",
    })
    llm = ConversationLlm("2026级新生心理测评对象是谁？")
    rag = service(retrieval, llm)
    first = post({"query": "2026级新生心理测评什么时候？"}, rag)
    assert first["rewrittenQuery"] == "2026级新生心理测评什么时候？"
    assert first["answer"] == "测评时间是2026年9月19日至22日。"
    assert first["sources"][0]["content"] == "调查时间：2026年9月19日至22日。"
    assert llm.rewrite_prompts == []

    second = post({
        "query": "对象是谁？",
        "history": [
            {"role": "user", "content": "2026级新生心理测评什么时候？"},
            {"role": "assistant", "content": "奖学金为5000元。"},
        ],
    }, rag)
    assert retrieval.queries[-1] == "2026级新生心理测评对象是谁？"
    assert second["rewrittenQuery"] == retrieval.queries[-1]
    assert second["answer"] == "对象是2026级新生。"
    assert second["sources"][0]["content"] == "测评对象：2026级新生。"
    assert "5000" not in llm.answer_prompts[-1]
    assert "用户问题：对象是谁？" in llm.answer_prompts[-1]


def test_location_question_rewrites_before_retrieval() -> None:
    retrieval = RecordingRetrieval("测评平台：学校心理测评系统。")
    llm = ConversationLlm("2026级新生心理测评在哪里进行？")
    result = post({
        "query": "在哪里进行？",
        "history": [{"role": "user", "content": "2026级新生心理测评什么时候？"}],
    }, service(retrieval, llm))
    assert "心理测评" in result["rewrittenQuery"]
    assert "在哪里进行" in retrieval.queries[0]


def test_topic_switch_keeps_independent_question() -> None:
    for question in ["学校图书馆开放时间是什么？", "奖学金申请需要什么材料？"]:
        retrieval = RecordingRetrieval(None)
        llm = ConversationLlm(question)
        result = post({
            "query": question,
            "history": [{"role": "user", "content": "心理测评什么时候？"}],
        }, service(retrieval, llm))
        assert retrieval.queries == [question]
        assert result["rewrittenQuery"] == question


def test_unknown_topic_with_history_keeps_no_information_guard() -> None:
    retrieval = RecordingRetrieval(None)
    llm = ConversationLlm("火星校区怎么坐飞船过去？")
    result = post({
        "query": "火星校区怎么坐飞船过去？",
        "history": [{"role": "user", "content": "心理测评时间是什么时候？"}],
    }, service(retrieval, llm))
    assert result["answer"] == NO_INFORMATION
    assert result["sources"] == []
    assert llm.answer_prompts == []


def test_rewrite_timeout_falls_back_and_still_answers() -> None:
    retrieval = RecordingRetrieval("测评对象：2026级新生。")
    llm = ConversationLlm(LlmTimeoutError("timeout"))
    result = post({
        "query": "对象是谁？",
        "history": [{"role": "user", "content": "2026级新生心理测评什么时候？"}],
    }, service(retrieval, llm))
    assert retrieval.queries == ["对象是谁？"]
    assert result["rewrittenQuery"] == "对象是谁？"
    assert result["answer"] == "对象是2026级新生。"


def test_only_latest_configured_history_is_sent_to_rewriter() -> None:
    retrieval = RecordingRetrieval(None)
    llm = ConversationLlm("当前问题？")
    post({
        "query": "当前问题？",
        "history": [
            {"role": "user", "content": "应被截断的旧问题"},
            {"role": "assistant", "content": "旧回答"},
            {"role": "user", "content": "最近的问题"},
            {"role": "assistant", "content": "最近的回答"},
        ],
    }, service(retrieval, llm))
    assert "应被截断的旧问题" not in llm.rewrite_prompts[0]
    assert "旧回答" not in llm.rewrite_prompts[0]
    assert "最近的问题" in llm.rewrite_prompts[0]
