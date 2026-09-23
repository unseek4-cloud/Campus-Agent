package com.campusagent.affair.serviceguide.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** Public module contract; JSON collections stay structured and can evolve independently. */
public record ServiceItemDTO(Long id, String code, String name, String category, String description,
        String department, String location, String officeHours, String contact,
        List<String> requirements, List<Material> materials, RecognitionRules recognitionRules,
        String deadline, String sourceDocumentId, String sourceTitle, String sourceUrl,
        LocalDate sourcePublishTime, String status, boolean isExample, int version,
        LocalDateTime createdAt, LocalDateTime updatedAt) {
    public record Material(String id, String name, String description, boolean required,
            @com.fasterxml.jackson.annotation.JsonProperty(access = com.fasterxml.jackson.annotation.JsonProperty.Access.READ_ONLY)
            MaterialAttachmentDTO attachment) {
        public Material(String name, String description, boolean required) { this(null, name, description, required, null); }
    }
    public ServiceItemDTO withMaterials(List<Material> materials) {
        return new ServiceItemDTO(id, code, name, category, description, department, location, officeHours, contact,
                requirements, materials, recognitionRules, deadline, sourceDocumentId, sourceTitle, sourceUrl,
                sourcePublishTime, status, isExample, version, createdAt, updatedAt);
    }
    public record RecognitionRules(List<String> subjects, List<String> actions, List<String> exclusions) { }
}
