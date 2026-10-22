-- Extend the canonical P3 schema. Existing deployed migration 001 is unchanged.
ALTER TABLE tasks ADD COLUMN created_by_uid TEXT REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN completed_by_uid TEXT REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN completed_at_epoch_ms INTEGER;
UPDATE tasks SET created_by_uid=(SELECT created_by FROM groups WHERE groups.id=tasks.group_id);
ALTER TABLE agent_sessions ADD COLUMN turns INTEGER NOT NULL DEFAULT 0 CHECK(turns>=0);
UPDATE alarm_recipients SET received_version=1 WHERE received_version=0;
UPDATE alarm_recipients SET consent_scope=NULL,chosen_time_zone=NULL,chosen_local_date=NULL,chosen_local_time=NULL,chosen_effective_at_epoch_ms=NULL WHERE decision<>'ACCEPTED';
CREATE TABLE alarm_projection_events(
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id TEXT NOT NULL REFERENCES users(id),
 group_id TEXT NOT NULL REFERENCES groups(id),
 request_id TEXT REFERENCES alarm_requests(id),
 kind TEXT NOT NULL CHECK(kind IN ('upsert','revoke')),
 created_at_epoch_ms INTEGER NOT NULL
);
CREATE INDEX alarm_projection_feed ON alarm_projection_events(user_id,sequence);
CREATE TABLE alarm_projection_cursors(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),sequence INTEGER NOT NULL,expires_at_epoch_ms INTEGER NOT NULL);
INSERT INTO alarm_projection_events(user_id,group_id,request_id,kind,created_at_epoch_ms)
 SELECT r.uid,a.group_id,a.id,'upsert',a.updated_at_epoch_ms FROM alarm_recipients r JOIN alarm_requests a ON a.id=r.request_id JOIN memberships m ON m.user_id=r.uid AND m.group_id=a.group_id WHERE m.status='ACTIVE';
INSERT INTO alarm_projection_events(user_id,group_id,request_id,kind,created_at_epoch_ms)
 SELECT user_id,group_id,NULL,'revoke',COALESCE(removed_at_epoch_ms,joined_at_epoch_ms) FROM memberships WHERE status='REMOVED';
CREATE TRIGGER project_alarm_request AFTER INSERT ON change_events WHEN NEW.entity_type='alarm_request' BEGIN
 INSERT INTO alarm_projection_events(user_id,group_id,request_id,kind,created_at_epoch_ms)
 SELECT NEW.audience_uid,a.group_id,a.id,'upsert',NEW.created_at_epoch_ms FROM alarm_requests a JOIN alarm_recipients r ON r.request_id=a.id WHERE a.id=NEW.entity_id AND r.uid=NEW.audience_uid;
END;
CREATE TRIGGER project_alarm_schedule AFTER INSERT ON change_events WHEN NEW.entity_type IN ('schedule','recipient') BEGIN
 INSERT INTO alarm_projection_events(user_id,group_id,request_id,kind,created_at_epoch_ms)
 SELECT NEW.audience_uid,a.group_id,a.id,'upsert',NEW.created_at_epoch_ms FROM alarm_requests a JOIN alarm_recipients r ON r.request_id=a.id WHERE a.id=json_extract(NEW.payload_json,'$.requestId') AND r.uid=NEW.audience_uid;
END;
CREATE TRIGGER project_alarm_device AFTER INSERT ON change_events WHEN NEW.entity_type='device' BEGIN
 INSERT INTO alarm_projection_events(user_id,group_id,request_id,kind,created_at_epoch_ms)
 SELECT NEW.audience_uid,a.group_id,a.id,'upsert',NEW.created_at_epoch_ms FROM alarm_requests a JOIN alarm_recipients r ON r.request_id=a.id JOIN memberships m ON m.group_id=a.group_id AND m.user_id=r.uid WHERE r.uid=NEW.audience_uid AND m.status='ACTIVE';
END;
CREATE TRIGGER project_membership_revoke AFTER INSERT ON change_events WHEN NEW.entity_type='membership' AND NEW.kind='REVOKED' BEGIN
 INSERT INTO alarm_projection_events(user_id,group_id,request_id,kind,created_at_epoch_ms) VALUES (NEW.audience_uid,NEW.group_id,NULL,'revoke',NEW.created_at_epoch_ms);
END;
CREATE TRIGGER project_membership_join AFTER INSERT ON change_events WHEN NEW.entity_type='membership' AND NEW.kind='UPSERT' AND json_extract(NEW.payload_json,'$.uid')=NEW.audience_uid BEGIN
 INSERT INTO alarm_projection_events(user_id,group_id,request_id,kind,created_at_epoch_ms)
 SELECT NEW.audience_uid,a.group_id,a.id,'upsert',NEW.created_at_epoch_ms FROM alarm_requests a JOIN alarm_recipients r ON r.request_id=a.id WHERE r.uid=NEW.audience_uid AND a.group_id=NEW.group_id;
END;
CREATE TRIGGER tasks_created_by_default AFTER INSERT ON tasks WHEN NEW.created_by_uid IS NULL BEGIN
 UPDATE tasks SET created_by_uid=(SELECT created_by FROM groups WHERE id=NEW.group_id) WHERE id=NEW.id;
END;
PRAGMA user_version=2;
