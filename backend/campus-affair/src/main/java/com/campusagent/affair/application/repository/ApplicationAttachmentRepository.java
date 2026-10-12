package com.campusagent.affair.application.repository;

import com.campusagent.affair.application.dto.ApplicationDetail.Attachment;
import com.campusagent.affair.application.dto.ApplicationDetail.MaterialRequirement;
import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class ApplicationAttachmentRepository {
    private final JdbcTemplate jdbc;
    public ApplicationAttachmentRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    private static final RowMapper<Attachment> MAPPER = (r,n) -> new Attachment(r.getString("id"), r.getLong("application_id"),
            r.getString("original_filename"), r.getString("content_type"), r.getLong("file_size"), r.getTimestamp("uploaded_at").toLocalDateTime(),
            r.getString("material_id"), r.getString("material_name"));
    private static final String SELECT = "SELECT a.*,b.material_id,b.material_name FROM service_application_attachment a LEFT JOIN service_application_attachment_material b ON b.attachment_id=a.id";
    public List<Attachment> list(long id) { return jdbc.query(SELECT + " WHERE a.application_id=? ORDER BY a.uploaded_at,a.id", MAPPER, id); }
    public Attachment find(String id) { return jdbc.query(SELECT + " WHERE a.id=?", MAPPER, id).stream().findFirst().orElse(null); }
    public void insert(String id, long applicationId, String filename, String type, long size, MaterialRequirement material) {
        jdbc.update("INSERT INTO service_application_attachment(id,application_id,original_filename,content_type,file_size) VALUES (?,?,?,?,?)", id, applicationId, filename, type, size);
        if (material != null) jdbc.update("INSERT INTO service_application_attachment_material(attachment_id,material_id,material_name) VALUES (?,?,?)",
                id, material.id(), material.name());
    }
}
