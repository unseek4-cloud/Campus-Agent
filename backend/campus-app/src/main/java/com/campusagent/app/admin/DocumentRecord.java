package com.campusagent.app.admin;

import java.time.LocalDateTime;

public record DocumentRecord(String id, String knowledgeBaseId, String displayName,
        String originalFilename, String fileType, String mimeType, long fileSize,
        String fileHash, String status, int chunkCount, String errorMessage,
        LocalDateTime createdAt, LocalDateTime updatedAt) { }
