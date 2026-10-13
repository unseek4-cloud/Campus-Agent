package com.campusagent.app.auth;

import com.campusagent.identity.security.JwtService;
import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.*;
import java.time.Instant;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:auth-test;MODE=MySQL;DB_CLOSE_DELAY=-1", "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.sql.init.schema-locations=classpath:material-test-schema.sql,classpath:db/migration/V5__auth_rbac.sql,classpath:db/migration/V11__user_profile.sql",
        "campus.auth.jwt-secret=dGVzdC1vbmx5LXJhbmRvbS1zZWNyZXQtbm90LWZvci1wcm9k"})
@AutoConfigureMockMvc
class AuthIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired BCryptPasswordEncoder encoder;
    @Autowired JwtService jwt;
    @BeforeEach void accounts() {
        jdbc.update("DELETE FROM user_login_session"); jdbc.update("DELETE FROM user_account");
        add("admin", "ADMIN", null); add("20260001", "STUDENT", "20260001");
    }
    void add(String username, String role, String studentNo) {
        jdbc.update("INSERT INTO user_account(username,password_hash,display_name,role,student_no) VALUES (?,?,?,?,?)",
                username, encoder.encode("test-password"), username, role, studentNo);
    }
    MvcResult login(String username, String password) throws Exception {
        return mvc.perform(withCsrf(post("/api/auth/login")).contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("username", username, "password", password)))).andReturn();
    }
    org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder withCsrf(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder builder) throws Exception {
        var response = mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn().getResponse();
        var token = json.readTree(response.getContentAsByteArray()).path("data");
        return builder.cookie(response.getCookies()).header(token.path("headerName").asText(), token.path("token").asText());
    }
    Cookie login(String username) throws Exception {
        var result = login(username, "test-password"); assertEquals(200, result.getResponse().getStatus());
        return result.getResponse().getCookie("CAMPUS_AUTH");
    }
    @Test void rolesAndSafeDtoAndPersistentCookie() throws Exception {
        var result = login("admin", "test-password");
        assertEquals(200, result.getResponse().getStatus());
        String body = result.getResponse().getContentAsString();
        assertFalse(body.contains("password")); assertFalse(body.contains("token"));
        var cookie = result.getResponse().getCookie("CAMPUS_AUTH");
        assertTrue(cookie.isHttpOnly()); assertEquals("/api", cookie.getPath()); assertTrue(cookie.getMaxAge() > 0);
        assertTrue(result.getResponse().getHeader("Set-Cookie").contains("SameSite=Lax"));
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isOk()).andExpect(jsonPath("$.data.role").value("ADMIN"));
        for (String path : new String[]{"/api/admin/overview", "/api/admin/documents", "/api/admin/services", "/api/admin/material-attachments/config"})
            mvc.perform(get(path).cookie(cookie)).andExpect(status().isOk());
        var student = login("20260001");
        mvc.perform(get("/api/auth/me").cookie(student)).andExpect(jsonPath("$.data.studentNo").value("20260001"));
        mvc.perform(get("/api/services").cookie(student)).andExpect(status().isOk());
        mvc.perform(get("/api/knowledge/documents/missing/file").cookie(student)).andExpect(status().isNotFound());
        mvc.perform(get("/api/knowledge/documents/missing/file").cookie(cookie)).andExpect(status().isNotFound());
        mvc.perform(get("/api/knowledge/documents/missing/file")).andExpect(status().isUnauthorized());
    }
    @Test void studentForbiddenAnonymousUnauthorizedIncludingWritesAndUnknownAdminPaths() throws Exception {
        var student = login("20260001");
        for (String path : new String[]{"/api/admin/services", "/api/admin/documents", "/api/admin/xxx"}) {
            mvc.perform(get(path).cookie(student)).andExpect(status().isForbidden());
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/admin/services").contentType("application/json").content("{}")).andExpect(status().isUnauthorized());
        mvc.perform(withCsrf(post("/api/admin/services").cookie(student)).contentType("application/json").content("{}")).andExpect(status().isForbidden());
        mvc.perform(get("/api/services")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/health")).andExpect(status().isOk());
        mvc.perform(get("/api/admin/services").with(httpBasic("admin", "test-password"))).andExpect(status().isUnauthorized());
    }
    @Test void profileDetailsAreReturnedForCurrentAccountOnly() throws Exception {
        long studentId=jdbc.queryForObject("SELECT id FROM user_account WHERE username='20260001'",Long.class);
        jdbc.update("INSERT INTO user_profile(user_id,department,major,class_name) VALUES (?,?,?,?)", studentId,"计算机学院","软件工程","软工2601班");
        var result=login("20260001","test-password");
        assertEquals(200,result.getResponse().getStatus());
        var cookie=result.getResponse().getCookie("CAMPUS_AUTH");
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.department").value("计算机学院"))
                .andExpect(jsonPath("$.data.major").value("软件工程"))
                .andExpect(jsonPath("$.data.className").value("软工2601班"));
        mvc.perform(get("/api/auth/me").cookie(login("admin"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.major").isEmpty()).andExpect(jsonPath("$.data.className").isEmpty());
    }
    @Test void badCredentialsAndSqlInjectionAreIndistinguishable() throws Exception {
        for (String name : new String[]{"admin", "missing", "admin' OR '1'='1"}) {
            var result = login(name, "wrong-password"); assertEquals(401, result.getResponse().getStatus());
            assertEquals("账号或密码错误", json.readTree(result.getResponse().getContentAsByteArray()).path("message").asText());
        }
    }
    @Test void disabledAndPasswordResetInvalidateExistingSessionsAndDatabaseAccountWorks() throws Exception {
        var cookie = login("20260001");
        jdbc.update("UPDATE user_account SET status='DISABLED' WHERE username='20260001'");
        assertEquals(403, login("20260001", "test-password").getResponse().getStatus());
        assertEquals(401, login("20260001", "wrong").getResponse().getStatus());
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isUnauthorized());
        jdbc.update("UPDATE user_account SET status='ACTIVE' WHERE username='20260001'");
        cookie = login("20260001");
        jdbc.update("UPDATE user_account SET password_hash=? WHERE username='20260001'", encoder.encode("new-password"));
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isUnauthorized());
        assertEquals(401, login("20260001", "test-password").getResponse().getStatus());
        assertEquals(200, login("20260001", "new-password").getResponse().getStatus());
        add("20260003", "STUDENT", "20260003");
        mvc.perform(get("/api/auth/me").cookie(login("20260003"))).andExpect(jsonPath("$.data.username").value("20260003"));
    }
    @Test void logoutRevokesCopiedCookieAndRoleChangesApplyImmediately() throws Exception {
        var cookie = login("admin");
        jdbc.update("UPDATE user_account SET role='STUDENT' WHERE username='admin'");
        mvc.perform(get("/api/admin/services").cookie(cookie)).andExpect(status().isForbidden());
        mvc.perform(withCsrf(post("/api/auth/logout").cookie(cookie))).andExpect(status().isOk())
                .andExpect(cookie().maxAge("CAMPUS_AUTH", 0));
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isUnauthorized());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM user_login_session", Integer.class));
    }
    @Test void realCsrfCookieAndCorsAndTamperedTokens() throws Exception {
        mvc.perform(post("/api/auth/login").contentType("application/json").content("{}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("CSRF_INVALID"));
        var csrfResult = mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn();
        var csrfBody = json.readTree(csrfResult.getResponse().getContentAsByteArray()).path("data");
        var result = mvc.perform(post("/api/auth/login").cookie(csrfResult.getResponse().getCookies())
                .header(csrfBody.path("headerName").asText(), csrfBody.path("token").asText()).contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"test-password\"}")).andExpect(status().isOk()).andReturn();
        var cookie = result.getResponse().getCookie("CAMPUS_AUTH");
        mvc.perform(post("/api/auth/logout").cookie(cookie)).andExpect(status().isForbidden());
        cookie.setValue(cookie.getValue() + "tampered");
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isUnauthorized());
        mvc.perform(options("/api/admin/services").header("Origin", "http://localhost:5173").header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Credentials", "true"));
        mvc.perform(options("/api/admin/services").header("Origin", "https://evil.example").header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden());
    }
    @Test void expiredJwtRejectedAndConstraintsEnforced() throws Exception {
        long id = jdbc.queryForObject("SELECT id FROM user_account WHERE username='admin'", Long.class);
        var expired = new com.nimbusds.jwt.SignedJWT(new com.nimbusds.jose.JWSHeader(com.nimbusds.jose.JWSAlgorithm.HS256),
                new com.nimbusds.jwt.JWTClaimsSet.Builder().issuer("campus-agent").subject(Long.toString(id))
                        .jwtID(java.util.UUID.randomUUID().toString()).issueTime(java.util.Date.from(Instant.now().minusSeconds(600)))
                        .expirationTime(java.util.Date.from(Instant.now().minusSeconds(300))).build());
        expired.sign(new com.nimbusds.jose.crypto.MACSigner(java.util.Base64.getDecoder().decode("dGVzdC1vbmx5LXJhbmRvbS1zZWNyZXQtbm90LWZvci1wcm9k")));
        mvc.perform(get("/api/auth/me").cookie(new Cookie("CAMPUS_AUTH", expired.serialize()))).andExpect(status().isUnauthorized());
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> add("admin", "ADMIN", null));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> add("other", "STUDENT", "20260001"));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                () -> jdbc.update("UPDATE user_account SET password_hash='123456' WHERE username='admin'"));
    }
    @Test void authenticatedReadsAndRepeatedWritesDoNotRotateCsrfEveryRequest() throws Exception {
        var auth = login("admin");
        var csrfResponse = mvc.perform(get("/api/auth/csrf").cookie(auth)).andReturn().getResponse();
        var csrf = json.readTree(csrfResponse.getContentAsByteArray()).path("data");
        var tokenCookie = csrfResponse.getCookie("XSRF-TOKEN");
        assertNotNull(tokenCookie);
        for (int i = 0; i < 3; i++) {
            mvc.perform(get("/api/auth/me").cookie(auth, tokenCookie)).andExpect(status().isOk())
                    .andExpect(cookie().doesNotExist("XSRF-TOKEN"));
            // Body validation proves the authenticated request passed both RBAC and CSRF.
            mvc.perform(post("/api/admin/services").cookie(auth, tokenCookie)
                    .header(csrf.path("headerName").asText(), csrf.path("token").asText())
                    .contentType("application/json").content("{}"))
                    .andExpect(status().isBadRequest()).andExpect(cookie().doesNotExist("XSRF-TOKEN"));
        }
        mvc.perform(post("/api/auth/logout").cookie(auth, tokenCookie)
                .header(csrf.path("headerName").asText(), csrf.path("token").asText()))
                .andExpect(status().isOk()).andExpect(cookie().maxAge("XSRF-TOKEN", 0));
    }
}
