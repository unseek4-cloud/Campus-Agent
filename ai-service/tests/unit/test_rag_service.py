from dataclasses import replace

import pytest

from app.domain.document import VectorSearchResult
from app.llm.base import LlmProvider
from app.services.context_builder import ContextBuilder
from app.services.rag_service import NO_INFORMATION, RagService
from app.services.result_filter import RerankResultFilter
from app.services.retrieval_service import RetrievalRun


def match(content: str, score: float, index: int, evidence: float = 0.0) -> VectorSearchResult:
    return VectorSearchResult(
        content=content,
        score=0.6,
        rerank_score=score,
        evidence_score=evidence,
        final_score=score,
        metadata={
            "document_id": "doc-2026",
            "file_name": "关于2026级新生心理测评的通知.pdf",
            "chunk_index": index,
            "page_number": 1,
        },
    )


class FakeRetrieval:
    def __init__(self, matches: list[VectorSearchResult]) -> None:
        self.matches = matches

    def search_with_counts(self, query: str, top_k: int, knowledge_base_id: str | None):
        assert top_k == 10
        return RetrievalRun(self.matches, 10, len(self.matches))


class ScriptedLlm(LlmProvider):
    def __init__(self, answer: str) -> None:
        self.answer = answer
        self.calls: list[tuple[str, str]] = []

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        self.calls.append((system_prompt, user_prompt))
        return self.answer


def service(matches: list[VectorSearchResult], llm: ScriptedLlm) -> RagService:
    return RagService(
        FakeRetrieval(matches), RerankResultFilter(0.5, 3), ContextBuilder(1000), llm, 10
    )


@pytest.mark.parametrize(
    ("query", "evidence", "expected", "unrelated"),
    [
        ("2026级新生心理测评时间是什么时候？", "测评时间：2026年9月20日至9月30日。", "2026级新生心理测评时间为2026年9月20日至9月30日。", "测评对象"),
        ("心理测评对象是谁？", "测评对象：2026级新生。", "心理测评对象是2026级新生。", "测评时间"),
        ("心理测评在哪里进行？", "测评平台：学校心理测评系统。", "心理测评在学校心理测评系统进行。", "联系电话"),
    ],
)
def test_rag_uses_relevant_context_and_cites_only_used_chunk(
    query: str, evidence: str, expected: str, unrelated: str
) -> None:
    llm = ScriptedLlm(expected)
    matches = [match(evidence, 0.9, 1), match(unrelated + "：不应参与回答。", 0.2, 2)]
    result = service(matches, llm).answer(query)

    assert result.answer == expected
    assert len(result.sources) == 1
    assert result.sources[0].match.metadata["chunk_index"] == 1
    assert result.sources[0].content == evidence
    assert result.retrieval_count == 10
    assert result.rerank_count == 2
    assert unrelated not in llm.calls[0][1]
    assert "只回答" in llm.calls[0][0]


def test_missing_knowledge_never_calls_llm() -> None:
    llm = ScriptedLlm("臆造的答案")
    result = service([match("其他通知", -4.0, 2)], llm).answer("火星基地在哪里？")

    assert result.answer == NO_INFORMATION
    assert result.sources == []
    assert llm.calls == []


def test_empty_retrieval_never_calls_llm() -> None:
    llm = ScriptedLlm("臆造的答案")
    result = service([], llm).answer("知识库没有的问题")

    assert result.answer == NO_INFORMATION
    assert result.sources == []
    assert result.rerank_count == 0
    assert llm.calls == []


def test_filter_excludes_temporal_conflict_and_context_deduplicates() -> None:
    relevant = match("调查时间：2026年9月20日至9月30日。", 0.8, 1)
    duplicate = replace(relevant, metadata={**relevant.metadata, "chunk_index": 2})
    conflict = match("截图示例的截止时间：2025年9月20日。", 0.95, 3, -1.0)
    llm = ScriptedLlm("2026年9月20日至9月30日。")

    result = service([conflict, relevant, duplicate], llm).answer("调查时间是什么时候？")

    assert result.answer == "2026年9月20日至9月30日。"
    assert len(result.sources) == 1
    assert "2025年" not in llm.calls[0][1]


def test_relative_filter_discards_weak_result_but_keeps_lower_scoring_answer() -> None:
    selected = RerankResultFilter(0.015, 3, 0.4).select([
        match("正确时间", 0.994, 1),
        match("无关事项", 0.065, 2),
    ])
    assert [item.content for item in selected] == ["正确时间"]

    selected = RerankResultFilter(0.015, 3, 0.4).select([
        match("界面截图", 0.042, 1),
        match("测评对象：2026级新生", 0.018, 2),
    ])
    assert len(selected) == 2


def test_context_builder_caps_text_and_source_to_same_content() -> None:
    long_match = match("长" * 800, 0.9, 1)
    context = ContextBuilder(500).build([long_match])

    assert len(context.text) == 500
    assert context.sources[0].content in context.text
    assert context.sources[0].content != long_match.content
