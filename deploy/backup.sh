#!/usr/bin/env bash
set -euo pipefail
backup_dir=/var/lib/alarmat/backups
mkdir -p "$backup_dir"
backup_file="$backup_dir/alarmat-$(date -u +%Y%m%dT%H%M%SZ).db"
/opt/alarmat/runtime/node scripts/backup.mjs /var/lib/alarmat/alarmat.db "$backup_file"
# Retain the newest fourteen successful copies owned by this application.
python3 - "$backup_dir" <<'PY'
from pathlib import Path
import sys
copies = sorted(Path(sys.argv[1]).glob('alarmat-*.db'), reverse=True)
for old in copies[14:]:
    old.unlink()
PY
