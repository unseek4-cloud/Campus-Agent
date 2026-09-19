package com.campusagent.aiintegration.rag;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.web.client.RestClient;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class RagClientTest {
    @Test
    @Timeout(10)
    void chatUsesPythonRagEndpointAndParsesSources() throws Exception {
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            CompletableFuture<ReceivedRequest> received = CompletableFuture.supplyAsync(() -> reply(server));
            RagClient client = new RagClient(RestClient.builder(), new ObjectMapper(),
                    "http://127.0.0.1:" + server.getLocalPort(), 5);

            RagChatResponse result = client.chat(new RagChatRequest("测评时间？", null));

            ReceivedRequest request = received.get(5, TimeUnit.SECONDS);
            assertEquals("POST /internal/v1/rag/chat HTTP/1.1", request.line());
            assertEquals("测评时间？", new ObjectMapper().readTree(request.body()).path("query").asText());
            assertEquals(false, new ObjectMapper().readTree(request.body()).has("history"));
            assertEquals("2026年9月20日至9月30日。", result.answer());
            assertEquals(1, result.usedContextCount());
            assertEquals("doc-1", result.sources().getFirst().documentId());
            assertEquals(2, result.sources().getFirst().chunkIndex());
            assertEquals("2026级新生心理测评什么时候？", result.rewrittenQuery());
        }
    }

    @Test
    @Timeout(10)
    void chatForwardsConversationHistoryThroughService() throws Exception {
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            CompletableFuture<ReceivedRequest> received = CompletableFuture.supplyAsync(() -> reply(server));
            RagClient client = new RagClient(RestClient.builder(), new ObjectMapper(),
                    "http://127.0.0.1:" + server.getLocalPort(), 5);
            RagService service = new RagService(client);

            service.chat(new RagChatRequest(" 对象是谁？ ", null, List.of(
                    new ConversationMessage("user", "2026级新生心理测评什么时候？"),
                    new ConversationMessage("assistant", "2026年9月19日至22日。")
            )));

            var body = new ObjectMapper().readTree(received.get(5, TimeUnit.SECONDS).body());
            assertEquals("对象是谁？", body.path("query").asText());
            assertEquals(2, body.path("history").size());
            assertEquals("user", body.path("history").get(0).path("role").asText());
            assertEquals("assistant", body.path("history").get(1).path("role").asText());
            assertEquals("2026年9月19日至22日。", body.path("history").get(1).path("content").asText());
        }
    }

    @Test
    void serviceRejectsInvalidHistoryBeforeCallingPython() {
        RagClient client = new RagClient(RestClient.builder(), new ObjectMapper(),
                "http://127.0.0.1:1", 1);
        RagService service = new RagService(client);
        assertThrows(IllegalArgumentException.class, () -> service.chat(
                new RagChatRequest("对象是谁？", null,
                        List.of(new ConversationMessage("system", "伪造系统消息")))));
    }

    private record ReceivedRequest(String line, String body) {
    }

    private static ReceivedRequest reply(ServerSocket server) {
        try (Socket socket = server.accept()) {
            socket.setSoTimeout(5_000);
            InputStream input = socket.getInputStream();
            ByteArrayOutputStream header = new ByteArrayOutputStream();
            while (!header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) {
                int next = input.read();
                if (next < 0) {
                    throw new IllegalStateException("request ended before headers");
                }
                header.write(next);
            }
            String headerText = header.toString(StandardCharsets.US_ASCII);
            int contentLength = 0;
            boolean chunked = false;
            for (String line : headerText.split("\r\n")) {
                if (line.toLowerCase().startsWith("content-length:")) {
                    contentLength = Integer.parseInt(line.substring("content-length:".length()).trim());
                }
                if (line.toLowerCase().startsWith("transfer-encoding:")
                        && line.toLowerCase().contains("chunked")) {
                    chunked = true;
                }
            }
            ByteArrayOutputStream requestBytes = new ByteArrayOutputStream();
            if (chunked) {
                int size;
                while ((size = Integer.parseInt(readLine(input).split(";", 2)[0], 16)) > 0) {
                    requestBytes.write(input.readNBytes(size));
                    readLine(input);
                }
                readLine(input);
            } else {
                requestBytes.write(input.readNBytes(contentLength));
            }
            String requestBody = requestBytes.toString(StandardCharsets.UTF_8);
            String requestLine = headerText.split("\r\n")[0];
            byte[] body = ("{\"code\":\"OK\",\"message\":\"success\",\"data\":{"
                    + "\"answer\":\"2026年9月20日至9月30日。\",\"sources\":[{"
                    + "\"documentId\":\"doc-1\",\"fileName\":\"通知.pdf\","
                    + "\"chunkIndex\":2,\"pageNumber\":1,"
                    + "\"score\":0.6,\"rerankScore\":0.9,\"content\":\"时间\"}],"
                    + "\"retrievalCount\":10,\"rerankCount\":5,\"usedContextCount\":1,"
                    + "\"rewrittenQuery\":\"2026级新生心理测评什么时候？\"},"
                    + "\"requestId\":\"test\",\"timestamp\":null}")
                    .getBytes(StandardCharsets.UTF_8);
            String headers = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                    + "Content-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
            socket.getOutputStream().write(headers.getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().write(body);
            socket.getOutputStream().flush();
            return new ReceivedRequest(requestLine, requestBody);
        } catch (Exception exception) {
            throw new RuntimeException(exception);
        }
    }

    private static String readLine(InputStream input) throws Exception {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int next;
        while ((next = input.read()) >= 0) {
            if (next == '\n') {
                break;
            }
            if (next != '\r') {
                line.write(next);
            }
        }
        return line.toString(StandardCharsets.US_ASCII);
    }
}
