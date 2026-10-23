# Receipt OCR and shared expenses

The web and Android expense forms accept camera photos, JPEG/PNG files and PDFs. Uploads are
resized in the browser, persisted privately in SQLite and read asynchronously.
The user reviews merchant, purchase date, amount in EUR, category and notes before
creating an expense. Purchase date and payment deadline are separate. Shares can
be equal, exact cent amounts or percentages. A personal expense selects only the
payer. Saved expenses can be edited by the payer until another positive share is
settled; revisions and operation receipts retain the prior state.

The Android release includes native camera/document pickers. They request camera
permission only when taking a photo and remove only their own temporary cache
copy after upload. Original documents and user photos are not deleted.

## Deployment

Apply migration 008 after the concurrent task-assignment migration 007. The existing
startup migration runner and daily SQLite backup include receipt originals, parsed
results and expense revision history. Never alter an applied migration.

Provision the separate OCR worker following [the adapter runbook](ocr/README.md).
The Node service reads its loopback URL and private token from `/etc/alarmat/ocr.env`
via the prepared systemd drop-in. No browser receives provider credentials. The
worker uses a dedicated image derived from the pinned ingestion image, with its
own data directory. Local Tesseract OCR is the default and requires no provider
credential. It never accesses Trace-it data or borrows another application's keys.

Run `npm run check`, export web with `--clear` (Metro's context cache otherwise can
retain routes from another checkout), and validate the full browser flow against
an isolated API. Preserve current production static extras and old asset chunks
when overlaying the new export. Acquire `/opt/alarmat/.publish.lock`, back up SQLite,
verify no newer release has appeared, switch `current` atomically, and restart only
`alarmat.service`. Validate health/schema, authenticated receipt flow, original
expense balances, and unrelated sites.

A code rollback can point `current` at the prior release; migration 008 is additive
and existing expense responses remain compatible. Keep new receipt rows in the
database. Never restore a predeployment database over subsequent user activity.

## Boundaries

Uploads require active group membership and have an 8 MB decoded limit, a global
queue limit and per-user rate limit. Pending receipts belong to their uploader;
attachments become readable to active group members once linked to a shared expense.
Repeated uploads by the same user/group reuse the receipt, and the database prevents
linking that receipt to multiple expenses. Polling and reopening do not rerun OCR.
The original is preserved; proposals retain uncertainty and require user confirmation.
The form assumes EUR only after user review, and asks for manual EUR input when a
foreign currency is explicitly detected. It does not perform currency conversion.

The standalone OCR cache can be rebuilt from receipt originals; it is separate from
the SQLite backup. If the local reader cannot read a ticket, users can retry with a clearer photo or
enter fields manually. All extracted values remain unverified until reviewed.
