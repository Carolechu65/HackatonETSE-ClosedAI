ALTER TABLE tasks ADD COLUMN assignment_decision TEXT NOT NULL DEFAULT 'not_required' CHECK (assignment_decision IN ('pending','accepted','rejected','not_required'));
PRAGMA user_version = 7;
