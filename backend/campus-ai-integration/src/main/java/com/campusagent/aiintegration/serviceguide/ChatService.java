package com.campusagent.aiintegration.serviceguide;

import com.campusagent.affair.serviceguide.dto.*;
import com.campusagent.affair.serviceguide.service.*;
import com.campusagent.aiintegration.rag.*;
import com.campusagent.shared.error.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class ChatService {
    private static final Logger log = LoggerFactory.getLogger(ChatService.class);
    private final RagService rag;
    private final ServiceIntentRecognizer recognizer;
    private final ServiceGuideService guides;
    private final ServiceAiClient ai;
    public ChatService(RagService rag, ServiceIntentRecognizer recognizer, ServiceGuideService guides, ServiceAiClient ai) {
        this.rag = rag; this.recognizer = recognizer; this.guides = guides; this.ai = ai;
    }
    public ChatResponse chat(RagChatRequest raw) {
        var request = RagService.normalize(raw);
        var intent = recognizer.recognize(request.query());
        if (!intent.matched()) return ChatResponse.qa(rag.chat(request));
        ServiceDetail guide;
        try { guide = guides.activeByCode(intent.serviceCode()); }
        catch (BusinessException e) {
            if (!"SERVICE_NOT_FOUND".equals(e.getCode())) throw e;
            return new ChatResponse("SERVICE_GUIDE", e.getMessage(), List.of(), 0, 0, 0, request.query(), null, List.of(), null, null, false);
        }
        log.info("[ServiceGuide] serviceItemId={}", guide.service().id());
        String fallback = fallback(guide);
        RagChatResponse narration = null;
        try { narration = ai.narrate(request.query(), request.knowledgeBaseId(), guide); }
        catch (RuntimeException e) { log.warn("[ServiceGuide] AI unavailable; returning database guide id={} reason={}", guide.service().id(), e.getClass().getSimpleName()); }
        var s = guide.service();
        var source = new ChatResponse.Source(s.sourceTitle(), s.sourceDocumentId(), s.sourcePublishTime(), s.sourceUrl());
        String answer = narration == null ? fallback : narration.answer();
        // This label is deterministic and cannot be removed by model output.
        if (s.isExample()) answer = "【测试数据 / 示例数据，不代表学校真实政策】\n" + answer;
        return new ChatResponse("SERVICE_GUIDE", answer, narration == null ? List.of() : narration.sources(),
                narration == null ? 0 : narration.retrievalCount(), narration == null ? 0 : narration.rerankCount(),
                narration == null ? 0 : narration.usedContextCount(), request.query(), s, guide.steps(), source,
                guide.steps().isEmpty() ? 0 : 1, narration != null);
    }
    static String fallback(ServiceDetail guide) {
        String materials = guide.service().materials().stream().map(ServiceItemDTO.Material::name).collect(Collectors.joining("、"));
        String first = guide.steps().isEmpty() ? "当前暂未维护办理步骤，请查看最新学校通知。" : "你首先应该完成“" + guide.steps().getFirst().title() + "”。";
        return first + (materials.isEmpty() ? "当前暂未找到明确的材料要求。" : "请先核对所需材料：" + materials + "。")
                + (guide.service().deadline() == null || guide.service().deadline().isBlank() ? "当前暂未找到明确截止日期，请查看最新学校通知。" : "截止时间：" + guide.service().deadline() + "。");
    }
}
