package com.campusagent.affair.serviceguide;

import com.campusagent.affair.serviceguide.controller.*;
import com.campusagent.affair.serviceguide.dto.*;
import com.campusagent.affair.serviceguide.repository.*;
import com.campusagent.affair.serviceguide.service.*;
import com.campusagent.shared.error.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ServiceGuideTest {
    private ServiceGuideService catalog;
    private SemanticIntentMatcher semantic;
    private DatabaseServiceIntentRecognizer recognizer;
    private MockMvc mvc;

    static ServiceItemDTO item(String code, String name, List<String> subjects, List<String> actions) {
        return new ServiceItemDTO(1L, code, name, "测试", null, null, null, null, null,
                List.of(), List.of(), new ServiceItemDTO.RecognitionRules(subjects, actions, List.of()),
                null, null, "测试数据", null, null, "ACTIVE", true, 0, null, null);
    }
    @BeforeEach void setup() {
        catalog = mock(ServiceGuideService.class); semantic = mock(SemanticIntentMatcher.class);
        var card = item("STUDENT_CARD_REISSUE", "学生证补办", List.of("学生证"), List.of("丢", "补办"));
        var repair = item("DORM_REPAIR", "宿舍报修", List.of("宿舍", "寝室"), List.of("坏", "报修"));
        when(catalog.list(true)).thenReturn(List.of(card, repair));
        recognizer = new DatabaseServiceIntentRecognizer(catalog, semantic);
        mvc = MockMvcBuilders.standaloneSetup(new ServiceGuideController(catalog, recognizer))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }
    @Test void cardLossWorksWithoutAi() {
        assertEquals("STUDENT_CARD_REISSUE", recognizer.recognize("学生证丢了怎么办？").serviceCode());
        assertEquals("STUDENT_CARD_REISSUE", recognizer.recognize("我的学生证丢了，应该怎么办？").serviceCode());
        verifyNoInteractions(semantic);
    }
    @Test void dormLightMatchesWordCombination() {
        assertEquals("DORM_REPAIR", recognizer.recognize("宿舍灯坏了怎么报修？").serviceCode());
        assertEquals("DORM_REPAIR", recognizer.recognize("宿舍水龙头坏了").serviceCode());
    }
    @Test void ordinaryQuestionsDoNotInvokeAi() {
        assertFalse(recognizer.recognize("学校食堂几点开门？").matched());
        assertFalse(recognizer.recognize("学校心理咨询中心在哪里？").matched());
        verifyNoInteractions(semantic);
    }
    @Test void unavailableSemanticFallbackIsUnmatched() {
        when(semantic.match(anyString(), anyList())).thenThrow(new IllegalStateException("offline"));
        assertFalse(recognizer.recognize("我想申请其他事项").matched());
    }
    @Test void inventedCodeAndLowConfidenceAreRejected() {
        when(semantic.match(anyString(), anyList())).thenReturn(new ServiceRecognitionResponse(true, "UNKNOWN", "假名称", 0.99, QueryIntent.SERVICE_GUIDE));
        assertFalse(recognizer.recognize("我要办理其他手续").matched());
        when(semantic.match(anyString(), anyList())).thenReturn(new ServiceRecognitionResponse(true, "DORM_REPAIR", "假名称", 0.4, QueryIntent.SERVICE_GUIDE));
        assertFalse(recognizer.recognize("我要办理其他手续").matched());
    }
    @Test void ambiguousAndNegatedRequestsDoNotTakeFirstRule() {
        when(semantic.match(anyString(), anyList())).thenReturn(ServiceRecognitionResponse.unmatched());
        assertFalse(recognizer.recognize("学生证丢了，宿舍灯也坏了怎么办？").matched());
        assertFalse(recognizer.recognize("我不想补办学生证").matched());
    }
    @Test void invalidIdUsesRealHttp404Envelope() throws Exception {
        when(catalog.detail(999L, true)).thenThrow(new BusinessException("SERVICE_NOT_FOUND", "事项不存在", org.springframework.http.HttpStatus.NOT_FOUND));
        mvc.perform(get("/api/services/999")).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("SERVICE_NOT_FOUND"));
        mvc.perform(get("/api/services/999/steps")).andExpect(status().isNotFound());
    }
    @Test void recognizeEndpointAndValidation() throws Exception {
        mvc.perform(post("/api/services/recognize").contentType(MediaType.APPLICATION_JSON).content("{\"query\":\"宿舍灯坏了怎么报修？\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.serviceCode").value("DORM_REPAIR"));
        mvc.perform(post("/api/services/recognize").contentType(MediaType.APPLICATION_JSON).content("{\"query\":\" \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/services/not-a-number")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/services/recognize").contentType(MediaType.APPLICATION_JSON).content("{broken"))
                .andExpect(status().isBadRequest());
    }
    @Test void jdbcAggregateRoundTripOrderVersionAndCascade() {
        var jdbc = new JdbcTemplate(new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", ""));
        // H2 uses VARCHAR for JSON here; production migration is separately checked in MySQL mode.
        jdbc.execute("CREATE TABLE service_item (id BIGINT AUTO_INCREMENT PRIMARY KEY,code VARCHAR(80) UNIQUE,name VARCHAR(120),category VARCHAR(80),description TEXT,department VARCHAR(255),location VARCHAR(500),office_hours VARCHAR(255),contact VARCHAR(255),requirements TEXT,materials TEXT,recognition_rules TEXT,deadline VARCHAR(500),source_document_id VARCHAR(36),source_title VARCHAR(255),source_url VARCHAR(2000),source_publish_time DATE,status VARCHAR(16),is_example BOOLEAN,version INT DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        jdbc.execute("CREATE TABLE service_step (id BIGINT AUTO_INCREMENT PRIMARY KEY,service_item_id BIGINT REFERENCES service_item(id) ON DELETE CASCADE,step_order INT,title VARCHAR(160),description TEXT,responsible_department VARCHAR(255),required_materials TEXT,location VARCHAR(500),estimated_time VARCHAR(255),UNIQUE(service_item_id,step_order))");
        var json = new ObjectMapper();
        var service = new ServiceGuideService(new ServiceItemRepository(jdbc, json), new ServiceStepRepository(jdbc, json));
        var original = item("CARD", "测试事项", List.of("学生证"), List.of("补办"));
        var second = new ServiceStepDTO(null, 19, "提交", null, null, List.of(), null, null);
        var first = new ServiceStepDTO(null, 8, "准备", null, null, List.of("申请表"), null, null);
        var created = service.save(null, new ServiceDetail(original, List.of(first, second)));
        assertEquals(List.of(1, 2), created.steps().stream().map(ServiceStepDTO::order).toList());
        assertEquals("申请表", created.steps().getFirst().requiredMaterials().getFirst());
        var updated = service.save(created.service().id(), new ServiceDetail(created.service(), List.of(second, first)));
        assertEquals("提交", updated.steps().getFirst().title());
        assertEquals(1, updated.service().version());
        assertThrows(BusinessException.class, () -> service.save(created.service().id(), created));
        assertEquals("提交", service.detail(created.service().id(), true).steps().getFirst().title());
        service.delete(updated.service().id(), updated.service().version());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM service_step", Integer.class));
        assertThrows(BusinessException.class, () -> service.detail(created.service().id(), true));
    }
}
