#!/usr/bin/env bash
# Daily SQLite backup — run via cron: 0 3 * * * /opt/filetransfer/deploy/backup.sh
set -euo pipefail

DB_PATH="${DB_PATH:-/opt/filetransfer/db/filetransfer.db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/filetransfer/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_DIR/filetransfer_$STAMP.db"

sqlite3 "$DB_PATH" ".backup '$DEST'"
gzip "$DEST"

# Prune old backups
find "$BACKUP_DIR" -name "filetransfer_*.db.gz" -mtime +"$KEEP_DAYS" -delete

echo "[backup] $(date) → $DEST.gz"
