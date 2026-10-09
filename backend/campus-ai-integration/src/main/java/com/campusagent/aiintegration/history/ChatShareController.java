package com.campusagent.aiintegration.history;

import com.campusagent.aiintegration.history.ChatHistoryTypes.SharedConversation;
import com.campusagent.shared.api.ApiResponse;
import org.springframework.web.bind.annotation.*;

/**
 * 公开只读分享接口：/api/share/** 在 SecurityConfiguration 中 permitAll，
 * 只开放 GET，且 token 只对应一段会话 —— 不提供任何写入或枚举能力。
 */
@RestController
@RequestMapping("/api/share")
public class ChatShareController {
    private final ChatShareService service;
    public ChatShareController(ChatShareService service) { this.service = service; }

    @GetMapping("/chat/{token}")
    public ApiResponse<SharedConversation> view(@PathVariable String token) {
        return ApiResponse.success(service.view(token));
    }
}
