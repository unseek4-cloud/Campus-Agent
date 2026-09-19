package com.campusagent.aiintegration.rag;

import org.springframework.stereotype.Service;

@Service
public class RagService {
    private final RagClient client;

    public RagService(RagClient client) {
        this.client = client;
    }

    public RagChatResponse chat(RagChatRequest request) {
        if (request == null || request.query() == null || request.query().isBlank()) {
            throw new IllegalArgumentException("query must not be blank");
        }
        String query = request.query().strip();
        if (query.length() > 4000) {
            throw new IllegalArgumentException("query must not exceed 4000 characters");
        }
        String knowledgeBaseId = request.knowledgeBaseId();
        if (knowledgeBaseId != null) {
            knowledgeBaseId = knowledgeBaseId.strip();
            if (knowledgeBaseId.isEmpty()) {
                knowledgeBaseId = null;
            } else if (knowledgeBaseId.length() > 128) {
                throw new IllegalArgumentException("knowledgeBaseId must not exceed 128 characters");
            }
        }
        return client.chat(new RagChatRequest(query, knowledgeBaseId));
    }
}
