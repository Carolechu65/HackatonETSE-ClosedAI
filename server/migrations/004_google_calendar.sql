CREATE TABLE calendar_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  generation TEXT NOT NULL,
  tokens TEXT,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  invalid INTEGER NOT NULL DEFAULT 0 CHECK (invalid IN (0,1)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE calendar_oauth (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  generation TEXT NOT NULL,
  verifier TEXT NOT NULL,
  browser_hash TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX calendar_oauth_expiry ON calendar_oauth(expires_at);
CREATE TABLE calendar_operations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (user_id, operation_id)
);
CREATE TABLE calendar_oauth_results (
  completion_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  generation TEXT NOT NULL,
  tokens TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
