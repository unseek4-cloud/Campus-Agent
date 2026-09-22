package com.campusagent.aiintegration.serviceguide;

import com.campusagent.affair.serviceguide.dto.*;
import com.campusagent.aiintegration.rag.*;
import java.time.LocalDate;
import java.util.List;

/** Additive public chat response: all original QA fields retain their meaning. */
public record ChatResponse(String type, String answer, List<RagSource> sources, int retrievalCount,
        int rerankCount, int usedContextCount, String rewrittenQuery, ServiceItemDTO service,
        List<ServiceStepDTO> steps, Source source, Integer currentStep, boolean aiEnhanced) {
    public record Source(String title, String documentId, LocalDate publishTime, String url) { }
    public static ChatResponse qa(RagChatResponse r) {
        return new ChatResponse("QA", r.answer(), r.sources(), r.retrievalCount(), r.rerankCount(), r.usedContextCount(), r.rewrittenQuery(), null, List.of(), null, null, false);
    }
}
