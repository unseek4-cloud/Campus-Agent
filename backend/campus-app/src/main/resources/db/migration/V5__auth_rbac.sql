-- Repeatable startup SQL, following the existing schema.sql migration mechanism.
CREATE TABLE IF NOT EXISTS user_account (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(80) NOT NULL,
    password_hash VARCHAR(60) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    role VARCHAR(16) NOT NULL,
    student_no VARCHAR(40) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT uk_user_account_username UNIQUE (username),
    CONSTRAINT uk_user_account_student_no UNIQUE (student_no),
    CONSTRAINT ck_user_account_role CHECK (role IN ('STUDENT', 'ADMIN')),
    CONSTRAINT ck_user_account_status CHECK (status IN ('ACTIVE', 'DISABLED')),
    CONSTRAINT ck_user_account_password CHECK (CHAR_LENGTH(password_hash) = 60 AND SUBSTRING(password_hash, 1, 4) IN ('$2a$', '$2b$', '$2y$'))
);

-- Revocable JWT sessions. No raw JWT or password is stored here.
CREATE TABLE IF NOT EXISTS user_login_session (
    id CHAR(36) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    credential_stamp CHAR(64) NOT NULL,
    expires_at TIMESTAMP(3) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_login_session_user FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE CASCADE,
    INDEX idx_login_session_expiry (expires_at)
);
