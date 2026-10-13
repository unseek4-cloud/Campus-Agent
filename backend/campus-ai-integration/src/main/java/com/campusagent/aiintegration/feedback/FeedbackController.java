package com.campusagent.aiintegration.feedback;

import com.campusagent.aiintegration.feedback.FeedbackTypes.*;
import com.campusagent.identity.security.UserPrincipal;
import com.campusagent.shared.api.ApiResponse;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;

@RestController
public class FeedbackController {
    private final FeedbackService service;
    public FeedbackController(FeedbackService service) { this.service = service; }
    @PutMapping("/api/chat/messages/{id}/feedback")
    public ApiResponse<Feedback> rate(@PathVariable long id, @RequestBody RatingRequest request, @AuthenticationPrincipal UserPrincipal user) {
        return ApiResponse.success(service.rate(user.user().id(), id, request));
    }
    @DeleteMapping("/api/chat/messages/{id}/feedback")
    public ApiResponse<Void> cancel(@PathVariable long id, @AuthenticationPrincipal UserPrincipal user) {
        service.cancel(user.user().id(), id); return ApiResponse.success(null);
    }
    @GetMapping("/api/admin/ai-quality/summary")
    public ApiResponse<Summary> summary(@AuthenticationPrincipal UserPrincipal user, @RequestParam(required=false) String rating,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate endDate) {
        return ApiResponse.success(service.summary(user.user().id(), rating, startDate, endDate));
    }
    @GetMapping("/api/admin/ai-quality/feedback")
    public ApiResponse<Page> list(@AuthenticationPrincipal UserPrincipal user, @RequestParam(required=false) String rating,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize) {
        return ApiResponse.success(service.list(user.user().id(), rating, startDate, endDate, page, pageSize));
    }
    @PatchMapping("/api/admin/ai-quality/feedback/{id}")
    public ApiResponse<Void> review(@PathVariable long id, @RequestBody ReviewRequest request, @AuthenticationPrincipal UserPrincipal user) {
        service.review(user.user().id(), id, request); return ApiResponse.success(null);
    }
}
