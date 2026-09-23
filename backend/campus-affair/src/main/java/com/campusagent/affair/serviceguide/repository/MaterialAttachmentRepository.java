package com.campusagent.affair.serviceguide.repository;

import com.campusagent.affair.serviceguide.dto.MaterialAttachmentDTO;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class MaterialAttachmentRepository {
    public record Attachment(String id, long serviceId, String materialId, String filename, String contentType, long size) {
        public MaterialAttachmentDTO dto() { return new MaterialAttachmentDTO(id, filename, "/api/files/" + id + "/download"); }
    }
    private final JdbcTemplate jdbc;
    public MaterialAttachmentRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public List<Attachment> list(long serviceId) {
        return jdbc.query("SELECT * FROM service_material_attachment WHERE service_item_id=?",
                (r, n) -> new Attachment(r.getString("id"), r.getLong("service_item_id"), r.getString("material_id"),
                        r.getString("original_filename"), r.getString("content_type"), r.getLong("file_size")), serviceId);
    }
    public Attachment find(String id) {
        return jdbc.query("SELECT * FROM service_material_attachment WHERE id=?",
                (r, n) -> new Attachment(r.getString("id"), r.getLong("service_item_id"), r.getString("material_id"),
                        r.getString("original_filename"), r.getString("content_type"), r.getLong("file_size")), id)
                .stream().findFirst().orElse(null);
    }
    public void insert(Attachment a) {
        jdbc.update("INSERT INTO service_material_attachment(id,service_item_id,material_id,original_filename,content_type,file_size) VALUES(?,?,?,?,?,?)",
                a.id(), a.serviceId(), a.materialId(), a.filename(), a.contentType(), a.size());
    }
    public void delete(String id) { jdbc.update("DELETE FROM service_material_attachment WHERE id=?", id); }
}
