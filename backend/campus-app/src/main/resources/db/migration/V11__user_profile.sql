-- Optional personal details; repeatable without changing existing accounts.
CREATE TABLE IF NOT EXISTS user_profile (
    user_id BIGINT PRIMARY KEY,
    department VARCHAR(120) NULL,
    major VARCHAR(120) NULL,
    class_name VARCHAR(120) NULL,
    CONSTRAINT fk_user_profile_account FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE CASCADE
);
