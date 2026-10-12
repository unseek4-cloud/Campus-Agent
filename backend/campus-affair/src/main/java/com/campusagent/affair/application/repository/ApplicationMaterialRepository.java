package com.campusagent.affair.application.repository;

import com.campusagent.affair.application.dto.ApplicationDetail.MaterialRequirement;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class ApplicationMaterialRepository {
    private final JdbcTemplate jdbc;
    public ApplicationMaterialRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public void snapshot(long applicationId, List<MaterialRequirement> materials) {
        for (var material : materials) jdbc.update(
                "INSERT INTO service_application_material(application_id,material_id,material_name,description,required) VALUES (?,?,?,?,?)",
                applicationId, material.id(), material.name(), material.description(), material.required());
    }
    public List<MaterialRequirement> list(long applicationId) {
        return jdbc.query("SELECT * FROM service_application_material WHERE application_id=? ORDER BY required DESC,material_id",
                (r,n) -> new MaterialRequirement(r.getString("material_id"), r.getString("material_name"),
                        r.getString("description"), r.getBoolean("required")), applicationId);
    }
}
