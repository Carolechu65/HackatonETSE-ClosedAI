CREATE TABLE agent_sessions(id TEXT PRIMARY KEY,owner_uid TEXT NOT NULL REFERENCES users(id),group_id TEXT NOT NULL REFERENCES groups(id),messages TEXT NOT NULL,turns INTEGER NOT NULL DEFAULT 0 CHECK(turns>=0),expires_at INTEGER NOT NULL);
CREATE INDEX agent_session_owner ON agent_sessions(owner_uid,group_id,expires_at);
