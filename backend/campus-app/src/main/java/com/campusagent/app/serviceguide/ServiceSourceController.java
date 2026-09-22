package com.campusagent.app.serviceguide;

import com.campusagent.affair.serviceguide.service.ServiceGuideService;
import com.campusagent.app.admin.AdminDocumentService;
import com.campusagent.shared.error.BusinessException;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.nio.charset.StandardCharsets;

/** Composition at the app layer, through both modules' public services. */
@RestController
@RequestMapping("/api/services")
public class ServiceSourceController {
    private final ServiceGuideService guides;
    private final AdminDocumentService documents;
    public ServiceSourceController(ServiceGuideService guides, AdminDocumentService documents) { this.guides = guides; this.documents = documents; }
    @GetMapping("/{id}/source")
    public ResponseEntity<Resource> source(@PathVariable long id) {
        String documentId = guides.detail(id, true).service().sourceDocumentId();
        if (documentId == null) throw new BusinessException("SOURCE_NOT_FOUND", "暂未关联来源文件", HttpStatus.NOT_FOUND);
        var document = documents.detail(documentId);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(document.displayName(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff").body(documents.originalFile(documentId));
    }
}
