package com.campusagent.app.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class DocumentAiClientTest {
    @Test void sendsMultipartToExistingPythonProcessingEndpoint() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> body = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        server.createContext("/internal/v1/documents/process", exchange -> {
            contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"code\":\"OK\",\"data\":{\"chunkCount\":2}}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(201, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        });
        server.start();
        try {
            DocumentAiClient client = new DocumentAiClient(RestClient.builder(), new ObjectMapper(),
                    "http://127.0.0.1:" + server.getAddress().getPort());
            DocumentRecord document = new DocumentRecord("doc-1", "kb-1", "规则.pdf", "规则.pdf", "pdf",
                    "application/pdf", 9, "hash", "PROCESSING", 0, null, LocalDateTime.now(), LocalDateTime.now());
            assertEquals(2, client.process(document, "%PDF-test".getBytes(StandardCharsets.UTF_8)));
            assertTrue(contentType.get().startsWith("multipart/form-data"), contentType.get());
            assertTrue(contentType.get().contains("boundary="), contentType.get());
            assertTrue(body.get().contains("name=\"documentId\""));
            assertTrue(body.get().contains("doc-1"));
            assertTrue(body.get().contains("name=\"knowledgeBaseId\""));
            assertTrue(body.get().contains("kb-1"));
            assertTrue(body.get().contains("%PDF-test"));
        } finally { server.stop(0); }
    }
}
