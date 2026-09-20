package com.campusagent.app.admin;

import java.time.LocalDateTime;

public record DocumentRecord(String id, String knowledgeBaseId, String displayName,
        String originalFilename, String fileType, String mimeType, long fileSize,
        String fileHash, String status, int chunkCount, String errorMessage,
        LocalDateTime createdAt, LocalDateTime updatedAt,
        String parseStatus, int progress, int totalPages, int processedPages, String ocrProvider) {
    public DocumentRecord(String id, String knowledgeBaseId, String displayName,
            String originalFilename, String fileType, String mimeType, long fileSize,
            String fileHash, String status, int chunkCount, String errorMessage,
            LocalDateTime createdAt, LocalDateTime updatedAt) {
        this(id, knowledgeBaseId, displayName, originalFilename, fileType, mimeType, fileSize,
                fileHash, status, chunkCount, errorMessage, createdAt, updatedAt,
                status.equals("SUCCESS") ? "COMPLETED" : status.equals("FAILED") ? "FAILED" : "UPLOADED",
                status.equals("SUCCESS") ? 100 : 0, 0, 0, "none");
    }
}
