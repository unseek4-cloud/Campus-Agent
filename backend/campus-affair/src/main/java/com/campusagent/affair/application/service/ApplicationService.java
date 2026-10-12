package com.campusagent.affair.application.service;

import com.campusagent.affair.application.dto.ApplicationDetail;
import com.campusagent.affair.application.dto.ApplicationDetail.*;
import com.campusagent.affair.application.model.*;
import com.campusagent.affair.application.repository.ApplicationRepository;
import com.campusagent.affair.application.repository.ApplicationMaterialRepository;
import com.campusagent.affair.serviceguide.repository.ServiceItemRepository;
import com.campusagent.identity.user.UserView;
import com.campusagent.shared.error.BusinessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;

@Service
public class ApplicationService {
    private final ApplicationRepository repository;
    private final ServiceItemRepository items;
    private final ApplicationAttachmentService attachments;
    private final ApplicationMaterialRepository materials;
    public ApplicationService(ApplicationRepository repository, ServiceItemRepository items, ApplicationAttachmentService attachments,
            ApplicationMaterialRepository materials) {
        this.repository = repository; this.items = items; this.attachments = attachments; this.materials = materials;
    }
    @Transactional
    public ApplicationDetail create(UserView user, long serviceId, String remark, List<MultipartFile> files) {
        return create(user, serviceId, remark, files, List.of());
    }
    @Transactional
    public ApplicationDetail create(UserView user, long serviceId, String remark, List<MultipartFile> files, List<String> materialIds) {
        role(user, "STUDENT"); remark = text(remark, true);
        if (user.studentNo() == null || user.studentNo().isBlank()) throw new IllegalArgumentException("账号尚未配置学号，请联系管理员");
        var item = items.lock(serviceId);
        if (item == null || !"ACTIVE".equals(item.status())) throw new BusinessException("SERVICE_NOT_FOUND", "事项不存在或已下架", HttpStatus.NOT_FOUND);
        if (repository.active(user.id(), serviceId) != null) throw duplicate();
        var requirements = item.materials().stream().map(m -> new MaterialRequirement(m.id(),m.name(),m.description(),m.required())).toList();
        var bindings = MaterialSubmissionValidator.validate(requirements, files.size(), materialIds, true);
        try {
            long id = repository.insert(serviceId, item.name(), user, remark);
            materials.snapshot(id, requirements);
            attachments.save(id, files, bindings, requirements);
            repository.event(id, null, ApplicationStatus.SUBMITTED, user, remark);
            return detail(id, user);
        } catch (DuplicateKeyException e) { throw duplicate(); }
    }
    @Transactional(readOnly=true)
    public Page list(UserView user, String filter, int page, int size) {
        if (page < 1 || size < 1 || size > 100) throw new IllegalArgumentException("分页参数无效");
        return repository.list("ADMIN".equals(user.role()) ? null : user.id(), filter, page, size);
    }
    @Transactional(readOnly=true)
    public ApplicationRecord active(UserView user, long serviceId) { role(user,"STUDENT"); return repository.active(user.id(), serviceId); }
    @Transactional(readOnly=true)
    public ApplicationDetail detail(long id, UserView user) {
        var record = require(id, user, false);
        return new ApplicationDetail(record, attachments.list(id), repository.events(id), materials.list(id));
    }
    @Transactional
    public ApplicationDetail review(long id, UserView user, Review review) {
        role(user,"ADMIN");
        var current = require(id,user,true);
        if (review == null || review.status() == null) throw new IllegalArgumentException("请选择审核操作");
        version(current, review.version());
        if (!current.status().canReviewTo(review.status())) throw conflict("当前状态不允许此操作，请刷新申请");
        String remark = text(review.remark(), review.status() == ApplicationStatus.NEED_MORE || review.status() == ApplicationStatus.REJECTED);
        repository.transition(id, review.status(), remark, current.studentRemark());
        repository.event(id, current.status(), review.status(), user, remark);
        return detail(id,user);
    }
    @Transactional
    public ApplicationDetail resubmit(long id, UserView user, int version, String remark, List<MultipartFile> files) {
        return resubmit(id, user, version, remark, files, List.of());
    }
    @Transactional
    public ApplicationDetail resubmit(long id, UserView user, int version, String remark, List<MultipartFile> files, List<String> materialIds) {
        role(user,"STUDENT");
        var current = require(id,user,true); version(current,version);
        if (current.status() != ApplicationStatus.NEED_MORE) throw conflict("只有待补充材料的申请可以补交");
        if (files.isEmpty()) throw new IllegalArgumentException("请至少选择一份补充材料");
        remark = text(remark,true);
        var requirements = materials.list(id);
        var bindings = MaterialSubmissionValidator.validate(requirements, files.size(), materialIds, false);
        attachments.save(id, files, bindings, requirements);
        repository.transition(id, ApplicationStatus.SUBMITTED, current.adminRemark(), remark);
        repository.event(id, ApplicationStatus.NEED_MORE, ApplicationStatus.SUBMITTED, user, remark);
        return detail(id,user);
    }
    @Transactional(readOnly=true)
    public ApplicationAttachmentService.Download download(String attachmentId, UserView user) {
        var file = attachments.require(attachmentId);
        require(file.applicationId(), user, false);
        return attachments.download(file);
    }
    private ApplicationRecord require(long id, UserView user, boolean lock) {
        var record = lock ? repository.lock(id) : repository.find(id);
        if (record == null) throw new BusinessException("APPLICATION_NOT_FOUND", "申请不存在", HttpStatus.NOT_FOUND);
        if (!"ADMIN".equals(user.role()) && record.userId() != user.id()) throw forbidden();
        return record;
    }
    private static void version(ApplicationRecord record, int version) {
        if (record.version() != version) throw conflict("申请已更新，请刷新后重试");
    }
    private static String text(String text, boolean required) {
        text = text == null ? "" : text.trim();
        if (required && text.isEmpty()) throw new IllegalArgumentException("请填写申请说明或审核意见");
        if (text.length() > 4000) throw new IllegalArgumentException("说明或意见不能超过 4000 字");
        return text;
    }
    private static void role(UserView user, String role) { if (!role.equals(user.role())) throw forbidden(); }
    private static BusinessException forbidden() { return new BusinessException("ACCESS_DENIED", "你没有权限访问此申请", HttpStatus.FORBIDDEN); }
    private static BusinessException conflict(String message) { return new BusinessException("APPLICATION_STATE_CONFLICT", message, HttpStatus.CONFLICT); }
    private static BusinessException duplicate() { return new BusinessException("APPLICATION_ALREADY_ACTIVE", "你已经有一个正在办理中的申请，请查看办理进度。", HttpStatus.CONFLICT); }
}
