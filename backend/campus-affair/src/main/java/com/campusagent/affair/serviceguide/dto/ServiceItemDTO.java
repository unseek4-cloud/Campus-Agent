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
    public record Material(String name, String description, boolean required) { }
    public record RecognitionRules(List<String> subjects, List<String> actions, List<String> exclusions) { }
}
