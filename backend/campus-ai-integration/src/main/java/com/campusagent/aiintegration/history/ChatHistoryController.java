package com.campusagent.aiintegration.history;

import com.campusagent.aiintegration.history.ChatHistoryTypes.*;
import com.campusagent.identity.security.UserPrincipal;
import com.campusagent.shared.api.ApiResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/chat/conversations")
public class ChatHistoryController {
    private final ChatHistoryService service;
    public ChatHistoryController(ChatHistoryService service) { this.service = service; }
    @GetMapping public ApiResponse<List<Conversation>> list(@AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.list(user.user().id()));
    }
    @PostMapping public ApiResponse<Conversation> create(@AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.create(user.user().id()));
    }
    @GetMapping("/{id}/messages") public ApiResponse<Messages> messages(@PathVariable long id, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.messages(user.user().id(), id));
    }
    @DeleteMapping("/{id}") public ApiResponse<Void> delete(@PathVariable long id, @AuthenticationPrincipal UserPrincipal user) {
        service.delete(user.user().id(), id); return ApiResponse.success(null);
    }
}
