-- LOCAL TEACHING TEMPLATE ONLY. NOT RUN AT STARTUP.
-- This real BCrypt hash is for the deliberately weak example password 123456.
-- Generate your own hash with scripts/manage-accounts.ps1 -Action Hash before real use.
-- Select only the operation you need; do not execute this entire management template.
USE campus_agent;

-- Add student (replace username, name, student number and hash).
INSERT INTO user_account(username,password_hash,display_name,role,student_no,status)
VALUES ('20260003','$2a$10$YoKKLheITAEm9/cCer48l.JS7bH/Nhf1lfkq2ZWtuYBMZmOBHXViK','王五','STUDENT','20260003','ACTIVE');

-- Add administrator (SQL NULL, not the string 'NULL').
INSERT INTO user_account(username,password_hash,display_name,role,student_no,status)
VALUES ('admin2','$2a$10$YoKKLheITAEm9/cCer48l.JS7bH/Nhf1lfkq2ZWtuYBMZmOBHXViK','管理员2','ADMIN',NULL,'ACTIVE');

-- Everyday listing never includes password_hash.
SELECT id,username,display_name,role,student_no,status,created_at,updated_at
FROM user_account ORDER BY id;

-- Other operations are commented to prevent accidental execution.
-- UPDATE user_account SET status='DISABLED' WHERE username='20260001';
-- DELETE FROM user_login_session WHERE user_id=(SELECT id FROM user_account WHERE username='20260001');
-- UPDATE user_account SET status='ACTIVE' WHERE username='20260001';
-- UPDATE user_account SET password_hash='PASTE_COMPLETE_BCRYPT_HASH_HERE' WHERE username='20260001';
-- DELETE FROM user_account WHERE username IN ('20260003','admin2');
