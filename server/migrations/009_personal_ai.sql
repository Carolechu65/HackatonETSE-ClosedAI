CREATE TABLE ai_connections (
 owner_uid TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision TEXT NOT NULL,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 secret_ciphertext TEXT NOT NULL,
 key_last4 TEXT NOT NULL,
 verified_at_epoch_ms INTEGER NOT NULL
);
CREATE TABLE ai_connection_tests (
 token_hash TEXT PRIMARY KEY,
 owner_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL,
 previous_revision TEXT,
 verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
 expires_at_epoch_ms INTEGER NOT NULL
);
CREATE INDEX ai_connection_tests_owner ON ai_connection_tests(owner_uid);
