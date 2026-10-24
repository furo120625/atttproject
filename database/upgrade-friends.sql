-- NANG CAP DATABASE DANG DUNG: chay MOT LAN cho seruchat_full.
-- Khong chay schema.sql tren database da co bang. Khong DROP/TRUNCATE.
-- Neu DB_NAME trong .env khac, thay USE o dong duoi cho dung.
USE seruchat_full;

ALTER TABLE friendships
    ADD COLUMN blocked_previous_status ENUM('pending', 'accepted', 'rejected') NULL DEFAULT NULL AFTER blocked_at;

-- Ban ung dung truoc nang cap chi tao chat khi accepted va chua co xoa ban.
-- Neu mot cap dang blocked da co chat, khoi phuc dau vet accepted de bo chan.
-- Khong co chat thi de NULL; bo chan se cho phep gui loi moi moi.
UPDATE friendships f
SET f.blocked_previous_status = 'accepted'
WHERE f.status = 'blocked' AND f.blocked_previous_status IS NULL AND EXISTS (
    SELECT 1 FROM conversation_members a
    JOIN conversation_members b ON b.conversation_id = a.conversation_id
    WHERE a.user_id = f.user1_id AND b.user_id = f.user2_id
);

SELECT id, status, blocked_by, blocked_previous_status FROM friendships;
