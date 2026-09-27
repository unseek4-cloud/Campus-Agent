-- Additive, repeatable startup migration, following V3-V5. No workflow engine.
CREATE TABLE IF NOT EXISTS service_application (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    application_no VARCHAR(48) NOT NULL,
    service_item_id BIGINT NOT NULL,
    service_name VARCHAR(120) NOT NULL,
    user_id BIGINT NOT NULL,
    applicant_name VARCHAR(120) NOT NULL,
    student_no VARCHAR(40) NOT NULL,
    status VARCHAR(16) NOT NULL,
    active_slot INT NULL,
    student_remark TEXT NOT NULL,
    admin_remark TEXT NULL,
    version INT NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    completed_at TIMESTAMP(3) NULL,
    CONSTRAINT uk_application_no UNIQUE (application_no),
    CONSTRAINT uk_application_active UNIQUE (user_id, service_item_id, active_slot),
    CONSTRAINT fk_application_service FOREIGN KEY (service_item_id) REFERENCES service_item(id),
    CONSTRAINT fk_application_user FOREIGN KEY (user_id) REFERENCES user_account(id),
    CONSTRAINT ck_application_status CHECK (status IN ('SUBMITTED','REVIEWING','NEED_MORE','APPROVED','REJECTED','COMPLETED')),
    CONSTRAINT ck_application_active CHECK (
        (status IN ('SUBMITTED','REVIEWING','NEED_MORE','APPROVED') AND active_slot IS NOT NULL AND active_slot=1)
        OR (status IN ('REJECTED','COMPLETED') AND active_slot IS NULL)),
    INDEX idx_application_user (user_id, submitted_at),
    INDEX idx_application_status (status, submitted_at)
);

CREATE TABLE IF NOT EXISTS service_application_attachment (
    id CHAR(36) PRIMARY KEY,
    application_id BIGINT NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    file_size BIGINT NOT NULL,
    uploaded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_application_attachment FOREIGN KEY (application_id) REFERENCES service_application(id),
    INDEX idx_application_attachment (application_id)
);

CREATE TABLE IF NOT EXISTS service_application_event (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    application_id BIGINT NOT NULL,
    from_status VARCHAR(16) NULL,
    to_status VARCHAR(16) NOT NULL,
    actor_id BIGINT NOT NULL,
    actor_name VARCHAR(120) NOT NULL,
    actor_role VARCHAR(16) NOT NULL,
    remark TEXT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_application_event FOREIGN KEY (application_id) REFERENCES service_application(id),
    CONSTRAINT fk_application_event_actor FOREIGN KEY (actor_id) REFERENCES user_account(id),
    INDEX idx_application_event (application_id, id)
);
