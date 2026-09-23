package com.campusagent.app.admin;

import com.campusagent.shared.error.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import jakarta.annotation.PreDestroy;
import java.util.zip.ZipInputStream;

@Service
public class AdminDocumentService {
    private static final Logger log = LoggerFactory.getLogger(AdminDocumentService.class);
    private static final Set<String> TYPES = Set.of("pdf","docx","txt","md","xlsx","pptx","png","jpg","jpeg");
    private final DocumentRepository repository;
    private final DocumentAiClient ai;
    private final com.campusagent.shared.storage.LocalFileStorage storage;
    private final String kb;
    private final long maxBytes;
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(16), task -> { Thread thread = new Thread(task, "document-ingest"); thread.setDaemon(true); return thread; });

    public AdminDocumentService(DocumentRepository repository, DocumentAiClient ai,
            @Value("${campus.admin.storage-path}") String storagePath,
            @Value("${campus.admin.knowledge-base-id}") String knowledgeBaseId,
            @Value("${campus.admin.max-upload-size-mb}") long maxMb) {
        this.repository=repository; this.ai=ai; this.storage=new com.campusagent.shared.storage.LocalFileStorage(storagePath);
        this.kb=knowledgeBaseId; this.maxBytes=maxMb*1024*1024;
    }

    public Map<String,Object> list(String search,String type,String status,int page,int size) {
        if (page<1 || size<1 || size>100) throw error("INVALID_PAGE","分页参数无效",HttpStatus.BAD_REQUEST);
        return repository.list(kb,search,type,status,page,size);
    }
    public Map<String,Object> stats() { return repository.stats(kb); }
    public long maxUploadSizeMb() { return maxBytes / 1024 / 1024; }
    @EventListener(ApplicationReadyEvent.class)
    public void markInterruptedTasks() { repository.failInterrupted(); }
    @PreDestroy public void shutdown() { workers.shutdown(); }
    public DocumentRecord detail(String id) {
        DocumentRecord d=repository.find(id);
        if (d==null || !d.knowledgeBaseId().equals(kb)) throw error("DOCUMENT_NOT_FOUND","文档不存在",HttpStatus.NOT_FOUND);
        return d;
    }

    public org.springframework.core.io.Resource originalFile(String id) {
        detail(id);
        return storage.resource(id);
    }

    public Map<String,Object> upload(MultipartFile file) {
        String original = file.getOriginalFilename()==null ? "" : Path.of(file.getOriginalFilename().replace('\\','/')).getFileName().toString();
        String type = original.contains(".") ? original.substring(original.lastIndexOf('.')+1).toLowerCase() : "";
        if (Set.of("doc","xls","ppt").contains(type)) throw error("UNSUPPORTED_DOCUMENT_TYPE","暂不支持旧版 Office 格式，请转换为 DOCX / XLSX / PPTX 后上传",HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        if (!TYPES.contains(type)) throw error("UNSUPPORTED_DOCUMENT_TYPE","暂不支持该文件格式",HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        if (original.length()>255) throw error("INVALID_NAME","文件名过长",HttpStatus.BAD_REQUEST);
        if (file.isEmpty()) throw error("EMPTY_FILE","文件为空",HttpStatus.BAD_REQUEST);
        if (file.getSize()>maxBytes) throw error("DOCUMENT_TOO_LARGE","文件超过大小限制",HttpStatus.PAYLOAD_TOO_LARGE);
        try {
            byte[] bytes=file.getBytes();
            String mime=file.getContentType()==null ? "application/octet-stream" : file.getContentType().split(";",2)[0].toLowerCase();
            validate(type,mime,bytes);
            String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            log.info("document upload received name={} size={}; document hash calculated hash={}",original,bytes.length,hash);
            DocumentRecord existing=repository.duplicate(kb,hash);
            log.info("duplicate check hash={} duplicate={}",hash,existing!=null);
            if (existing!=null) return Map.of("duplicate",true,"document",existing);
            String id=UUID.randomUUID().toString();
            DocumentRecord doc=new DocumentRecord(id,kb,original,original,type,mime,bytes.length,hash,"PROCESSING",0,null,null,null);
            storage.write(id,bytes);
            try { repository.insert(doc); }
            catch (DataIntegrityViolationException race) {
                storage.delete(id);
                DocumentRecord duplicate=repository.duplicate(kb,hash);
                if (duplicate!=null) return Map.of("duplicate",true,"document",duplicate);
                throw race;
            } catch (RuntimeException databaseFailure) {
                storage.delete(id);
                throw databaseFailure;
            }
            enqueue(id);
            DocumentRecord created = detail(id);
            return Map.of("duplicate",false,"taskId",id,"documentId",id,"status",created.status(),"document",created);
        } catch (IOException | NoSuchAlgorithmException exception) {
            throw error("UPLOAD_FAILED","文件保存失败，请稍后重试",HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    private void enqueue(String id) {
        try { workers.execute(() -> processStored(id)); }
        catch (RejectedExecutionException rejected) {
            repository.failed(id, "处理队列已满，请稍后重新解析");
            throw error("PROCESSING_QUEUE_FULL", "处理队列已满，请稍后重试", HttpStatus.SERVICE_UNAVAILABLE);
        }
    }

    private void processStored(String id) {
        long started = System.nanoTime();
        try {
            DocumentRecord doc = detail(id);
            byte[] bytes = storage.read(id);
            log.info("document parsing started id={} parser={}", id, doc.fileType());
            DocumentAiClient.ProcessResult result = ai.process(doc, bytes);
            repository.processed(id, result);
            log.info("document parsing completed id={} pages={} chunks={} durationMs={}",
                    id, result.pageCount(), result.chunkCount(), (System.nanoTime()-started)/1_000_000);
        } catch (Exception failure) {
            log.error("document processing failed id={}", id, failure);
            try { ai.deleteVectors(id); }
            catch (Exception cleanupFailure) { log.error("document vector cleanup failed id={}", id, cleanupFailure); }
            repository.failed(id, "文档解析失败，请重新解析或切换 OCR 模式");
        }
    }

    public DocumentRecord progress(String id) {
        DocumentRecord doc = detail(id);
        if (doc.status().equals("PROCESSING")) {
            try { repository.progress(id, ai.progress(id)); }
            catch (RuntimeException unavailable) { log.debug("document progress unavailable id={}", id); }
        }
        return detail(id);
    }

    private void validate(String type,String mime,byte[] bytes) {
        String expected=switch(type) {
            case "pdf" -> "application/pdf"; case "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            case "png" -> "image/png"; case "jpg","jpeg" -> "image/jpeg";
            case "md" -> "text/markdown"; default -> "text/plain";
        };
        boolean mimeOk=mime.equals(expected)||mime.equals("application/octet-stream")||
                (Set.of("docx","xlsx","pptx").contains(type)&&mime.equals("application/zip"))||
                (type.equals("md")&&(mime.equals("text/plain")||mime.equals("text/x-markdown")))||
                (Set.of("docx","xlsx","pptx").contains(type)&&mime.equals("application/x-zip-compressed"));
        if (!mimeOk) throw error("UNSUPPORTED_DOCUMENT_TYPE","文件类型与内容类型不一致",HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        if (type.equals("txt") || type.equals("md")) {
            try {
                String decoded=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
                if (decoded.chars().anyMatch(c -> c<32 && c!='\t' && c!='\n' && c!='\r'))
                    throw error("INVALID_DOCUMENT","文本文件包含二进制内容",HttpStatus.UNPROCESSABLE_ENTITY);
            } catch (CharacterCodingException exception) {
                throw error("INVALID_DOCUMENT","文本文件必须使用 UTF-8 编码",HttpStatus.UNPROCESSABLE_ENTITY);
            }
        }
        boolean signature=switch(type) {
            case "pdf" -> new String(bytes,0,Math.min(bytes.length,5),java.nio.charset.StandardCharsets.US_ASCII).equals("%PDF-");
            case "docx","xlsx","pptx" -> bytes.length>=4 && bytes[0]=='P' && bytes[1]=='K' && validOffice(bytes,type);
            case "png" -> bytes.length>=8 && bytes[0]==(byte)0x89 && bytes[1]=='P' && bytes[2]=='N' && bytes[3]=='G';
            case "jpg","jpeg" -> bytes.length>=3 && bytes[0]==(byte)0xff && bytes[1]==(byte)0xd8 && bytes[2]==(byte)0xff;
            default -> true;
        };
        if (!signature) throw error("INVALID_DOCUMENT","文件内容与格式不符或文件已损坏",HttpStatus.UNPROCESSABLE_ENTITY);
    }

    private boolean validOffice(byte[] bytes,String type) {
        String expected=switch(type) {case "docx"->"word/document.xml";case "xlsx"->"xl/workbook.xml";default->"ppt/presentation.xml";};
        try (ZipInputStream zip=new ZipInputStream(new java.io.ByteArrayInputStream(bytes))) {
            java.util.zip.ZipEntry entry;
            while ((entry=zip.getNextEntry())!=null) if (expected.equals(entry.getName())) return true;
        } catch (IOException ignored) { }
        return false;
    }

    public DocumentRecord rename(String id,String requested) {
        DocumentRecord doc=detail(id);
        if (doc.status().equals("PROCESSING")) throw error("DOCUMENT_BUSY","文档正在处理，请稍后操作",HttpStatus.CONFLICT);
        String name=requested==null ? "" : requested.trim();
        if (name.isBlank() || name.length()>240 || name.contains("/") || name.contains("\\")) throw error("INVALID_NAME","请输入有效的文档名称",HttpStatus.BAD_REQUEST);
        if (!name.toLowerCase().endsWith("."+doc.fileType())) name += "."+doc.fileType();
        ai.renameVectors(id,name);
        try { repository.rename(id,name); }
        catch (RuntimeException databaseFailure) {
            try { ai.renameVectors(id,doc.displayName()); }
            catch (RuntimeException rollbackFailure) { log.error("document rename rollback failed id={}",id,rollbackFailure); }
            throw databaseFailure;
        }
        log.info("document renamed id={}",id);
        return detail(id);
    }

    public void delete(String id) {
        if (detail(id).status().equals("PROCESSING")) throw error("DOCUMENT_BUSY","文档正在处理，请稍后操作",HttpStatus.CONFLICT);
        ai.deleteVectors(id);
        try { storage.delete(id); }
        catch (IOException exception) { throw error("DELETE_FAILED","原文件删除失败，请稍后重试",HttpStatus.INTERNAL_SERVER_ERROR); }
        repository.delete(id);
        log.info("document deleted id={}",id);
    }

    public DocumentRecord reprocess(String id) {
        DocumentRecord doc=detail(id);
        if (doc.status().equals("PROCESSING")) throw error("DOCUMENT_BUSY","文档正在处理，请稍后操作",HttpStatus.CONFLICT);
        if (!storage.exists(id)) throw error("SOURCE_FILE_MISSING","原文件不存在，无法重新解析",HttpStatus.CONFLICT);
        log.info("document reprocess started id={}",id);
        repository.processing(id);
        enqueue(id);
        return detail(id);
    }

    private static BusinessException error(String code,String message,HttpStatus status) { return new BusinessException(code,message,status); }
}
