-- Optional civil deadline; existing expense amounts and settlements are preserved.
ALTER TABLE shared_expenses ADD COLUMN due_date TEXT
  CHECK(due_date IS NULL OR (length(due_date) = 10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'));
