package com.campusagent.affair.serviceguide.service;

import com.campusagent.affair.serviceguide.dto.*;
import com.campusagent.affair.serviceguide.repository.*;
import com.campusagent.affair.serviceguide.repository.MaterialAttachmentRepository.Attachment;
import com.campusagent.shared.error.BusinessException;
import com.campusagent.shared.storage.LocalFileStorage;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.*;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.util.*;

@Service
public class MaterialAttachmentService {
    private final ServiceItemRepository items;
    private final MaterialAttachmentRepository attachments;
    private final LocalFileStorage storage;
    private final long maxBytes;
    public MaterialAttachmentService(ServiceItemRepository items, MaterialAttachmentRepository attachments,
            @Value("${campus.material.storage-path}") String root,
            @Value("${campus.admin.max-upload-size-mb}") long maxMb) {
        this.items = items; this.attachments = attachments; this.storage = new LocalFileStorage(root);
        if (maxMb < 1 || maxMb > 100) throw new IllegalArgumentException("上传大小限制必须为 1–100 MB");
        this.maxBytes = maxMb * 1024 * 1024;
    }
    public long maxUploadSizeMb() { return maxBytes / 1024 / 1024; }
    @Transactional
    public MaterialAttachmentDTO upload(long serviceId, String materialId, MultipartFile file) {
        var item = requireMaterial(serviceId, materialId);
        try {
            var valid = MaterialFileValidator.validate(file, maxBytes);
            var attachment = new Attachment(UUID.randomUUID().toString(), serviceId, materialId,
                    valid.filename(), valid.contentType(), valid.bytes().length);
            storage.write(attachment.id(), valid.bytes());
            // Rollback removes the new file; commit removes the replaced file.
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCompletion(int status) { if (status != STATUS_COMMITTED) cleanup(attachment.id()); }
            });
            items.persistMaterialIds(item);
            for (var old : attachments.list(serviceId)) if (old.materialId().equals(materialId)) remove(old);
            attachments.insert(attachment);
            return attachment.dto();
        } catch (IOException e) { throw new BusinessException("UPLOAD_FAILED", "文件保存失败，请稍后重试", HttpStatus.INTERNAL_SERVER_ERROR); }
    }
    @Transactional
    public void delete(long serviceId, String materialId) {
        requireMaterial(serviceId, materialId);
        for (var old : attachments.list(serviceId)) if (old.materialId().equals(materialId)) remove(old);
    }
    private ServiceItemDTO requireMaterial(long serviceId, String materialId) {
        var item = items.lock(serviceId);
        if (item == null || item.materials().stream().noneMatch(m -> m.id().equals(materialId))) throw missing();
        return item;
    }
    /** Called inside the definition transaction, before deleting the parent row. */
    public void retain(long serviceId, Set<String> materialIds) {
        for (var old : attachments.list(serviceId)) if (!materialIds.contains(old.materialId())) remove(old);
    }
    private void remove(Attachment old) {
        attachments.delete(old.id());
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() { cleanup(old.id()); }
        });
    }
    private void cleanup(String id) {
        try { storage.delete(id); }
        catch (IOException e) { LoggerFactory.getLogger(getClass()).warn("Attachment file cleanup pending id={}", id); }
    }
    public record Download(Attachment metadata, Resource resource) { }
    @Transactional(readOnly = true)
    public Download download(String id, boolean admin) {
        var a = attachments.find(id);
        if (a == null) throw missing();
        var item = items.find(a.serviceId());
        if (item == null || !admin && !"ACTIVE".equals(item.status()) ||
                item.materials().stream().noneMatch(m -> m.id().equals(a.materialId()))) throw missing();
        return new Download(a, storage.resource(id));
    }
    private static BusinessException missing() { return new BusinessException("ATTACHMENT_NOT_FOUND", "材料或附件不存在，可能已更新", HttpStatus.NOT_FOUND); }
}
