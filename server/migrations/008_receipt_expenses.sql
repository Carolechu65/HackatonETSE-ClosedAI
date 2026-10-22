CREATE TABLE expense_receipts (
 id TEXT PRIMARY KEY,
 group_id TEXT NOT NULL REFERENCES groups(id),
 actor_uid TEXT NOT NULL REFERENCES users(id),
 sha256 TEXT NOT NULL,
 filename TEXT NOT NULL,
 media_type TEXT NOT NULL,
 content BLOB NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','reading','ready','failed')),
 result_json TEXT,
 created_at_epoch_ms INTEGER NOT NULL,
 UNIQUE(group_id, actor_uid, sha256)
);
CREATE INDEX expense_receipts_queue ON expense_receipts(status,created_at_epoch_ms);
ALTER TABLE shared_expenses ADD COLUMN receipt_id TEXT REFERENCES expense_receipts(id);
ALTER TABLE shared_expenses ADD COLUMN purchased_on TEXT;
ALTER TABLE shared_expenses ADD COLUMN merchant TEXT;
ALTER TABLE shared_expenses ADD COLUMN category TEXT;
ALTER TABLE shared_expenses ADD COLUMN notes TEXT;
ALTER TABLE shared_expenses ADD COLUMN split_json TEXT;
CREATE UNIQUE INDEX expense_receipt_once ON shared_expenses(receipt_id) WHERE receipt_id IS NOT NULL;
CREATE TABLE expense_revisions (
 expense_id TEXT NOT NULL REFERENCES shared_expenses(id),
 version INTEGER NOT NULL,
 actor_uid TEXT NOT NULL REFERENCES users(id),
 previous_json TEXT NOT NULL,
 changed_at_epoch_ms INTEGER NOT NULL,
 PRIMARY KEY(expense_id,version)
);
