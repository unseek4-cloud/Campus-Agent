package com.campusagent.aiintegration.serviceguide;

import com.campusagent.affair.serviceguide.dto.*;
import com.campusagent.affair.serviceguide.service.SemanticIntentMatcher;
import com.campusagent.aiintegration.knowledge.AiServiceResponse;
import com.campusagent.aiintegration.rag.RagChatResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;

@Component
public class ServiceAiClient implements SemanticIntentMatcher {
    private final RestClient client;
    public ServiceAiClient(RestClient.Builder builder,
            @Value("${campus.ai-service.base-url}") String baseUrl,
            @Value("${campus.service-guide.ai-timeout-seconds:12}") int timeoutSeconds) {
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(2)).build());
        factory.setReadTimeout(Duration.ofSeconds(timeoutSeconds));
        client = builder.requestFactory(factory).baseUrl(baseUrl).build();
    }
    public record Candidate(String code, String name, String description) { }
    public record IntentRequest(String query, List<Candidate> candidates) { }
    public record NarrationRequest(String query, String knowledgeBaseId, ServiceDetail guide) { }
    @Override
    public ServiceRecognitionResponse match(String query, List<ServiceItemDTO> candidates) {
        if (candidates.isEmpty()) return ServiceRecognitionResponse.unmatched();
        var payload = new IntentRequest(query, candidates.stream().map(s -> new Candidate(s.code(), s.name(), s.description())).toList());
        AiServiceResponse<ServiceRecognitionResponse> response = client.post().uri("/internal/v1/service-guide/recognize")
                .body(payload).retrieve().body(new ParameterizedTypeReference<>() {});
        return response != null && "OK".equals(response.code()) ? response.data() : ServiceRecognitionResponse.unmatched();
    }
    public RagChatResponse narrate(String query, String knowledgeBaseId, ServiceDetail guide) {
        AiServiceResponse<RagChatResponse> response = client.post().uri("/internal/v1/service-guide/narrate")
                .body(new NarrationRequest(query, knowledgeBaseId, guide)).retrieve().body(new ParameterizedTypeReference<>() {});
        if (response == null || !"OK".equals(response.code()) || response.data() == null || response.data().answer() == null || response.data().answer().isBlank())
            throw new IllegalStateException("Invalid service narration");
        return response.data();
    }
}
