package com.campusagent.aiintegration.history;

import com.campusagent.aiintegration.rag.ConversationMessage;
import com.campusagent.aiintegration.serviceguide.ChatResponse;
import com.fasterxml.jackson.annotation.JsonUnwrapped;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDateTime;
import java.util.List;

public final class ChatHistoryTypes {
    private ChatHistoryTypes() { }
    public record Conversation(long id, String title, LocalDateTime createdAt, LocalDateTime updatedAt) { }
    public record Message(long id, String requestId, String role, String content, JsonNode response, LocalDateTime createdAt) { }
    public record Messages(List<Message> messages, boolean pending) { }
    // history is accepted for compatibility; authenticated persistent conversations use database history only.
    public record Request(String query, String knowledgeBaseId, List<ConversationMessage> history,
                          Long conversationId, String requestId) { }
    public record Turn(long conversationId, long userMessageId, long assistantMessageId,
                       @JsonUnwrapped ChatResponse response) { }
    public record Lease(String requestId, LocalDateTime since) { }
}
