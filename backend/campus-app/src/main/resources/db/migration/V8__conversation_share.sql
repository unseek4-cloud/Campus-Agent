-- Versioned, repeatable startup migration, registered in spring.sql.init.schema-locations.
-- Read-only public share links for a single conversation.
-- The token is the only credential for GET /api/share/chat/{token}; it is random, scoped to one
-- conversation and revocable by its owner. No account data is exposed through the public route.
CREATE TABLE IF NOT EXISTS ai_conversation_share (
    token CHAR(43) PRIMARY KEY,
    conversation_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    title VARCHAR(80) NOT NULL DEFAULT '新对话',
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    view_count INT NOT NULL DEFAULT 0,
    -- JSON 数组：只分享被选中的消息 id；NULL/空数组表示整段会话
    message_ids TEXT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at TIMESTAMP(3) NULL,
    last_viewed_at TIMESTAMP(3) NULL,
    CONSTRAINT fk_ai_share_conversation FOREIGN KEY (conversation_id) REFERENCES ai_conversation(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_share_user FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE CASCADE,
    INDEX idx_ai_share_conversation (conversation_id, created_at),
    INDEX idx_ai_share_user (user_id, created_at)
);
