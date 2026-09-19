package com.campusagent.aiintegration.knowledge;

import java.util.List;

/** Retrieval payload shared by the AI client and the public Java API. */
public record KnowledgeSearchResponse(
        String query,
        List<KnowledgeSearchResult> results
) {
}
