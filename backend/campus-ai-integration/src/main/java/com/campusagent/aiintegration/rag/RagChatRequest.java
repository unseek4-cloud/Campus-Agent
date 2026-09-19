package com.campusagent.aiintegration.rag;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/** Public campus question; knowledgeBaseId is optional for development-wide search. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record RagChatRequest(String query, String knowledgeBaseId, List<ConversationMessage> history) {
    public RagChatRequest(String query, String knowledgeBaseId) {
        this(query, knowledgeBaseId, null);
    }
}
