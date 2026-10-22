-- Additive ledger: existing household, task, alarm and calendar data is untouched.
CREATE TABLE shared_expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents) = 'integer' AND amount_cents BETWEEN 1 AND 100000000),
  paid_by_uid TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at_epoch_ms INTEGER NOT NULL
);
CREATE INDEX shared_expenses_group ON shared_expenses(group_id, created_at_epoch_ms DESC, id);
CREATE TABLE expense_participants (
  expense_id TEXT NOT NULL REFERENCES shared_expenses(id),
  uid TEXT NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL CHECK(typeof(share_cents) = 'integer' AND share_cents >= 0),
  settled_at_epoch_ms INTEGER,
  PRIMARY KEY(expense_id, uid)
);
PRAGMA user_version=5;
