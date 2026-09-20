package com.campusagent.app.admin;

import com.campusagent.shared.error.BusinessException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;

@Component
public class DocumentAiClient {
    private final RestClient client;
    private final ObjectMapper mapper;

    public DocumentAiClient(RestClient.Builder builder,
            ObjectMapper mapper,
            @Value("${campus.ai-service.base-url}") String baseUrl) {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(15)).build());
        factory.setReadTimeout(Duration.ofMinutes(10));
        this.client = builder.baseUrl(baseUrl).requestFactory(factory).build();
        this.mapper = mapper;
    }

    private JsonNode data(JsonNode response) {
        if (response == null || !"OK".equals(response.path("code").asText()) || response.path("data").isMissingNode())
            throw new BusinessException("AI_INVALID_RESPONSE", "文档服务返回异常，请稍后重试", HttpStatus.BAD_GATEWAY);
        return response.path("data");
    }

    private BusinessException translate(RestClientException exception) {
        if (exception instanceof RestClientResponseException response) {
            String code = "DOCUMENT_PROCESSING_FAILED";
            String message = "文档处理失败，请查看错误详情或稍后重试";
            try {
                code = mapper.readTree(response.getResponseBodyAsString()).path("code").asText(code);
                message = switch (code) {
                    case "UNSUPPORTED_DOCUMENT_TYPE" -> "暂不支持该文件格式";
                    case "DOCUMENT_TOO_LARGE" -> "文件超过大小限制";
                    case "DOCUMENT_HAS_NO_TEXT" -> "文件中没有可用文字，请检查内容或图片清晰度";
                    case "DOCUMENT_EXTRACTION_FAILED" -> "文件无法解析，可能已损坏";
                    case "OCR_PAGE_LIMIT_EXCEEDED" -> "扫描页超过 OCR 处理上限";
                    case "OCR_FAILED" -> "图片文字识别失败，请检查文件或稍后重试";
                    case "EMBEDDING_UNAVAILABLE" -> "向量生成服务暂不可用";
                    case "VECTOR_STORE_UNAVAILABLE" -> "向量索引写入失败";
                    case "INVALID_DOCUMENT" -> "文件内容与格式不符或文件已损坏";
                    default -> message;
                };
            } catch (Exception ignored) { }
            return new BusinessException(code, message, HttpStatus.BAD_GATEWAY);
        }
        return new BusinessException("AI_SERVICE_UNAVAILABLE", "AI 服务不可用，请稍后重试", HttpStatus.SERVICE_UNAVAILABLE);
    }

    public int process(DocumentRecord document, byte[] bytes) {
        MultiValueMap<String,Object> parts = new LinkedMultiValueMap<>();
        parts.add("documentId", document.id()); parts.add("knowledgeBaseId", document.knowledgeBaseId());
        parts.add("file", new ByteArrayResource(bytes) {
            @Override public String getFilename() { return document.displayName(); }
        });
        try {
            JsonNode response = client.post().uri("/internal/v1/documents/process")
                    .contentType(MediaType.MULTIPART_FORM_DATA).body(parts).retrieve().body(JsonNode.class);
            return data(response).path("chunkCount").asInt();
        } catch (RestClientException exception) { throw translate(exception); }
    }

    public void deleteVectors(String id) {
        try { data(client.delete().uri("/internal/v1/documents/{id}/vectors", id).retrieve().body(JsonNode.class)); }
        catch (RestClientException exception) { throw translate(exception); }
    }

    public void renameVectors(String id, String name) {
        try { data(client.patch().uri("/internal/v1/documents/{id}/name", id).body(Map.of("fileName", name)).retrieve().body(JsonNode.class)); }
        catch (RestClientException exception) { throw translate(exception); }
    }
}
