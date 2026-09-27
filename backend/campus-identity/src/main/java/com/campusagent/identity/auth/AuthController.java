package com.campusagent.identity.auth;

import com.campusagent.identity.security.*;
import com.campusagent.identity.user.UserView;
import com.campusagent.shared.api.ApiResponse;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService service;
    private final AuthCookie cookie;
    private final CookieCsrfTokenRepository csrfTokens;
    public AuthController(AuthService service, AuthCookie cookie, CookieCsrfTokenRepository csrfTokens) {
        this.service = service; this.cookie = cookie; this.csrfTokens = csrfTokens;
    }
    @GetMapping("/csrf") public ApiResponse<Map<String,String>> csrf(CsrfToken csrf) {
        return ApiResponse.success(Map.of("token", csrf.getToken(), "headerName", csrf.getHeaderName()));
    }
    @PostMapping("/login") public ApiResponse<LoginResponse> login(@RequestBody LoginRequest body,
            @AuthenticationPrincipal UserPrincipal previous, HttpServletRequest request, HttpServletResponse response) {
        var result = service.login(body.username(), body.password(), previous);
        cookie.set(response, result.token(), result.expires());
        csrfTokens.saveToken(null, request, response);
        return ApiResponse.success(new LoginResponse(true, result.user()));
    }
    @GetMapping("/me") public ApiResponse<UserView> me(@AuthenticationPrincipal UserPrincipal principal) {
        return ApiResponse.success(principal.user());
    }
    @PostMapping("/logout") public ApiResponse<Map<String,Boolean>> logout(@AuthenticationPrincipal UserPrincipal principal, HttpServletRequest request, HttpServletResponse response) {
        service.logout(principal); cookie.clear(response);
        csrfTokens.saveToken(null, request, response);
        return ApiResponse.success(Map.of("success", true));
    }
    public record LoginRequest(String username, String password) {
        @Override public String toString() { return "LoginRequest[REDACTED]"; }
    }
    public record LoginResponse(boolean success, UserView user) {}
}
