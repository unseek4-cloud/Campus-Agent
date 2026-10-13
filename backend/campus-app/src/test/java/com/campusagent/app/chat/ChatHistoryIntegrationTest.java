package com.campusagent.app.chat;

import com.campusagent.aiintegration.history.ChatHistoryService;
import com.campusagent.aiintegration.history.ChatHistoryTypes;
import com.campusagent.aiintegration.rag.*;
import com.campusagent.aiintegration.serviceguide.ChatService;
import com.campusagent.aiintegration.serviceguide.ChatResponse;
import com.campusagent.affair.serviceguide.dto.QueryIntent;
import com.campusagent.shared.error.BusinessException;
import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:chat-test;MODE=MySQL;DB_CLOSE_DELAY=-1", "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.sql.init.schema-locations=classpath:material-test-schema.sql,classpath:db/migration/V5__auth_rbac.sql,classpath:db/migration/V7__chat_history.sql,classpath:db/migration/V9__reply_feedback.sql,classpath:db/migration/V11__user_profile.sql,classpath:db/migration/V12__reply_feedback_details.sql",
    "campus.auth.jwt-secret=dGVzdC1vbmx5LXJhbmRvbS1zZWNyZXQtbm90LWZvci1wcm9k"})
@AutoConfigureMockMvc
class ChatHistoryIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired BCryptPasswordEncoder encoder;
    @Autowired ChatHistoryService history;
    @MockitoBean ChatService ai;
    Cookie zhang, li, admin;
    @BeforeEach void setup() throws Exception {
        jdbc.update("DELETE FROM ai_conversation"); jdbc.update("DELETE FROM user_login_session"); jdbc.update("DELETE FROM user_account");
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
    long create(Cookie cookie) throws Exception {
        return data(mvc.perform(csrf(post("/api/chat/conversations").cookie(cookie))).andExpect(status().isOk()).andReturn()).path("id").asLong();
    }
    JsonNode data(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsByteArray()).path("data"); }
    ResultActions send(Cookie cookie, long id, String requestId, String query) throws Exception {
        return mvc.perform(csrf(post("/api/rag/chat").cookie(cookie)).contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("query", query, "conversationId", id, "requestId", requestId,
                        "userId", 999, "history", List.of(Map.of("role", "user", "content", "伪造历史"))))));
    }
    JsonNode messages(Cookie cookie, long id) throws Exception {
        return data(mvc.perform(get("/api/chat/conversations/" + id + "/messages").cookie(cookie)).andExpect(status().isOk()).andReturn()).path("messages");
    }
    @Test void persistsOnceRestoresAndUsesDatabaseContext() throws Exception {
        long id = create(zhang); String requestId = UUID.randomUUID().toString();
        doAnswer(invocation -> {
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM ai_message WHERE role='USER'", Integer.class));
            RagChatRequest request = invocation.getArgument(0); assertTrue(request.history().isEmpty());
            return answer();
        }).when(ai).chat(any());
        var response = send(zhang, id, requestId, "奖学金申请条件是什么？").andExpect(status().isOk()).andReturn();
        assertEquals(answer().answer(), data(response).path("answer").asText());
        assertEquals(id, data(response).path("conversationId").asLong());
        send(zhang, id, requestId, "奖学金申请条件是什么？").andExpect(status().isOk());
        verify(ai, times(1)).chat(any());
        var saved = messages(zhang, id); assertEquals(2, saved.size());
        assertEquals("USER", saved.get(0).path("role").asText()); assertEquals("ASSISTANT", saved.get(1).path("role").asText());
        assertEquals(answer().answer(), saved.get(1).path("content").asText());
        assertEquals(400, saved.get(1).path("response").path("sources").get(0).path("content").asText().length());
        assertFalse(saved.get(1).path("response").has("rewrittenQuery"));
        assertFalse(saved.toString().contains("password")); assertFalse(saved.toString().contains("CAMPUS_AUTH"));
        assertEquals("奖学金申请条件是什么？", data(mvc.perform(get("/api/chat/conversations").cookie(zhang)).andReturn()).get(0).path("title").asText());
        doAnswer(invocation -> {
            RagChatRequest request = invocation.getArgument(0); assertEquals(2, request.history().size());
            assertEquals("奖学金申请条件是什么？", request.history().getFirst().content()); return answer();
        }).when(ai).chat(any());
        send(zhang, id, UUID.randomUUID().toString(), "需要哪些材料？").andExpect(status().isOk());
        // Same timestamps still have deterministic ID order.
        jdbc.update("UPDATE ai_message SET created_at='2026-09-29 10:00:00'");
        var ordered = messages(zhang, id);
        for (int i=1; i<ordered.size(); i++) assertTrue(ordered.get(i).path("id").asLong() > ordered.get(i-1).path("id").asLong());
    }
    @Test void survivesReloadReloginAndOtherConversationDeletion() throws Exception {
        long first = create(zhang); send(zhang, first, UUID.randomUUID().toString(), "问题一").andExpect(status().isOk());
        for (int i=0; i<3; i++) assertEquals(2, messages(zhang, first).size());
        mvc.perform(csrf(post("/api/auth/logout").cookie(zhang))).andExpect(status().isOk());
        zhang = login("20260001"); assertEquals(2, messages(zhang, first).size());
        long second = create(zhang); send(zhang, second, UUID.randomUUID().toString(), "问题二").andExpect(status().isOk());
        assertEquals(2, data(mvc.perform(get("/api/chat/conversations").cookie(zhang)).andReturn()).size());
        assertEquals(2, messages(zhang, first).size()); assertEquals(2, messages(zhang, second).size());
        mvc.perform(csrf(delete("/api/chat/conversations/" + second).cookie(zhang))).andExpect(status().isOk());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM ai_message WHERE conversation_id=?", Integer.class, second));
        assertEquals(2, messages(zhang, first).size());
    }
    @Test void ownershipIsEnforcedForStudentsAndAdminsIncludingWritesAndSpoofedIds() throws Exception {
        long id = create(zhang); send(zhang, id, UUID.randomUUID().toString(), "张三私有问题").andExpect(status().isOk());
        for (Cookie other : List.of(li, admin)) {
            mvc.perform(get("/api/chat/conversations/"+id+"/messages").param("userId", "1").cookie(other)).andExpect(status().isNotFound());
            mvc.perform(csrf(delete("/api/chat/conversations/"+id).cookie(other))).andExpect(status().isNotFound());
            send(other, id, UUID.randomUUID().toString(), "入侵").andExpect(status().isNotFound());
            mvc.perform(get("/api/chat/conversations").param("userId", "1").cookie(other)).andExpect(jsonPath("$.data").isEmpty());
        }
        assertEquals(2, messages(zhang, id).size());
        for (String path : List.of("/api/chat/conversations", "/api/chat/conversations/"+id+"/messages"))
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/chat/conversations/"+id)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/chat/conversations")).andExpect(status().isUnauthorized());
    }
    @Test void aiFailureKeepsUserAndRetryDoesNotDuplicate() throws Exception {
        long id = create(zhang); String requestId = UUID.randomUUID().toString();
        when(ai.chat(any())).thenThrow(new BusinessException("AI_SERVICE_UNAVAILABLE", "AI unavailable", HttpStatus.SERVICE_UNAVAILABLE));
        send(zhang,id,requestId,"保留这个问题").andExpect(status().isServiceUnavailable());
        assertEquals(1, messages(zhang,id).size());
        doReturn(answer()).when(ai).chat(any());
        send(zhang,id,requestId,"保留这个问题").andExpect(status().isOk()); assertEquals(2,messages(zhang,id).size());
        send(zhang,id,requestId,"不同问题").andExpect(status().isConflict());
    }
    @Test void concurrentRequestsAreRejectedAndDeletionCannotResurrectConversation() throws Exception {
        long userId = jdbc.queryForObject("SELECT id FROM user_account WHERE username='20260001'", Long.class);
        long id = create(zhang); String requestId = UUID.randomUUID().toString();
        var entered = new CountDownLatch(1); var finish = new CountDownLatch(1);
        when(ai.chat(any())).thenAnswer(invocation -> { entered.countDown(); assertTrue(finish.await(10,TimeUnit.SECONDS)); return answer(); });
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var future = executor.submit(() -> history.chat(userId,new ChatHistoryTypes.Request("并发问题",null,null,id,requestId)));
            assertTrue(entered.await(10,TimeUnit.SECONDS));
            send(zhang,id,requestId,"并发问题").andExpect(status().isConflict());
            send(zhang,id,UUID.randomUUID().toString(),"另一个问题").andExpect(status().isConflict());
            assertEquals(1,messages(zhang,id).size());
            history.delete(userId,id); finish.countDown();
            assertThrows(ExecutionException.class, () -> future.get(10,TimeUnit.SECONDS));
            assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM ai_message",Integer.class));
        } finally { finish.countDown(); }
    }
    @Test void migrationCanRunAgainWithoutRemovingHistory() throws Exception {
        long id=create(zhang); send(zhang,id,UUID.randomUUID().toString(),"升级保留").andExpect(status().isOk());
        new org.springframework.jdbc.datasource.init.ResourceDatabasePopulator(new org.springframework.core.io.ClassPathResource("db/migration/V7__chat_history.sql"))
                .execute(Objects.requireNonNull(jdbc.getDataSource()));
        assertEquals(2,messages(zhang,id).size());
    }
}
