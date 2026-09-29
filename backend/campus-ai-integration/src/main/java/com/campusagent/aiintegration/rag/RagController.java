package com.campusagent.aiintegration.rag;

import com.campusagent.shared.api.ApiResponse;
import com.campusagent.aiintegration.history.ChatHistoryService;
import com.campusagent.aiintegration.history.ChatHistoryTypes;
import com.campusagent.identity.security.UserPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rag")
public class RagController {
    private final ChatHistoryService service;

    public RagController(ChatHistoryService service) {
        this.service = service;
    }

    @PostMapping("/chat")
    public ApiResponse<ChatHistoryTypes.Turn> chat(@RequestBody ChatHistoryTypes.Request request, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.chat(user.user().id(), request));
    }
}
