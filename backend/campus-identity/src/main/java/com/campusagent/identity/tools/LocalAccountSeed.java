package com.campusagent.identity.tools;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import java.security.SecureRandom;
import java.sql.*;
import java.util.*;

/** Explicit local initialization command; never runs during application startup. */
public final class LocalAccountSeed {
    public static void main(String[] args) throws SQLException {
        if (!"true".equals(System.getenv("CAMPUS_ALLOW_LOCAL_SEED")))
            throw new IllegalStateException("Run scripts/manage-accounts.ps1 -Action Seed explicitly in local development");
        var encoder = new BCryptPasswordEncoder(10);
        var random = new SecureRandom();
        var created = new ArrayList<String>();
        try (var connection = DriverManager.getConnection(required("DB_URL"), required("DB_USERNAME"), required("DB_PASSWORD"))) {
            connection.setAutoCommit(false);
            try {
                for (String[] row : List.of(new String[]{"admin", "系统管理员", "ADMIN", null},
                        new String[]{"20260001", "张三", "STUDENT", "20260001"}, new String[]{"20260002", "李四", "STUDENT", "20260002"})) {
                    try (var query = connection.prepareStatement("SELECT id FROM user_account WHERE username=?")) {
                        query.setString(1, row[0]);
                        try (var result = query.executeQuery()) { if (result.next()) { System.out.println("Skipped existing account: " + row[0]); continue; } }
                    }
                    byte[] bytes = new byte[18]; random.nextBytes(bytes);
                    String password = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
                    try (var insert = connection.prepareStatement("INSERT INTO user_account(username,password_hash,display_name,role,student_no,status) VALUES (?,?,?,?,?,'ACTIVE')")) {
                        insert.setString(1, row[0]); insert.setString(2, encoder.encode(password)); insert.setString(3, row[1]);
                        insert.setString(4, row[2]); insert.setString(5, row[3]); insert.executeUpdate();
                    }
                    created.add(row[0] + " : " + password);
                }
                connection.commit();
            } catch (SQLException | RuntimeException e) { connection.rollback(); throw e; }
        }
        System.out.println("Local test credentials (shown once; change or delete before deployment):");
        created.forEach(System.out::println);
    }
    private static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing environment variable: " + key);
        return value;
    }
}
