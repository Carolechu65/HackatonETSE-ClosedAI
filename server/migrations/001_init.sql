-- alarmaT - esquema inicial v1 (SQLite del VPS).
-- Instantes en milisegundos UTC enteros. Secretos: solo hashes.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  primary_device_id TEXT,
  device_epoch INTEGER NOT NULL DEFAULT 0 CHECK (device_epoch >= 0),
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at_epoch_ms INTEGER NOT NULL,
  expires_at_epoch_ms INTEGER NOT NULL,
  revoked_at_epoch_ms INTEGER,
  last_used_at_epoch_ms INTEGER NOT NULL,
  CHECK (expires_at_epoch_ms > created_at_epoch_ms)
);
CREATE INDEX sessions_by_user ON sessions(user_id, expires_at_epoch_ms);
CREATE INDEX sessions_by_expiry ON sessions(expires_at_epoch_ms);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  time_zone TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);

CREATE TABLE memberships (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'MEMBER')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REMOVED')),
  joined_at_epoch_ms INTEGER NOT NULL,
  removed_at_epoch_ms INTEGER,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX memberships_active_by_user ON memberships(user_id, status, group_id);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'MEMBER')),
  created_at_epoch_ms INTEGER NOT NULL,
  expires_at_epoch_ms INTEGER NOT NULL,
  consumed_at_epoch_ms INTEGER,
  consumed_by TEXT REFERENCES users(id),
  CHECK (expires_at_epoch_ms > created_at_epoch_ms),
  CHECK ((consumed_at_epoch_ms IS NULL) = (consumed_by IS NULL))
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web', 'unknown')),
  push_token TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL,
  last_seen_at_epoch_ms INTEGER NOT NULL
);
CREATE INDEX devices_by_user ON devices(user_id, status);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  assigned_to TEXT REFERENCES users(id),
  activate_at_epoch_ms INTEGER,
  due_at_epoch_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);
CREATE INDEX tasks_by_group ON tasks(group_id, status, due_at_epoch_ms);

CREATE TABLE alarm_requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  creator_uid TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  request_version INTEGER NOT NULL DEFAULT 1 CHECK (request_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'WITHDRAWN', 'EXPIRED')),
  time_zone TEXT NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  effective_at_epoch_ms INTEGER NOT NULL CHECK (effective_at_epoch_ms >= 0),
  mode TEXT NOT NULL CHECK (mode IN ('ALARM', 'NOTIFICATION')),
  recurrence_kind TEXT CHECK (recurrence_kind IS NULL OR recurrence_kind = 'WEEKLY'),
  recurrence_weekday INTEGER CHECK (recurrence_weekday IS NULL OR recurrence_weekday BETWEEN 1 AND 7),
  recurrence_local_time TEXT,
  recurrence_until_epoch_ms INTEGER,
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL,
  withdrawn_at_epoch_ms INTEGER,
  expired_at_epoch_ms INTEGER,
  CHECK ((recurrence_kind IS NULL AND recurrence_weekday IS NULL AND recurrence_local_time IS NULL)
      OR (recurrence_kind = 'WEEKLY' AND recurrence_weekday IS NOT NULL AND recurrence_local_time IS NOT NULL))
);
CREATE INDEX alarm_requests_by_group ON alarm_requests(group_id, updated_at_epoch_ms);
CREATE INDEX alarm_requests_by_creator ON alarm_requests(creator_uid, updated_at_epoch_ms);

