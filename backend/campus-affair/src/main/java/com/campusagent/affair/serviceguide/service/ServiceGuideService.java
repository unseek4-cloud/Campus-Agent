package com.campusagent.affair.serviceguide.service;

import com.campusagent.affair.serviceguide.dto.*;
import com.campusagent.affair.serviceguide.repository.*;
import com.campusagent.shared.error.BusinessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.util.List;
import java.util.Set;

@Service
public class ServiceGuideService {
    private final ServiceItemRepository items;
    private final ServiceStepRepository steps;
    private final MaterialAttachmentService attachments;
    public ServiceGuideService(ServiceItemRepository items, ServiceStepRepository steps, MaterialAttachmentService attachments) {
        this.items = items; this.steps = steps; this.attachments = attachments;
    }
    public List<ServiceItemDTO> list(boolean activeOnly) { return items.list(activeOnly); }
    @Transactional(readOnly = true)
    public ServiceDetail detail(long id, boolean activeOnly) {
        var item = items.find(id);
        if (item == null || activeOnly && !"ACTIVE".equals(item.status())) throw missing();
        return new ServiceDetail(item, steps.list(id));
    }
    @Transactional(readOnly = true)
    public ServiceDetail activeByCode(String code) {
        var item = items.findActiveByCode(code);
        if (item == null) throw missing();
        return new ServiceDetail(item, steps.list(item.id()));
    }
    @Transactional
    public ServiceDetail save(Long id, ServiceDetail data) {
        validate(data);
        var previous = id == null ? null : items.lock(id);
        if (id != null && previous == null) throw missing();
        var normalized = new java.util.ArrayList<ServiceItemDTO.Material>();
        var seen = new java.util.HashSet<String>();
        for (var m : data.service().materials()) {
            String materialId = m.id();
            if (materialId == null && previous != null) {
                var matches = previous.materials().stream().filter(old -> old.name().equals(m.name())).toList();
                if (matches.size() == 1) materialId = matches.getFirst().id();
            }
            if (materialId == null) materialId = java.util.UUID.randomUUID().toString();
            else {
                String candidate = materialId;
                if (previous == null || previous.materials().stream().noneMatch(old -> old.id().equals(candidate)))
                    invalid("材料 ID 不属于当前事项，请刷新后重试");
            }
            if (!seen.add(materialId)) invalid("材料 ID 重复");
            normalized.add(new ServiceItemDTO.Material(materialId, m.name(), m.description(), m.required(), null));
        }
        data = new ServiceDetail(data.service().withMaterials(normalized), data.steps());
        try {
            if (id == null) id = items.insert(data.service());
            else if (!items.update(id, data.service())) throw conflict();
            attachments.retain(id, seen);
            steps.replace(id, data.steps());
            return detail(id, false);
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException("SERVICE_DATA_CONFLICT", "事项编码重复或关联的来源文档不存在，请检查后重试", HttpStatus.CONFLICT);
        }
    }
    @Transactional
    public void delete(long id, int version) {
        if (items.lock(id) == null) throw missing();
        attachments.retain(id, Set.of());
        if (!items.delete(id, version)) throw conflict();
    }
    private void validate(ServiceDetail data) {
        if (data == null || data.service() == null || data.steps() == null) invalid("事项和步骤不能为空");
        var s = data.service();
        required(s.name(), 120, "事项名称"); required(s.code(), 80, "业务编码"); required(s.category(), 80, "分类");
        if (!s.code().matches("[A-Z][A-Z0-9_]{1,79}")) invalid("业务编码只能使用大写字母、数字和下划线");
        if (s.status() == null || !Set.of("ACTIVE", "DRAFT", "DISABLED").contains(s.status())) invalid("状态无效");
        optional(s.description(), 10000, "说明"); optional(s.department(), 255, "部门"); optional(s.location(), 500, "地点");
        optional(s.officeHours(), 255, "办公时间"); optional(s.contact(), 255, "联系方式"); optional(s.deadline(), 500, "截止时间");
        optional(s.sourceDocumentId(), 36, "来源文档 ID"); optional(s.sourceTitle(), 255, "来源标题"); optional(s.sourceUrl(), 2000, "来源链接");
        if (s.sourceDocumentId() != null && !s.sourceDocumentId().matches("[a-zA-Z0-9-]{1,36}")) invalid("来源文档 ID 无效");
        if (s.sourceUrl() != null && !s.sourceUrl().isBlank()) {
            try {
                URI url = URI.create(s.sourceUrl());
                if (!("https".equalsIgnoreCase(url.getScheme()) || "http".equalsIgnoreCase(url.getScheme())) || url.getHost() == null || url.getUserInfo() != null) invalid("来源链接必须为 HTTP(S) 地址");
            } catch (IllegalArgumentException e) { invalid("来源链接必须为有效 HTTP(S) 地址"); }
        }
        strings(s.requirements(), 50, 1000, "办理条件");
        if (s.materials() == null || s.materials().size() > 50) invalid("材料最多 50 项");
        for (var m : s.materials()) {
            if (m == null) invalid("材料不能为空");
            required(m.name(), 160, "材料名称"); optional(m.description(), 1000, "材料说明");
        }
        if (s.recognitionRules() == null) invalid("请配置识别词");
        strings(s.recognitionRules().subjects(), 50, 80, "主题词");
        strings(s.recognitionRules().actions(), 50, 80, "动作词");
        strings(s.recognitionRules().exclusions(), 50, 80, "排除词");
        if ("ACTIVE".equals(s.status()) && (s.recognitionRules().subjects().isEmpty() || s.recognitionRules().actions().isEmpty())) invalid("启用事项需要主题词和动作词");
        if (data.steps().size() > 50) invalid("步骤最多 50 项");
        for (var step : data.steps()) {
            if (step == null) invalid("步骤不能为空");
            required(step.title(), 160, "步骤标题"); optional(step.description(), 10000, "步骤说明");
            optional(step.responsibleDepartment(), 255, "步骤部门"); optional(step.location(), 500, "步骤地点");
            optional(step.estimatedTime(), 255, "预计时间"); strings(step.requiredMaterials(), 50, 160, "步骤材料");
        }
    }
    private static void strings(List<String> values, int count, int length, String label) {
        if (values == null || values.size() > count) invalid(label + "数量无效");
        for (String value : values) required(value, length, label);
    }
    private static void required(String value, int length, String label) {
        if (value == null || value.isBlank()) invalid(label + "不能为空");
        optional(value, length, label);
    }
    private static void optional(String value, int length, String label) { if (value != null && value.length() > length) invalid(label + "过长"); }
    private static void invalid(String message) { throw new IllegalArgumentException(message); }
    private static BusinessException missing() { return new BusinessException("SERVICE_NOT_FOUND", "暂未找到该办事事项，可能已下架，请查看最新学校通知", HttpStatus.NOT_FOUND); }
    private static BusinessException conflict() { return new BusinessException("SERVICE_VERSION_CONFLICT", "事项已被更新，请刷新后重试", HttpStatus.CONFLICT); }
}
