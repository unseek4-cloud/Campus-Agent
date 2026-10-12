-- Additive and repeatable: preserve existing applications and attachments.
CREATE TABLE IF NOT EXISTS service_application_material (
    application_id BIGINT NOT NULL,
    material_id VARCHAR(80) NOT NULL,
    material_name VARCHAR(160) NOT NULL,
    description VARCHAR(1000) NULL,
    required BOOLEAN NOT NULL,
    PRIMARY KEY (application_id, material_id),
    CONSTRAINT fk_application_material FOREIGN KEY (application_id) REFERENCES service_application(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS service_application_attachment_material (
    attachment_id CHAR(36) PRIMARY KEY,
    material_id VARCHAR(80) NOT NULL,
    material_name VARCHAR(160) NOT NULL,
    CONSTRAINT fk_attachment_material FOREIGN KEY (attachment_id) REFERENCES service_application_attachment(id) ON DELETE CASCADE
);
