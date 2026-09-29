package com.campusagent.aiintegration.history;

import com.campusagent.aiintegration.history.ChatHistoryTypes.*;
import com.campusagent.aiintegration.rag.*;
import com.campusagent.aiintegration.serviceguide.*;
import com.campusagent.shared.error.BusinessException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class ChatHistoryService {
    private final ChatHistoryRepository repository;
    private final ChatService ai;
    private final ObjectMapper json;
    private final TransactionTemplate transaction;
    public ChatHistoryService(ChatHistoryRepository repository, ChatService ai, ObjectMapper json, PlatformTransactionManager manager) {
        this.repository = repository; this.ai = ai; this.json = json; this.transaction = new TransactionTemplate(manager);
    }
    public List<Conversation> list(long userId) { return repository.list(userId); }
    public Conversation create(long userId) { return repository.create(userId); }
    public Messages messages(long userId, long id) {
        return transaction.execute(s -> {
            repository.owned(userId, id, true);
            return new Messages(repository.messages(userId, id), active(repository.lease(id)));
        });
    }
    public void delete(long userId, long id) {
        transaction.executeWithoutResult(s -> { repository.owned(userId, id, true); repository.delete(userId, id); });
    }
    private boolean active(Lease lease) {
        // Above the existing 90-second RAG timeout; releases abandoned work after a server restart.
        return lease.requestId() != null && lease.since().isAfter(LocalDateTime.now().minusMinutes(5));
    }
    private BusinessException conflict(String message) { return new BusinessException("CHAT_BUSY", message, HttpStatus.CONFLICT); }
    private record Prepared(long id, long userMessageId, List<ConversationMessage> history, Turn cached) { }

    public Turn chat(long userId, Request request) {
        var normalized = RagService.normalize(new RagChatRequest(request.query(), request.knowledgeBaseId()));
        String requestId = request.requestId() == null ? UUID.randomUUID().toString() : request.requestId();
        if (!requestId.matches("[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")) throw new IllegalArgumentException("requestId 必须为 UUID");
        Prepared prepared = transaction.execute(s -> {
            var conversation = request.conversationId() == null ? repository.create(userId) : repository.owned(userId, request.conversationId(), true);
            long id = conversation.id();
            var existing = repository.messages(userId, id);
            var user = existing.stream().filter(m -> m.requestId().equals(requestId) && m.role().equals("USER")).findFirst().orElse(null);
            if (user != null && !user.content().equals(normalized.query())) throw conflict("同一请求标识不能用于不同问题");
            var answer = existing.stream().filter(m -> m.requestId().equals(requestId) && m.role().equals("ASSISTANT")).findFirst().orElse(null);
            if (answer != null) return new Prepared(id, user.id(), List.of(), new Turn(id, user.id(), answer.id(), restore(answer)));
            if (active(repository.lease(id))) throw conflict("当前对话正在生成回答，请稍后刷新");
            // Retry a failed turn only while it is still the last turn, keeping chronology stable.
            if (user != null && existing.getLast().id() != user.id()) throw conflict("该问题之后已有新消息，请重新发送问题");
            var history = existing.stream().filter(m -> !m.requestId().equals(requestId)).toList();
            var context = history.subList(Math.max(0, history.size()-8), history.size()).stream()
                    .map(m -> new ConversationMessage(m.role().toLowerCase(Locale.ROOT), truncate(m.content(), 4000))).toList();
            long userMessageId = user == null ? repository.message(id, requestId, "USER", normalized.query(), null) : user.id();
            repository.claim(id, requestId, existing.isEmpty() ? truncate(normalized.query(), 30) : conversation.title());
            return new Prepared(id, userMessageId, context, null);
        });
        if (prepared.cached() != null) return prepared.cached();
        try {
            // The USER commit precedes network IO. No database lock is held while calling the AI.
            var response = ai.chat(new RagChatRequest(normalized.query(), normalized.knowledgeBaseId(), prepared.history()));
            String metadata = metadata(response).toString();
            return transaction.execute(s -> {
                repository.owned(userId, prepared.id(), true);
                if (!requestId.equals(repository.lease(prepared.id()).requestId())) throw conflict("请求已失效，请刷新对话");
                long answerId = repository.message(prepared.id(), requestId, "ASSISTANT", response.answer(), metadata);
                repository.release(prepared.id(), requestId);
                return new Turn(prepared.id(), prepared.userMessageId(), answerId, response);
            });
        } catch (RuntimeException e) {
            repository.release(prepared.id(), requestId);
            throw e;
        }
    }
    private ObjectNode metadata(ChatResponse response) {
        ObjectNode node = json.valueToTree(response);
        node.remove(List.of("answer", "rewrittenQuery", "retrievalCount", "rerankCount", "usedContextCount"));
        // Retain small user-facing citation excerpts, never full debug chunks or embeddings.
        if (node.path("sources").isArray()) for (var source : node.withArray("sources")) {
            var citation = (ObjectNode) source;
            citation.put("content", truncate(citation.path("content").asText(), 400));
            citation.remove(List.of("score", "rerankScore"));
        }
        return node;
    }
    private ChatResponse restore(Message message) {
        ObjectNode node = message.response().deepCopy(); node.put("answer", message.content());
        return json.convertValue(node, ChatResponse.class);
    }
    private static String truncate(String text, int length) {
        return text.substring(0, text.offsetByCodePoints(0, Math.min(length, text.codePointCount(0, text.length()))));
    }
}
