package com.campusagent.affair.serviceguide.controller;

import com.campusagent.affair.serviceguide.dto.MaterialAttachmentDTO;
import com.campusagent.affair.serviceguide.service.MaterialAttachmentService;
import com.campusagent.shared.api.ApiResponse;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.nio.charset.StandardCharsets;
import java.util.Map;

@RestController
public class MaterialAttachmentController {
    private final MaterialAttachmentService service;
    public MaterialAttachmentController(MaterialAttachmentService service) { this.service = service; }
    @GetMapping("/api/admin/material-attachments/config")
    public ApiResponse<Map<String, Object>> config() {
        return ApiResponse.success(Map.of("maxUploadSizeMb", service.maxUploadSizeMb(), "extensions", java.util.List.of("doc", "docx", "pdf", "xls", "xlsx", "zip")));
    }
    @PostMapping("/api/admin/services/{serviceId}/materials/{materialId}/attachment")
    public ApiResponse<MaterialAttachmentDTO> upload(@PathVariable long serviceId, @PathVariable String materialId, @RequestPart("file") MultipartFile file) {
        return ApiResponse.success(service.upload(serviceId, materialId, file));
    }
    @DeleteMapping("/api/admin/services/{serviceId}/materials/{materialId}/attachment")
    public ApiResponse<Map<String, Boolean>> delete(@PathVariable long serviceId, @PathVariable String materialId) {
        service.delete(serviceId, materialId); return ApiResponse.success(Map.of("deleted", true));
    }
    @GetMapping("/api/files/{id}/download")
    public ResponseEntity<Resource> download(@PathVariable String id) { return response(service.download(id, false)); }
    @GetMapping("/api/admin/files/{id}/download")
    public ResponseEntity<Resource> adminDownload(@PathVariable String id) { return response(service.download(id, true)); }
    private ResponseEntity<Resource> response(MaterialAttachmentService.Download file) {
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(file.metadata().contentType()))
                .contentLength(file.metadata().size()).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(file.metadata().filename(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff").body(file.resource());
    }
}
