package com.campusagent.aiintegration.serviceguide;

import com.campusagent.affair.serviceguide.dto.*;
import com.sun.net.httpserver.HttpServer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class ServiceAiClientTest {
    @Test void usesHttp11WithoutUpgradeAndPreservesStructuredFacts() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var upgrade = new AtomicReference<String>();
        var body = new AtomicReference<String>();
        server.createContext("/internal/v1/service-guide/narrate", exchange -> {
            upgrade.set(exchange.getRequestHeaders().getFirst("Upgrade"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"code\":\"OK\",\"data\":{\"answer\":\"请准备材料\",\"sources\":[],\"retrievalCount\":0,\"rerankCount\":0,\"usedContextCount\":0,\"rewrittenQuery\":\"补办\"}}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response); exchange.close();
        });
        server.start();
        try {
            var client = new ServiceAiClient(RestClient.builder(), "http://127.0.0.1:" + server.getAddress().getPort(), 3);
            var item = new ServiceItemDTO(1L, "CARD", "学生证补办", "测试", null, null, null, null, null,
                    List.of(), List.of(), new ServiceItemDTO.RecognitionRules(List.of("学生证"), List.of("丢"), List.of()),
                    null, null, null, null, null, "ACTIVE", true, 0, null, null);
            var result = client.narrate("补办", null, new ServiceDetail(item, List.of()));
            assertEquals("请准备材料", result.answer());
            assertNull(upgrade.get(), "Uvicorn does not support h2c upgrades");
            var payload = new ObjectMapper().readTree(body.get());
            assertTrue(payload.path("guide").path("service").path("isExample").asBoolean());
            assertEquals("学生证补办", payload.path("guide").path("service").path("name").asText());
        } finally { server.stop(0); }
    }
}
