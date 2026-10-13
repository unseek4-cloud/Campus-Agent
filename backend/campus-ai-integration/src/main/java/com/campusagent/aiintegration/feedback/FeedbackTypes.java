package com.campusagent.aiintegration.feedback;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public final class FeedbackTypes {
    private FeedbackTypes() { }
    public static List<String> reasons(String stored) {
        return stored == null || stored.isBlank() ? List.of() : List.of(stored.split(","));
    }
    public record Feedback(String rating, LocalDateTime updatedAt, List<String> reasons, String comment) { }
    public record RatingRequest(String rating, List<String> reasons, String comment) { }
    public record ReviewRequest(String issueType, String handlingStatus, String adminNote, int version) { }
    public record Trend(LocalDate date, long positive, long negative) { }
    public record Summary(long total, long positive, long negative, double positiveRate,
                          String accessScope, List<Trend> trend) { }
    public record Record(long id, long messageId, String question, String answer, JsonNode response,
                         String rating, LocalDateTime createdAt, LocalDateTime updatedAt, List<String> reasons, String comment,
                         String issueType, String handlingStatus, String adminNote,
                         LocalDateTime reviewedAt, int version) { }
    public record Page(List<Record> items, long total, int page, int pageSize) { }
}
