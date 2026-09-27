package com.campusagent.affair.application.controller;

import com.campusagent.affair.application.service.ApplicationService;
import com.campusagent.identity.security.UserPrincipal;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.nio.charset.StandardCharsets;

@RestController
public class ApplicationAttachmentController {
    private final ApplicationService service;
    public ApplicationAttachmentController(ApplicationService service) { this.service=service; }
    @GetMapping({"/api/student/applications/attachments/{id}/download", "/api/admin/applications/attachments/{id}/download"})
    public ResponseEntity<Resource> download(@PathVariable String id, @AuthenticationPrincipal UserPrincipal user) {
        var file = service.download(id,user.user());
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(file.metadata().contentType()))
                .contentLength(file.metadata().fileSize()).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(file.metadata().filename(),StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options","nosniff").body(file.resource());
    }
}
