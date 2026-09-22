package com.campusagent.affair.serviceguide.controller;

import com.campusagent.affair.serviceguide.dto.*;
import com.campusagent.affair.serviceguide.service.*;
import com.campusagent.shared.api.ApiResponse;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/services")
public class ServiceGuideController {
    private final ServiceGuideService service;
    private final ServiceIntentRecognizer recognizer;
    public ServiceGuideController(ServiceGuideService service, ServiceIntentRecognizer recognizer) { this.service = service; this.recognizer = recognizer; }
    @GetMapping public ApiResponse<List<ServiceItemDTO>> list() { return ApiResponse.success(service.list(true)); }
    @GetMapping("/{id}") public ApiResponse<ServiceDetail> detail(@PathVariable long id) { return ApiResponse.success(service.detail(id, true)); }
    @GetMapping("/{id}/steps") public ApiResponse<List<ServiceStepDTO>> steps(@PathVariable long id) { return ApiResponse.success(service.detail(id, true).steps()); }
    public record RecognitionRequest(String query) { }
    @PostMapping("/recognize") public ApiResponse<ServiceRecognitionResponse> recognize(@RequestBody RecognitionRequest request) {
        return ApiResponse.success(recognizer.recognize(request.query()));
    }
}
