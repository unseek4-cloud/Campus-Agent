package com.campusagent.aiintegration.knowledge;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Validates the public request and delegates retrieval to the AI-service adapter. */
@Service
public class KnowledgeRetrievalService {
    private final AiKnowledgeClient aiKnowledgeClient;
    private final int defaultTopK;
    private final int maxTopK;

    public KnowledgeRetrievalService(
            AiKnowledgeClient aiKnowledgeClient,
            @Value("${campus.knowledge.default-top-k}") int defaultTopK,
            @Value("${campus.knowledge.max-top-k}") int maxTopK
    ) {
        if (defaultTopK <= 0 || maxTopK <= 0 || defaultTopK > maxTopK) {
            throw new IllegalArgumentException("Invalid knowledge retrieval topK configuration");
        }
        this.aiKnowledgeClient = aiKnowledgeClient;
        this.defaultTopK = defaultTopK;
        this.maxTopK = maxTopK;
    }

    public KnowledgeSearchResponse search(KnowledgeSearchRequest request) {
        if (request == null || request.query() == null || request.query().isBlank()) {
            throw new IllegalArgumentException("query must not be blank");
        }

        String query = request.query().strip();
        if (query.length() > 4000) {
            throw new IllegalArgumentException("query must not exceed 4000 characters");
        }

        int topK = request.topK() == null ? defaultTopK : request.topK();
        if (topK <= 0 || topK > maxTopK) {
            throw new IllegalArgumentException("topK must be between 1 and " + maxTopK);
        }

        String knowledgeBaseId = request.knowledgeBaseId();
        if (knowledgeBaseId != null) {
            knowledgeBaseId = knowledgeBaseId.strip();
            if (knowledgeBaseId.isEmpty()) {
                knowledgeBaseId = null;
            } else if (knowledgeBaseId.length() > 128) {
                throw new IllegalArgumentException(
                        "knowledgeBaseId must not exceed 128 characters"
                );
            }
        }

        return aiKnowledgeClient.search(
                new KnowledgeSearchRequest(query, topK, knowledgeBaseId)
        );
    }
}
