package com.campusagent.aiintegration.feedback;

import com.campusagent.aiintegration.feedback.FeedbackTypes.*;
import com.campusagent.shared.error.BusinessException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.sql.Timestamp;
import java.util.*;

@Service
public class FeedbackService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public FeedbackService(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

    private BusinessException missing() { return new BusinessException("FEEDBACK_NOT_FOUND", "回复或评价不存在", HttpStatus.NOT_FOUND); }
    private void ownedAssistant(long userId, long messageId) {
        // Serialize owner writes with chat deletion and other feedback writes on the same conversation.
        var ids = jdbc.queryForList("SELECT c.id FROM ai_conversation c JOIN ai_message m ON m.conversation_id=c.id "
                + "WHERE c.user_id=? AND m.id=? AND m.role='ASSISTANT' FOR UPDATE", Long.class, userId, messageId);
        if (ids.isEmpty()) throw missing();
    }
    @Transactional
    public Feedback rate(long userId, long messageId, String rating) {
        return rate(userId, messageId, new RatingRequest(rating, null, null));
    }
    @Transactional
    public Feedback rate(long userId, long messageId, RatingRequest request) {
        String rating = request.rating();
        if (!List.of("POSITIVE", "NEGATIVE").contains(rating == null ? "" : rating)) throw new IllegalArgumentException("评价类型无效");
        var allowed = List.of("INCORRECT", "NOT_HELPFUL", "OUTDATED", "SLOW_OR_ERROR", "STYLE", "SAFETY", "OTHER");
        var supplied = request.reasons() == null ? List.<String>of() : request.reasons();
        if (supplied.size() > allowed.size() || supplied.stream().anyMatch(reason -> reason == null || !allowed.contains(reason)))
            throw new IllegalArgumentException("反馈原因无效");
        String reasons = String.join(",", allowed.stream().filter(supplied::contains).toList());
        String comment = request.comment() == null ? "" : request.comment().trim();
        if (comment.length() > 2000) throw new IllegalArgumentException("反馈说明最多2000字");
        if (rating.equals("POSITIVE") && (!reasons.isEmpty() || !comment.isEmpty())) throw new IllegalArgumentException("仅回复不佳支持反馈说明");
        ownedAssistant(userId, messageId);
        var old = jdbc.query("SELECT f.id,f.rating,COALESCE(d.reasons,''),COALESCE(d.user_comment,'') FROM ai_reply_feedback f "
                + "LEFT JOIN ai_reply_feedback_detail d ON d.feedback_id=f.id WHERE f.user_id=? AND f.message_id=?",
                (r,n) -> new Object[]{r.getLong(1),r.getString(2),r.getString(3),r.getString(4)}, userId, messageId);
        boolean changed = old.isEmpty() || !old.getFirst()[1].equals(rating) || !old.getFirst()[2].equals(reasons) || !old.getFirst()[3].equals(comment);
        if (old.isEmpty()) jdbc.update("INSERT INTO ai_reply_feedback(user_id,message_id,rating) VALUES (?,?,?)", userId, messageId, rating);
        else if (changed) jdbc.update("UPDATE ai_reply_feedback SET rating=?,updated_at=CURRENT_TIMESTAMP(3),"
                + "issue_type='UNCLASSIFIED',handling_status='OPEN',admin_note='',reviewed_by=NULL,reviewed_at=NULL,version=version+1 "
                + "WHERE user_id=? AND message_id=?", rating, userId, messageId);
        if (changed) {
            long feedbackId = jdbc.queryForObject("SELECT id FROM ai_reply_feedback WHERE user_id=? AND message_id=?", Long.class, userId, messageId);
            jdbc.update("DELETE FROM ai_reply_feedback_detail WHERE feedback_id=?", feedbackId);
            if (rating.equals("NEGATIVE")) jdbc.update("INSERT INTO ai_reply_feedback_detail(feedback_id,reasons,user_comment) VALUES (?,?,?)", feedbackId, reasons, comment);
        }
        return jdbc.queryForObject("SELECT rating,updated_at FROM ai_reply_feedback WHERE user_id=? AND message_id=?",
                (r,n) -> new Feedback(r.getString(1), r.getTimestamp(2).toLocalDateTime(), FeedbackTypes.reasons(reasons), comment), userId, messageId);
    }
    @Transactional
    public void cancel(long userId, long messageId) {
        ownedAssistant(userId, messageId);
        jdbc.update("DELETE FROM ai_reply_feedback WHERE user_id=? AND message_id=?", userId, messageId);
    }

    private String scope(long adminId) {
        var values = jdbc.queryForList("SELECT a.access_scope FROM ai_feedback_admin_access a JOIN user_account u ON u.id=a.admin_id "
                + "WHERE a.admin_id=? AND u.role='ADMIN' AND u.status='ACTIVE'", String.class, adminId);
        if (values.isEmpty()) throw new BusinessException("FEEDBACK_SCOPE_REQUIRED", "尚未授权查看问答反馈，请联系系统管理员配置数据范围", HttpStatus.FORBIDDEN);
        return values.getFirst();
    }
    private static final String FROM = " FROM ai_reply_feedback f JOIN ai_message m ON m.id=f.message_id "
            + "JOIN ai_conversation c ON c.id=m.conversation_id AND c.user_id=f.user_id ";
    private record Filter(String sql, List<Object> args) { }
    private Filter filter(long adminId, String rating, LocalDate start, LocalDate end) {
        String access = scope(adminId);
        if (rating != null && !rating.isBlank() && !List.of("POSITIVE", "NEGATIVE").contains(rating)) throw new IllegalArgumentException("评价类型无效");
        if (start != null && end != null && start.isAfter(end)) throw new IllegalArgumentException("开始日期不能晚于结束日期");
        var sql = new StringBuilder(" WHERE m.role='ASSISTANT'");
        var args = new ArrayList<Object>();
        if (!access.equals("ALL")) { sql.append(" AND EXISTS (SELECT 1 FROM ai_feedback_admin_user_scope s WHERE s.admin_id=? AND s.user_id=f.user_id)"); args.add(adminId); }
        if (rating != null && !rating.isBlank()) { sql.append(" AND f.rating=?"); args.add(rating); }
        if (start != null) { sql.append(" AND f.updated_at>=?"); args.add(Timestamp.valueOf(start.atStartOfDay())); }
        if (end != null) { sql.append(" AND f.updated_at<?"); args.add(Timestamp.valueOf(end.plusDays(1).atStartOfDay())); }
        return new Filter(sql.toString(), args);
    }
    @Transactional(readOnly = true)
    public Summary summary(long adminId, String rating, LocalDate start, LocalDate end) {
        var filter = filter(adminId, rating, start, end);
        long[] counts = jdbc.queryForObject("SELECT COUNT(*),COALESCE(SUM(CASE WHEN f.rating='POSITIVE' THEN 1 ELSE 0 END),0)" + FROM + filter.sql,
                (r,n) -> new long[]{r.getLong(1), r.getLong(2)}, filter.args.toArray());
        // Trend defaults to the last 30 calendar days; cards cover all effective feedback unless filtered.
        LocalDate trendEnd = end == null ? LocalDate.now() : end;
        LocalDate trendStart = start == null ? trendEnd.minusDays(29) : start;
        if (java.time.temporal.ChronoUnit.DAYS.between(trendStart, trendEnd) > 365) throw new IllegalArgumentException("趋势日期范围不能超过366天");
        var tf = filter(adminId, rating, trendStart, trendEnd);
        var daily = jdbc.query("SELECT CAST(f.updated_at AS DATE),SUM(CASE WHEN f.rating='POSITIVE' THEN 1 ELSE 0 END),"
                + "SUM(CASE WHEN f.rating='NEGATIVE' THEN 1 ELSE 0 END)" + FROM + tf.sql + " GROUP BY CAST(f.updated_at AS DATE) ORDER BY 1",
                (r,n) -> new Trend(r.getDate(1).toLocalDate(), r.getLong(2), r.getLong(3)), tf.args.toArray());
        var byDate = new HashMap<LocalDate, Trend>(); daily.forEach(t -> byDate.put(t.date(), t));
        var trend = new ArrayList<Trend>();
        for (LocalDate date=trendStart; !date.isAfter(trendEnd); date=date.plusDays(1)) trend.add(byDate.getOrDefault(date, new Trend(date,0,0)));
        return new Summary(counts[0], counts[1], counts[0]-counts[1], counts[0] == 0 ? 0 : Math.round(counts[1]*10000.0/counts[0])/100.0, scope(adminId), trend);
    }
    @Transactional(readOnly = true)
    public Page list(long adminId, String rating, LocalDate start, LocalDate end, int page, int pageSize) {
        if (page < 1 || page > 1000000 || pageSize < 1 || pageSize > 100) throw new IllegalArgumentException("分页参数无效");
        var filter = filter(adminId, rating, start, end);
        long total = jdbc.queryForObject("SELECT COUNT(*)" + FROM + filter.sql, Long.class, filter.args.toArray());
        var args = new ArrayList<>(filter.args); args.add(pageSize); args.add((page-1)*pageSize);
        var items = jdbc.query("SELECT f.*,d.reasons,d.user_comment,m.content AS answer,m.sources_json,"
                + "(SELECT q.content FROM ai_message q WHERE q.conversation_id=m.conversation_id AND q.request_id=m.request_id AND q.role='USER') AS question"
                + FROM + "LEFT JOIN ai_reply_feedback_detail d ON d.feedback_id=f.id " + filter.sql + " ORDER BY f.updated_at DESC,f.id DESC LIMIT ? OFFSET ?", (r,n) -> {
                    try {
                        String raw = r.getString("sources_json"); var node = raw == null ? null : json.readTree(raw);
                        if (node != null && node.isTextual()) node = json.readTree(node.textValue());
                        var reviewed = r.getTimestamp("reviewed_at");
                        return new FeedbackTypes.Record(r.getLong("id"), r.getLong("message_id"), r.getString("question"), r.getString("answer"), node,
                                r.getString("rating"), r.getTimestamp("created_at").toLocalDateTime(), r.getTimestamp("updated_at").toLocalDateTime(),
                                FeedbackTypes.reasons(r.getString("reasons")), Objects.toString(r.getString("user_comment"), ""),
                                r.getString("issue_type"), r.getString("handling_status"), r.getString("admin_note"), reviewed == null ? null : reviewed.toLocalDateTime(), r.getInt("version"));
                    } catch (java.io.IOException e) { throw new IllegalStateException("Invalid feedback source metadata"); }
                }, args.toArray());
        return new Page(items, total, page, pageSize);
    }
    @Transactional
    public void review(long adminId, long id, ReviewRequest request) {
        var filter = filter(adminId, "NEGATIVE", null, null);
        var args = new ArrayList<>(filter.args); args.add(id);
        var visible = jdbc.queryForList("SELECT f.id" + FROM + filter.sql + " AND f.id=?", Long.class, args.toArray());
        if (visible.isEmpty()) throw missing();
        if (request == null || !List.of("UNCLASSIFIED", "KNOWLEDGE_GAP", "RETRIEVAL_MISMATCH", "ANSWER_QUALITY", "OTHER").contains(Objects.toString(request.issueType(), ""))
                || !List.of("OPEN", "IN_PROGRESS", "RESOLVED").contains(Objects.toString(request.handlingStatus(), ""))
                || request.version() < 0 || request.adminNote() == null || request.adminNote().length() > 2000) throw new IllegalArgumentException("处理信息无效，备注最多2000字");
        // Version check prevents stale edits after a user changes/cancels feedback or another admin edits it.
        int changed = jdbc.update("UPDATE ai_reply_feedback SET issue_type=?,handling_status=?,admin_note=?,reviewed_by=?,"
                + "reviewed_at=CURRENT_TIMESTAMP(3),version=version+1 WHERE id=? AND version=? AND rating='NEGATIVE'",
                request.issueType(), request.handlingStatus(), request.adminNote().trim(), adminId, id, request.version());
        if (changed == 0) throw new BusinessException("FEEDBACK_CHANGED", "评价已发生变化，请刷新后再处理", HttpStatus.CONFLICT);
    }
}
