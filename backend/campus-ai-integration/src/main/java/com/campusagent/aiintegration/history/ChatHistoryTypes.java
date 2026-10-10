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
    public record Message(long id, String requestId, String role, String content, JsonNode response, LocalDateTime createdAt,
                          com.campusagent.aiintegration.feedback.FeedbackTypes.Feedback feedback) {
        public Message(long id, String requestId, String role, String content, JsonNode response, LocalDateTime createdAt) {
            this(id, requestId, role, content, response, createdAt, null);
        }
    }
    public record RegenerateRequest(String requestId) { }
    public record Messages(List<Message> messages, boolean pending) { }
    // history is accepted for compatibility; authenticated persistent conversations use database history only.
    public record Request(String query, String knowledgeBaseId, List<ConversationMessage> history,
                          Long conversationId, String requestId) { }
    public record Turn(long conversationId, long userMessageId, long assistantMessageId,
                       @JsonUnwrapped ChatResponse response) { }
    public record Lease(String requestId, LocalDateTime since) { }
    /** Owner-facing share record; the token is the whole public credential. */
    public record Share(String token, long conversationId, String title, LocalDateTime createdAt,
                        LocalDateTime expiresAt, int viewCount, boolean revoked, List<Long> messageIds) { }
    /** messageIds 为空表示分享整段会话；非空表示只分享选中的消息。 */
    public record ShareRequest(Integer ttlDays, List<Long> messageIds) { }
    /** Public payload: no requestId, no account fields. */
    public record SharedMessage(String role, String content, JsonNode response, LocalDateTime createdAt) { }
    public record SharedConversation(String title, LocalDateTime createdAt, LocalDateTime expiresAt,
                                     int viewCount, List<Long> messageIds, List<SharedMessage> messages) { }
}
