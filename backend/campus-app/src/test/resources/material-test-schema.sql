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
    parse_status VARCHAR(24) NOT NULL DEFAULT 'UPLOADED',
    progress INT NOT NULL DEFAULT 0,
    total_pages INT NOT NULL DEFAULT 0,
    processed_pages INT NOT NULL DEFAULT 0,
    ocr_provider VARCHAR(32) NOT NULL DEFAULT 'none',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_knowledge_document_hash (knowledge_base_id, file_hash),
    KEY idx_knowledge_document_created (created_at),
    KEY idx_knowledge_document_name (display_name)
);

-- Additive and repeatable. Uses the existing knowledge_document UUID and database collation.
CREATE TABLE IF NOT EXISTS service_item (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(80) NOT NULL,
    description TEXT NULL,
    department VARCHAR(255) NULL,
    location VARCHAR(500) NULL,
    office_hours VARCHAR(255) NULL,
    contact VARCHAR(255) NULL,
    requirements TEXT NOT NULL,
    materials TEXT NOT NULL,
    recognition_rules TEXT NOT NULL,
    deadline VARCHAR(500) NULL,
    source_document_id VARCHAR(36) NULL,
    source_title VARCHAR(255) NULL,
    source_url VARCHAR(2000) NULL,
    source_publish_time DATE NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    is_example BOOLEAN NOT NULL DEFAULT FALSE,
    version INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT uk_service_code UNIQUE (code),
    CONSTRAINT fk_service_document FOREIGN KEY (source_document_id) REFERENCES knowledge_document(id) ON DELETE SET NULL,
    CONSTRAINT ck_service_status CHECK (status IN ('DRAFT','ACTIVE','DISABLED')),
    KEY idx_service_status_category (status, category),
    KEY idx_service_updated (updated_at)
);

CREATE TABLE IF NOT EXISTS service_step (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    service_item_id BIGINT NOT NULL,
    step_order INT NOT NULL,
    title VARCHAR(160) NOT NULL,
    description TEXT NULL,
    responsible_department VARCHAR(255) NULL,
    required_materials TEXT NOT NULL,
    location VARCHAR(500) NULL,
    estimated_time VARCHAR(255) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT uk_service_step_order UNIQUE (service_item_id, step_order),
    CONSTRAINT fk_step_service FOREIGN KEY (service_item_id) REFERENCES service_item(id) ON DELETE CASCADE,
    CONSTRAINT ck_step_order CHECK (step_order > 0)
);

-- Additive / repeatable. Materials remain in service_item.materials JSON.
-- Legacy material IDs are derived on read and persisted on save/first upload.
CREATE TABLE IF NOT EXISTS service_material_attachment (
    id CHAR(36) PRIMARY KEY,
    service_item_id BIGINT NOT NULL,
    material_id CHAR(36) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    file_size BIGINT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT uk_material_attachment UNIQUE (service_item_id, material_id),
    CONSTRAINT fk_attachment_service FOREIGN KEY (service_item_id) REFERENCES service_item(id) ON DELETE CASCADE
);
