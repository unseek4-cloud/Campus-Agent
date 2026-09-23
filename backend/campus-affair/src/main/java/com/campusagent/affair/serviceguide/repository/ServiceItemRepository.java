package com.campusagent.affair.serviceguide.repository;

import com.campusagent.affair.serviceguide.dto.ServiceItemDTO;
import com.campusagent.affair.serviceguide.dto.ServiceItemDTO.Material;
import com.campusagent.affair.serviceguide.dto.ServiceItemDTO.RecognitionRules;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ServiceItemRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final MaterialAttachmentRepository attachments;
    public ServiceItemRepository(JdbcTemplate jdbc, ObjectMapper json, MaterialAttachmentRepository attachments) {
        this.jdbc = jdbc; this.json = json; this.attachments = attachments;
    }

    private RowMapper<ServiceItemDTO> mapper() {
        return (r, n) -> new ServiceItemDTO(r.getLong("id"), r.getString("code"), r.getString("name"),
                r.getString("category"), r.getString("description"), r.getString("department"),
                r.getString("location"), r.getString("office_hours"), r.getString("contact"),
                read(r.getString("requirements"), new TypeReference<List<String>>() {}),
                materials(r.getLong("id"), r.getString("materials")),
                read(r.getString("recognition_rules"), new TypeReference<RecognitionRules>() {}),
                r.getString("deadline"), r.getString("source_document_id"), r.getString("source_title"),
                r.getString("source_url"), r.getDate("source_publish_time") == null ? null : r.getDate("source_publish_time").toLocalDate(),
                r.getString("status"), r.getBoolean("is_example"), r.getInt("version"),
                r.getTimestamp("created_at").toLocalDateTime(), r.getTimestamp("updated_at").toLocalDateTime());
    }

    private List<Material> materials(long serviceId, String stored) {
        List<Material> materials = read(stored, new TypeReference<List<Material>>() {});
        var files = attachments.list(serviceId).stream().collect(java.util.stream.Collectors.toMap(
                MaterialAttachmentRepository.Attachment::materialId, MaterialAttachmentRepository.Attachment::dto));
        var result = new java.util.ArrayList<Material>();
        for (int i = 0; i < materials.size(); i++) {
            var m = materials.get(i);
            String id = m.id() == null ? java.util.UUID.nameUUIDFromBytes(("material:" + serviceId + ":" + i)
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString() : m.id();
            result.add(new Material(id, m.name(), m.description(), m.required(), files.get(id)));
        }
        return result;
    }
    public ServiceItemDTO lock(long id) {
        // All definition and attachment mutations lock the same parent row.
        jdbc.queryForList("SELECT id FROM service_item WHERE id=? FOR UPDATE", id);
        return find(id);
    }
    public void persistMaterialIds(ServiceItemDTO item) {
        jdbc.update("UPDATE service_item SET materials=? WHERE id=?", writeMaterials(item.materials()), item.id());
    }
    private String writeMaterials(List<Material> materials) {
        return write(materials.stream().map(m -> new Material(m.id(), m.name(), m.description(), m.required(), null)).toList());
    }
    public List<ServiceItemDTO> list(boolean activeOnly) {
        return jdbc.query("SELECT * FROM service_item" + (activeOnly ? " WHERE status='ACTIVE'" : "") + " ORDER BY id", mapper());
    }
    public ServiceItemDTO find(long id) {
        return jdbc.query("SELECT * FROM service_item WHERE id=?", mapper(), id).stream().findFirst().orElse(null);
    }
    public ServiceItemDTO findActiveByCode(String code) {
        return jdbc.query("SELECT * FROM service_item WHERE code=? AND status='ACTIVE'", mapper(), code).stream().findFirst().orElse(null);
    }
    private Object[] values(ServiceItemDTO s) {
        return new Object[]{s.code(), s.name(), s.category(), s.description(), s.department(), s.location(), s.officeHours(),
                s.contact(), write(s.requirements()), writeMaterials(s.materials()), write(s.recognitionRules()), s.deadline(),
                s.sourceDocumentId(), s.sourceTitle(), s.sourceUrl(), s.sourcePublishTime(), s.status(), s.isExample()};
    }
    public long insert(ServiceItemDTO s) {
        var keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("INSERT INTO service_item (code,name,category,description,department,location,office_hours,contact,requirements,materials,recognition_rules,deadline,source_document_id,source_title,source_url,source_publish_time,status,is_example) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", new String[]{"id"});
            Object[] values = values(s);
            for (int i = 0; i < values.length; i++) statement.setObject(i + 1, values[i]);
            return statement;
        }, keys);
        return java.util.Objects.requireNonNull(keys.getKey()).longValue();
    }
    public boolean update(long id, ServiceItemDTO s) {
        var args = new java.util.ArrayList<>(java.util.Arrays.asList(values(s)));
        args.add(id); args.add(s.version());
        return jdbc.update("UPDATE service_item SET code=?,name=?,category=?,description=?,department=?,location=?,office_hours=?,contact=?,requirements=?,materials=?,recognition_rules=?,deadline=?,source_document_id=?,source_title=?,source_url=?,source_publish_time=?,status=?,is_example=?,version=version+1 WHERE id=? AND version=?", args.toArray()) == 1;
    }
    public boolean delete(long id, int version) { return jdbc.update("DELETE FROM service_item WHERE id=? AND version=?", id, version) == 1; }
    private String write(Object value) {
        try { return json.writeValueAsString(value); }
        catch (Exception e) { throw new IllegalArgumentException("办事数据格式无效"); }
    }
    private <T> T read(String value, TypeReference<T> type) {
        try { return json.readValue(value, type); }
        catch (Exception e) { throw new IllegalStateException("Invalid stored service data", e); }
    }
}
