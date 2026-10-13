package com.campusagent.identity.user;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public class UserRepository {
    private final JdbcTemplate jdbc;
    private static final RowMapper<UserAccount> MAPPER = (rs, row) -> new UserAccount(
            new UserView(rs.getLong("id"), rs.getString("username"), rs.getString("display_name"),
                    rs.getString("role"), rs.getString("student_no"), rs.getString("department"),
                    rs.getString("major"), rs.getString("class_name")), rs.getString("password_hash"), rs.getString("status"));
    private static final String ACCOUNT = "SELECT u.*,p.department,p.major,p.class_name FROM user_account u "
            + "LEFT JOIN user_profile p ON p.user_id=u.id ";
    public UserRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public Optional<UserAccount> findByUsername(String username) {
        return jdbc.query(ACCOUNT + "WHERE u.username=?", MAPPER, username).stream().findFirst();
    }
    public Optional<UserAccount> findById(long id) {
        return jdbc.query(ACCOUNT + "WHERE u.id=?", MAPPER, id).stream().findFirst();
    }
}
