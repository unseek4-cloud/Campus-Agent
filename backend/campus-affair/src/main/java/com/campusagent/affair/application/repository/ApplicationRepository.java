package com.campusagent.affair.application.repository;

import com.campusagent.affair.application.dto.ApplicationDetail.*;
import com.campusagent.affair.application.model.*;
import com.campusagent.identity.user.UserView;
import org.springframework.jdbc.core.*;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Repository
public class ApplicationRepository {
    private final JdbcTemplate jdbc;
    public ApplicationRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    private static final String SELECT = "SELECT a.*,u.username FROM service_application a JOIN user_account u ON u.id=a.user_id";
    private static final RowMapper<ApplicationRecord> MAPPER = (r, n) -> new ApplicationRecord(
            r.getLong("id"), r.getString("application_no"), r.getLong("service_item_id"), r.getString("service_name"),
            r.getLong("user_id"), r.getString("username"), r.getString("applicant_name"), r.getString("student_no"),
            ApplicationStatus.valueOf(r.getString("status")), r.getString("student_remark"), r.getString("admin_remark"),
            r.getInt("version"), r.getTimestamp("submitted_at").toLocalDateTime(), r.getTimestamp("updated_at").toLocalDateTime(),
            r.getTimestamp("completed_at") == null ? null : r.getTimestamp("completed_at").toLocalDateTime());
    public ApplicationRecord find(long id) {
        return jdbc.query(SELECT + " WHERE a.id=?", MAPPER, id).stream().findFirst().orElse(null);
    }
    public ApplicationRecord lock(long id) {
        jdbc.queryForList("SELECT id FROM service_application WHERE id=? FOR UPDATE", id);
        return find(id);
    }
    public ApplicationRecord active(long userId, long serviceId) {
        return jdbc.query(SELECT + " WHERE a.user_id=? AND a.service_item_id=? AND a.active_slot=1", MAPPER, userId, serviceId)
                .stream().findFirst().orElse(null);
    }
    public Page list(Long userId, String filter, int page, int size) {
        var args = new ArrayList<Object>();
        String where = " WHERE 1=1";
        if (userId != null) { where += " AND a.user_id=?"; args.add(userId); }
        if ("ACTIVE".equals(filter)) where += " AND a.active_slot=1";
        else if (filter != null && !filter.isBlank()) {
            try { ApplicationStatus.valueOf(filter); }
            catch (IllegalArgumentException e) { throw new IllegalArgumentException("申请状态筛选无效"); }
            where += " AND a.status=?"; args.add(filter);
        }
        long total = Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM service_application a" + where, Long.class, args.toArray()));
        args.add(size); args.add((long) (page - 1) * size);
        return new Page(jdbc.query(SELECT + where + " ORDER BY a.submitted_at DESC,a.id DESC LIMIT ? OFFSET ?", MAPPER, args.toArray()), total, page, size);
    }
    public long insert(long serviceId, String serviceName, UserView user, String remark) {
        var keys = new GeneratedKeyHolder();
        jdbc.update(c -> {
            var statement = c.prepareStatement("INSERT INTO service_application(application_no,service_item_id,service_name,user_id,applicant_name,student_no,status,active_slot,student_remark) VALUES (?,?,?,?,?,?,'SUBMITTED',1,?)", new String[]{"id"});
            // Only visible inside this transaction, replaced by date + database ID before commit.
            Object[] values = {"PENDING-" + UUID.randomUUID(), serviceId, serviceName, user.id(), user.displayName(), user.studentNo(), remark};
            for (int i=0; i<values.length; i++) statement.setObject(i+1, values[i]);
            return statement;
        }, keys);
        long id = Objects.requireNonNull(keys.getKey()).longValue();
        String day = LocalDate.now(ZoneId.of("Asia/Shanghai")).format(DateTimeFormatter.BASIC_ISO_DATE);
        jdbc.update("UPDATE service_application SET application_no=? WHERE id=?", "CA" + day + String.format(Locale.ROOT, "%08d", id), id);
        return id;
    }
    public void transition(long id, ApplicationStatus status, String adminRemark, String studentRemark) {
        jdbc.update("UPDATE service_application SET status=?,active_slot=?,admin_remark=?,student_remark=?,version=version+1,updated_at=CURRENT_TIMESTAMP(3),completed_at=? WHERE id=?",
                status.name(), status.active() ? 1 : null, adminRemark, studentRemark,
                status == ApplicationStatus.COMPLETED ? LocalDateTime.now() : null, id);
    }
    public void event(long id, ApplicationStatus from, ApplicationStatus to, UserView actor, String remark) {
        jdbc.update("INSERT INTO service_application_event(application_id,from_status,to_status,actor_id,actor_name,actor_role,remark) VALUES (?,?,?,?,?,?,?)",
                id, from == null ? null : from.name(), to.name(), actor.id(), actor.displayName(), actor.role(), remark);
    }
    public List<Event> events(long id) {
        return jdbc.query("SELECT * FROM service_application_event WHERE application_id=? ORDER BY id", (r,n) -> new Event(
                r.getLong("id"), r.getString("from_status") == null ? null : ApplicationStatus.valueOf(r.getString("from_status")),
                ApplicationStatus.valueOf(r.getString("to_status")), r.getString("actor_name"), r.getString("actor_role"),
                r.getString("remark"), r.getTimestamp("created_at").toLocalDateTime()), id);
    }
}