CREATE TABLE alarm_recipients (
  request_id TEXT NOT NULL REFERENCES alarm_requests(id) ON DELETE CASCADE,
  uid TEXT NOT NULL REFERENCES users(id),
  received_version INTEGER NOT NULL DEFAULT 0 CHECK (received_version >= 0),
  reception TEXT NOT NULL CHECK (reception IN ('NOT_ACKNOWLEDGED', 'RECEIVED')),
  decision TEXT NOT NULL CHECK (decision IN ('PENDING', 'ACCEPTED', 'REJECTED', 'DISABLED', 'NEEDS_REVIEW')),
  decision_revision INTEGER NOT NULL DEFAULT 1 CHECK (decision_revision >= 1),
  accepted_request_version INTEGER,
  chosen_time_zone TEXT,
  chosen_local_date TEXT,
  chosen_local_time TEXT,
  chosen_effective_at_epoch_ms INTEGER,
  consent_scope TEXT CHECK (consent_scope IS NULL OR consent_scope IN ('THIS_OCCURRENCE', 'SERIES')),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  updated_at_epoch_ms INTEGER NOT NULL,
  PRIMARY KEY (request_id, uid),
  CHECK ((accepted_request_version IS NULL) = (decision <> 'ACCEPTED')),
  CHECK ((chosen_time_zone IS NULL AND chosen_local_date IS NULL AND chosen_local_time IS NULL AND chosen_effective_at_epoch_ms IS NULL)
      OR (chosen_time_zone IS NOT NULL AND chosen_local_date IS NOT NULL AND chosen_local_time IS NOT NULL AND chosen_effective_at_epoch_ms IS NOT NULL))
);
CREATE INDEX alarm_recipients_inbox ON alarm_recipients(uid, updated_at_epoch_ms);

CREATE TABLE device_schedules (
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  occurrence_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  device_epoch INTEGER NOT NULL CHECK (device_epoch >= 1),
  request_version INTEGER NOT NULL CHECK (request_version >= 1),
  decision_revision INTEGER NOT NULL CHECK (decision_revision >= 1),
  mode TEXT NOT NULL CHECK (mode IN ('ALARM', 'NOTIFICATION')),
  mechanism TEXT NOT NULL CHECK (mechanism IN ('ALARM_RUNTIME', 'EXPO_NOTIFICATIONS')),
  status TEXT NOT NULL CHECK (status IN ('NOT_SCHEDULED', 'PENDING_PERMISSION', 'SCHEDULING', 'SCHEDULED', 'CANCEL_PENDING', 'CANCELLED', 'FIRED', 'FAILED', 'EXPIRED')),
  effective_at_epoch_ms INTEGER NOT NULL CHECK (effective_at_epoch_ms >= 0),
  reported_at_epoch_ms INTEGER NOT NULL,
  status_updated_at_epoch_ms INTEGER NOT NULL,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  PRIMARY KEY (request_id, uid, occurrence_id, device_id, device_epoch),
  FOREIGN KEY (request_id, uid) REFERENCES alarm_recipients(request_id, uid) ON DELETE CASCADE,
  CHECK ((mode = 'ALARM' AND mechanism = 'ALARM_RUNTIME') OR (mode = 'NOTIFICATION' AND mechanism = 'EXPO_NOTIFICATIONS'))
);
CREATE INDEX device_schedules_by_recipient ON device_schedules(uid, effective_at_epoch_ms);

CREATE TABLE operations (
  actor_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  operation_name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at_epoch_ms INTEGER NOT NULL,
  PRIMARY KEY (actor_uid, operation_id)
);

CREATE TABLE change_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  audience_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('alarm_request', 'recipient', 'schedule', 'membership', 'group', 'device')),
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('UPSERT', 'TOMBSTONE', 'REVOKED')),
  payload_json TEXT,
  created_at_epoch_ms INTEGER NOT NULL
);
CREATE INDEX change_events_feed ON change_events(audience_uid, sequence);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  audience_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT,
  kind TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at_epoch_ms INTEGER NOT NULL,
  lease_until_epoch_ms INTEGER,
  delivered_at_epoch_ms INTEGER,
  last_error TEXT,
  created_at_epoch_ms INTEGER NOT NULL
);
CREATE INDEX outbox_pending ON outbox_events(delivered_at_epoch_ms, next_attempt_at_epoch_ms);

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'EXPIRED')),
  collected_json TEXT NOT NULL DEFAULT '{}',
  expires_at_epoch_ms INTEGER NOT NULL,
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);
CREATE INDEX agent_sessions_by_owner ON agent_sessions(owner_uid, group_id, status);

PRAGMA user_version = 1;
