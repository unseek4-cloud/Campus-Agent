package com.campusagent.aiintegration.rag;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.web.client.RestClient;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RagClientTest {
    @Test
    @Timeout(10)
    void chatUsesPythonRagEndpointAndParsesSources() throws Exception {
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            CompletableFuture<String> received = CompletableFuture.supplyAsync(() -> reply(server));
            RagClient client = new RagClient(RestClient.builder(), new ObjectMapper(),
                    "http://127.0.0.1:" + server.getLocalPort(), 5);

            RagChatResponse result = client.chat(new RagChatRequest("测评时间？", null));

            assertEquals("POST /internal/v1/rag/chat HTTP/1.1", received.get(5, TimeUnit.SECONDS));
            assertEquals("2026年9月20日至9月30日。", result.answer());
            assertEquals(1, result.usedContextCount());
            assertEquals("doc-1", result.sources().getFirst().documentId());
            assertEquals(2, result.sources().getFirst().chunkIndex());
        }
    }

    private static String reply(ServerSocket server) {
        try (Socket socket = server.accept()) {
            socket.setSoTimeout(5_000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(
                    socket.getInputStream(), StandardCharsets.US_ASCII));
            String requestLine = reader.readLine();
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                // Consume request headers before returning a response.
            }
            byte[] body = ("{\"code\":\"OK\",\"message\":\"success\",\"data\":{"
                    + "\"answer\":\"2026年9月20日至9月30日。\",\"sources\":[{"
                    + "\"documentId\":\"doc-1\",\"fileName\":\"通知.pdf\","
                    + "\"chunkIndex\":2,\"pageNumber\":1,"
                    + "\"score\":0.6,\"rerankScore\":0.9,\"content\":\"时间\"}],"
                    + "\"retrievalCount\":10,\"rerankCount\":5,\"usedContextCount\":1},"
                    + "\"requestId\":\"test\",\"timestamp\":null}")
                    .getBytes(StandardCharsets.UTF_8);
            String headers = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                    + "Content-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
            socket.getOutputStream().write(headers.getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().write(body);
            socket.getOutputStream().flush();
            return requestLine;
        } catch (Exception exception) {
            throw new RuntimeException(exception);
        }
    }
}
