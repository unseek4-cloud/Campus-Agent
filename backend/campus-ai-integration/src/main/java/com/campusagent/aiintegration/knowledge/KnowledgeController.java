package com.campusagent.aiintegration.knowledge;

import com.campusagent.shared.api.ApiResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public retrieval API. Browsers call Java; only this module calls the Python service. */
@RestController
@RequestMapping("/api/knowledge")
public class KnowledgeController {
    private final KnowledgeRetrievalService retrievalService;

    public KnowledgeController(KnowledgeRetrievalService retrievalService) {
        this.retrievalService = retrievalService;
    }

    @PostMapping("/search")
    public ApiResponse<KnowledgeSearchResponse> search(
            @RequestBody KnowledgeSearchRequest request
    ) {
        return ApiResponse.success(retrievalService.search(request));
    }
}
