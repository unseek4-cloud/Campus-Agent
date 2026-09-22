package com.campusagent.aiintegration.rag;

import com.campusagent.shared.api.ApiResponse;
import com.campusagent.aiintegration.serviceguide.ChatService;
import com.campusagent.aiintegration.serviceguide.ChatResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rag")
public class RagController {
    private final ChatService service;

    public RagController(ChatService service) {
        this.service = service;
    }

    @PostMapping("/chat")
    public ApiResponse<ChatResponse> chat(@RequestBody RagChatRequest request) {
        return ApiResponse.success(service.chat(request));
    }
}
