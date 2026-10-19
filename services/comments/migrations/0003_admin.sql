ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'reader' CHECK(role IN ('reader', 'admin'));
ALTER TABLE users ADD COLUMN activated INTEGER NOT NULL DEFAULT 1 CHECK(activated IN (0, 1));
CREATE TABLE admin_setup (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE moderation_actions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL CHECK(scope IN ('entry', 'thread', 'post')),
  target_id TEXT,
  post TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  restored_at INTEGER,
  restored_by TEXT REFERENCES users(id)
);
ALTER TABLE comments ADD COLUMN deleted_at INTEGER;
ALTER TABLE comments ADD COLUMN deleted_group TEXT REFERENCES moderation_actions(id);
CREATE INDEX comments_trash ON comments(visible, deleted_at DESC, id DESC);
CREATE INDEX comments_deleted_group ON comments(deleted_group);
