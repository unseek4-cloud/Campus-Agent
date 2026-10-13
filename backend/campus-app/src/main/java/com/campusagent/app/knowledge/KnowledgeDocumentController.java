package com.campusagent.app.knowledge;

import com.campusagent.app.admin.AdminDocumentService;
import com.campusagent.shared.error.BusinessException;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.nio.charset.StandardCharsets;

/** Original policy files from the same knowledge base available to authenticated search/chat users. */
@RestController
@RequestMapping("/api/knowledge/documents")
public class KnowledgeDocumentController {
    private final AdminDocumentService documents;
    public KnowledgeDocumentController(AdminDocumentService documents) { this.documents = documents; }

    @GetMapping("/{id}/file")
    public ResponseEntity<Resource> file(@PathVariable String id) {
        var document = documents.detail(id); // Also enforces the configured knowledge base.
        if (!"SUCCESS".equals(document.status())) throw new BusinessException("SOURCE_NOT_AVAILABLE", "来源文件暂不可用，请稍后再试", HttpStatus.NOT_FOUND);
        String type = switch (document.fileType()) {
            case "pdf" -> "application/pdf";
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "txt", "md" -> "text/plain;charset=UTF-8";
            case "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            default -> "application/octet-stream";
        };
        boolean preview = java.util.Set.of("pdf", "png", "jpg", "jpeg", "txt", "md").contains(document.fileType());
        var disposition = preview ? ContentDisposition.inline() : ContentDisposition.attachment();
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(type))
                .cacheControl(CacheControl.noStore().cachePrivate())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.filename(document.displayName(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(documents.originalFile(id));
    }
}
