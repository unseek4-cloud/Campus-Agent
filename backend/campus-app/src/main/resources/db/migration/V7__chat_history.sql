-- Versioned, repeatable startup migration, registered in spring.sql.init.schema-locations.
CREATE TABLE IF NOT EXISTS ai_conversation (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    title VARCHAR(80) NOT NULL DEFAULT '新对话',
    pending_request_id CHAR(36) NULL,
    pending_since TIMESTAMP(3) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_ai_conversation_user FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE CASCADE,
    INDEX idx_ai_conversation_user_updated (user_id, updated_at)
);

CREATE TABLE IF NOT EXISTS ai_message (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id BIGINT NOT NULL,
    request_id CHAR(36) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content LONGTEXT NOT NULL,
    sources_json JSON NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_ai_message_conversation FOREIGN KEY (conversation_id) REFERENCES ai_conversation(id) ON DELETE CASCADE,
    CONSTRAINT ck_ai_message_role CHECK (role IN ('USER', 'ASSISTANT')),
    CONSTRAINT uk_ai_message_request_role UNIQUE (conversation_id, request_id, role),
    INDEX idx_ai_message_conversation_created (conversation_id, created_at)
);
