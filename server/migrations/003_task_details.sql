ALTER TABLE tasks ADD COLUMN description TEXT CHECK (description IS NULL OR length(description) <= 2000);
ALTER TABLE tasks ADD COLUMN category TEXT CHECK (category IS NULL OR length(category) <= 80);
PRAGMA user_version = 3;
