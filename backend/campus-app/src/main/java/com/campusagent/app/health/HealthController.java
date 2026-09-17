package com.campusagent.app.health;

import com.campusagent.shared.api.ApiResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 仅表示 Java 进程可响应；数据库等依赖状态后续另设 readiness 检查。 */
@RestController
@RequestMapping("/api/v1")
public class HealthController {
    private final String applicationName;
    private final String applicationVersion;

    public HealthController(
            @Value("${spring.application.name}") String applicationName,
            @Value("${app.version}") String applicationVersion
    ) {
        this.applicationName = applicationName;
        this.applicationVersion = applicationVersion;
    }

    @GetMapping("/health")
    public ApiResponse<HealthResponse> health() {
        return ApiResponse.success(new HealthResponse("UP", applicationName, applicationVersion));
    }

    public record HealthResponse(String status, String service, String version) {
    }
}

