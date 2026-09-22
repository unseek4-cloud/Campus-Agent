package com.campusagent.aiintegration.serviceguide;

import com.campusagent.affair.serviceguide.dto.*;
import com.campusagent.affair.serviceguide.service.*;
import com.campusagent.aiintegration.rag.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class QueryIntentRoutingTest {
    private ServiceGuideService catalog;
    private ServiceAiClient ai;
    private RagService rag;
    private DatabaseServiceIntentRecognizer recognizer;
    private ChatService chat;
    private List<ServiceItemDTO> items;

    @BeforeEach void setup() {
        catalog = mock(ServiceGuideService.class); ai = mock(ServiceAiClient.class); rag = mock(RagService.class);
        items = List.of(item("SCHOLARSHIP_APPLICATION", "奖学金申请", "奖学金"),
                item("STUDENT_CARD_REISSUE", "学生证补办", "学生证"),
                item("PSYCHOLOGICAL_ASSESSMENT", "心理测评", "心理测评"),
                item("DORM_REPAIR", "宿舍报修", "宿舍"));
        when(catalog.list(true)).thenReturn(items);
        for (var item : items) when(catalog.activeByCode(item.code())).thenReturn(new ServiceDetail(item,
                List.of(new ServiceStepDTO(1L, 1, "准备材料", null, null, List.of(), null, null))));
        recognizer = new DatabaseServiceIntentRecognizer(catalog, ai);
        chat = new ChatService(rag, recognizer, catalog, ai);
    }
    private static ServiceItemDTO item(String code, String name, String subject) {
        var actions = switch (code) {
            case "SCHOLARSHIP_APPLICATION" -> List.of("申请", "申报", "办理", "怎么拿", "如何拿");
            case "STUDENT_CARD_REISSUE" -> List.of("丢", "遗失", "补办", "找不到", "遗落");
            case "PSYCHOLOGICAL_ASSESSMENT" -> List.of("怎么做", "如何做", "参加", "流程", "怎么参加", "如何参加");
            case "DORM_REPAIR" -> List.of("坏", "报修", "漏水", "不亮", "维修", "不出水", "堵");
            default -> List.<String>of();
        };
        return new ServiceItemDTO(1L, code, name, "测试", null, null, null, null, null,
                List.of(), List.of(), new ServiceItemDTO.RecognitionRules(List.of(subject), actions,
                        "PSYCHOLOGICAL_ASSESSMENT".equals(code) ? List.of("咨询中心", "什么时候", "几点", "时间", "对象", "在哪里") : List.of()),
                null, null, null, null, null, "ACTIVE", false, 0, null, null);
    }

    @ParameterizedTest
    @CsvSource({
        "体测不及格可以申请奖学金吗？,ELIGIBILITY_QA,SCHOLARSHIP_APPLICATION",
        "奖学金申请条件是什么？,ELIGIBILITY_QA,SCHOLARSHIP_APPLICATION",
        "我的体测只有58分，还能评奖学金吗？,ELIGIBILITY_QA,SCHOLARSHIP_APPLICATION",
        "奖学金什么时候截止？,POLICY_QA,SCHOLARSHIP_APPLICATION",
        "补办学生证收费吗？,POLICY_QA,STUDENT_CARD_REISSUE",
        "学生证补办需要多少钱？,POLICY_QA,STUDENT_CARD_REISSUE",
        "心理测评必须参加吗？,POLICY_QA,PSYCHOLOGICAL_ASSESSMENT",
        "宿舍报修收费吗？,POLICY_QA,DORM_REPAIR",
        "我这种情况符合申请条件吗？,ELIGIBILITY_QA,",
        "奖学金对成绩有什么要求？,ELIGIBILITY_QA,SCHOLARSHIP_APPLICATION",
        "学生证补办收费吗？,POLICY_QA,STUDENT_CARD_REISSUE",
        "奖学金怎么申请？,SERVICE_GUIDE,SCHOLARSHIP_APPLICATION",
        "我要申请奖学金,SERVICE_GUIDE,SCHOLARSHIP_APPLICATION",
        "奖学金申请流程是什么？,SERVICE_GUIDE,SCHOLARSHIP_APPLICATION",
        "申请奖学金需要准备哪些材料？,SERVICE_GUIDE,SCHOLARSHIP_APPLICATION",
        "学生证丢了怎么补办？,SERVICE_GUIDE,STUDENT_CARD_REISSUE",
        "学生证补办流程是什么？,SERVICE_GUIDE,STUDENT_CARD_REISSUE",
        "宿舍灯坏了怎么报修？,SERVICE_GUIDE,DORM_REPAIR",
        "心理测评怎么操作？,SERVICE_GUIDE,PSYCHOLOGICAL_ASSESSMENT",
        "心理测评在哪里做？,SERVICE_GUIDE,PSYCHOLOGICAL_ASSESSMENT",
        "告诉我奖学金申请的具体步骤,SERVICE_GUIDE,SCHOLARSHIP_APPLICATION",
        "学生证怎么补办？,SERVICE_GUIDE,STUDENT_CARD_REISSUE",
        "奖学金去哪里办理？,SERVICE_GUIDE,SCHOLARSHIP_APPLICATION",
        "奖学金是否可以申请？,ELIGIBILITY_QA,SCHOLARSHIP_APPLICATION",
        "奖学金能不能办理？,ELIGIBILITY_QA,SCHOLARSHIP_APPLICATION",
        "奖学金政策规定是什么？,POLICY_QA,SCHOLARSHIP_APPLICATION",
        "奖学金怎么申请、体测58分符合条件吗？,ELIGIBILITY_QA,SCHOLARSHIP_APPLICATION",
        "学生证补办费用怎么算？,POLICY_QA,STUDENT_CARD_REISSUE",
        "可以告诉我奖学金怎么申请吗？,SERVICE_GUIDE,SCHOLARSHIP_APPLICATION",
        "这部分奖学金怎么申请？,SERVICE_GUIDE,SCHOLARSHIP_APPLICATION",
        "我想参加心理测评,SERVICE_GUIDE,PSYCHOLOGICAL_ASSESSMENT",
        "心理测评在哪里？,POLICY_QA,PSYCHOLOGICAL_ASSESSMENT",
        "心理测评的对象是谁？,POLICY_QA,PSYCHOLOGICAL_ASSESSMENT",
        "心理测评什么时候？,POLICY_QA,PSYCHOLOGICAL_ASSESSMENT",
        "心理测评咨询中心在哪里？,POLICY_QA,"
    })
    void routesByQueryIntentWhileRetainingTopicAndRag(String question, QueryIntent expected, String code) {
        var request = new RagChatRequest(question, "school-kb", List.of(new ConversationMessage("user", "咨询学校规定")));
        String evidence = "评选学年体质健康测试成绩低于60分，不得参加评奖评优。";
        var original = new RagChatResponse(evidence, List.of(), 10, 5, 1, question);
        when(rag.chat(request)).thenReturn(original);
        var result = chat.chat(request);
        assertEquals(expected, result.queryIntent());
        if (expected == QueryIntent.SERVICE_GUIDE) {
            assertEquals("SERVICE_GUIDE", result.type()); assertEquals(code, result.service().code());
            assertFalse(result.steps().isEmpty()); verifyNoInteractions(rag);
        } else {
            assertEquals("QA", result.type()); assertEquals(evidence, result.answer());
            assertEquals(10, result.retrievalCount()); assertEquals(5, result.rerankCount());
            assertEquals(1, result.usedContextCount()); assertEquals(question, result.rewrittenQuery());
            assertNull(result.service()); assertTrue(result.steps().isEmpty()); assertNull(result.currentStep());
            if (code != null) assertEquals(code, result.relatedService().code());
            else assertNull(result.relatedService());
            verify(rag).chat(request); verify(catalog, never()).activeByCode(anyString());
            verify(ai, never()).narrate(anyString(), any(), any());
        }
    }

    @Test void semanticFallbackUnderstandsParaphraseAndValidatesCatalogName() {
        when(ai.match(anyString(), anyList())).thenReturn(new ServiceRecognitionResponse(true,
                "SCHOLARSHIP_APPLICATION", "模型假名称", 0.95, QueryIntent.SERVICE_GUIDE));
        var result = recognizer.recognize("请带着我把奖学金的申报手续一步一步走完");
        assertEquals(QueryIntent.SERVICE_GUIDE, result.queryIntent());
        assertEquals("奖学金申请", result.serviceName());
        verify(ai).match(anyString(), anyList());
    }

    @Test void policyRuleOverridesSemanticWorkflowGuessForIndirectTopic() {
        when(ai.match(anyString(), anyList())).thenReturn(new ServiceRecognitionResponse(true,
                "STUDENT_CARD_REISSUE", "学生证补办", 0.95, QueryIntent.SERVICE_GUIDE));
        assertEquals(QueryIntent.POLICY_QA, recognizer.recognize("校园身份证件补办收费吗").queryIntent());
    }

    @Test void unknownIntentOrUnavailableAiCannotTurnKnownTopicIntoGuide() throws Exception {
        var mapper = new ObjectMapper();
        var missing = mapper.readValue("{\"matched\":true,\"serviceCode\":\"SCHOLARSHIP_APPLICATION\",\"confidence\":0.95}", ServiceRecognitionResponse.class);
        when(ai.match(anyString(), anyList())).thenReturn(missing);
        assertEquals(QueryIntent.GENERAL_QA, recognizer.recognize("聊聊奖学金").queryIntent());
        assertThrows(Exception.class, () -> mapper.readValue("{\"matched\":true,\"queryIntent\":\"CUSTOM_GUIDE\"}", ServiceRecognitionResponse.class));
        when(ai.match(anyString(), anyList())).thenThrow(new IllegalStateException("offline"));
        var result = recognizer.recognize("聊聊奖学金");
        assertTrue(result.matched()); assertEquals(QueryIntent.GENERAL_QA, result.queryIntent());
    }

    @Test void explicitPolicyAndNegationCannotBeOverriddenByModel() {
        when(ai.match(anyString(), anyList())).thenReturn(new ServiceRecognitionResponse(true,
                "SCHOLARSHIP_APPLICATION", "奖学金申请", 0.95, QueryIntent.SERVICE_GUIDE));
        assertEquals(QueryIntent.ELIGIBILITY_QA, recognizer.recognize("体测不及格可以申请奖学金吗").queryIntent());
        verifyNoInteractions(ai);
        assertEquals(QueryIntent.GENERAL_QA, recognizer.recognize("我不需要奖学金申请流程").queryIntent());
    }

    @Test void broadTopicDoesNotTurnAnUnrelatedProcedureIntoTheCatalogWorkflow() {
        when(ai.match(anyString(), anyList())).thenReturn(ServiceRecognitionResponse.unmatched());
        var result = recognizer.recognize("宿舍怎么申请入住？");
        assertFalse(result.matched());
        verify(ai).match(anyString(), anyList());
        when(ai.match(anyString(), anyList())).thenThrow(new IllegalStateException("offline"));
        assertFalse(recognizer.recognize("宿舍怎么申请入住？").matched());
    }

    @Test void semanticQaForUncertainServiceIsNotOverriddenByGenericGuideWords() {
        when(ai.match(anyString(), anyList())).thenReturn(new ServiceRecognitionResponse(true,
                "DORM_REPAIR", "宿舍报修", 0.95, QueryIntent.GENERAL_QA));
        assertEquals(QueryIntent.GENERAL_QA, recognizer.recognize("宿舍怎么申请入住？").queryIntent());
    }
}
