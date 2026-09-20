package com.campusagent.app.admin;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Repository
public class DocumentRepository {
    private final JdbcTemplate jdbc;
    private final RowMapper<DocumentRecord> mapper = (rs, row) -> new DocumentRecord(
            rs.getString("id"), rs.getString("knowledge_base_id"), rs.getString("display_name"),
            rs.getString("original_filename"), rs.getString("file_type"), rs.getString("mime_type"),
            rs.getLong("file_size"), rs.getString("file_hash"), rs.getString("status"),
            rs.getInt("chunk_count"), rs.getString("error_message"),
            rs.getTimestamp("created_at").toLocalDateTime(), rs.getTimestamp("updated_at").toLocalDateTime(),
            rs.getString("parse_status"), rs.getInt("progress"), rs.getInt("total_pages"),
            rs.getInt("processed_pages"), rs.getString("ocr_provider"));

    public DocumentRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public DocumentRecord find(String id) {
        return jdbc.query("SELECT * FROM knowledge_document WHERE id=?", mapper, id).stream().findFirst().orElse(null);
    }

    public DocumentRecord duplicate(String kb, String hash) {
        return jdbc.query("SELECT * FROM knowledge_document WHERE knowledge_base_id=? AND file_hash=?",
                mapper, kb, hash).stream().findFirst().orElse(null);
    }

    public void insert(DocumentRecord document) {
        jdbc.update("INSERT INTO knowledge_document (id,knowledge_base_id,display_name,original_filename,file_type,mime_type,file_size,file_hash,status,chunk_count) VALUES (?,?,?,?,?,?,?,?,?,0)",
                document.id(), document.knowledgeBaseId(), document.displayName(), document.originalFilename(),
                document.fileType(), document.mimeType(), document.fileSize(), document.fileHash(), document.status());
    }

    public void processed(String id, DocumentAiClient.ProcessResult result) {
        jdbc.update("UPDATE knowledge_document SET status='SUCCESS',parse_status='COMPLETED',progress=100,chunk_count=?,total_pages=?,processed_pages=?,ocr_provider=?,error_message=NULL WHERE id=?",
                result.chunkCount(), result.pageCount(), result.pageCount(), result.ocrProvider(), id);
    }

    public void failed(String id, String message) {
        jdbc.update("UPDATE knowledge_document SET status='FAILED',parse_status='FAILED',error_message=? WHERE id=?", message, id);
    }

    public void processing(String id) {
        jdbc.update("UPDATE knowledge_document SET status='PROCESSING',parse_status='UPLOADED',progress=5,"
                + "processed_pages=0,total_pages=0,ocr_provider='none',error_message=NULL,chunk_count=0 WHERE id=?", id);
    }

    public void progress(String id, DocumentAiClient.Progress progress) {
        int value = Math.min(99, Math.max(0, progress.progress()));
        jdbc.update("UPDATE knowledge_document SET parse_status=CASE WHEN ? >= progress THEN ? ELSE parse_status END,"
                + "progress=GREATEST(progress,?),processed_pages=GREATEST(processed_pages,?),"
                + "total_pages=GREATEST(total_pages,?),"
                + "ocr_provider=CASE WHEN ? >= progress THEN ? ELSE ocr_provider END WHERE id=? AND status='PROCESSING'",
                value, progress.status(), value, progress.currentPage(), progress.totalPages(),
                value, progress.ocrProvider(), id);
    }

    public void failInterrupted() {
        jdbc.update("UPDATE knowledge_document SET status='FAILED',parse_status='FAILED',error_message='服务重启中断处理，请重新解析' WHERE status='PROCESSING'");
    }

    public void rename(String id, String name) {
        jdbc.update("UPDATE knowledge_document SET display_name=? WHERE id=?", name, id);
    }

    public void delete(String id) { jdbc.update("DELETE FROM knowledge_document WHERE id=?", id); }

    private String where(String kb, String search, String type, String status, List<Object> args) {
        StringBuilder sql = new StringBuilder(" WHERE knowledge_base_id=?"); args.add(kb);
        if (search != null && !search.isBlank()) { sql.append(" AND display_name LIKE ?"); args.add("%" + search.trim() + "%"); }
        if (type != null && !type.isBlank()) { sql.append(" AND file_type=?"); args.add(type.toLowerCase()); }
        if (status != null && !status.isBlank()) { sql.append(" AND status=?"); args.add(status.toUpperCase()); }
        return sql.toString();
    }

    public Map<String,Object> list(String kb, String search, String type, String status, int page, int size) {
        List<Object> args = new ArrayList<>();
        String clause = where(kb, search, type, status, args);
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM knowledge_document" + clause, Long.class, args.toArray());
        List<Object> paging = new ArrayList<>(args); paging.add(size); paging.add((page - 1) * size);
        List<DocumentRecord> items = jdbc.query("SELECT * FROM knowledge_document" + clause + " ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", mapper, paging.toArray());
        return Map.of("items", items, "total", total == null ? 0 : total, "page", page, "pageSize", size);
    }

    public Map<String,Object> stats(String kb) {
        List<Map<String,Object>> rows = jdbc.queryForList("SELECT status,COUNT(*) AS n,COALESCE(SUM(chunk_count),0) AS chunks FROM knowledge_document WHERE knowledge_base_id=? GROUP BY status", kb);
        long success=0, failed=0, processing=0, chunks=0;
        for (Map<String,Object> row : rows) {
            long n = ((Number) row.get("n")).longValue(); chunks += ((Number) row.get("chunks")).longValue();
            switch (String.valueOf(row.get("status"))) { case "SUCCESS" -> success=n; case "FAILED" -> failed=n; case "PROCESSING" -> processing=n; default -> { } }
        }
        return Map.of("total", success+failed+processing, "success",success,"failed",failed,"processing",processing,"chunks",chunks,
                "recent", list(kb,null,null,null,1,7).get("items"));
    }
}
