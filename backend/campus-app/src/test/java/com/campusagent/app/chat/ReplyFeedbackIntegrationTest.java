package com.campusagent.app.chat;

import com.campusagent.aiintegration.feedback.FeedbackService;
import com.campusagent.aiintegration.rag.*;
import com.campusagent.aiintegration.serviceguide.*;
import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.core.io.ClassPathResource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:feedback-test;MODE=MySQL;DB_CLOSE_DELAY=-1", "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.sql.init.schema-locations=classpath:material-test-schema.sql,classpath:db/migration/V5__auth_rbac.sql,classpath:db/migration/V7__chat_history.sql,classpath:db/migration/V8__conversation_share.sql,classpath:db/migration/V9__reply_feedback.sql",
    "campus.auth.jwt-secret=dGVzdC1vbmx5LXJhbmRvbS1zZWNyZXQtbm90LWZvci1wcm9k"})
@AutoConfigureMockMvc
class ReplyFeedbackIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired BCryptPasswordEncoder encoder;
    @Autowired FeedbackService feedback;
    @MockitoBean ChatService ai;
    Cookie student, second, admin, scoped;
    long studentId, secondId, adminId, scopedId;
    @BeforeEach void setup() throws Exception {
        jdbc.update("DELETE FROM ai_conversation"); jdbc.update("DELETE FROM user_login_session"); jdbc.update("DELETE FROM user_account");
        for (String name : List.of("student", "second", "admin", "scoped")) jdbc.update(
                "INSERT INTO user_account(username,password_hash,display_name,role) VALUES (?,?,?,?)", name, encoder.encode("test-password"), name,
                name.equals("admin") || name.equals("scoped") ? "ADMIN" : "STUDENT");
        studentId=id("student");secondId=id("second");adminId=id("admin");scopedId=id("scoped");
        jdbc.update("INSERT INTO ai_feedback_admin_access(admin_id,access_scope) VALUES (?,'ALL'),(?,'ASSIGNED')",adminId,scopedId);
        jdbc.update("INSERT INTO ai_feedback_admin_user_scope(admin_id,user_id) VALUES (?,?)",scopedId,studentId);
        student=login("student");second=login("second");admin=login("admin");scoped=login("scoped");
        when(ai.chat(any())).thenReturn(ChatResponse.qa(new RagChatResponse("学校通知中的回答", List.of(new RagSource("doc-1","奖学金规定.pdf",2,3,.8,.9,"引用摘要")),10,5,1,"检索问题"), com.campusagent.affair.serviceguide.dto.ServiceRecognitionResponse.unmatched()));
    }
    long id(String username) {return jdbc.queryForObject("SELECT id FROM user_account WHERE username=?",Long.class,username);}
    MockHttpServletRequestBuilder csrf(MockHttpServletRequestBuilder builder) throws Exception {
        var response=mvc.perform(get("/api/auth/csrf")).andReturn().getResponse();var token=json.readTree(response.getContentAsByteArray()).path("data");
        return builder.cookie(response.getCookies()).header(token.path("headerName").asText(),token.path("token").asText());
    }
    Cookie login(String name) throws Exception {return mvc.perform(csrf(post("/api/auth/login")).contentType("application/json").content(json.writeValueAsBytes(Map.of("username",name,"password","test-password")))).andExpect(status().isOk()).andReturn().getResponse().getCookie("CAMPUS_AUTH");}
    JsonNode data(MvcResult result) throws Exception {return json.readTree(result.getResponse().getContentAsByteArray()).path("data");}
    JsonNode turn(Cookie user, Long conversation, String query) throws Exception {
        var body=new HashMap<String,Object>();body.put("query",query);body.put("requestId",UUID.randomUUID().toString());body.put("knowledgeBaseId","kb-test");if(conversation!=null)body.put("conversationId",conversation);
        return data(mvc.perform(csrf(post("/api/rag/chat").cookie(user)).contentType("application/json").content(json.writeValueAsBytes(body))).andExpect(status().isOk()).andReturn());
    }
    ResultActions rate(Cookie user,long message,String rating) throws Exception {return mvc.perform(csrf(put("/api/chat/messages/"+message+"/feedback").cookie(user)).contentType("application/json").content(json.writeValueAsBytes(Map.of("rating",rating,"userId",secondId))));}
    JsonNode messages(Cookie user,long conversation) throws Exception {return data(mvc.perform(get("/api/chat/conversations/"+conversation+"/messages").cookie(user)).andExpect(status().isOk()).andReturn()).path("messages");}
    JsonNode summary(Cookie user,String params) throws Exception {return data(mvc.perform(get("/api/admin/ai-quality/summary"+params).cookie(user)).andExpect(status().isOk()).andReturn());}
    JsonNode list(Cookie user,String params) throws Exception {return data(mvc.perform(get("/api/admin/ai-quality/feedback"+params).cookie(user)).andExpect(status().isOk()).andReturn());}
    String path(long message) {return "/api/chat/messages/"+message+"/feedback";}
    @Test void submitModifyCancelAndRestoreIndependentFeedback() throws Exception {
        var first=turn(student,null,"条件是什么？");long c=first.path("conversationId").asLong(),m=first.path("assistantMessageId").asLong();
        var next=turn(student,c,"需要材料吗？");long other=next.path("assistantMessageId").asLong();
        rate(student,m,"POSITIVE").andExpect(status().isOk()).andExpect(jsonPath("$.data.rating").value("POSITIVE"));
        var timestamp=messages(student,c).get(1).path("feedback").path("updatedAt");
        rate(student,m,"POSITIVE").andExpect(status().isOk());assertEquals(timestamp,messages(student,c).get(1).path("feedback").path("updatedAt"));
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM ai_reply_feedback",Integer.class));
        rate(student,other,"NEGATIVE").andExpect(status().isOk());rate(student,m,"NEGATIVE").andExpect(status().isOk());
        student=login("student");assertEquals("NEGATIVE",messages(student,c).get(1).path("feedback").path("rating").asText());
        mvc.perform(csrf(delete(path(m)).cookie(student))).andExpect(status().isOk());mvc.perform(csrf(delete(path(m)).cookie(student))).andExpect(status().isOk());
        assertTrue(messages(student,c).get(1).path("feedback").isNull());assertEquals("NEGATIVE",messages(student,c).get(3).path("feedback").path("rating").asText());
    }
    @Test void denyCrossUserUserMessagesAnonymousAndMissingCsrf() throws Exception {
        var t=turn(student,null,"私有问题");long m=t.path("assistantMessageId").asLong();
        for(Cookie other:List.of(second,admin,scoped)){rate(other,m,"NEGATIVE").andExpect(status().isNotFound());mvc.perform(csrf(delete(path(m)).cookie(other))).andExpect(status().isNotFound());}
        rate(student,t.path("userMessageId").asLong(),"POSITIVE").andExpect(status().isNotFound());rate(student,m,"INVALID").andExpect(status().isBadRequest());
        mvc.perform(put(path(m)).cookie(student).contentType("application/json").content("{\"rating\":\"POSITIVE\"}")).andExpect(status().isForbidden());
        mvc.perform(put(path(m)).contentType("application/json").content("{\"rating\":\"POSITIVE\"}")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/ai-quality/summary").cookie(student)).andExpect(status().isForbidden());mvc.perform(get("/api/admin/ai-quality/summary")).andExpect(status().isUnauthorized());
    }
    @Test void concurrentDuplicateSubmissionsKeepOneRow() throws Exception {
        long m=turn(student,null,"并发评价").path("assistantMessageId").asLong();
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()){
            var work=new ArrayList<Future<?>>();for(int i=0;i<12;i++)work.add(executor.submit(()->feedback.rate(studentId,m,"POSITIVE")));
            for(var result:work)result.get(15,TimeUnit.SECONDS);
        }
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM ai_reply_feedback",Integer.class));
    }
    @Test void statisticsTrendFiltersPaginationAndAssignedScopes() throws Exception {
        long good=turn(student,null,"好问题").path("assistantMessageId").asLong(),bad=turn(second,null,"差问题").path("assistantMessageId").asLong();
        rate(student,good,"POSITIVE").andExpect(status().isOk());rate(second,bad,"NEGATIVE").andExpect(status().isOk());
        var s=summary(admin,"");assertEquals(2,s.path("total").asLong());assertEquals(1,s.path("positive").asLong());assertEquals(1,s.path("negative").asLong());assertEquals(50,s.path("positiveRate").asDouble());
        var today=s.path("trend").get(29);assertEquals(1,today.path("positive").asLong());assertEquals(1,today.path("negative").asLong());
        assertEquals(1,summary(scoped,"?scope=ALL&userId="+secondId).path("total").asLong());assertEquals(0,summary(scoped,"?rating=NEGATIVE").path("total").asLong());
        var rows=list(admin,"?rating=NEGATIVE&page=1&pageSize=1");assertEquals(1,rows.path("total").asLong());assertEquals("差问题",rows.path("items").get(0).path("question").asText());assertEquals("doc-1",rows.path("items").get(0).path("response").path("sources").get(0).path("documentId").asText());
        assertFalse(rows.toString().contains("password"));assertEquals(0,list(admin,"?page=3&pageSize=1").path("items").size());
        jdbc.update("UPDATE ai_reply_feedback SET updated_at='2026-01-02 23:59:59' WHERE message_id=?",bad);
        assertEquals(1,summary(admin,"?startDate=2026-01-02&endDate=2026-01-02").path("total").asLong());
        assertEquals(0,summary(admin,"?startDate=2026-01-03&endDate=2026-01-03").path("total").asLong());
        for(String params:List.of("?startDate=2026-10-10&endDate=2026-01-01","?rating=BAD","?startDate=2024-01-01&endDate=2026-10-10"))mvc.perform(get("/api/admin/ai-quality/summary"+params).cookie(admin)).andExpect(status().isBadRequest());
        mvc.perform(get("/api/admin/ai-quality/feedback?pageSize=101").cookie(admin)).andExpect(status().isBadRequest());
    }
    @Test void reviewIsScopedVersionedAndResetsOnChangedFeedback() throws Exception {
        long m=turn(second,null,"需要核查").path("assistantMessageId").asLong();rate(second,m,"NEGATIVE").andExpect(status().isOk());
        long id=list(admin,"").path("items").get(0).path("id").asLong();String body="{\"issueType\":\"KNOWLEDGE_GAP\",\"handlingStatus\":\"RESOLVED\",\"adminNote\":\"补充通知\",\"version\":0}";
        mvc.perform(csrf(patch("/api/admin/ai-quality/feedback/"+id).cookie(scoped)).contentType("application/json").content(body)).andExpect(status().isNotFound());
        mvc.perform(csrf(patch("/api/admin/ai-quality/feedback/"+id).cookie(admin)).contentType("application/json").content(body)).andExpect(status().isOk());
        mvc.perform(csrf(patch("/api/admin/ai-quality/feedback/"+id).cookie(admin)).contentType("application/json").content(body)).andExpect(status().isConflict());
        var r=list(admin,"").path("items").get(0);assertEquals("RESOLVED",r.path("handlingStatus").asText());assertEquals("补充通知",r.path("adminNote").asText());
        rate(second,m,"POSITIVE").andExpect(status().isOk());rate(second,m,"NEGATIVE").andExpect(status().isOk());
        r=list(admin,"").path("items").get(0);assertEquals("OPEN",r.path("handlingStatus").asText());assertEquals("",r.path("adminNote").asText());
        mvc.perform(csrf(patch("/api/admin/ai-quality/feedback/"+id).cookie(admin)).contentType("application/json").content(body)).andExpect(status().isConflict());
    }
    @Test void missingGrantFailsClosedAndMigrationDoesNotRestoreRevokedAccess() throws Exception {
        jdbc.update("DELETE FROM ai_feedback_admin_access WHERE admin_id=?",adminId);
        mvc.perform(get("/api/admin/ai-quality/summary").cookie(admin)).andExpect(status().isForbidden());
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V9__reply_feedback.sql")).execute(Objects.requireNonNull(jdbc.getDataSource()));
        mvc.perform(get("/api/admin/ai-quality/feedback").cookie(admin)).andExpect(status().isForbidden());
        assertEquals("ASSIGNED",jdbc.queryForObject("SELECT access_scope FROM ai_feedback_admin_access WHERE admin_id=?",String.class,scopedId));
    }
    @Test void regenerationPreservesHistoryFeedbackAndUsesOriginalContextAndKnowledgeBase() throws Exception {
        var first=turn(student,null,"前文");long c=first.path("conversationId").asLong();var source=turn(student,c,"原问题");long m=source.path("assistantMessageId").asLong();turn(student,c,"后来换了主题");
        rate(student,m,"NEGATIVE").andExpect(status().isOk());
        doAnswer(invocation->{RagChatRequest request=invocation.getArgument(0);assertEquals("原问题",request.query());assertEquals("kb-test",request.knowledgeBaseId());assertEquals(2,request.history().size());assertEquals("前文",request.history().getFirst().content());return ChatResponse.qa(new RagChatResponse("重新生成的答案",List.of(),0,0,0,"原问题"), com.campusagent.affair.serviceguide.dto.ServiceRecognitionResponse.unmatched());}).when(ai).chat(any());
        String body=json.writeValueAsString(Map.of("requestId",UUID.randomUUID().toString()));
        for(Cookie other:List.of(second,admin))mvc.perform(csrf(post("/api/chat/messages/"+m+"/regenerate").cookie(other)).contentType("application/json").content(body)).andExpect(status().isNotFound());
        for(int i=0;i<2;i++)mvc.perform(csrf(post("/api/chat/messages/"+m+"/regenerate").cookie(student)).contentType("application/json").content(body)).andExpect(status().isOk());
        var saved=messages(student,c);assertEquals(8,saved.size());assertEquals("NEGATIVE",saved.get(3).path("feedback").path("rating").asText());assertEquals("重新生成的答案",saved.get(7).path("content").asText());verify(ai,times(4)).chat(any());
    }
    @Test void publicSharesExcludePrivateFeedbackAndMigrationPreservesRows() throws Exception {
        var t=turn(student,null,"分享问题");long c=t.path("conversationId").asLong(),m=t.path("assistantMessageId").asLong();rate(student,m,"NEGATIVE").andExpect(status().isOk());
        var share=data(mvc.perform(csrf(post("/api/chat/conversations/"+c+"/shares").cookie(student))).andExpect(status().isOk()).andReturn());
        var publicData=data(mvc.perform(get("/api/share/chat/"+share.path("token").asText())).andExpect(status().isOk()).andReturn());assertFalse(publicData.toString().contains("feedback"));assertFalse(publicData.toString().contains("adminNote"));
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V9__reply_feedback.sql")).execute(Objects.requireNonNull(jdbc.getDataSource()));assertEquals(2,messages(student,c).size());assertEquals("NEGATIVE",messages(student,c).get(1).path("feedback").path("rating").asText());
        mvc.perform(csrf(delete("/api/chat/conversations/"+c).cookie(student))).andExpect(status().isOk());assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM ai_reply_feedback",Integer.class));
    }
}
