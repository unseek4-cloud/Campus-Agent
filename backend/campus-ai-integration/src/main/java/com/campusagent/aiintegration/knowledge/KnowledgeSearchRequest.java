package com.campusagent.aiintegration.knowledge;

/** Browser-facing retrieval request. knowledgeBaseId is optional for development-wide search. */
public record KnowledgeSearchRequest(
        String query,
        Integer topK,
        String knowledgeBaseId
) {
}
