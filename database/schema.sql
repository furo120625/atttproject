-- SERUCHAT - Schema cho database moi, MySQL 8.0.16 tro len.
-- Khop voi cac controller Node.js va Web Crypto client da cung cap.
-- Giao thuc v2: AAD, Ed25519, backup bang ma khoi phuc; doc duoc tin v1.
-- Khong DROP/TRUNCATE, khong tao tai khoan mau, khong chen private key ro.
-- Chay mot lan. Neu bang da ton tai, dung lai de kiem tra/migrate;
-- CREATE TABLE khong co IF NOT EXISTS de tranh bo qua schema cu khong tuong thich.

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS seruchat
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE seruchat;

-- 1. Tai khoan. ID do crypto.randomUUID() cua Node.js tao.
-- Username KHONG unique: code hien tai chi quy dinh email la duy nhat.
CREATE TABLE users (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_username (username),
    CONSTRAINT chk_users_username CHECK (CHAR_LENGTH(TRIM(username)) > 0),
    CONSTRAINT chk_users_email CHECK (CHAR_LENGTH(TRIM(email)) > 0),
    CONSTRAINT chk_users_password_hash CHECK (CHAR_LENGTH(password_hash) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Mot bo public key + ban sao private key DA MA HOA cho moi user.
-- Noi dung key/ban ma giu nguyen Base64, phan biet hoa-thuong.
-- Salt/IV duoi day dung cho backup private key, khac nonce cua messages.
CREATE TABLE public_keys (
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    public_key TEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    signing_public_key TEXT CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    backup_version TINYINT UNSIGNED NOT NULL DEFAULT 1,
    algorithm VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    encrypted_private_key TEXT CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    encryption_salt VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    encryption_iv VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id),
    CONSTRAINT fk_public_keys_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT chk_public_keys_algorithm CHECK (algorithm = 'X25519'),
    CONSTRAINT chk_public_keys_public CHECK (CHAR_LENGTH(public_key) > 0),
    -- Java Receiver giu private key local, nen backup co the NULL.
    -- Neu co backup thi phai co du ca ba truong.
    CONSTRAINT chk_public_keys_backup CHECK (
        (encrypted_private_key IS NULL AND encryption_salt IS NULL AND encryption_iv IS NULL)
        OR (encrypted_private_key IS NOT NULL AND CHAR_LENGTH(encrypted_private_key) > 0
            AND encryption_salt IS NOT NULL AND encryption_iv IS NOT NULL)
    ),
    CONSTRAINT chk_public_keys_salt CHECK (CHAR_LENGTH(encryption_salt) = 24),
    CONSTRAINT chk_public_keys_iv CHECK (CHAR_LENGTH(encryption_iv) = 16)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Quan he ban be. Sap xep user1_id < user2_id nhu controller hien tai.
-- UNIQUE + CHECK ngan ca cap (A,B) trung va cap dao (B,A).
-- rejected duoc giu lai vi API hien tai dang su dung trang thai nay.
-- blocked_by la nguoi block; phai thuoc chinh cap user nay.
CREATE TABLE friendships (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user1_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user2_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    requested_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM('pending', 'accepted', 'rejected', 'blocked') NOT NULL DEFAULT 'pending',
    blocked_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    blocked_at TIMESTAMP(6) NULL DEFAULT NULL,
    blocked_previous_status ENUM('pending', 'accepted', 'rejected') NULL DEFAULT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_friendships_pair (user1_id, user2_id),
    KEY idx_friendships_user1_status (user1_id, status, created_at),
    KEY idx_friendships_user2_status (user2_id, status, created_at),
    KEY idx_friendships_requested_by (requested_by),
    KEY idx_friendships_blocked_by (blocked_by),
    -- Khong ON DELETE/ON UPDATE: MySQL han che cac hanh dong nay
    -- tren cot tham gia CHECK. Mac dinh tu choi xoa user con lien ket.
    CONSTRAINT fk_friendships_user1 FOREIGN KEY (user1_id) REFERENCES users (id),
    CONSTRAINT fk_friendships_user2 FOREIGN KEY (user2_id) REFERENCES users (id),
    CONSTRAINT fk_friendships_requester FOREIGN KEY (requested_by) REFERENCES users (id),
    CONSTRAINT fk_friendships_blocker FOREIGN KEY (blocked_by) REFERENCES users (id),
    CONSTRAINT chk_friendships_order CHECK (user1_id < user2_id),
    CONSTRAINT chk_friendships_requester CHECK (requested_by IN (user1_id, user2_id)),
    CONSTRAINT chk_friendships_status CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked')),
    CONSTRAINT chk_friendships_block CHECK (
        (status = 'blocked' AND blocked_by IS NOT NULL
            AND blocked_by IN (user1_id, user2_id) AND blocked_at IS NOT NULL)
        OR
        (status <> 'blocked' AND blocked_by IS NULL AND blocked_at IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Cuoc tro chuyen. Controller hien tai chi INSERT id,
-- vi vay khong them cot NOT NULL bat buoc ma controller chua gui.
-- Chong tao nhieu conversation dong thoi cho cung cap user can transaction
-- va khoa friendship trong controller, khong duoc bao dam boi bang nay.
CREATE TABLE conversations (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Thanh vien conversation. PRIMARY KEY ngan them cung user hai lan.
-- API phai dam bao chat 1-1 co dung hai thanh vien, chi giua ban accepted.
CREATE TABLE conversation_members (
    conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    joined_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (conversation_id, user_id),
    KEY idx_conversation_members_user (user_id, conversation_id),
    CONSTRAINT fk_members_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id),
    CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Tin nhan: chi luu ciphertext Base64, KHONG luu plaintext/AES key.
-- nonce = IV 12 byte cua AES-GCM -> Base64 16 ky tu.
-- Tag 128 bit da nam trong ciphertext, khong tach hay thay doi tag.
-- self_* la ban ma hoa thu hai cho nguoi gui doc lai lich su.
CREATE TABLE messages (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sender_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    protocol_version TINYINT UNSIGNED NOT NULL DEFAULT 1,
    recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    signature VARCHAR(88) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    sender_signing_key TEXT CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    ciphertext MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    nonce VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sender_public_key TEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    self_ciphertext MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    self_nonce VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    self_public_key TEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_messages_conversation_time (conversation_id, created_at, id),
    KEY idx_messages_sender_member (conversation_id, sender_id),
    CONSTRAINT fk_messages_sender_member FOREIGN KEY (conversation_id, sender_id)
        REFERENCES conversation_members (conversation_id, user_id),
    CONSTRAINT chk_messages_nonce CHECK (CHAR_LENGTH(nonce) = 16),
    CONSTRAINT chk_messages_self_nonce CHECK (CHAR_LENGTH(self_nonce) = 16),
    CONSTRAINT chk_messages_ciphertext CHECK (CHAR_LENGTH(ciphertext) >= 24),
    CONSTRAINT chk_messages_self_ciphertext CHECK (CHAR_LENGTH(self_ciphertext) >= 24),
    CONSTRAINT chk_messages_sender_key CHECK (CHAR_LENGTH(sender_public_key) > 0),
    CONSTRAINT chk_messages_self_key CHECK (CHAR_LENGTH(self_public_key) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Sessions: dung ten cot cua express-mysql-session.
-- expires: Unix timestamp tinh bang GIAY. data la JSON session,
-- KHONG dua password, private key ro hoac AES key vao session.
CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    expires INT UNSIGNED NOT NULL,
    data MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
    PRIMARY KEY (session_id),
    KEY idx_sessions_expires (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Kiem tra sau khi tao: ket qua phai gom 7 bang.
SHOW TABLES;
