package com.campusagent.affair.application.controller;

import com.campusagent.affair.application.dto.ApplicationDetail;
import com.campusagent.affair.application.service.ApplicationService;
import com.campusagent.identity.security.UserPrincipal;
import com.campusagent.shared.api.ApiResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/applications")
public class AdminApplicationController {
    private final ApplicationService service;
    public AdminApplicationController(ApplicationService service) { this.service=service; }
    @GetMapping public ApiResponse<ApplicationDetail.Page> list(@RequestParam(required=false) String status,
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="10") int pageSize, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.list(user.user(),status,page,pageSize));
    }
    @GetMapping("/{id}") public ApiResponse<ApplicationDetail> detail(@PathVariable long id, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.detail(id,user.user()));
    }
    @PatchMapping("/{id}/status") public ApiResponse<ApplicationDetail> review(@PathVariable long id,
            @RequestBody ApplicationDetail.Review review, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.review(id,user.user(),review));
    }
    @PatchMapping("/{id}/review") public ApiResponse<ApplicationDetail> reviewFlow(@PathVariable long id,
            @RequestBody ApplicationDetail.Review review, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.reviewFlow(id,user.user(),review));
    }
}
