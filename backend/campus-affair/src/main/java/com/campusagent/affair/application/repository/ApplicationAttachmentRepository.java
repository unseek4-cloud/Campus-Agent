package com.campusagent.affair.application.repository;

import com.campusagent.affair.application.dto.ApplicationDetail.Attachment;
import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class ApplicationAttachmentRepository {
    private final JdbcTemplate jdbc;
    public ApplicationAttachmentRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    private static final RowMapper<Attachment> MAPPER = (r,n) -> new Attachment(r.getString("id"), r.getLong("application_id"),
            r.getString("original_filename"), r.getString("content_type"), r.getLong("file_size"), r.getTimestamp("uploaded_at").toLocalDateTime());
    public List<Attachment> list(long id) { return jdbc.query("SELECT * FROM service_application_attachment WHERE application_id=? ORDER BY uploaded_at,id", MAPPER, id); }
    public Attachment find(String id) { return jdbc.query("SELECT * FROM service_application_attachment WHERE id=?", MAPPER, id).stream().findFirst().orElse(null); }
    public void insert(String id, long applicationId, String filename, String type, long size) {
        jdbc.update("INSERT INTO service_application_attachment(id,application_id,original_filename,content_type,file_size) VALUES (?,?,?,?,?)", id, applicationId, filename, type, size);
    }
}
