-- Repeatable additive migration. Existing chat messages and sources are unchanged.
CREATE TABLE IF NOT EXISTS ai_reply_feedback (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    message_id BIGINT NOT NULL,
    rating VARCHAR(16) NOT NULL,
    issue_type VARCHAR(32) NOT NULL DEFAULT 'UNCLASSIFIED',
    handling_status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    admin_note VARCHAR(2000) NOT NULL DEFAULT '',
    reviewed_by BIGINT NULL,
    reviewed_at TIMESTAMP(3) NULL,
    version INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT uk_reply_feedback_user_message UNIQUE (user_id, message_id),
    CONSTRAINT fk_reply_feedback_user FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE CASCADE,
    CONSTRAINT fk_reply_feedback_message FOREIGN KEY (message_id) REFERENCES ai_message(id) ON DELETE CASCADE,
    CONSTRAINT fk_reply_feedback_reviewer FOREIGN KEY (reviewed_by) REFERENCES user_account(id) ON DELETE SET NULL,
    CONSTRAINT ck_reply_feedback_rating CHECK (rating IN ('POSITIVE', 'NEGATIVE')),
    CONSTRAINT ck_reply_feedback_issue CHECK (issue_type IN ('UNCLASSIFIED', 'KNOWLEDGE_GAP', 'RETRIEVAL_MISMATCH', 'ANSWER_QUALITY', 'OTHER')),
    CONSTRAINT ck_reply_feedback_status CHECK (handling_status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
    INDEX idx_reply_feedback_rating_time (rating, updated_at),
    INDEX idx_reply_feedback_user_time (user_id, updated_at)
);

-- Existing ADMIN role is school-wide. Explicit ASSIGNED scope narrows access.
-- Missing permission rows fail closed; no client-provided scope is trusted.
CREATE TABLE IF NOT EXISTS ai_feedback_admin_access (
    admin_id BIGINT PRIMARY KEY,
    access_scope VARCHAR(16) NOT NULL,
    CONSTRAINT fk_feedback_admin FOREIGN KEY (admin_id) REFERENCES user_account(id) ON DELETE CASCADE,
    CONSTRAINT ck_feedback_scope CHECK (access_scope IN ('ALL', 'ASSIGNED'))
);
CREATE TABLE IF NOT EXISTS ai_feedback_admin_user_scope (
    admin_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    PRIMARY KEY (admin_id, user_id),
    CONSTRAINT fk_feedback_scope_admin FOREIGN KEY (admin_id) REFERENCES ai_feedback_admin_access(admin_id) ON DELETE CASCADE,
    CONSTRAINT fk_feedback_scope_user FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE CASCADE
);
-- Bootstrap existing school-wide administrators only once. Later account creation or
-- revocation must never silently acquire broader permission on a backend restart.
CREATE TABLE IF NOT EXISTS ai_feedback_schema_state (
    id INT PRIMARY KEY,
    CONSTRAINT ck_feedback_schema_state CHECK (id = 1)
);
INSERT INTO ai_feedback_admin_access (admin_id, access_scope)
SELECT u.id, 'ALL' FROM user_account u
WHERE u.role = 'ADMIN' AND NOT EXISTS (SELECT 1 FROM ai_feedback_admin_access a WHERE a.admin_id = u.id)
AND NOT EXISTS (SELECT 1 FROM ai_feedback_schema_state WHERE id = 1);
INSERT INTO ai_feedback_schema_state (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ai_feedback_schema_state WHERE id = 1);
