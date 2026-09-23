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
