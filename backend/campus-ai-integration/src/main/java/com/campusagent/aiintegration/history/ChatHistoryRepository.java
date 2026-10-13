package com.campusagent.aiintegration.history;

import com.campusagent.aiintegration.history.ChatHistoryTypes.*;
import com.campusagent.shared.error.BusinessException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.*;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;
import java.time.LocalDateTime;
import java.util.*;

@Repository
public class ChatHistoryRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    /** 字段初始化器不能用构造器里才赋值的 json，所以消息映射在构造器内创建。 */
    private final RowMapper<Message> messageMapper;
    public ChatHistoryRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
        this.messageMapper = (r, n) -> {
            try {
                String metadata = r.getString("sources_json");
                var node = metadata == null ? null : json.readTree(metadata);
                // H2's JSON JDBC binding returns a JSON string, MySQL returns the object directly.
                if (node != null && node.isTextual()) node = json.readTree(node.textValue());
                return new Message(r.getLong("id"), r.getString("request_id"), r.getString("role"), r.getString("content"),
                        node, r.getTimestamp("created_at").toLocalDateTime());
            } catch (java.io.IOException e) { throw new IllegalStateException("Invalid stored chat metadata"); }
        };
    }
    private final RowMapper<Conversation> conversations = (r, n) -> new Conversation(r.getLong("id"), r.getString("title"),
            r.getTimestamp("created_at").toLocalDateTime(), r.getTimestamp("updated_at").toLocalDateTime());
    public List<Conversation> list(long userId) {
        return jdbc.query("SELECT id,title,created_at,updated_at FROM ai_conversation WHERE user_id=? ORDER BY updated_at DESC,id DESC", conversations, userId);
    }
    public Conversation owned(long userId, long id, boolean lock) {
        return jdbc.query("SELECT id,title,created_at,updated_at FROM ai_conversation WHERE user_id=? AND id=?" + (lock ? " FOR UPDATE" : ""),
                conversations, userId, id).stream().findFirst().orElseThrow(() -> new BusinessException("CHAT_NOT_FOUND", "对话不存在", HttpStatus.NOT_FOUND));
    }
    public Conversation create(long userId) {
        long id = insert("INSERT INTO ai_conversation(user_id) VALUES (?)", userId);
        return owned(userId, id, false);
    }
    public Lease lease(long id) {
        return jdbc.queryForObject("SELECT pending_request_id,pending_since FROM ai_conversation WHERE id=?", (r,n) ->
                new Lease(r.getString(1), r.getTimestamp(2) == null ? null : r.getTimestamp(2).toLocalDateTime()), id);
    }
    public void claim(long id, String requestId, String title) {
        jdbc.update("UPDATE ai_conversation SET pending_request_id=?,pending_since=CURRENT_TIMESTAMP(3),title=?,updated_at=CURRENT_TIMESTAMP(3) WHERE id=?", requestId, title, id);
    }
    public void release(long id, String requestId) {
        jdbc.update("UPDATE ai_conversation SET pending_request_id=NULL,pending_since=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND pending_request_id=?", id, requestId);
    }
    public List<Message> messages(long userId, long id) {
        return jdbc.query("SELECT m.* FROM ai_message m JOIN ai_conversation c ON c.id=m.conversation_id WHERE c.user_id=? AND c.id=? ORDER BY m.created_at ASC,m.id ASC",
                messageMapper, userId, id);
    }
    public long ownedMessageConversation(long userId, long messageId) {
        return jdbc.queryForList("SELECT c.id FROM ai_conversation c JOIN ai_message m ON m.conversation_id=c.id WHERE c.user_id=? AND m.id=? AND m.role='ASSISTANT'",
                Long.class, userId, messageId).stream().findFirst().orElseThrow(() -> new BusinessException("CHAT_NOT_FOUND", "回复不存在", HttpStatus.NOT_FOUND));
    }
    public List<Message> messagesWithFeedback(long userId, long id) {
        var feedback = new HashMap<Long, com.campusagent.aiintegration.feedback.FeedbackTypes.Feedback>();
        jdbc.query("SELECT f.message_id,f.rating,f.updated_at,d.reasons,d.user_comment FROM ai_reply_feedback f "
                + "LEFT JOIN ai_reply_feedback_detail d ON d.feedback_id=f.id JOIN ai_message m ON m.id=f.message_id "
                + "JOIN ai_conversation c ON c.id=m.conversation_id WHERE f.user_id=? AND c.user_id=? AND c.id=?",
                (org.springframework.jdbc.core.RowCallbackHandler) r -> feedback.put(r.getLong(1), new com.campusagent.aiintegration.feedback.FeedbackTypes.Feedback(
                        r.getString(2), r.getTimestamp(3).toLocalDateTime(), com.campusagent.aiintegration.feedback.FeedbackTypes.reasons(r.getString(4)),
                        Objects.toString(r.getString(5), ""))), userId, userId, id);
        return messages(userId, id).stream().map(m -> new Message(m.id(),m.requestId(),m.role(),m.content(),m.response(),m.createdAt(),feedback.get(m.id()))).toList();
    }
    public long message(long id, String requestId, String role, String content, String metadata) {
        return insert("INSERT INTO ai_message(conversation_id,request_id,role,content,sources_json) VALUES (?,?,?,?,?)", id, requestId, role, content, metadata);
    }
    public void delete(long userId, long id) { jdbc.update("DELETE FROM ai_conversation WHERE user_id=? AND id=?", userId, id); }

    /* ---------- 公开分享（token 是唯一凭证，见 ChatShareService） ---------- */
    private final RowMapper<Share> shares = (r, n) -> new Share(r.getString("token"), r.getLong("conversation_id"),
            r.getString("title"), r.getTimestamp("created_at").toLocalDateTime(),
            r.getTimestamp("expires_at") == null ? null : r.getTimestamp("expires_at").toLocalDateTime(),
            r.getInt("view_count"), r.getBoolean("revoked"), shareMessageIds(r.getString("message_ids")));
    /** message_ids 以 TEXT 保存 JSON 数组：NULL/空数组表示整段会话。 */
    private List<Long> shareMessageIds(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        try {
            var node = json.readTree(raw);
            if (node.isTextual()) node = json.readTree(node.textValue());   // H2 可能把 JSON 当字符串返回
            var ids = new ArrayList<Long>();
            if (node.isArray()) node.forEach(v -> ids.add(v.asLong()));
            return List.copyOf(ids);
        } catch (java.io.IOException e) { throw new IllegalStateException("Invalid stored share message ids"); }
    }
    public List<Share> shares(long userId, long conversationId) {
        return jdbc.query("SELECT * FROM ai_conversation_share WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC, token",
                shares, userId, conversationId);
    }
    public Share activeShare(long userId, long conversationId) {
        return jdbc.query("SELECT * FROM ai_conversation_share WHERE user_id=? AND conversation_id=? AND revoked=FALSE "
                + "AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP(3)) ORDER BY created_at DESC, token", shares, userId, conversationId)
                .stream().findFirst().orElse(null);
    }
    public Share share(String token) {
        return jdbc.query("SELECT * FROM ai_conversation_share WHERE token=?", shares, token).stream().findFirst().orElse(null);
    }
    public Share createShare(long userId, long conversationId, String token, String title, LocalDateTime expiresAt, List<Long> messageIds) {
        jdbc.update("INSERT INTO ai_conversation_share(token,conversation_id,user_id,title,expires_at,message_ids) VALUES (?,?,?,?,?,?)",
                token, conversationId, userId, title, expiresAt == null ? null : java.sql.Timestamp.valueOf(expiresAt),
                messageIds == null || messageIds.isEmpty() ? null : messageIds.toString());
        return share(token);
    }
    public void revokeShare(long userId, long conversationId, String token) {
        jdbc.update("UPDATE ai_conversation_share SET revoked=TRUE WHERE user_id=? AND conversation_id=? AND token=?",
                userId, conversationId, token);
    }
    public void viewed(String token) {
        jdbc.update("UPDATE ai_conversation_share SET view_count=view_count+1,last_viewed_at=CURRENT_TIMESTAMP(3) WHERE token=?", token);
    }
    public Conversation conversation(long id) {
        return jdbc.query("SELECT id,title,created_at,updated_at FROM ai_conversation WHERE id=?", conversations, id)
                .stream().findFirst().orElse(null);
    }
    /** Old whole-conversation links are bounded by creation time; new links always freeze IDs. */
    public List<Message> sharedMessages(long conversationId, List<Long> ids, LocalDateTime sharedAt) {
        var all = jdbc.query("SELECT m.* FROM ai_message m WHERE m.conversation_id=? ORDER BY m.created_at ASC,m.id ASC",
                messageMapper, conversationId);
        // Legacy links have no ID snapshot; timestamp ties cannot establish message ordering.
        if (ids == null || ids.isEmpty()) return all.stream().filter(m -> m.createdAt().isBefore(sharedAt)).toList();
        var keep = new HashSet<>(ids);
        return all.stream().filter(m -> keep.contains(m.id())).toList();
    }
    private long insert(String sql, Object... values) {
        var keys = new GeneratedKeyHolder();
        jdbc.update(c -> {
            var statement = c.prepareStatement(sql, new String[]{"id"});
            for (int i=0; i<values.length; i++) statement.setObject(i+1, values[i]);
            return statement;
        }, keys);
        return Objects.requireNonNull(keys.getKey()).longValue();
    }
}
