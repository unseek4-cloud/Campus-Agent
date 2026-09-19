package com.campusagent.aiintegration.rag;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

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
        List<ConversationMessage> history = request.history();
        if (history != null) {
            if (history.size() > 100) {
                throw new IllegalArgumentException("history must not exceed 100 messages");
            }
            List<ConversationMessage> normalized = new ArrayList<>(history.size());
            for (ConversationMessage message : history) {
                if (message == null || !("user".equals(message.role()) || "assistant".equals(message.role()))
                        || message.content() == null || message.content().isBlank()) {
                    throw new IllegalArgumentException("history entries require role and content");
                }
                String content = message.content().strip();
                if (content.length() > 4000) {
                    throw new IllegalArgumentException("history content must not exceed 4000 characters");
                }
                normalized.add(new ConversationMessage(message.role(), content));
            }
            history = normalized.isEmpty() ? null : List.copyOf(normalized);
        }
        return client.chat(new RagChatRequest(query, knowledgeBaseId, history));
    }
}
