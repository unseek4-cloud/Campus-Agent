package com.campusagent.identity;

import com.campusagent.shared.api.ApiResponse;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;
import java.security.Principal;
import java.util.Map;

@RestController
public class AdminSessionController {
    @GetMapping("/api/admin/session")
    public ApiResponse<Map<String, String>> session(Principal principal, CsrfToken csrf) {
        return ApiResponse.success(Map.of("username", principal.getName(), "csrfToken", csrf.getToken(), "csrfHeader", csrf.getHeaderName()));
    }
}
