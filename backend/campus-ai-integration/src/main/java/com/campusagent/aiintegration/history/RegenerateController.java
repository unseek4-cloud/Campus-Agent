package com.campusagent.aiintegration.history;

import com.campusagent.identity.security.UserPrincipal;
import com.campusagent.shared.api.ApiResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
public class RegenerateController {
    private final ChatHistoryService service;
    public RegenerateController(ChatHistoryService service) { this.service = service; }
    @PostMapping("/api/chat/messages/{id}/regenerate")
    public ApiResponse<ChatHistoryTypes.Turn> regenerate(@PathVariable long id,
            @RequestBody ChatHistoryTypes.RegenerateRequest request, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.regenerate(user.user().id(), id, request.requestId()));
    }
}
