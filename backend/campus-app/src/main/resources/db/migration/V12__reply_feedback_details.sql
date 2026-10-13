-- Keep user explanations separate from administrator classifications and notes.
CREATE TABLE IF NOT EXISTS ai_reply_feedback_detail (
    feedback_id BIGINT PRIMARY KEY,
    reasons VARCHAR(240) NOT NULL DEFAULT '',
    user_comment VARCHAR(2000) NOT NULL DEFAULT '',
    CONSTRAINT fk_reply_feedback_detail FOREIGN KEY (feedback_id) REFERENCES ai_reply_feedback(id) ON DELETE CASCADE
);
