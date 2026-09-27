package com.campusagent.affair.application.model;

import java.time.LocalDateTime;

/** Account and service display fields are submission-time snapshots. */
public record ApplicationRecord(long id, String applicationNo, long serviceItemId, String serviceName,
        long userId, String username, String applicantName, String studentNo, ApplicationStatus status,
        String studentRemark, String adminRemark, int version,
        LocalDateTime submittedAt, LocalDateTime updatedAt, LocalDateTime completedAt) {}
