import json
from unittest.mock import Mock

import pytest

from app.core.exceptions import LlmTimeoutError
from app.domain.document import VectorSearchResult
from app.schemas.service_guide import NarrationRequest, RecognitionRequest
from app.services.context_builder import ContextBuilder
from app.services.result_filter import RerankResultFilter
from app.services.service_guide_service import GUIDE_PROMPT, ServiceGuideAiService


def build_service(output='{"evidenceQuotes": []}'):
    llm, retrieval = Mock(), Mock()
    llm.generate.return_value = output
    retrieval.search_with_counts.return_value = Mock(results=[], retrieval_count=0, rerank_count=0)
    return ServiceGuideAiService(llm, retrieval, RerankResultFilter(0.1, 3), ContextBuilder(6000), 10)


def request(example=False, steps=True):
    return NarrationRequest.model_validate({
        "query": "学生证丢了怎么办？", "knowledgeBaseId": "kb-test",
        "guide": {"service": {"name": "学生证补办", "code": "STUDENT_CARD_REISSUE",
            "isExample": example, "sourceDocumentId": "doc-1",
            "materials": [{"name": "申请表", "required": True}]},
            "steps": [{"order": 1, "title": "准备材料"}] if steps else []},
    })


@pytest.mark.parametrize("output", [
    '{"evidenceQuotes":[{"sourceIndex":0,"quote":"截止日期是9月30日，地点是虚构楼"}]}',
    '{"answer":"截止日期是9月30日"}', 'plain hallucinated answer', '{"evidenceQuotes":null}',
])
def test_unverified_model_facts_never_reach_answer(output):
    service = build_service(output)
    result = service.narrate(request())
    assert "9月30日" not in result.answer
    assert "暂未找到明确截止日期" in result.answer
    assert "首先应该完成“准备材料”" in result.answer
    assert result.sources == []
    assert "不得自行编造" in GUIDE_PROMPT


def test_exact_evidence_quotes_and_metadata_only_from_bound_document():
    service = build_service(json.dumps({"evidenceQuotes": [{"sourceIndex": 0, "quote": "请在申请表上填写本人姓名及学号。"}]}))
    other = VectorSearchResult(content="错误学校的信息", score=0.9, rerank_score=0.99, metadata={"document_id": "other"})
    match = VectorSearchResult(content="请在申请表上填写本人姓名及学号。", score=0.8, rerank_score=0.9, metadata={"document_id": "doc-1"})
    service.retrieval.search_with_counts.return_value = Mock(results=[other, match], retrieval_count=2, rerank_count=2)
    result = service.narrate(request())
    assert "请在申请表上填写本人姓名及学号。" in result.answer
    assert len(result.sources) == 1
    assert result.sources[0].match.metadata["document_id"] == "doc-1"
    service.retrieval.search_with_counts.assert_called_once_with("学生证丢了怎么办？", 10, "kb-test")


def test_examples_do_not_borrow_real_policy_evidence():
    service = build_service()
    result = service.narrate(request(example=True))
    service.retrieval.search_with_counts.assert_not_called()
    assert result.sources == []


def test_example_and_recognition_do_not_initialize_retrieval():
    service = build_service('{"matched":false}')
    def unavailable_factory():
        raise AssertionError("Vector store must not be initialized")
    service.retrieval = unavailable_factory
    assert service.recognize(RecognitionRequest(query="怎么办", candidates=[])) == {"matched": False, "queryIntent": "GENERAL_QA"}
    assert "准备材料" in service.narrate(request(example=True)).answer


def test_retrieval_failure_and_missing_steps_still_produce_database_guidance():
    service = build_service()
    service.retrieval.search_with_counts.side_effect = RuntimeError("offline")
    result = service.narrate(request(steps=False))
    assert "暂未维护办理步骤" in result.answer
    assert "申请表" in result.answer


def test_provider_failure_propagates_for_java_fallback():
    service = build_service()
    service.llm.generate.side_effect = LlmTimeoutError("offline")
    with pytest.raises(LlmTimeoutError):
        service.narrate(request())


@pytest.mark.parametrize("output", [
    '{"matched":true,"serviceCode":"MADE_UP","confidence":0.99}',
    '{"matched":true,"serviceCode":"STUDENT_CARD_REISSUE","confidence":0.5}',
    'not json', '{"matched":false}',
])
def test_semantic_recognition_rejects_unknown_or_uncertain_codes(output):
    service = build_service(output)
    payload = RecognitionRequest(query="我的证件找不着了怎么处理", candidates=[{"code": "STUDENT_CARD_REISSUE", "name": "学生证补办"}])
    assert service.recognize(payload) == {"matched": False, "queryIntent": "GENERAL_QA"}


def test_semantic_recognition_accepts_catalog_code_and_replaces_model_name():
    service = build_service('{"matched":true,"serviceCode":"STUDENT_CARD_REISSUE","serviceName":"假名称","confidence":0.91}')
    payload = RecognitionRequest(query="我的证件找不着了怎么处理", candidates=[{"code": "STUDENT_CARD_REISSUE", "name": "学生证补办"}])
    assert service.recognize(payload)["serviceName"] == "学生证补办"


@pytest.mark.parametrize("intent", ["GENERAL_QA", "POLICY_QA", "ELIGIBILITY_QA", "SERVICE_GUIDE"])
def test_semantic_query_intent_is_independent_of_matched_service(intent):
    service = build_service(json.dumps({"matched": True, "serviceCode": "CARD", "confidence": 0.95, "queryIntent": intent}))
    result = service.recognize(RecognitionRequest(query="学生证的问题", candidates=[{"code": "CARD", "name": "学生证补办"}]))
    assert result == {"matched": True, "serviceCode": "CARD", "serviceName": "学生证补办", "confidence": 0.95, "queryIntent": intent}
    service.retrieval.search_with_counts.assert_not_called()


@pytest.mark.parametrize("overrides", [
    {"queryIntent": "CUSTOM_GUIDE"}, {"queryIntent": None}, {"queryIntent": 1},
    {"queryIntent": "service_guide"}, {"confidence": True}, {"confidence": "0.95"},
    {"confidence": float("nan")}, {"confidence": float("inf")}, {"matched": "true"},
])
def test_invalid_structured_intent_falls_back_to_stable_qa_enum(overrides):
    output = {"matched": True, "serviceCode": "CARD", "confidence": 0.95, "queryIntent": "SERVICE_GUIDE"} | overrides
    service = build_service(json.dumps(output))
    result = service.recognize(RecognitionRequest(query="补办证件", candidates=[{"code": "CARD", "name": "学生证补办"}]))
    assert result == {"matched": False, "queryIntent": "GENERAL_QA"}


def test_model_type_cannot_authorize_guide_when_query_intent_missing():
    service = build_service('{"matched":true,"serviceCode":"CARD","confidence":0.95,"type":"SERVICE_GUIDE"}')
    result = service.recognize(RecognitionRequest(query="学生证", candidates=[{"code": "CARD", "name": "学生证补办"}]))
    assert result["matched"] is True
    assert result["queryIntent"] == "GENERAL_QA"
    assert "type" not in result


def test_recognition_provider_timeout_is_safe_qa():
    service = build_service()
    service.llm.generate.side_effect = LlmTimeoutError("offline")
    result = service.recognize(RecognitionRequest(query="学生证", candidates=[{"code": "CARD", "name": "学生证補办"}]))
    assert result == {"matched": False, "queryIntent": "GENERAL_QA"}
