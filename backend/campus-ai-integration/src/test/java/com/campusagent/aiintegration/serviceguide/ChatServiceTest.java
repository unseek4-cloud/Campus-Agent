package com.campusagent.aiintegration.serviceguide;

import com.campusagent.affair.serviceguide.dto.*;
import com.campusagent.affair.serviceguide.service.*;
import com.campusagent.aiintegration.rag.*;
import com.campusagent.shared.error.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.RestClient;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ChatServiceTest {
    private RagService rag;
    private ServiceIntentRecognizer recognizer;
    private ServiceGuideService guides;
    private ServiceAiClient ai;
    private ChatService chat;
    private ServiceDetail guide;

    @BeforeEach void setup() {
        rag = mock(RagService.class); recognizer = mock(ServiceIntentRecognizer.class);
        guides = mock(ServiceGuideService.class); ai = mock(ServiceAiClient.class);
        chat = new ChatService(rag, recognizer, guides, ai);
        var item = new ServiceItemDTO(1L, "CARD", "学生证补办", "学籍事务", null, "示例部门", null, null, null,
                List.of(), List.of(new ServiceItemDTO.Material("申请表", null, true)),
                new ServiceItemDTO.RecognitionRules(List.of("学生证"), List.of("丢"), List.of()),
                null, null, "测试数据", null, null, "ACTIVE", true, 0, null, null);
        guide = new ServiceDetail(item, List.of(new ServiceStepDTO(1L, 1, "准备材料", null, null, List.of(), null, null)));
        when(recognizer.recognize(anyString())).thenReturn(new ServiceRecognitionResponse(true, "CARD", "学生证补办", 0.93, QueryIntent.SERVICE_GUIDE));
        when(guides.activeByCode("CARD")).thenReturn(guide);
    }
    @Test void offlineAiStillReturnsCompleteStructuredWorkflow() {
        // Real HTTP client pointed at a closed port, not only a mocked exception.
        var offline = new ServiceAiClient(RestClient.builder(), "http://127.0.0.1:1", 1);
        var result = new ChatService(rag, recognizer, guides, offline).chat(new RagChatRequest("学生证丢了怎么办", null));
        assertEquals("SERVICE_GUIDE", result.type());
        assertEquals("学生证补办", result.service().name());
        assertEquals(1, result.steps().size()); assertEquals(1, result.currentStep());
        assertTrue(result.answer().contains("首先应该完成“准备材料”"));
        assertTrue(result.answer().contains("暂未找到明确截止日期"));
        assertTrue(result.answer().contains("测试数据")); assertFalse(result.aiEnhanced());
        assertNull(result.source().documentId()); verifyNoInteractions(rag);
    }
    @Test void noStepsAndNoSourceAreAllowed() {
        when(guides.activeByCode("CARD")).thenReturn(new ServiceDetail(guide.service(), List.of()));
        when(ai.narrate(anyString(), isNull(), any())).thenThrow(new IllegalStateException());
        var result = chat.chat(new RagChatRequest("学生证丢了", null));
        assertEquals(0, result.currentStep()); assertTrue(result.steps().isEmpty());
        assertTrue(result.answer().contains("暂未维护办理步骤"));
    }
    @Test void deletedAfterRecognitionHasFriendlyResponse() {
        when(guides.activeByCode("CARD")).thenThrow(new BusinessException("SERVICE_NOT_FOUND", "暂未找到该办事事项", HttpStatus.NOT_FOUND));
        var result = chat.chat(new RagChatRequest("学生证丢了", null));
        assertEquals("SERVICE_GUIDE", result.type()); assertNull(result.service());
        assertTrue(result.answer().contains("暂未找到")); verifyNoInteractions(ai, rag);
    }
    @Test void unmatchedPreservesOriginalRagAndHistory() {
        when(recognizer.recognize(anyString())).thenReturn(ServiceRecognitionResponse.unmatched());
        var request = new RagChatRequest("学校食堂几点开门？", "kb", List.of(new ConversationMessage("user", "食堂")));
        when(rag.chat(request)).thenReturn(new RagChatResponse("原 RAG 回答", List.of(), 10, 5, 0, request.query()));
        var result = chat.chat(request);
        assertEquals("QA", result.type()); assertEquals("原 RAG 回答", result.answer());
        verify(rag).chat(request); verifyNoInteractions(guides, ai);
    }
    @Test void validationRunsBeforeRouting() {
        assertThrows(IllegalArgumentException.class, () -> chat.chat(new RagChatRequest("  ", null)));
        assertThrows(IllegalArgumentException.class, () -> chat.chat(new RagChatRequest("问题", null, List.of(new ConversationMessage("system", "bad")))));
        verifyNoInteractions(recognizer);
    }
}
