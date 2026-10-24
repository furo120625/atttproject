-- Upgrade existing seruchat_full, preserving accounts, keys and messages.
-- Safe to run again. Stop Node server and back up database first.
USE seruchat_full;
DELIMITER $$
DROP PROCEDURE IF EXISTS seruchat_security_upgrade$$
CREATE PROCEDURE seruchat_security_upgrade()
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='public_keys' AND column_name='signing_public_key') THEN
  ALTER TABLE public_keys ADD COLUMN signing_public_key TEXT CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='public_keys' AND column_name='backup_version') THEN
  ALTER TABLE public_keys ADD COLUMN backup_version TINYINT UNSIGNED NOT NULL DEFAULT 1;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='messages' AND column_name='protocol_version') THEN
  ALTER TABLE messages ADD COLUMN protocol_version TINYINT UNSIGNED NOT NULL DEFAULT 1;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='messages' AND column_name='recipient_id') THEN
  ALTER TABLE messages ADD COLUMN recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='messages' AND column_name='signature') THEN
  ALTER TABLE messages ADD COLUMN signature VARCHAR(88) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='messages' AND column_name='sender_signing_key') THEN
  ALTER TABLE messages ADD COLUMN sender_signing_key TEXT CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='friendships' AND column_name='blocked_previous_status') THEN
  ALTER TABLE friendships ADD COLUMN blocked_previous_status ENUM('pending','accepted','rejected') NULL DEFAULT NULL;
 END IF;
 UPDATE friendships f SET blocked_previous_status='accepted'
 WHERE status='blocked' AND blocked_previous_status IS NULL
 AND EXISTS (SELECT 1 FROM conversation_members a JOIN conversation_members b ON a.conversation_id=b.conversation_id
 WHERE a.user_id=f.user1_id AND b.user_id=f.user2_id);
END$$
CALL seruchat_security_upgrade()$$
DROP PROCEDURE seruchat_security_upgrade$$
DELIMITER ;
SHOW COLUMNS FROM public_keys;
SHOW COLUMNS FROM messages;
