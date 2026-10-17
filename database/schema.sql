CREATE DATABASE IF NOT EXISTS aetheris_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE aetheris_db;

CREATE TABLE IF NOT EXISTS users (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	username VARCHAR(30) NOT NULL,
	email VARCHAR(254) NOT NULL,
	password_hash VARCHAR(255) NOT NULL,
	full_name VARCHAR(120) NOT NULL,
	avatar VARCHAR(512) NULL,
	bio VARCHAR(500) NULL,
	is_online BOOLEAN NOT NULL DEFAULT FALSE,
	last_seen DATETIME(6) NULL,
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	UNIQUE KEY uq_users_username (username),
	UNIQUE KEY uq_users_email (email),
	KEY idx_users_online (is_online, last_seen)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS conversations (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	KEY idx_conversations_updated (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS conversation_members (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	conversation_id BIGINT UNSIGNED NOT NULL,
	user_id BIGINT UNSIGNED NOT NULL,
	joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	UNIQUE KEY uq_conversation_member (conversation_id, user_id),
	KEY idx_members_user (user_id, conversation_id),
	CONSTRAINT fk_members_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
	CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS media (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	user_id BIGINT UNSIGNED NOT NULL,
	file_name VARCHAR(255) NOT NULL,
	original_name VARCHAR(255) NOT NULL,
	file_type ENUM('image','video','audio','file') NOT NULL,
	file_size BIGINT UNSIGNED NOT NULL,
	storage_path VARCHAR(1024) NOT NULL,
	mime_type VARCHAR(127) NOT NULL,
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	KEY idx_media_user_created (user_id, created_at),
	CONSTRAINT fk_media_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reels (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	title VARCHAR(255) NOT NULL,
	source_url VARCHAR(2048) NOT NULL,
	embed_url VARCHAR(2048) NULL,
	thumbnail_url VARCHAR(2048) NULL,
	platform VARCHAR(50) NOT NULL,
	created_by BIGINT UNSIGNED NOT NULL,
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	KEY idx_reels_created (created_at),
	KEY idx_reels_creator (created_by, created_at),
	CONSTRAINT fk_reels_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	conversation_id BIGINT UNSIGNED NOT NULL,
	sender_id BIGINT UNSIGNED NOT NULL,
	message_type ENUM('text','image','video','audio','file','reel') NOT NULL DEFAULT 'text',
	message_text TEXT NULL,
	media_id BIGINT UNSIGNED NULL,
	reel_id BIGINT UNSIGNED NULL,
	reply_to_message_id BIGINT UNSIGNED NULL,
	is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
	view_once BOOLEAN NOT NULL DEFAULT FALSE,
	viewed_at DATETIME(6) NULL,
	delivered_at DATETIME(6) NULL,
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	KEY idx_messages_conversation_created (conversation_id, id),
	KEY idx_messages_sender (sender_id, created_at),
	KEY idx_messages_media (media_id),
	KEY idx_messages_reel (reel_id),
	KEY idx_messages_reply (reply_to_message_id),
	KEY idx_messages_undelivered (sender_id, delivered_at),
	CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
	CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE RESTRICT,
	CONSTRAINT fk_messages_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL,
	CONSTRAINT fk_messages_reel FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE SET NULL,
	CONSTRAINT fk_messages_reply FOREIGN KEY (reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS message_reads (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	message_id BIGINT UNSIGNED NOT NULL,
	user_id BIGINT UNSIGNED NOT NULL,
	read_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	UNIQUE KEY uq_message_read (message_id, user_id),
	KEY idx_message_reads_user (user_id, read_at),
	CONSTRAINT fk_reads_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
	CONSTRAINT fk_reads_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_sessions (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	user_id BIGINT UNSIGNED NOT NULL,
	session_token_hash CHAR(64) NOT NULL,
	device_info VARCHAR(512) NULL,
	ip_address VARCHAR(45) NULL,
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	expires_at DATETIME(6) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE KEY uq_session_token_hash (session_token_hash),
	KEY idx_sessions_user_expiry (user_id, expires_at),
	CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	user_id BIGINT UNSIGNED NOT NULL,
	type VARCHAR(50) NOT NULL,
	title VARCHAR(255) NOT NULL,
	body VARCHAR(1000) NULL,
	related_message_id BIGINT UNSIGNED NULL,
	is_read BOOLEAN NOT NULL DEFAULT FALSE,
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	KEY idx_notifications_owner_unread (user_id, is_read, created_at),
	KEY idx_notifications_message (related_message_id),
	CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_notifications_message FOREIGN KEY (related_message_id) REFERENCES messages(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blocked_users (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	blocker_id BIGINT UNSIGNED NOT NULL,
	blocked_id BIGINT UNSIGNED NOT NULL,
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	UNIQUE KEY uq_block_pair (blocker_id, blocked_id),
	KEY idx_blocked_user (blocked_id, blocker_id),
	CONSTRAINT chk_block_not_self CHECK (blocker_id <> blocked_id),
	CONSTRAINT fk_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
	CONSTRAINT fk_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
