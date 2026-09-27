package com.campusagent.identity.security;

import com.campusagent.identity.user.UserRepository;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.List;

/** Installed only inside SecurityFilterChain, not as a second servlet filter. */
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private final JwtService jwt;
    private final AuthCookie cookie;
    private final UserRepository users;
    private final LoginSessions sessions;
    public JwtAuthenticationFilter(JwtService jwt, AuthCookie cookie, UserRepository users, LoginSessions sessions) {
        this.jwt = jwt; this.cookie = cookie; this.users = users; this.sessions = sessions;
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        String token = cookie.read(request);
        if (token != null) {
            try {
                var claims = jwt.decode(token);
                var account = users.findById(Long.parseLong(claims.getSubject())).orElse(null);
                if (account != null && account.active() && sessions.valid(claims.getId(), account)) {
                    var principal = new UserPrincipal(account.user(), claims.getId());
                    var authentication = UsernamePasswordAuthenticationToken.authenticated(principal, null,
                            List.of(new SimpleGrantedAuthority("ROLE_" + account.user().role())));
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                } else { cookie.clear(response); }
            } catch (JwtException | IllegalArgumentException e) { cookie.clear(response); }
        }
        chain.doFilter(request, response);
    }
}
