CREATE TABLE IF NOT EXISTS knowledge_document (
    id VARCHAR(36) PRIMARY KEY,
    knowledge_base_id VARCHAR(128) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(16) NOT NULL,
    mime_type VARCHAR(160) NOT NULL,
    file_size BIGINT NOT NULL,
    file_hash CHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL,
    chunk_count INT NOT NULL DEFAULT 0,
    error_message VARCHAR(1000) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_knowledge_document_hash (knowledge_base_id, file_hash),
    KEY idx_knowledge_document_created (created_at),
    KEY idx_knowledge_document_name (display_name)
);
