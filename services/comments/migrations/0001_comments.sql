PRAGMA foreign_keys = ON;

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post TEXT NOT NULL,
  parent_id TEXT REFERENCES comments(id),
  reply_to TEXT REFERENCES comments(id),
  nickname TEXT NOT NULL,
  body TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  anchor TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader', 'ai')),
  ai_status TEXT NOT NULL DEFAULT 'none',
  created_at INTEGER NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX comments_threads ON comments(post, parent_id, visible, created_at DESC, id DESC);
CREATE INDEX comments_replies ON comments(parent_id, visible, created_at);

CREATE TABLE jobs (
  comment_id TEXT PRIMARY KEY REFERENCES comments(id),
  status TEXT NOT NULL DEFAULT 'queued',
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX jobs_pending ON jobs(status, available_at, created_at);
CREATE TABLE quotas (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
