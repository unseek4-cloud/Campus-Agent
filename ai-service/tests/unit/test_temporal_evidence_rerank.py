from collections.abc import Sequence
from dataclasses import replace

from app.domain.document import VectorSearchResult
from app.services.evidence_aware_rerank_service import EvidenceAwareRerankService
from app.services.rerank_service import RerankService
from app.services.temporal_evidence_service import TemporalEvidenceService


PAGE_1 = (
    "关于开展我校2026年秋季新生心理健康状况调查的通知\n"
    "一、调查时间\n2026年9月19日—22日。\n二、调查地点\n各班级指定地点。"
)
PAGE_4 = (
    "心理测评系统\n待完成测评 UNFINISH\n"
    "·2025-2026学年秋季新生心理普查\n"
    "测评截止时间:2025-09-2000:00\n当前完成进度:0/3"
)


class ScreenshotScoresReranker(RerankService):
    @property
    def model_name(self) -> str:
        return "fake-screenshot-scores"

    def rerank(
        self,
        query: str,
        candidates: Sequence[VectorSearchResult],
        top_k: int,
    ) -> list[VectorSearchResult]:
        scores = {1: 0.7956, 4: 0.8891}
        scored = [
            replace(candidate, rerank_score=scores[candidate.metadata["page_number"]])
            for candidate in candidates
        ]
        return sorted(scored, key=lambda candidate: candidate.rerank_score or 0, reverse=True)[:top_k]


def _candidates() -> list[VectorSearchResult]:
    return [
        VectorSearchResult(PAGE_4, 0.7083, {"page_number": 4}),
        VectorSearchResult(PAGE_1, 0.5793, {"page_number": 1}),
    ]


def _service() -> EvidenceAwareRerankService:
    return EvidenceAwareRerankService(
        ScreenshotScoresReranker(), TemporalEvidenceService(), evidence_weight=0.35
    )


def test_assessment_time_uses_official_schedule_not_screenshot_deadline() -> None:
    results = _service().rerank("心理测评调查时间?", _candidates(), 2)

    assert [result.metadata["page_number"] for result in results] == [1, 4]
    assert results[0].rerank_score == 0.7956
    assert results[0].score == 0.5793
    assert results[0].evidence_score == 1.0
    assert results[0].evidence_text == "一、调查时间\n2026年9月19日—22日。"
    assert results[0].final_score > results[1].final_score
    assert results[1].evidence_score == -1.0


def test_general_assessment_time_prefers_schedule() -> None:
    results = _service().rerank("心理测评的时间是什么时候？", _candidates(), 2)

    assert results[0].metadata["page_number"] == 1
    assert "2026年9月19日—22日" in results[0].evidence_text


def test_explicit_deadline_query_still_prefers_deadline() -> None:
    results = _service().rerank("心理测评截止时间是什么时候？", _candidates(), 2)

    assert results[0].metadata["page_number"] == 4
    assert results[0].evidence_score == 1.0
    assert "测评截止时间:2025-09-2000:00" in results[0].evidence_text
    assert results[1].evidence_score == -1.0


def test_unrelated_query_keeps_model_order() -> None:
    results = _service().rerank("如何登录心理测评系统？", _candidates(), 2)

    assert [result.metadata["page_number"] for result in results] == [4, 1]
    assert all(result.evidence_score == 0.0 for result in results)
    assert all(result.evidence_text is None for result in results)


def test_no_matching_time_role_does_not_change_model_order() -> None:
    result = _service().rerank("心理测评调查时间?", _candidates()[:1], 1)[0]

    assert result.metadata["page_number"] == 4
    assert result.evidence_score == -1.0
    assert result.final_score == result.rerank_score
