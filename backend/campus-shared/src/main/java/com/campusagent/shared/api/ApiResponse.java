package com.campusagent.shared.api;

import java.time.Instant;
import java.util.UUID;

/**
 * 所有普通 JSON API 使用的统一响应结构。
 *
 * @param code 稳定的业务结果码
 * @param message 面向调用方的简短信息
 * @param data 响应数据
 * @param requestId 本次响应的追踪标识
 * @param timestamp 响应生成时间
 */
public record ApiResponse<T>(
        String code,
        String message,
        T data,
        String requestId,
        Instant timestamp
) {
    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>("OK", "success", data, newRequestId(), Instant.now());
    }

    public static <T> ApiResponse<T> error(String code, String message) {
        return new ApiResponse<>(code, message, null, newRequestId(), Instant.now());
    }

    private static String newRequestId() {
        return UUID.randomUUID().toString();
    }
}

