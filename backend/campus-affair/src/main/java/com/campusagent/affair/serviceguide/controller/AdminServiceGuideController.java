package com.campusagent.affair.serviceguide.controller;

import com.campusagent.affair.serviceguide.dto.*;
import com.campusagent.affair.serviceguide.service.ServiceGuideService;
import com.campusagent.shared.api.ApiResponse;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/services")
public class AdminServiceGuideController {
    private final ServiceGuideService service;
    public AdminServiceGuideController(ServiceGuideService service) { this.service = service; }
    @GetMapping public ApiResponse<List<ServiceItemDTO>> list() { return ApiResponse.success(service.list(false)); }
    @GetMapping("/{id}") public ApiResponse<ServiceDetail> detail(@PathVariable long id) { return ApiResponse.success(service.detail(id, false)); }
    @PostMapping public ApiResponse<ServiceDetail> create(@RequestBody ServiceDetail data) { return ApiResponse.success(service.save(null, data)); }
    @PutMapping("/{id}") public ApiResponse<ServiceDetail> update(@PathVariable long id, @RequestBody ServiceDetail data) { return ApiResponse.success(service.save(id, data)); }
    @DeleteMapping("/{id}") public ApiResponse<Map<String, Boolean>> delete(@PathVariable long id, @RequestParam int version) {
        service.delete(id, version); return ApiResponse.success(Map.of("deleted", true));
    }
}
