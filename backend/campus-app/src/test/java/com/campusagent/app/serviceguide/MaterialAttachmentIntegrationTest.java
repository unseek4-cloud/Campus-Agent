package com.campusagent.app.serviceguide;

import com.campusagent.affair.serviceguide.service.MaterialAttachmentService;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.*;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:material-test;MODE=MySQL;DB_CLOSE_DELAY=-1", "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=", "spring.sql.init.schema-locations=classpath:material-test-schema.sql",
        "campus.auth.jwt-secret=dGVzdC1vbmx5LXJhbmRvbS1zZWNyZXQtbm90LWZvci1wcm9k", "campus.admin.max-upload-size-mb=1"})
@AutoConfigureMockMvc
@org.springframework.security.test.context.support.WithMockUser(roles = "STUDENT")
class MaterialAttachmentIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired MaterialAttachmentService attachments;
    @Autowired PlatformTransactionManager transactions;
    static final Path storage;
    static { try { storage = Files.createTempDirectory("campus-attachment-tests-"); } catch (IOException e) { throw new UncheckedIOException(e); } }
    @DynamicPropertySource static void storage(DynamicPropertyRegistry properties) {
        properties.add("campus.material.storage-path", storage::toString);
        properties.add("campus.admin.storage-path", () -> storage.resolve("knowledge").toString());
    }
    @AfterAll static void cleanup() throws IOException {
        try (var files = Files.walk(storage)) { for (Path path : files.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path); }
    }
    @BeforeEach void clear() throws IOException {
        jdbc.update("DELETE FROM service_material_attachment"); jdbc.update("DELETE FROM service_step"); jdbc.update("DELETE FROM service_item");
        try (var files = Files.list(storage)) { for (var file : files.filter(Files::isRegularFile).toList()) Files.delete(file); }
    }
    private JsonNode data(org.springframework.test.web.servlet.MvcResult response) throws Exception {
        return json.readTree(response.getResponse().getContentAsByteArray()).path("data");
    }
    private JsonNode create(String code) throws Exception {
        String body = """
                {"service":{"code":"%s","name":"学生证补办","category":"测试","status":"ACTIVE","version":0,
                "requirements":[],"materials":[{"name":"学生证补办申请表","description":"请填写完整","required":true},{"name":"身份证明","required":true}],
                "recognitionRules":{"subjects":["学生证"],"actions":["补办"],"exclusions":[]}},"steps":[]}
                """.formatted(code);
        return data(mvc.perform(post("/api/admin/services").with(user("test-admin").roles("ADMIN")).with(csrf())
                .contentType("application/json").content(body)).andExpect(status().isOk()).andReturn());
    }
    private String endpoint(JsonNode detail) {
        return "/api/admin/services/" + detail.path("service").path("id").asLong() + "/materials/" + detail.path("service").path("materials").get(0).path("id").asText() + "/attachment";
    }
    private byte[] docx() throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            for (String name : List.of("[Content_Types].xml", "word/document.xml")) {
                var entry = new ZipEntry(name); entry.setTime(0); zip.putNextEntry(entry); zip.write("<document>测试表格</document>".getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }
    private JsonNode upload(JsonNode detail, String name) throws Exception {
        return data(mvc.perform(multipart(endpoint(detail)).file(new MockMultipartFile("file", name, "application/octet-stream", docx()))
                .with(user("test-admin").roles("ADMIN")).with(csrf())).andExpect(status().isOk()).andReturn());
    }
    @Test void uploadStudentDetailDownloadReplaceAndDeletePreserveMaterial() throws Exception {
        var detail = create("CARD"); var file = upload(detail, "学生证补办申请表.docx");
        long id = detail.path("service").path("id").asLong();
        var student = data(mvc.perform(get("/api/services/" + id)).andExpect(status().isOk()).andReturn());
        assertEquals("学生证补办申请表.docx", student.at("/service/materials/0/attachment/filename").asText());
        assertTrue(student.at("/service/materials/1/attachment").isNull());
        var response = mvc.perform(get(file.path("downloadUrl").asText())).andExpect(status().isOk())
                .andExpect(content().contentType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).andReturn().getResponse();
        assertArrayEquals(docx(), response.getContentAsByteArray());
        assertEquals("学生证补办申请表.docx", org.springframework.http.ContentDisposition.parse(response.getHeader("Content-Disposition")).getFilename());
        assertTrue(response.getHeader("Content-Disposition").contains("filename*=UTF-8''"));
        assertTrue(Files.exists(storage.resolve(file.path("id").asText())));
        var newer = upload(detail, "新版 学生证补办申请表.docx");
        assertNotEquals(file.path("id"), newer.path("id"));
        mvc.perform(get(file.path("downloadUrl").asText())).andExpect(status().isNotFound());
        assertFalse(Files.exists(storage.resolve(file.path("id").asText())));
        var replaced = mvc.perform(get(newer.path("downloadUrl").asText())).andExpect(status().isOk()).andReturn().getResponse();
        assertEquals("新版 学生证补办申请表.docx", org.springframework.http.ContentDisposition.parse(replaced.getHeader("Content-Disposition")).getFilename());
        // An older editor cannot overwrite the server-controlled attachment via PUT.
        mvc.perform(put("/api/admin/services/" + id).with(user("test-admin").roles("ADMIN")).with(csrf())
                .contentType("application/json").content(json.writeValueAsBytes(detail))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.service.materials[0].attachment.id").value(newer.path("id").asText()));
        mvc.perform(delete(endpoint(detail)).with(user("test-admin").roles("ADMIN")).with(csrf())).andExpect(status().isOk());
        mvc.perform(get("/api/services/" + id)).andExpect(jsonPath("$.data.service.materials[0].name").value("学生证补办申请表"))
                .andExpect(jsonPath("$.data.service.materials[0].attachment").isEmpty()).andExpect(jsonPath("$.data.service.materials.length()").value(2));
        mvc.perform(get(newer.path("downloadUrl").asText())).andExpect(status().isNotFound());
        assertFalse(Files.exists(storage.resolve(newer.path("id").asText())));
    }
    @Test void otherAffairsAndLegacyJsonGetStableIdsAndDoNotCrossBind() throws Exception {
        var one = create("DORM_REPAIR"); var two = create("SCHOLARSHIP");
        long id = one.at("/service/id").asLong();
        jdbc.update("UPDATE service_item SET materials=? WHERE id=?", "[{\"name\":\"旧申请表\",\"required\":true}]", id);
        var first = data(mvc.perform(get("/api/services/" + id)).andReturn());
        var second = data(mvc.perform(get("/api/services/" + id)).andReturn());
        assertEquals(first.at("/service/materials/0/id"), second.at("/service/materials/0/id"));
        upload(first, "宿舍 申请表.docx");
        String wrong = endpoint(first).replace("/services/" + id + "/", "/services/" + two.at("/service/id").asLong() + "/");
        mvc.perform(multipart(wrong).file(new MockMultipartFile("file", "申请表.docx", "application/octet-stream", docx()))
                .with(user("test-admin").roles("ADMIN")).with(csrf())).andExpect(status().isNotFound());
        assertTrue(jdbc.queryForObject("SELECT materials FROM service_item WHERE id=?", String.class, id).contains(first.at("/service/materials/0/id").asText()));
    }
    @Test void permissionAndCsrfAreRequiredForAllAdminWrites() throws Exception {
        var detail = create("CARD"); var file = new MockMultipartFile("file", "form.docx", "application/octet-stream", docx());
        mvc.perform(get("/api/admin/services").with(anonymous())).andExpect(status().isUnauthorized());
        mvc.perform(multipart(endpoint(detail)).file(file).with(anonymous()).with(csrf())).andExpect(status().isUnauthorized());
        mvc.perform(multipart(endpoint(detail)).file(file).with(user("student").roles("STUDENT")).with(csrf())).andExpect(status().isForbidden());
        mvc.perform(multipart(endpoint(detail)).file(file).with(user("test-admin").roles("ADMIN"))).andExpect(status().isForbidden());
        mvc.perform(delete(endpoint(detail)).with(user("student").roles("STUDENT")).with(csrf())).andExpect(status().isForbidden());
        mvc.perform(put("/api/admin/services/1").with(user("student").roles("STUDENT")).with(csrf()).contentType("application/json").content("{}")).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/documents").with(anonymous())).andExpect(status().isUnauthorized());
        // Full cookie login / CSRF exchange is covered by AuthIntegrationTest.
        mvc.perform(multipart(endpoint(detail)).file(file).with(user("test-admin").roles("ADMIN")).with(csrf()))
                .andExpect(status().isOk());
    }
    @Test void validationRejectsUnsupportedEmptyForgedOversizeAndSanitizesPath() throws Exception {
        var detail = create("CARD");
        for (var pair : Map.of("evil.exe", 415, "fake.docx", 422, "empty.pdf", 400, "large.pdf", 413).entrySet()) {
            byte[] bytes = pair.getKey().equals("empty.pdf") ? new byte[0] : pair.getKey().equals("large.pdf") ? new byte[1024*1024+1] : "executable".getBytes();
            mvc.perform(multipart(endpoint(detail)).file(new MockMultipartFile("file", pair.getKey(), "application/octet-stream", bytes))
                    .with(user("test-admin").roles("ADMIN")).with(csrf())).andExpect(status().is(pair.getValue()));
        }
        var valid = upload(detail, "../../中文 表格.docx");
        assertEquals("中文 表格.docx", valid.path("filename").asText());
        try (var files = Files.list(storage)) { assertEquals(1, files.count()); }
    }
    @Test void inactiveAttachmentsOnlyDownloadableByAdmin() throws Exception {
        var detail = create("CARD"); var file = upload(detail, "form.docx");
        jdbc.update("UPDATE service_item SET status='DRAFT' WHERE id=?", detail.at("/service/id").asLong());
        mvc.perform(get(file.path("downloadUrl").asText())).andExpect(status().isNotFound());
        mvc.perform(get("/api/admin/files/" + file.path("id").asText() + "/download").with(anonymous())).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/files/" + file.path("id").asText() + "/download").with(user("test-admin").roles("ADMIN"))).andExpect(status().isOk());
    }
    @Test void sixTemplateFormatsUseCanonicalMimeAndMissingDiskFileReturns404() throws Exception {
        var detail = create("TEMPLATES");
        for (String extension : List.of("doc", "docx", "pdf", "xls", "xlsx", "zip")) {
            byte[] bytes;
            if (extension.equals("doc") || extension.equals("xls")) bytes = new byte[]{(byte)0xd0,(byte)0xcf,0x11,(byte)0xe0,(byte)0xa1,(byte)0xb1,0x1a,(byte)0xe1};
            else if (extension.equals("pdf")) bytes = "%PDF-1.7\nfixture".getBytes(StandardCharsets.US_ASCII);
            else if (extension.equals("xlsx")) {
                var out = new ByteArrayOutputStream();
                try (var zip = new ZipOutputStream(out)) {
                    for (String name : List.of("[Content_Types].xml", "xl/workbook.xml")) {
                        zip.putNextEntry(new ZipEntry(name)); zip.write("<xml/>".getBytes()); zip.closeEntry();
                    }
                }
                bytes = out.toByteArray();
            } else bytes = docx();
            var response = data(mvc.perform(multipart(endpoint(detail)).file(new MockMultipartFile("file", "模板." + extension.toUpperCase(), "application/octet-stream", bytes))
                    .with(user("test-admin").roles("ADMIN")).with(csrf())).andExpect(status().isOk()).andReturn());
            mvc.perform(get(response.path("downloadUrl").asText())).andExpect(status().isOk())
                    .andExpect(content().contentType(com.campusagent.affair.serviceguide.service.MaterialFileValidator.TYPES.get(extension)))
                    .andExpect(content().bytes(bytes));
            Files.delete(storage.resolve(response.path("id").asText()));
            mvc.perform(get(response.path("downloadUrl").asText())).andExpect(status().isNotFound());
        }
    }
    @Test void rollbackKeepsOldFileAndRemovesNewFile() throws Exception {
        var detail = create("CARD"); var file = upload(detail, "old.docx");
        var replacement = new MockMultipartFile("file", "new.docx", "application/octet-stream", docx());
        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            attachments.upload(detail.at("/service/id").asLong(), detail.at("/service/materials/0/id").asText(), replacement);
            tx.setRollbackOnly();
        });
        mvc.perform(get(file.path("downloadUrl").asText())).andExpect(status().isOk());
        try (var files = Files.list(storage)) { assertEquals(1, files.count()); }
    }
    @Test void deletingMaterialOrAffairCleansFilesAndStaleSaveRollsBack() throws Exception {
        var detail = create("CARD"); var file = upload(detail, "form.docx");
        var service = (ObjectNode) detail.path("service");
        service.put("version", 99);
        service.putArray("materials");
        mvc.perform(put("/api/admin/services/" + service.path("id").asLong()).with(user("test-admin").roles("ADMIN")).with(csrf())
                .contentType("application/json").content(json.writeValueAsBytes(detail))).andExpect(status().isConflict());
        mvc.perform(get(file.path("downloadUrl").asText())).andExpect(status().isOk());
        service.put("version", 0);
        mvc.perform(put("/api/admin/services/" + service.path("id").asLong()).with(user("test-admin").roles("ADMIN")).with(csrf())
                .contentType("application/json").content(json.writeValueAsBytes(detail))).andExpect(status().isOk());
        assertFalse(Files.exists(storage.resolve(file.path("id").asText())));
        var other = create("OTHER"); var otherFile = upload(other, "other.docx");
        mvc.perform(delete("/api/admin/services/" + other.at("/service/id").asLong()).param("version", "0")
                .with(user("test-admin").roles("ADMIN")).with(csrf())).andExpect(status().isOk());
        assertFalse(Files.exists(storage.resolve(otherFile.path("id").asText())));
    }
}
