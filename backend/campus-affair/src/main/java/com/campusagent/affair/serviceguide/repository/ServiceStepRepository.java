package com.campusagent.affair.serviceguide.repository;

import com.campusagent.affair.serviceguide.dto.ServiceStepDTO;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class ServiceStepRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public ServiceStepRepository(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }
    public List<ServiceStepDTO> list(long itemId) {
        return jdbc.query("SELECT * FROM service_step WHERE service_item_id=? ORDER BY step_order", (r, n) -> {
            try {
                return new ServiceStepDTO(r.getLong("id"), r.getInt("step_order"), r.getString("title"),
                        r.getString("description"), r.getString("responsible_department"),
                        json.readValue(r.getString("required_materials"), new TypeReference<List<String>>() {}),
                        r.getString("location"), r.getString("estimated_time"));
            } catch (java.io.IOException e) { throw new IllegalStateException("Invalid step materials", e); }
        }, itemId);
    }
    /** Called inside the aggregate transaction; order is normalized by the service. */
    public void replace(long itemId, List<ServiceStepDTO> steps) {
        jdbc.update("DELETE FROM service_step WHERE service_item_id=?", itemId);
        for (int i = 0; i < steps.size(); i++) {
            var s = steps.get(i);
            try {
                jdbc.update("INSERT INTO service_step (service_item_id,step_order,title,description,responsible_department,required_materials,location,estimated_time) VALUES (?,?,?,?,?,?,?,?)",
                        itemId, i + 1, s.title(), s.description(), s.responsibleDepartment(),
                        json.writeValueAsString(s.requiredMaterials()), s.location(), s.estimatedTime());
            } catch (java.io.IOException e) { throw new IllegalArgumentException("步骤材料格式无效"); }
        }
    }
}
