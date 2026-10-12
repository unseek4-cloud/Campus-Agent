package com.campusagent.affair.application.controller;

import com.campusagent.affair.application.dto.ApplicationDetail;
import com.campusagent.affair.application.model.ApplicationRecord;
import com.campusagent.affair.application.service.*;
import com.campusagent.identity.security.UserPrincipal;
import com.campusagent.shared.api.ApiResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;

@RestController
@RequestMapping("/api/student/applications")
public class StudentApplicationController {
    private final ApplicationService service;
    private final ApplicationAttachmentService attachments;
    public StudentApplicationController(ApplicationService service, ApplicationAttachmentService attachments) { this.service=service; this.attachments=attachments; }
    @GetMapping("/upload-config") public ApiResponse<Map<String,Object>> config() { return ApiResponse.success(attachments.config()); }
    @GetMapping("/active") public ApiResponse<ApplicationRecord> active(@RequestParam long serviceItemId, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.active(user.user(), serviceItemId));
    }
    @GetMapping public ApiResponse<ApplicationDetail.Page> list(@RequestParam(required=false) String status,
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="10") int pageSize, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.list(user.user(),status,page,pageSize));
    }
    @GetMapping("/{id}") public ApiResponse<ApplicationDetail> detail(@PathVariable long id, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.detail(id,user.user()));
    }
    @PostMapping(consumes="multipart/form-data") public ApiResponse<ApplicationDetail> create(@RequestParam long serviceItemId,
            @RequestParam String studentRemark, @RequestPart(value="files",required=false) List<MultipartFile> files,
            @RequestParam(value="materialIds",required=false) List<String> materialIds, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.create(user.user(),serviceItemId,studentRemark,files==null ? List.of() : files,materialIds));
    }
    @PostMapping(value="/{id}/resubmit", consumes="multipart/form-data") public ApiResponse<ApplicationDetail> resubmit(@PathVariable long id,
            @RequestParam int version, @RequestParam String studentRemark, @RequestPart(value="files",required=false) List<MultipartFile> files,
            @RequestParam(value="materialIds",required=false) List<String> materialIds, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.resubmit(id,user.user(),version,studentRemark,files==null ? List.of() : files,materialIds));
    }
}
