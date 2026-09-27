package com.campusagent.identity.security;

import jakarta.servlet.http.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import java.time.Duration;
import java.time.Instant;

@Component
public class AuthCookie {
    public static final String NAME = "CAMPUS_AUTH";
    private final boolean secure;
    public AuthCookie(@Value("${campus.auth.cookie-secure:false}") boolean secure) { this.secure = secure; }
    public String read(HttpServletRequest request) {
        if (request.getCookies() != null) for (Cookie cookie : request.getCookies())
            if (NAME.equals(cookie.getName())) return cookie.getValue();
        return null;
    }
    public void set(HttpServletResponse response, String jwt, Instant expires) {
        write(response, jwt, Duration.between(Instant.now(), expires));
    }
    public void clear(HttpServletResponse response) { write(response, "", Duration.ZERO); }
    private void write(HttpServletResponse response, String value, Duration age) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(NAME, value).httpOnly(true)
                .secure(secure).sameSite("Lax").path("/api").maxAge(age).build().toString());
    }
}
