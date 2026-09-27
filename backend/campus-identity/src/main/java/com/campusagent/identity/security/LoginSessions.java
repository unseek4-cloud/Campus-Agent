package com.campusagent.identity.security;

import com.campusagent.identity.user.UserAccount;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

@Repository
public class LoginSessions {
    private final JdbcTemplate jdbc;
    public LoginSessions(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public String create(UserAccount account, Instant expires) {
        jdbc.update("DELETE FROM user_login_session WHERE expires_at <= ?", Timestamp.from(Instant.now()));
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO user_login_session(id,user_id,credential_stamp,expires_at) VALUES (?,?,?,?)",
                id, account.user().id(), stamp(account.passwordHash()), Timestamp.from(expires));
        return id;
    }
    public boolean valid(String id, UserAccount account) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT COUNT(*) > 0 FROM user_login_session WHERE id=? AND user_id=? AND credential_stamp=? AND expires_at>?",
                Boolean.class, id, account.user().id(), stamp(account.passwordHash()), Timestamp.from(Instant.now())));
    }
    public void revoke(String id) { jdbc.update("DELETE FROM user_login_session WHERE id=?", id); }
    // Fingerprints an already salted BCrypt hash, never the user's plaintext password.
    private String stamp(String hash) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(hash.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
