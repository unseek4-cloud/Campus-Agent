package com.campusagent.aiintegration.rag;

import java.util.List;

public record RagChatResponse(
        String answer,
        List<RagSource> sources,
        int retrievalCount,
        int rerankCount,
        int usedContextCount,
        String rewrittenQuery
) {
}
