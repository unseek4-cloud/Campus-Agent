package com.campusagent.app.application;

import com.campusagent.affair.application.service.ApplicationService;
import com.campusagent.identity.user.UserRepository;
import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.mock.web.MockMultipartFile;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={
    "spring.datasource.url=jdbc:h2:mem:application-test;MODE=MySQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.sql.init.schema-locations=classpath:material-test-schema.sql,classpath:db/migration/V5__auth_rbac.sql,classpath:db/migration/V6__service_application.sql,classpath:db/migration/V10__application_materials.sql,classpath:db/migration/V11__user_profile.sql",
    "campus.admin.max-upload-size-mb=1", "campus.auth.jwt-secret=dGVzdC1vbmx5LXJhbmRvbS1zZWNyZXQtbm90LWZvci1wcm9k"
})
@AutoConfigureMockMvc
class ApplicationIntegrationTest {
    @TempDir static Path storage;
    @DynamicPropertySource static void paths(DynamicPropertyRegistry registry) { registry.add("campus.application.storage-path", () -> storage.toString()); }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired BCryptPasswordEncoder encoder;
    @Autowired ApplicationService service;
    @Autowired UserRepository users;
    Cookie student, other, admin;
    long itemId;
    @BeforeEach void setup() throws Exception {
        for (String table : List.of("service_application_attachment_material","service_application_material","service_application_event","service_application_attachment","service_application","service_step","service_material_attachment","service_item","user_login_session","user_account")) jdbc.update("DELETE FROM " + table);
        String hash = encoder.encode("test-password");
        for (String username : List.of("20260001","20260002","admin"))
            jdbc.update("INSERT INTO user_account(username,password_hash,display_name,role,student_no) VALUES (?,?,?,?,?)",
                    username,hash,"姓名"+username,username.equals("admin") ? "ADMIN":"STUDENT",username.equals("admin") ? null:username);
        jdbc.update("INSERT INTO service_item(code,name,category,requirements,materials,recognition_rules,status) VALUES ('TEST_APP','学生证补办','学生事务','[]','[]','{\"subjects\":[\"学生证\"],\"actions\":[\"补办\"],\"exclusions\":[]}','ACTIVE')");
        itemId=jdbc.queryForObject("SELECT id FROM service_item WHERE code='TEST_APP'",Long.class);
        student=login("20260001"); other=login("20260002"); admin=login("admin");
    }
    @AfterEach void cleanupFiles() throws Exception {
        try (var files=Files.list(storage)) { for (var file:files.toList()) Files.delete(file); }
    }
    MockHttpServletRequestBuilder csrf(MockHttpServletRequestBuilder builder) throws Exception {
        var response=mvc.perform(get("/api/auth/csrf")).andReturn().getResponse();
        var data=json.readTree(response.getContentAsByteArray()).path("data");
        return builder.cookie(response.getCookies()).header(data.path("headerName").asText(),data.path("token").asText());
    }
    Cookie login(String username) throws Exception {
        return mvc.perform(csrf(post("/api/auth/login")).contentType("application/json").content(json.writeValueAsBytes(Map.of("username",username,"password","test-password"))))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("CAMPUS_AUTH");
    }
    JsonNode data(ResultActions result) throws Exception { return json.readTree(result.andReturn().getResponse().getContentAsByteArray()).path("data"); }
    MockMultipartFile pdf() { return new MockMultipartFile("files","身份证明.pdf","application/pdf","%PDF-1.4\n test evidence".getBytes()); }
    ResultActions create(Cookie cookie, MockMultipartFile... files) throws Exception {
        var request=multipart("/api/student/applications"); for (var file:files) request.file(file);
        return mvc.perform(csrf(request.cookie(cookie)).param("serviceItemId",Long.toString(itemId)).param("studentRemark","学生证遗失，申请补办。")
                .param("userId","999999").param("studentNo","forged").param("role","ADMIN"));
    }
    long create() throws Exception { return data(create(student).andExpect(status().isOk())).path("application").path("id").asLong(); }
    ResultActions createBound(List<String> materialIds, MockMultipartFile... files) throws Exception {
        var request=multipart("/api/student/applications"); for (var file:files) request.file(file);
        return mvc.perform(csrf(request.cookie(student)).param("serviceItemId",Long.toString(itemId))
                .param("studentRemark","按材料清单提交").param("materialIds",materialIds.toArray(String[]::new)));
    }
    ResultActions review(long id, String next, int version) throws Exception {
        return mvc.perform(csrf(patch("/api/admin/applications/"+id+"/status").cookie(admin)).contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("status",next,"remark","审核意见："+next,"version",version))));
    }
    @Test void studentCreatesWithServerIdentitySnapshotsAndReadableUniqueNumber() throws Exception {
        var a=data(create(student,pdf()).andExpect(status().isOk())).path("application");
        assertEquals(users.findByUsername("20260001").orElseThrow().user().id(),a.path("userId").asLong());
        assertEquals("20260001",a.path("studentNo").asText()); assertEquals("姓名20260001",a.path("applicantName").asText());
        assertTrue(a.path("applicationNo").asText().matches("CA\\d{16,}"));
        jdbc.update("UPDATE service_item SET name='新名称' WHERE id=?",itemId);
        jdbc.update("UPDATE user_account SET display_name='新姓名' WHERE username='20260001'");
        var snapshot=data(mvc.perform(get("/api/student/applications/"+a.path("id").asLong()).cookie(student)).andExpect(status().isOk())).path("application");
        assertEquals("学生证补办",snapshot.path("serviceName").asText()); assertEquals("姓名20260001",snapshot.path("applicantName").asText());
    }
    @Test void studentListsOwnAndAdminListsAllWithFiltersAndPaging() throws Exception {
        create(); create(other).andExpect(status().isOk());
        mvc.perform(get("/api/student/applications").cookie(student)).andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/admin/applications?pageSize=1").cookie(admin)).andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(2)).andExpect(jsonPath("$.data.items.length()").value(1));
        mvc.perform(get("/api/student/applications?status=COMPLETED").cookie(student)).andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(get("/api/student/applications/active?serviceItemId="+itemId).cookie(student)).andExpect(jsonPath("$.data.studentNo").value("20260001"));
    }
    @Test void otherStudentCannotReadOrSupplementAndMissingReturns404() throws Exception {
        long id=create();
        mvc.perform(get("/api/student/applications/"+id).cookie(other)).andExpect(status().isForbidden());
        mvc.perform(csrf(multipart("/api/student/applications/"+id+"/resubmit").file(pdf()).cookie(other)).param("version","0").param("studentRemark","伪造"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/student/applications/999999").cookie(student)).andExpect(status().isNotFound());
        mvc.perform(get("/api/admin/applications/"+id).cookie(admin)).andExpect(status().isOk());
    }
    @Test void rbacAndAnonymousAndCsrfRemainEnforced() throws Exception {
        long id=create();
        mvc.perform(get("/api/admin/applications").cookie(student)).andExpect(status().isForbidden());
        mvc.perform(csrf(patch("/api/admin/applications/"+id+"/status").cookie(student)).contentType("application/json").content("{\"status\":\"COMPLETED\"}"))
                .andExpect(status().isForbidden());
        create(admin).andExpect(status().isForbidden());
        mvc.perform(get("/api/student/applications").cookie(admin)).andExpect(status().isForbidden());
        mvc.perform(get("/api/student/applications")).andExpect(status().isUnauthorized());
        mvc.perform(patch("/api/admin/applications/"+id+"/status")).andExpect(status().isUnauthorized());
        mvc.perform(multipart("/api/student/applications").cookie(student).param("serviceItemId","1").param("studentRemark","x")).andExpect(status().isForbidden());
    }
    @Test void submittedToReviewing() throws Exception { review(create(),"REVIEWING",0).andExpect(status().isOk()).andExpect(jsonPath("$.data.application.status").value("REVIEWING")); }
    ResultActions reviewFlow(long id, String next, String remark, int version, Cookie actor) throws Exception {
        return mvc.perform(csrf(patch("/api/admin/applications/"+id+"/review").cookie(actor)).contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("status",next,"remark",remark,"version",version))));
    }
    @Test void oneReviewCompletesAllStagesAndStoresOpinionOnce() throws Exception {
        long id=create();
        var detail=data(reviewFlow(id,"COMPLETED","材料齐全，已办理完成",0,admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.application.status").value("COMPLETED"))
                .andExpect(jsonPath("$.data.application.version").value(3))
                .andExpect(jsonPath("$.data.application.completedAt").isNotEmpty()));
        assertEquals("材料齐全，已办理完成",detail.path("application").path("adminRemark").asText());
        var events=detail.path("events");
        assertEquals(4,events.size());
        assertEquals("REVIEWING",events.get(1).path("toStatus").asText());
        assertEquals("APPROVED",events.get(2).path("toStatus").asText());
        assertEquals("COMPLETED",events.get(3).path("toStatus").asText());
        assertEquals("",events.get(1).path("remark").asText());
        assertEquals("",events.get(2).path("remark").asText());
        assertEquals("材料齐全，已办理完成",events.get(3).path("remark").asText());
        reviewFlow(id,"COMPLETED","重复提交",0,admin).andExpect(status().isConflict());
        assertEquals(4,jdbc.queryForObject("SELECT COUNT(*) FROM service_application_event WHERE application_id=?",Integer.class,id));
        create(student).andExpect(status().isOk());
    }
    @Test void oneReviewCanStopAtApprovalAndCompleteLater() throws Exception {
        long id=create();
        reviewFlow(id,"APPROVED","审核通过，等待办理",0,admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.application.status").value("APPROVED"))
                .andExpect(jsonPath("$.data.application.completedAt").isEmpty());
        create(student).andExpect(status().isConflict());
        reviewFlow(id,"COMPLETED","已办理",2,admin).andExpect(status().isOk());
    }
    @Test void oneReviewSupportsSupplementAndRejectionButRequiresReasonBeforeAnyWrite() throws Exception {
        long id=create();
        reviewFlow(id,"NEED_MORE"," ",0,admin).andExpect(status().isBadRequest());
        reviewFlow(id,"REJECTED","",0,admin).andExpect(status().isBadRequest());
        assertEquals("SUBMITTED",jdbc.queryForObject("SELECT status FROM service_application WHERE id=?",String.class,id));
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM service_application_event WHERE application_id=?",Integer.class,id));
        reviewFlow(id,"NEED_MORE","请补充身份证明",0,admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.application.status").value("NEED_MORE"))
                .andExpect(jsonPath("$.data.events.length()").value(3));
        reviewFlow(id,"COMPLETED","无效跳转",2,admin).andExpect(status().isConflict());
        mvc.perform(csrf(multipart("/api/student/applications/"+id+"/resubmit").file(pdf()).cookie(student))
                .param("version","2").param("studentRemark","已补充")).andExpect(status().isOk());
        reviewFlow(id,"REJECTED","不符合办理条件",3,admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.application.status").value("REJECTED"));
    }
    @Test void reviewFlowStillEnforcesPermissionsCsrfAndVersion() throws Exception {
        long id=create();
        reviewFlow(id,"COMPLETED","伪造",0,student).andExpect(status().isForbidden());
        mvc.perform(patch("/api/admin/applications/"+id+"/review").cookie(admin).contentType("application/json")
                .content("{\"status\":\"COMPLETED\",\"version\":0}")).andExpect(status().isForbidden());
        reviewFlow(id,"COMPLETED","旧版本",1,admin).andExpect(status().isConflict());
        reviewFlow(id,"SUBMITTED","无效结果",0,admin).andExpect(status().isConflict());
        assertEquals(0,jdbc.queryForObject("SELECT version FROM service_application WHERE id=?",Integer.class,id));
        review(id,"REVIEWING",0).andExpect(status().isOk());
        reviewFlow(id,"COMPLETED","审核中申请连续办结",1,admin).andExpect(status().isOk());
    }
    @Test void reviewingToNeedMoreAndAtomicResubmissionPreservesHistory() throws Exception {
        long id=create(); review(id,"REVIEWING",0).andExpect(status().isOk()); review(id,"NEED_MORE",1).andExpect(status().isOk());
        var result=mvc.perform(csrf(multipart("/api/student/applications/"+id+"/resubmit").file(pdf()).cookie(student)).param("version","2").param("studentRemark","已补充身份证明"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.application.status").value("SUBMITTED")).andExpect(jsonPath("$.data.events.length()").value(4));
        assertEquals(1,data(result).path("attachments").size());
    }
    @Test void reviewingToApproved() throws Exception { long id=create(); review(id,"REVIEWING",0); review(id,"APPROVED",1).andExpect(status().isOk()).andExpect(jsonPath("$.data.application.status").value("APPROVED")); }
    @Test void approvedToCompletedAndAllowsNewApplication() throws Exception {
        long id=create(); review(id,"REVIEWING",0); review(id,"APPROVED",1); review(id,"COMPLETED",2).andExpect(status().isOk()).andExpect(jsonPath("$.data.application.completedAt").isNotEmpty());
        long newId=create(); assertNotEquals(id,newId);
        assertEquals(2,jdbc.queryForObject("SELECT COUNT(DISTINCT application_no) FROM service_application",Integer.class));
        mvc.perform(csrf(multipart("/api/student/applications/"+id+"/resubmit").file(pdf()).cookie(student)).param("version","3").param("studentRemark","补交"))
                .andExpect(status().isConflict());
    }
    @Test void rejectionAllowsNewApplicationAndCannotReopenOldOne() throws Exception {
        long id=create(); review(id,"REVIEWING",0); review(id,"REJECTED",1).andExpect(status().isOk());
        create(student).andExpect(status().isOk()); review(id,"REVIEWING",2).andExpect(status().isConflict());
    }
    @Test void invalidTransitionsAndStaleVersionsRejected() throws Exception {
        long id=create(); review(id,"COMPLETED",0).andExpect(status().isConflict()); review(id,"APPROVED",0).andExpect(status().isConflict());
        review(id,"REVIEWING",0).andExpect(status().isOk()); review(id,"APPROVED",0).andExpect(status().isConflict());
        review(id,"NEED_MORE",1); review(id,"APPROVED",2).andExpect(status().isConflict());
    }
    @Test void allActiveStatusesPreventDuplicates() throws Exception {
        long id=create(); create(student).andExpect(status().isConflict()); review(id,"REVIEWING",0); create(student).andExpect(status().isConflict());
        review(id,"NEED_MORE",1); create(student).andExpect(status().isConflict());
        mvc.perform(csrf(multipart("/api/student/applications/"+id+"/resubmit").file(pdf()).cookie(student)).param("version","2").param("studentRemark","补充"));
        review(id,"REVIEWING",3); review(id,"APPROVED",4); create(student).andExpect(status().isConflict());
    }
    @Test void attachmentDownloadRequiresOwnerOrAdminAndBytesMatch() throws Exception {
        var detail=data(create(student,pdf()).andExpect(status().isOk())); String file=detail.path("attachments").get(0).path("id").asText();
        String path="/api/student/applications/attachments/"+file+"/download";
        mvc.perform(get(path).cookie(student)).andExpect(status().isOk()).andExpect(content().bytes(pdf().getBytes())).andExpect(header().string("Cache-Control","no-store"));
        mvc.perform(get(path).cookie(other)).andExpect(status().isForbidden()); mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(get(path.replace("student","admin")).cookie(admin)).andExpect(status().isOk());
        mvc.perform(get(path.replace("student","admin")).cookie(student)).andExpect(status().isForbidden());
        mvc.perform(get("/api/files/"+file+"/download").cookie(other)).andExpect(status().isNotFound());
    }
    @Test void invalidFilesRollbackDatabaseAndPreviouslyWrittenFiles() throws Exception {
        for (var invalid:List.of(new MockMultipartFile("files","../bad.pdf","application/pdf","%PDF-".getBytes()),
                new MockMultipartFile("files","bad.exe","application/octet-stream",new byte[]{1}),
                new MockMultipartFile("files","bad.pdf","image/png","%PDF-".getBytes()),
                new MockMultipartFile("files","bad.pdf","application/pdf","not a pdf".getBytes()),
                new MockMultipartFile("files","big.pdf","application/pdf",new byte[1024*1024+1]))) {
            int status=create(student,pdf(),invalid).andReturn().getResponse().getStatus(); assertTrue(status>=400&&status<500);
            assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM service_application",Integer.class));
            assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM service_application_attachment",Integer.class));
            try (var files=Files.list(storage)) { assertEquals(0,files.count()); }
        }
    }
    @Test void requiredMaterialsAndInactiveServiceValidation() throws Exception {
        jdbc.update("UPDATE service_item SET materials='[{\"id\":\"identity\",\"name\":\"身份证明\",\"required\":true}]' WHERE id=?",itemId);
        create(student).andExpect(status().isBadRequest());
        create(student,pdf()).andExpect(status().isBadRequest());
        mvc.perform(csrf(multipart("/api/student/applications").file(pdf()).cookie(student))
                .param("serviceItemId",Long.toString(itemId)).param("studentRemark","办理说明").param("materialIds","identity"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.attachments[0].materialId").value("identity"));
        jdbc.update("UPDATE service_item SET status='DISABLED' WHERE id=?",itemId); create(other,pdf()).andExpect(status().isNotFound());
    }

    @Test void everyRequiredMaterialMustHaveAnOwnedBindingBeforeAnythingIsSaved() throws Exception {
        jdbc.update("UPDATE service_item SET materials=? WHERE id=?",
                "[{\"id\":\"identity\",\"name\":\"身份证明\",\"required\":true},{\"id\":\"form\",\"name\":\"申请表\",\"required\":true}]",itemId);
        createBound(List.of("identity"),pdf()).andExpect(status().isBadRequest());
        createBound(List.of("identity","identity"),pdf(),pdf()).andExpect(status().isBadRequest());
        createBound(List.of("identity","foreign"),pdf(),pdf()).andExpect(status().isBadRequest());
        createBound(List.of("identity","form"),pdf()).andExpect(status().isBadRequest());
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM service_application",Integer.class));
        try(var files=Files.list(storage)) { assertEquals(0,files.count()); }
        var saved=data(createBound(List.of("identity","form"),pdf(),pdf()).andExpect(status().isOk()));
        assertEquals(2,saved.path("materials").size());
        var names=new HashSet<String>();
        for(var file:saved.path("attachments")) names.add(file.path("materialName").asText());
        assertEquals(Set.of("身份证明","申请表"),names);
        assertEquals(2,jdbc.queryForObject("SELECT COUNT(*) FROM service_application_attachment_material",Integer.class));
    }

    @Test void resubmissionUsesSubmissionSnapshotAfterServiceMaterialsChange() throws Exception {
        jdbc.update("UPDATE service_item SET materials=? WHERE id=?",
                "[{\"id\":\"identity\",\"name\":\"原身份证明\",\"required\":true}]",itemId);
        long id=data(createBound(List.of("identity"),pdf()).andExpect(status().isOk())).path("application").path("id").asLong();
        review(id,"REVIEWING",0); review(id,"NEED_MORE",1);
        jdbc.update("UPDATE service_item SET materials=? WHERE id=?",
                "[{\"id\":\"new-form\",\"name\":\"新申请表\",\"required\":true}]",itemId);
        mvc.perform(csrf(multipart("/api/student/applications/"+id+"/resubmit").file(pdf()).cookie(student))
                .param("version","2").param("studentRemark","补交").param("materialIds","new-form"))
                .andExpect(status().isBadRequest());
        var saved=data(mvc.perform(csrf(multipart("/api/student/applications/"+id+"/resubmit").file(pdf()).cookie(student))
                .param("version","2").param("studentRemark","补交原身份证明").param("materialIds","identity"))
                .andExpect(status().isOk()));
        assertEquals("原身份证明",saved.path("materials").get(0).path("name").asText());
        assertEquals(2,saved.path("attachments").size());
        for(var file:saved.path("attachments")) assertEquals("原身份证明",file.path("materialName").asText());
    }
    @Test void missingParametersAndUnknownFilterAre400() throws Exception {
        mvc.perform(csrf(multipart("/api/student/applications").cookie(student))).andExpect(status().isBadRequest());
        mvc.perform(get("/api/student/applications?status=BAD").cookie(student)).andExpect(status().isBadRequest());
        mvc.perform(get("/api/student/applications?page=0").cookie(student)).andExpect(status().isBadRequest());
    }
    @Test void concurrentCreationHasExactlyOneWinner() throws Exception {
        var user=users.findByUsername("20260001").orElseThrow().user(); var start=new CountDownLatch(1);
        try (var executor=Executors.newFixedThreadPool(2)) {
            Callable<Boolean> task=() -> { start.await(); try { service.create(user,itemId,"并发申请",List.of()); return true; }
                catch (com.campusagent.shared.error.BusinessException e) { assertEquals("APPLICATION_ALREADY_ACTIVE",e.getCode()); return false; } };
            var a=executor.submit(task); var b=executor.submit(task); start.countDown();
            assertNotEquals(a.get(15,TimeUnit.SECONDS),b.get(15,TimeUnit.SECONDS));
        }
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM service_application",Integer.class));
    }
    @Test void existingApplicationProtectsServiceAndRepeatedMigrationPreservesData() throws Exception {
        create(); mvc.perform(csrf(delete("/api/admin/services/"+itemId+"?version=0").cookie(admin))).andExpect(status().isConflict());
        new org.springframework.jdbc.datasource.init.ResourceDatabasePopulator(new org.springframework.core.io.ClassPathResource("db/migration/V6__service_application.sql")).execute(Objects.requireNonNull(jdbc.getDataSource()));
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM service_application",Integer.class));
    }
    @Test void needMoreRequiresOpinionAndResubmissionRequiresMaterial() throws Exception {
        long id=create(); review(id,"REVIEWING",0);
        mvc.perform(csrf(patch("/api/admin/applications/"+id+"/status").cookie(admin)).contentType("application/json")
                .content("{\"status\":\"NEED_MORE\",\"version\":1,\"remark\":\" \"}" )).andExpect(status().isBadRequest());
        review(id,"NEED_MORE",1).andExpect(status().isOk());
        mvc.perform(csrf(multipart("/api/student/applications/"+id+"/resubmit").cookie(student)).param("version","2").param("studentRemark","没有附件"))
                .andExpect(status().isBadRequest());
        assertEquals("NEED_MORE",jdbc.queryForObject("SELECT status FROM service_application WHERE id=?",String.class,id));
    }
    @Test void concurrentReviewCannotOverwriteAnotherDecision() throws Exception {
        long id=create(); review(id,"REVIEWING",0);
        var user=users.findByUsername("admin").orElseThrow().user(); var start=new CountDownLatch(1);
        try (var executor=Executors.newFixedThreadPool(2)) {
            var futures=new ArrayList<Future<Boolean>>();
            for (var next:List.of(com.campusagent.affair.application.model.ApplicationStatus.APPROVED,com.campusagent.affair.application.model.ApplicationStatus.REJECTED)) {
                futures.add(executor.submit(() -> { start.await(); try {
                    service.review(id,user,new com.campusagent.affair.application.dto.ApplicationDetail.Review(next,"并发审核",1)); return true;
                } catch (com.campusagent.shared.error.BusinessException e) { assertEquals("APPLICATION_STATE_CONFLICT",e.getCode()); return false; } }));
            }
            start.countDown(); assertNotEquals(futures.get(0).get(15,TimeUnit.SECONDS),futures.get(1).get(15,TimeUnit.SECONDS));
        }
        assertEquals(3,jdbc.queryForObject("SELECT COUNT(*) FROM service_application_event WHERE application_id=?",Integer.class,id));
    }
}
