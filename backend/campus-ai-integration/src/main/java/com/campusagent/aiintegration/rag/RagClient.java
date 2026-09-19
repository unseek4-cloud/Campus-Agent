package com.campusagent.aiintegration.rag;

import com.campusagent.aiintegration.knowledge.AiServiceResponse;
import com.campusagent.shared.error.BusinessException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.net.http.HttpClient;
import java.time.Duration;

@Component
public class RagClient {
    private static final Logger log = LoggerFactory.getLogger(RagClient.class);
    private static final String RAG_PATH = "/internal/v1/rag/chat";

    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    public RagClient(
            RestClient.Builder restClientBuilder,
            ObjectMapper objectMapper,
            @Value("${campus.ai-service.base-url}") String baseUrl,
            @Value("${campus.ai-service.rag-timeout-seconds}") int timeoutSeconds
    ) {
        if (timeoutSeconds <= 0) {
            throw new IllegalArgumentException("RAG timeout must be positive");
        }
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(timeoutSeconds))
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(Duration.ofSeconds(timeoutSeconds));
        this.restClient = restClientBuilder.requestFactory(requestFactory).baseUrl(baseUrl).build();
        this.objectMapper = objectMapper;
    }

    public RagChatResponse chat(RagChatRequest request) {
        try {
            AiServiceResponse<RagChatResponse> response = restClient.post()
                    .uri(RAG_PATH)
                    .body(request)
                    .retrieve()
                    .body(new ParameterizedTypeReference<>() {
                    });
            if (response == null || response.data() == null || !"OK".equals(response.code())) {
                throw new BusinessException("AI_SERVICE_INVALID_RESPONSE",
                        "AI service returned an invalid response", HttpStatus.BAD_GATEWAY);
            }
            return response.data();
        } catch (RestClientResponseException exception) {
            String code = "AI_RAG_FAILED";
            String message = "AI answer request failed";
            try {
                JsonNode error = objectMapper.readTree(exception.getResponseBodyAsString());
                String remoteCode = error.path("code").asText();
                if (remoteCode.startsWith("LLM_") || remoteCode.equals("RERANK_UNAVAILABLE")
                        || remoteCode.equals("VECTOR_STORE_UNAVAILABLE")
                        || remoteCode.equals("EMBEDDING_UNAVAILABLE")) {
                    code = remoteCode;
                    message = error.path("message").asText(message);
                }
            } catch (Exception ignored) {
                // The remote body is not necessarily JSON; keep the safe generic error.
            }
            log.warn("AI RAG request failed: status={}, code={}", exception.getStatusCode(), code);
            throw new BusinessException(code, message, HttpStatus.BAD_GATEWAY);
        } catch (ResourceAccessException exception) {
            log.warn("AI RAG service unavailable: {}", exception.getClass().getSimpleName());
            throw new BusinessException("AI_SERVICE_UNAVAILABLE",
                    "AI service is unavailable or timed out", HttpStatus.SERVICE_UNAVAILABLE);
        } catch (RestClientException exception) {
            log.warn("AI RAG response invalid: {}", exception.getClass().getSimpleName());
            throw new BusinessException("AI_SERVICE_INVALID_RESPONSE",
                    "AI service returned an invalid response", HttpStatus.BAD_GATEWAY);
        }
    }
}
