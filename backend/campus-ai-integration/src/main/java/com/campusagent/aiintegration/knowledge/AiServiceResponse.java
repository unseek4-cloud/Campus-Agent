package com.campusagent.aiintegration.knowledge;

import java.time.OffsetDateTime;

/** Minimal representation of the AI service's unified response envelope. */
public record AiServiceResponse<T>(
        String code,
        String message,
        T data,
        String requestId,
        OffsetDateTime timestamp
) {
}
