package com.campusagent.aiintegration.knowledge;

import com.campusagent.shared.error.BusinessException;
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

/** HTTP adapter for the Python AI service; no AI provider details leak into controllers. */
@Component
public class AiKnowledgeClient {
    private static final Logger log = LoggerFactory.getLogger(AiKnowledgeClient.class);
    private static final String SEARCH_PATH = "/internal/v1/knowledge/search";

    private final RestClient restClient;

    public AiKnowledgeClient(
            RestClient.Builder restClientBuilder,
            @Value("${campus.ai-service.base-url}") String baseUrl
    ) {
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        this.restClient = restClientBuilder
                .requestFactory(new JdkClientHttpRequestFactory(httpClient))
                .baseUrl(baseUrl)
                .build();
    }

    public KnowledgeSearchResponse search(KnowledgeSearchRequest request) {
        try {
            AiServiceResponse<KnowledgeSearchResponse> response = restClient.post()
                    .uri(SEARCH_PATH)
                    .body(request)
                    .retrieve()
                    .body(new ParameterizedTypeReference<>() {
                    });

            if (response == null || response.data() == null || !"OK".equals(response.code())) {
                throw new BusinessException(
                        "AI_SERVICE_INVALID_RESPONSE",
                        "AI service returned an invalid response",
                        HttpStatus.BAD_GATEWAY
                );
            }
            return response.data();
        } catch (RestClientResponseException exception) {
            log.warn(
                    "AI knowledge search was rejected: status={}, body={}",
                    exception.getStatusCode(),
                    exception.getResponseBodyAsString()
            );
            throw new BusinessException(
                    "AI_SEARCH_FAILED",
                    "Knowledge retrieval request was rejected by the AI service",
                    HttpStatus.BAD_GATEWAY
            );
        } catch (ResourceAccessException exception) {
            log.warn("AI service is unavailable", exception);
            throw new BusinessException(
                    "AI_SERVICE_UNAVAILABLE",
                    "AI service is unavailable",
                    HttpStatus.SERVICE_UNAVAILABLE
            );
        } catch (RestClientException exception) {
            log.warn("AI knowledge search failed", exception);
            throw new BusinessException(
                    "AI_SERVICE_INVALID_RESPONSE",
                    "AI service returned an invalid response",
                    HttpStatus.BAD_GATEWAY
            );
        }
    }
}
