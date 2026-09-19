package com.campusagent.aiintegration.knowledge;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.web.client.RestClient;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

class AiKnowledgeClientTest {

    @Test
    @Timeout(10)
    void searchUsesHttp11WithoutH2cUpgrade() throws Exception {
        try (ServerSocket serverSocket = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            CompletableFuture<RawRequest> receivedRequest = CompletableFuture.supplyAsync(
                    () -> receiveRequest(serverSocket)
            );
            AiKnowledgeClient client = new AiKnowledgeClient(
                    RestClient.builder(),
                    "http://127.0.0.1:" + serverSocket.getLocalPort()
            );

            KnowledgeSearchResponse response = client.search(
                    new KnowledgeSearchRequest("campus policy", 3, null)
            );
            RawRequest request = receivedRequest.get(5, TimeUnit.SECONDS);

            assertEquals("campus policy", response.query());
            assertEquals(1, response.results().size());
            assertEquals(0.6508, response.results().getFirst().score());
            assertEquals(0.93, response.results().getFirst().rerankScore());
            assertEquals(1.0, response.results().getFirst().evidenceScore());
            assertEquals("调查时间 2026年9月19日—22日", response.results().getFirst().evidenceText());
            assertEquals(1.28, response.results().getFirst().finalScore());
            assertEquals("POST /internal/v1/knowledge/search HTTP/1.1", request.requestLine());
            assertNull(request.headers().get("upgrade"));
            assertFalse(request.headers()
                    .getOrDefault("connection", "")
                    .toLowerCase(Locale.ROOT)
                    .contains("upgrade"));
        }
    }

    private static RawRequest receiveRequest(ServerSocket serverSocket) {
        try (Socket socket = serverSocket.accept()) {
            socket.setSoTimeout(5_000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(
                    socket.getInputStream(),
                    StandardCharsets.US_ASCII
            ));
            String requestLine = reader.readLine();
            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int separator = line.indexOf(':');
                if (separator > 0) {
                    headers.put(
                            line.substring(0, separator).toLowerCase(Locale.ROOT),
                            line.substring(separator + 1).trim()
                    );
                }
            }

            byte[] body = ("{\"code\":\"OK\",\"message\":\"ok\",\"data\":"
                    + "{\"query\":\"campus policy\",\"results\":[{"
                    + "\"rank\":1,\"content\":\"answer\",\"score\":0.6508,"
                    + "\"rerankScore\":0.93,\"evidenceScore\":1.0,"
                    + "\"evidenceText\":\"调查时间 2026年9月19日—22日\","
                    + "\"finalScore\":1.28,\"documentId\":\"doc-1\","
                    + "\"knowledgeBaseId\":\"kb-1\",\"fileName\":\"rules.pdf\","
                    + "\"fileType\":\"pdf\",\"pageNumber\":1,\"chunkIndex\":0,"
                    + "\"source\":\"rules.pdf\"}]},"
                    + "\"requestId\":\"test-request\",\"timestamp\":null}")
                    .getBytes(StandardCharsets.UTF_8);
            String responseHeaders = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: application/json\r\n"
                    + "Content-Length: " + body.length + "\r\n"
                    + "Connection: close\r\n\r\n";
            socket.getOutputStream().write(responseHeaders.getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().write(body);
            socket.getOutputStream().flush();
            return new RawRequest(requestLine, headers);
        } catch (IOException exception) {
            throw new CompletionException(exception);
        }
    }

    private record RawRequest(String requestLine, Map<String, String> headers) {
    }
}
