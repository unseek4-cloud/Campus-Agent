package com.campusagent.aiintegration.rag;

import com.campusagent.shared.api.ApiResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rag")
public class RagController {
    private final RagService service;

    public RagController(RagService service) {
        this.service = service;
    }

    @PostMapping("/chat")
    public ApiResponse<RagChatResponse> chat(@RequestBody RagChatRequest request) {
        return ApiResponse.success(service.chat(request));
    }
}
