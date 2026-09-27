package com.campusagent.affair.application.service;

import com.campusagent.affair.application.dto.ApplicationDetail.Attachment;
import com.campusagent.affair.application.repository.ApplicationAttachmentRepository;
import com.campusagent.shared.error.BusinessException;
import com.campusagent.shared.storage.LocalFileStorage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.*;
import org.springframework.web.multipart.MultipartFile;
import org.slf4j.LoggerFactory;
import java.io.IOException;
import java.util.*;

@Service
public class ApplicationAttachmentService {
    private final ApplicationAttachmentRepository repository;
    private final LocalFileStorage storage;
    private final long maxBytes;
    public ApplicationAttachmentService(ApplicationAttachmentRepository repository,
            @Value("${campus.application.storage-path}") String root,
            @Value("${campus.admin.max-upload-size-mb}") long maxMb) {
        this.repository = repository; storage = new LocalFileStorage(root);
        if (maxMb < 1 || maxMb > 100) throw new IllegalArgumentException("上传大小限制必须为 1–100 MB");
        maxBytes = maxMb * 1024 * 1024;
    }
    public Map<String,Object> config() { return Map.of("maxUploadSizeMb", maxBytes/1024/1024,
            "maxFiles", 10, "maxTotalSizeMb", 100, "extensions", List.of("pdf","doc","docx","jpg","jpeg","png")); }
    /** Called inside the application transaction, with its row locked. */
    public void save(long applicationId, List<MultipartFile> files) {
        if (files.size() > 10 || files.size() + repository.list(applicationId).size() > 50)
            throw new IllegalArgumentException("每次最多上传 10 个文件，每份申请最多 50 个附件");
        if (files.stream().mapToLong(MultipartFile::getSize).sum() > 100L*1024*1024)
            throw new BusinessException("ATTACHMENT_TOO_LARGE", "本次上传总大小不能超过 100 MB", HttpStatus.PAYLOAD_TOO_LARGE);
        try {
            for (var file : files) {
                var valid = ApplicationFileValidator.validate(file, maxBytes);
                String id = UUID.randomUUID().toString();
                storage.write(id, valid.bytes());
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED) try { storage.delete(id); }
                        catch (IOException e) { LoggerFactory.getLogger(getClass()).warn("Application attachment cleanup pending id={}", id); }
                    }
                });
                repository.insert(id, applicationId, valid.filename(), valid.contentType(), valid.bytes().length);
            }
        } catch (IOException e) { throw new BusinessException("UPLOAD_FAILED", "文件保存失败，请稍后重试", HttpStatus.INTERNAL_SERVER_ERROR); }
    }
    public List<Attachment> list(long id) { return repository.list(id); }
    public Attachment require(String id) {
        var attachment = repository.find(id);
        if (attachment == null) throw new BusinessException("ATTACHMENT_NOT_FOUND", "申请附件不存在", HttpStatus.NOT_FOUND);
        return attachment;
    }
    public record Download(Attachment metadata, Resource resource) {}
    public Download download(Attachment attachment) { return new Download(attachment, storage.resource(attachment.id())); }
}
