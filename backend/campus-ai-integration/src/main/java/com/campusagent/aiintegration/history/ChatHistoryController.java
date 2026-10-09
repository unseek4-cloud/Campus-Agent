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
    private final ChatShareService shares;
    public ChatHistoryController(ChatHistoryService service, ChatShareService shares) {
        this.service = service; this.shares = shares;
    }
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
    /** 创建或复用公开分享链接；messageIds 为空表示整段会话，返回的 token 由前端拼成 #/share/<token>。 */
    @PostMapping("/{id}/shares") public ApiResponse<Share> share(@PathVariable long id,
            @RequestBody(required = false) ShareRequest body, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(shares.share(user.user().id(), id, body == null ? null : body.ttlDays(),
                body == null ? null : body.messageIds()));
    }
    @GetMapping("/{id}/shares") public ApiResponse<List<Share>> shares(@PathVariable long id, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(shares.shares(user.user().id(), id));
    }
    @DeleteMapping("/{id}/shares/{token}") public ApiResponse<Void> revoke(@PathVariable long id, @PathVariable String token,
            @AuthenticationPrincipal UserPrincipal user) {
        shares.revoke(user.user().id(), id, token); return ApiResponse.success(null);
    }
}
