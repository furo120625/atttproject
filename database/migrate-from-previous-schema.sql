-- CHI danh cho schema 7 bang da tao tu ban schema.sql truoc khi ghep.
-- Neu dang tao database moi, chi chay schema.sql, KHONG chay migration nay.
-- Khong danh cho file friendships-only cu. Khong DROP TABLE/TRUNCATE.
USE seruchat;

-- Cho phep Java Receiver dang ky public key voi private key giu local.
-- Backup cua browser neu co van phai du bo ba encrypted key, salt, iv.
ALTER TABLE public_keys
    DROP CHECK chk_public_keys_backup,
    MODIFY encrypted_private_key TEXT CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    MODIFY encryption_salt VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    MODIFY encryption_iv VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    ADD CONSTRAINT chk_public_keys_backup CHECK (
        (encrypted_private_key IS NULL AND encryption_salt IS NULL AND encryption_iv IS NULL)
        OR (encrypted_private_key IS NOT NULL AND CHAR_LENGTH(encrypted_private_key) > 0
            AND encryption_salt IS NOT NULL AND encryption_iv IS NOT NULL)
    );

SHOW CREATE TABLE public_keys;
