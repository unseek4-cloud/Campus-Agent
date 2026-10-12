package com.campusagent.affair.application.dto;

import com.campusagent.affair.application.model.*;
import java.time.LocalDateTime;
import java.util.List;

public record ApplicationDetail(ApplicationRecord application, List<Attachment> attachments, List<Event> events,
        List<MaterialRequirement> materials) {
    public record Attachment(String id, long applicationId, String filename, String contentType,
            long fileSize, LocalDateTime uploadedAt, String materialId, String materialName) {}
    public record MaterialRequirement(String id, String name, String description, boolean required) {}
    public record Event(long id, ApplicationStatus fromStatus, ApplicationStatus toStatus,
            String actorName, String actorRole, String remark, LocalDateTime createdAt) {}
    public record Page(List<ApplicationRecord> items, long total, int page, int pageSize) {}
    public record Review(ApplicationStatus status, String remark, int version) {}
}
