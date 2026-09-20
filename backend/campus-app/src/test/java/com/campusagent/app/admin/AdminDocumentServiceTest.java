package com.campusagent.app.admin;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.campusagent.shared.error.BusinessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.client.RestClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class AdminDocumentServiceTest {
    @TempDir Path temp;

    static class MemoryRepository extends DocumentRepository {
        Map<String, DocumentRecord> records = new ConcurrentHashMap<>();
        MemoryRepository() { super(new JdbcTemplate()); }
        @Override public DocumentRecord find(String id) { return records.get(id); }
        @Override public DocumentRecord duplicate(String kb,String hash) { return records.values().stream().filter(d -> d.knowledgeBaseId().equals(kb) && d.fileHash().equals(hash)).findFirst().orElse(null); }
        @Override public void insert(DocumentRecord d) { records.put(d.id(), new DocumentRecord(d.id(),d.knowledgeBaseId(),d.displayName(),d.originalFilename(),d.fileType(),d.mimeType(),d.fileSize(),d.fileHash(),d.status(),0,null,LocalDateTime.now(),LocalDateTime.now())); }
        @Override public void processed(String id,DocumentAiClient.ProcessResult result) { update(id,"SUCCESS",result.chunkCount(),null,null); }
        @Override public void failed(String id,String message) { update(id,"FAILED",0,message,null); }
        @Override public void processing(String id) { update(id,"PROCESSING",0,null,null); }
        @Override public void rename(String id,String name) { DocumentRecord d=find(id); update(id,d.status(),d.chunkCount(),d.errorMessage(),name); }
        @Override public void delete(String id) { records.remove(id); }
        @Override public void failInterrupted() { }
        void update(String id,String status,int count,String error,String name) {
            DocumentRecord d=find(id);
            records.put(id,new DocumentRecord(id,d.knowledgeBaseId(),name==null?d.displayName():name,d.originalFilename(),d.fileType(),d.mimeType(),d.fileSize(),d.fileHash(),status,count,error,d.createdAt(),LocalDateTime.now()));
        }
    }
    static class FakeAi extends DocumentAiClient {
        int processes, deletions, renames;
        boolean fail;
        FakeAi() { super(RestClient.builder(),new ObjectMapper(),"http://localhost:8000"); }
        @Override public ProcessResult process(DocumentRecord d,byte[] bytes) { processes++; if (fail) throw new IllegalStateException("文件无法解析"); return new ProcessResult(2,1,"none"); }
        @Override public void deleteVectors(String id) { deletions++; }
        @Override public void renameVectors(String id,String name) { renames++; }
    }

    @Test void uploadReturnsWhileProcessingRunsInBackground() throws Exception {
        MemoryRepository repo = new MemoryRepository();
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        FakeAi ai = new FakeAi() {
            @Override public ProcessResult process(DocumentRecord document, byte[] bytes) {
                started.countDown();
                try { if (!release.await(2, TimeUnit.SECONDS)) throw new IllegalStateException("worker timed out"); }
                catch (InterruptedException exception) { Thread.currentThread().interrupt(); throw new IllegalStateException(exception); }
                return super.process(document, bytes);
            }
        };
        AdminDocumentService service = new AdminDocumentService(repo, ai, temp.toString(), "campus-default", 20);
        try {
            Map<String,Object> response = service.upload(new FileUpload("异步.pdf", "%PDF-content".getBytes()));
            DocumentRecord document = (DocumentRecord) response.get("document");
            assertEquals(document.id(), response.get("taskId"));
            assertEquals("PROCESSING", document.status());
            assertTrue(started.await(1, TimeUnit.SECONDS));
            assertEquals(0, ai.processes);
            release.countDown();
            awaitStatus(repo, document.id(), "SUCCESS");
        } finally { release.countDown(); service.shutdown(); }
    }
    static DocumentRecord awaitStatus(MemoryRepository repo, String id, String status) {
        for (int attempt=0;attempt<100;attempt++) {
            DocumentRecord record=repo.find(id);
            if (record!=null && record.status().equals(status)) return record;
            try { Thread.sleep(20); } catch (InterruptedException exception) { Thread.currentThread().interrupt(); throw new AssertionError(exception); }
        }
        fail("Timed out waiting for status " + status);
        return null;
    }
    static class FileUpload implements MultipartFile {
        final String name; final byte[] content;
        FileUpload(String name,byte[] content) { this.name=name; this.content=content; }
        @Override public String getName() { return "file"; }
        @Override public String getOriginalFilename() { return name; }
        @Override public String getContentType() { return "application/pdf"; }
        @Override public boolean isEmpty() { return content.length==0; }
        @Override public long getSize() { return content.length; }
        @Override public byte[] getBytes() { return content; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(content); }
        @Override public void transferTo(File destination) throws IOException { Files.write(destination.toPath(),content); }
    }

    @Test void detectsSameContentWithDifferentNameWithoutSecondEmbedding() {
        MemoryRepository repo=new MemoryRepository(); FakeAi ai=new FakeAi();
        AdminDocumentService service=new AdminDocumentService(repo,ai,temp.toString(),"campus-default",20);
        byte[] bytes="%PDF-same-content".getBytes();
        Map<String,Object> first=service.upload(new FileUpload("学生手册.pdf",bytes));
        Map<String,Object> second=service.upload(new FileUpload("2026学生手册.pdf",bytes));
        assertEquals(false,first.get("duplicate")); assertEquals(true,second.get("duplicate"));
        awaitStatus(repo,((DocumentRecord)first.get("document")).id(),"SUCCESS");
        assertEquals(1,ai.processes); assertEquals(1,repo.records.size());
        assertEquals(((DocumentRecord)first.get("document")).id(),((DocumentRecord)second.get("document")).id());
    }

    @Test void renameUpdatesCitationsAndDeleteRemovesVectorsAndOriginal() {
        MemoryRepository repo=new MemoryRepository(); FakeAi ai=new FakeAi();
        AdminDocumentService service=new AdminDocumentService(repo,ai,temp.toString(),"campus-default",20);
        DocumentRecord uploaded=(DocumentRecord)service.upload(new FileUpload("规则.pdf","%PDF-content".getBytes())).get("document");
        awaitStatus(repo,uploaded.id(),"SUCCESS");
        assertEquals("新规则.pdf",service.rename(uploaded.id(),"新规则").displayName());
        assertEquals(1,ai.renames);
        assertTrue(Files.exists(temp.resolve(uploaded.id())));
        service.delete(uploaded.id());
        assertEquals(1,ai.deletions); assertNull(repo.find(uploaded.id()));
        assertFalse(Files.exists(temp.resolve(uploaded.id())));
    }

    @Test void reprocessReusesRecordAndReembeds() {
        MemoryRepository repo=new MemoryRepository(); FakeAi ai=new FakeAi();
        AdminDocumentService service=new AdminDocumentService(repo,ai,temp.toString(),"campus-default",20);
        DocumentRecord uploaded=(DocumentRecord)service.upload(new FileUpload("规则.pdf","%PDF-content".getBytes())).get("document");
        awaitStatus(repo,uploaded.id(),"SUCCESS");
        assertEquals(uploaded.id(),service.reprocess(uploaded.id()).id());
        awaitStatus(repo,uploaded.id(),"SUCCESS");
        assertEquals(0,ai.deletions); assertEquals(2,ai.processes);
    }

    @Test void failedProcessingKeepsRecordAndReasonForRetry() {
        MemoryRepository repo=new MemoryRepository(); FakeAi ai=new FakeAi(); ai.fail=true;
        AdminDocumentService service=new AdminDocumentService(repo,ai,temp.toString(),"campus-default",20);
        DocumentRecord uploaded=(DocumentRecord)service.upload(new FileUpload("损坏.pdf","%PDF-content".getBytes())).get("document");
        DocumentRecord failed=awaitStatus(repo,uploaded.id(),"FAILED");
        assertEquals("文档解析失败，请重新解析或切换 OCR 模式",failed.errorMessage());
        ai.fail=false;
        service.reprocess(failed.id());
        assertEquals("SUCCESS",awaitStatus(repo,failed.id(),"SUCCESS").status());
    }

    @Test void unsupportedOrMismatchedFileIsRejectedBeforePersistence() {
        MemoryRepository repo=new MemoryRepository(); FakeAi ai=new FakeAi();
        AdminDocumentService service=new AdminDocumentService(repo,ai,temp.toString(),"campus-default",20);
        assertThrows(BusinessException.class,()->service.upload(new FileUpload("archive.zip","PK-content".getBytes())));
        assertThrows(BusinessException.class,()->service.upload(new FileUpload("fake.pdf","not-a-pdf".getBytes())));
        assertTrue(repo.records.isEmpty()); assertEquals(0,ai.processes);
    }
}
