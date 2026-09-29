package com.campusagent.aiintegration.history;

import com.campusagent.aiintegration.history.ChatHistoryTypes.*;
import com.campusagent.shared.error.BusinessException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.*;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
public class ChatHistoryRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public ChatHistoryRepository(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }
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
        return jdbc.query("SELECT m.* FROM ai_message m JOIN ai_conversation c ON c.id=m.conversation_id WHERE c.user_id=? AND c.id=? ORDER BY m.created_at ASC,m.id ASC", (r,n) -> {
            try {
                String metadata = r.getString("sources_json");
                var node = metadata == null ? null : json.readTree(metadata);
                // H2's JSON JDBC binding returns a JSON string, MySQL returns the object directly.
                if (node != null && node.isTextual()) node = json.readTree(node.textValue());
                return new Message(r.getLong("id"), r.getString("request_id"), r.getString("role"), r.getString("content"),
                        node, r.getTimestamp("created_at").toLocalDateTime());
            } catch (java.io.IOException e) { throw new IllegalStateException("Invalid stored chat metadata"); }
        }, userId, id);
    }
    public long message(long id, String requestId, String role, String content, String metadata) {
        return insert("INSERT INTO ai_message(conversation_id,request_id,role,content,sources_json) VALUES (?,?,?,?,?)", id, requestId, role, content, metadata);
    }
    public void delete(long userId, long id) { jdbc.update("DELETE FROM ai_conversation WHERE user_id=? AND id=?", userId, id); }
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
