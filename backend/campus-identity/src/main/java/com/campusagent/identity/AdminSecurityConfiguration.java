package com.campusagent.identity;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

/** Environment-backed administrator, without introducing account tables or a login system. */
@Configuration
public class AdminSecurityConfiguration {
    @Bean
    UserDetailsService administrators(@Value("${campus.admin.username:}") String username,
            @Value("${campus.admin.password:}") String password) {
        var users = new InMemoryUserDetailsManager();
        if (!username.isBlank() && !password.isBlank()) {
            users.createUser(User.withUsername(username).password("{bcrypt}" + new BCryptPasswordEncoder().encode(password))
                    .roles("ADMIN").build());
        }
        return users;
    }
    @Bean
    SecurityFilterChain administratorSecurity(HttpSecurity http) throws Exception {
        return http.securityMatcher("/api/admin/**")
                .authorizeHttpRequests(auth -> auth.anyRequest().hasRole("ADMIN"))
                .httpBasic(basic -> basic.authenticationEntryPoint((request, response, failure) -> {
                    response.setStatus(401); response.setContentType("application/json;charset=UTF-8");
                    response.getWriter().write("{\"code\":\"ADMIN_AUTH_REQUIRED\",\"message\":\"请输入正确的管理员账号和密码\",\"data\":null}");
                }))
                .exceptionHandling(errors -> errors.accessDeniedHandler((request, response, failure) -> {
                    response.setStatus(403); response.setContentType("application/json;charset=UTF-8");
                    response.getWriter().write("{\"code\":\"ADMIN_ACCESS_DENIED\",\"message\":\"无管理员权限或验证已过期，请重新验证\",\"data\":null}");
                }))
                // Keep default session-backed CSRF protection for HTTP Basic browser clients.
                .requestCache(cache -> cache.disable()).formLogin(form -> form.disable())
                .logout(logout -> logout.disable()).build();
    }
}
