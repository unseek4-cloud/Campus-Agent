package com.campusagent.aiintegration.rag;

/** Public campus question; knowledgeBaseId is optional for development-wide search. */
public record RagChatRequest(String query, String knowledgeBaseId) {
}
