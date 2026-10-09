package com.campusagent.identity.security;

import com.campusagent.identity.user.UserRepository;
import com.campusagent.shared.api.ApiResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.*;
import org.springframework.web.cors.*;
import java.io.IOException;
import java.util.*;

@Configuration
public class SecurityConfiguration {
    @Bean BCryptPasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(10); }
    @Bean CookieCsrfTokenRepository csrfTokens(@Value("${campus.auth.cookie-secure:false}") boolean secure) {
        var csrf = new CookieCsrfTokenRepository();
        csrf.setCookiePath("/api");
        csrf.setCookieCustomizer(builder -> builder.httpOnly(true).secure(secure).sameSite("Lax"));
        return csrf;
    }
    @Bean SecurityFilterChain security(HttpSecurity http, JwtService jwt, AuthCookie cookie, UserRepository users,
            LoginSessions sessions, ObjectMapper json, CookieCsrfTokenRepository csrf,
            @Value("${campus.auth.allowed-origins:http://localhost:5173,http://127.0.0.1:5173}") String origins) throws Exception {
        var cors = new CorsConfiguration();
        cors.setAllowedOrigins(Arrays.stream(origins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList());
        cors.setAllowCredentials(true);
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Content-Type", "X-XSRF-TOKEN"));
        cors.setExposedHeaders(List.of("Content-Disposition"));
        var source = new UrlBasedCorsConfigurationSource(); source.registerCorsConfiguration("/api/**", cors);
        return http.cors(c -> c.configurationSource(source))
                // JWT identity is rebuilt on every request, not a new login on every request.
                // Rotate CSRF explicitly in AuthController only at login/logout boundaries.
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(c -> c.csrfTokenRepository(csrf).sessionAuthenticationStrategy(
                        new org.springframework.security.web.authentication.session.NullAuthenticatedSessionStrategy()))
                .addFilterBefore(new JwtAuthenticationFilter(jwt, cookie, users, sessions), CsrfFilter.class)
                .authorizeHttpRequests(a -> a
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/health", "/api/auth/csrf").permitAll()
                        // 公开只读分享：随机 token 即凭证，不需要登录，也不开放写操作
                        .requestMatchers(HttpMethod.GET, "/api/share/**").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/login", "/api/auth/logout").permitAll()
                        .requestMatchers("/api/admin/**").hasRole("ADMIN")
                        .requestMatchers("/api/student/**").hasRole("STUDENT")
                        .requestMatchers("/api/**").hasAnyRole("STUDENT", "ADMIN")
                        .anyRequest().denyAll())
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((req, res, ex) -> error(json, res, 401, "AUTH_REQUIRED", "请先登录"))
                        .accessDeniedHandler((req, res, ex) -> {
                            var auth = SecurityContextHolder.getContext().getAuthentication();
                            boolean authenticated = auth != null && auth.isAuthenticated()
                                    && !(auth instanceof org.springframework.security.authentication.AnonymousAuthenticationToken);
                            if (!authenticated && !req.getRequestURI().startsWith("/api/auth/"))
                                error(json, res, 401, "AUTH_REQUIRED", "请先登录");
                            else if (ex instanceof CsrfException) error(json, res, 403, "CSRF_INVALID", "页面验证已过期，请刷新后重试");
                            else error(json, res, 403, "ACCESS_DENIED", "你没有权限访问该页面。");
                        }))
                .requestCache(c -> c.disable()).httpBasic(c -> c.disable()).formLogin(c -> c.disable())
                .logout(c -> c.disable()).build();
    }
    private static void error(ObjectMapper json, HttpServletResponse response, int status, String code, String message) throws IOException {
        response.setStatus(status); response.setContentType("application/json;charset=UTF-8");
        json.writeValue(response.getWriter(), ApiResponse.error(code, message));
    }
}
