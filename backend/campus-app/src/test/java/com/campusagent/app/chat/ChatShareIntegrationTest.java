package com.campusagent.app.chat;

import com.campusagent.aiintegration.rag.*;
import com.campusagent.aiintegration.serviceguide.ChatResponse;
import com.campusagent.aiintegration.serviceguide.ChatService;
import com.campusagent.affair.serviceguide.dto.QueryIntent;
import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 公开分享 token：拥有者创建/撤销，访客凭 token 只读读取，越权与失效都必须拒绝。 */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:share-test;MODE=MySQL;DB_CLOSE_DELAY=-1", "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.sql.init.schema-locations=classpath:material-test-schema.sql,classpath:db/migration/V5__auth_rbac.sql,classpath:db/migration/V7__chat_history.sql,classpath:db/migration/V8__conversation_share.sql,classpath:db/migration/V9__reply_feedback.sql",
    "campus.auth.jwt-secret=dGVzdC1vbmx5LXJhbmRvbS1zZWNyZXQtbm90LWZvci1wcm9k"})
@AutoConfigureMockMvc
class ChatShareIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired BCryptPasswordEncoder encoder;
    @MockitoBean ChatService ai;
    Cookie zhang, li, admin;

    @BeforeEach void setup() throws Exception {
        jdbc.update("DELETE FROM ai_conversation_share");
        jdbc.update("DELETE FROM ai_conversation");
        jdbc.update("DELETE FROM user_login_session");
        jdbc.update("DELETE FROM user_account");
        for (String name : List.of("20260001", "20260002", "admin")) {
            jdbc.update("INSERT INTO user_account(username,password_hash,display_name,role) VALUES (?,?,?,?)", name,
                    encoder.encode("test-password"), name, name.equals("admin") ? "ADMIN" : "STUDENT");
        }
        zhang = login("20260001"); li = login("20260002"); admin = login("admin");
        when(ai.chat(any())).thenReturn(answer());
    }

    ChatResponse answer() {
        return new ChatResponse("QA", "**申请条件**：请查看学校通知。", List.of(new RagSource("doc-1", "奖学金规定.pdf", 2, 3, .8, .9, "原文".repeat(1000))),
                10, 5, 1, "改写问题", null, List.of(), null, null, false, QueryIntent.ELIGIBILITY_QA, new ChatResponse.RelatedService("SCHOLARSHIP_APPLICATION", "奖学金申请"));
    }
    MockHttpServletRequestBuilder csrf(MockHttpServletRequestBuilder builder) throws Exception {
        var response = mvc.perform(get("/api/auth/csrf")).andReturn().getResponse();
        var token = json.readTree(response.getContentAsByteArray()).path("data");
        return builder.cookie(response.getCookies()).header(token.path("headerName").asText(), token.path("token").asText());
    }
    Cookie login(String username) throws Exception {
        return mvc.perform(csrf(post("/api/auth/login")).contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("username", username, "password", "test-password"))))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("CAMPUS_AUTH");
    }
    JsonNode data(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsByteArray()).path("data"); }
    long conversationWithAnswer(Cookie cookie, String query) throws Exception {
        long id = data(mvc.perform(csrf(post("/api/chat/conversations").cookie(cookie))).andExpect(status().isOk()).andReturn()).path("id").asLong();
        mvc.perform(csrf(post("/api/rag/chat").cookie(cookie)).contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("query", query, "conversationId", id, "requestId", UUID.randomUUID().toString()))))
                .andExpect(status().isOk());
        return id;
    }
    String share(Cookie cookie, long id) throws Exception {
        return data(mvc.perform(csrf(post("/api/chat/conversations/" + id + "/shares").cookie(cookie)))
                .andExpect(status().isOk()).andReturn()).path("token").asText();
    }
    /** 带 messageIds 的分享请求，返回原始响应体。 */
    MvcResult shareMessages(Cookie cookie, long id, List<Long> messageIds) throws Exception {
        return mvc.perform(csrf(post("/api/chat/conversations/" + id + "/shares").cookie(cookie)).contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("messageIds", messageIds)))).andExpect(status().isOk()).andReturn();
    }
    ResultActions publicView(String token) throws Exception { return mvc.perform(get("/api/share/chat/" + token)); }

    @Test void ownerCreatesShareAndAnonymousVisitorReadsIt() throws Exception {
        long id = conversationWithAnswer(zhang, "奖学金申请条件是什么？");
        var created = data(mvc.perform(csrf(post("/api/chat/conversations/" + id + "/shares").cookie(zhang))).andReturn());
        String token = created.path("token").asText();
        assertEquals(43, token.length(), "URL-safe base64 of 32 bytes");
        assertTrue(token.matches("[A-Za-z0-9_-]{43}"));
        assertEquals(id, created.path("conversationId").asLong());
        assertFalse(created.path("revoked").asBoolean());
        assertTrue(created.path("expiresAt").asText().compareTo(LocalDateTime.now().plusDays(29).toString()) > 0, "默认 30 天有效");

        // 访客：不带任何 cookie / 不登录
        var view = data(publicView(token).andExpect(status().isOk()).andReturn());
        assertEquals(2, view.path("messages").size());
        assertEquals("USER", view.path("messages").get(0).path("role").asText());
        assertEquals("奖学金申请条件是什么？", view.path("messages").get(0).path("content").asText());
        assertEquals("ASSISTANT", view.path("messages").get(1).path("role").asText());
        assertEquals(answer().answer(), view.path("messages").get(1).path("content").asText());
        assertEquals("奖学金规定.pdf", view.path("messages").get(1).path("response").path("sources").get(0).path("fileName").asText());
        assertEquals(1, view.path("viewCount").asInt());

        // 重复点击复用同一条链接；访问次数累加
        assertEquals(token, share(zhang, id));
        assertEquals(2, data(publicView(token).andReturn()).path("viewCount").asInt());
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM ai_conversation_share", Integer.class));

        // 拥有者能看到自己的分享列表
        var list = data(mvc.perform(get("/api/chat/conversations/" + id + "/shares").cookie(zhang)).andExpect(status().isOk()).andReturn());
        assertEquals(1, list.size());
        assertEquals(token, list.get(0).path("token").asText());
    }

    @Test void revokedExpiredAndUnknownTokensAreGone() throws Exception {
        long id = conversationWithAnswer(zhang, "过期与撤销");
        String token = share(zhang, id);
        publicView(token).andExpect(status().isOk());

        mvc.perform(csrf(delete("/api/chat/conversations/" + id + "/shares/" + token).cookie(zhang))).andExpect(status().isOk());
        publicView(token).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("SHARE_NOT_FOUND"));
        assertTrue(jdbc.queryForObject("SELECT revoked FROM ai_conversation_share WHERE token=?", Boolean.class, token));
        // 撤销后重新分享会生成新链接，旧链接保持失效
        String fresh = share(zhang, id);
        assertNotEquals(token, fresh);
        publicView(token).andExpect(status().isNotFound());
        publicView(fresh).andExpect(status().isOk());

        jdbc.update("UPDATE ai_conversation_share SET expires_at=? WHERE token=?", Timestamp.valueOf(LocalDateTime.now().minusMinutes(1)), fresh);
        publicView(fresh).andExpect(status().isNotFound());

        publicView("z".repeat(43)).andExpect(status().isNotFound());
        publicView("short").andExpect(status().isNotFound());
    }

    @Test void ownershipAndAuthenticationAreEnforced() throws Exception {
        long id = conversationWithAnswer(zhang, "张三的私有对话");
        String token = share(zhang, id);

        // 其它账号（含管理员）不能为学生创建或读取分享链接
        mvc.perform(csrf(post("/api/chat/conversations/" + id + "/shares").cookie(li))).andExpect(status().isNotFound());
        mvc.perform(get("/api/chat/conversations/" + id + "/shares").cookie(admin)).andExpect(status().isNotFound());
        mvc.perform(csrf(delete("/api/chat/conversations/" + id + "/shares/" + token).cookie(li))).andExpect(status().isNotFound());

        // 未登录不能创建、列出、撤销
        mvc.perform(post("/api/chat/conversations/" + id + "/shares")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/chat/conversations/" + id + "/shares")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/chat/conversations/" + id + "/shares/" + token)).andExpect(status().isUnauthorized());

        // 自己的另一段会话不能用来撤销这段会话的 token
        long other = conversationWithAnswer(zhang, "另一段会话");
        mvc.perform(csrf(delete("/api/chat/conversations/" + other + "/shares/" + token).cookie(zhang))).andExpect(status().isNotFound());
        publicView(token).andExpect(status().isOk());
    }

    @Test void publicPayloadIsReadOnlyAndLeaksNothing() throws Exception {
        long id = conversationWithAnswer(zhang, "泄露检查");
        String token = share(zhang, id);

        // 公开路由只允许 GET
        mvc.perform(post("/api/share/chat/" + token)).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/share/chat/" + token)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/share/chat")).andExpect(status().isNotFound());
        mvc.perform(get("/api/share/chat/" + token + "/messages")).andExpect(status().isNotFound());

        String body = publicView(token).andReturn().getResponse().getContentAsString();
        var view = json.readTree(body).path("data");
        // 只看 data：信封里的 requestId 是接口统一的追踪字段，不是会话内容
        String payload = view.toString();
        assertTrue(json.readTree(body).has("requestId"));
        assertFalse(payload.contains("requestId"), "消息的 requestId 不外泄");
        assertFalse(payload.contains("password"));
        assertFalse(payload.contains("20260001"));
        assertFalse(payload.contains("userId"));
        assertFalse(payload.contains("rewrittenQuery"));
        // 引用正文在保存时已截断，公开读取不会放大
        assertTrue(view.path("messages").get(1).path("response").path("sources").get(0).path("content").asText().length() <= 400);
    }

    @Test void selectedMessagesCanBeSharedWithoutTheRest() throws Exception {
        long id = conversationWithAnswer(zhang, "只分享其中几条");
        var all = data(mvc.perform(get("/api/chat/conversations/" + id + "/messages").cookie(zhang)).andReturn()).path("messages");
        long userId = all.get(0).path("id").asLong();
        long answerId = all.get(1).path("id").asLong();

        var onlyAnswer = data(shareMessages(zhang, id, List.of(answerId))).path("messageIds");
        assertEquals(answerId, onlyAnswer.get(0).asLong());
        String answerToken = data(shareMessages(zhang, id, List.of(answerId))).path("token").asText();
        var view = data(publicView(answerToken).andExpect(status().isOk()).andReturn());
        assertEquals(1, view.path("messages").size());
        assertEquals("ASSISTANT", view.path("messages").get(0).path("role").asText());
        assertEquals(1, view.path("messageIds").size());

        // 相同选择复用同一条链接
        assertEquals(answerToken, data(shareMessages(zhang, id, List.of(answerId))).path("token").asText());
        // 不同选择是另一条链接，两条同时有效
        String userToken = data(shareMessages(zhang, id, List.of(userId))).path("token").asText();
        assertNotEquals(answerToken, userToken);
        assertEquals("USER", data(publicView(userToken).andReturn()).path("messages").get(0).path("role").asText());
        // 整段会话链接与选择链接互不影响
        String whole = share(zhang, id);
        assertNotEquals(answerToken, whole);
        assertEquals(2, data(publicView(whole).andReturn()).path("messages").size());
        assertEquals(0, data(publicView(whole).andReturn()).path("messageIds").size());
        assertEquals(3, jdbc.queryForObject("SELECT COUNT(*) FROM ai_conversation_share", Integer.class));

        // 不属于该会话的消息 id 必须拒绝
        long other = conversationWithAnswer(zhang, "另一段会话");
        var otherMessages = data(mvc.perform(get("/api/chat/conversations/" + other + "/messages").cookie(zhang)).andReturn()).path("messages");
        mvc.perform(csrf(post("/api/chat/conversations/" + id + "/shares").cookie(zhang)).contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("messageIds", List.of(otherMessages.get(0).path("id").asLong())))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("SHARE_MESSAGE_NOT_FOUND"));

        // 撤销其中一条不影响其它链接
        mvc.perform(csrf(delete("/api/chat/conversations/" + id + "/shares/" + answerToken).cookie(zhang))).andExpect(status().isOk());
        publicView(answerToken).andExpect(status().isNotFound());
        publicView(userToken).andExpect(status().isOk());
        publicView(whole).andExpect(status().isOk());
    }

    @Test void deletingConversationRemovesItsSharesAndMigrationIsRepeatable() throws Exception {
        long id = conversationWithAnswer(zhang, "级联删除");
        String token = share(zhang, id);
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V8__conversation_share.sql"))
                .execute(Objects.requireNonNull(jdbc.getDataSource()));
        publicView(token).andExpect(status().isOk());

        mvc.perform(csrf(delete("/api/chat/conversations/" + id).cookie(zhang))).andExpect(status().isOk());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM ai_conversation_share", Integer.class));
        publicView(token).andExpect(status().isNotFound());
    }
}
