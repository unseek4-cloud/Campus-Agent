package com.campusagent.identity.auth;

import com.campusagent.identity.user.*;
import com.campusagent.identity.security.*;
import com.campusagent.shared.error.BusinessException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;

@Service
public class AuthService {
    private final UserRepository users;
    private final BCryptPasswordEncoder encoder;
    private final LoginSessions sessions;
    private final JwtService jwt;
    private final String dummyHash;
    public AuthService(UserRepository users, BCryptPasswordEncoder encoder, LoginSessions sessions, JwtService jwt) {
        this.users = users; this.encoder = encoder; this.sessions = sessions; this.jwt = jwt;
        dummyHash = encoder.encode(UUID.randomUUID().toString());
    }
    @Transactional
    public LoginResult login(String username, String password, UserPrincipal previous) {
        if (username == null || username.isBlank() || username.length() > 80 || password == null || password.isEmpty()
                || password.getBytes(StandardCharsets.UTF_8).length > 72) throw invalid();
        var account = users.findByUsername(username.trim()).orElse(null);
        boolean matches = encoder.matches(password, account == null ? dummyHash : account.passwordHash());
        if (account == null || !matches) throw invalid();
        if (!account.active()) throw new BusinessException("ACCOUNT_DISABLED", "该账号已被禁用，请联系管理员。", HttpStatus.FORBIDDEN);
        if (previous != null) sessions.revoke(previous.sessionId());
        Instant expires = jwt.expiresAt();
        String session = sessions.create(account, expires);
        return new LoginResult(account.user(), jwt.issue(account.user().id(), session, expires), expires);
    }
    public void logout(UserPrincipal principal) { if (principal != null) sessions.revoke(principal.sessionId()); }
    private BusinessException invalid() { return new BusinessException("BAD_CREDENTIALS", "账号或密码错误", HttpStatus.UNAUTHORIZED); }
    public record LoginResult(UserView user, String token, Instant expires) {
        @Override public String toString() { return "LoginResult[userId=" + user.id() + "]"; }
    }
}
