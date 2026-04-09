#!/bin/bash
# PlayBound MongoDB Backup Script
# Usage: ./scripts/backup.sh
# Cron example (daily at 3am): 0 3 * * * /path/to/playbound/scripts/backup.sh
# Optional in .env: BACKUP_DIR, RETENTION_DAYS (default 7). Lower RETENTION_DAYS if Atlas keeps snapshots.

set -e

# Load env vars
if [ -f "$(dirname "$0")/../.env" ]; then
    export $(grep -v '^#' "$(dirname "$0")/../.env" | xargs)
fi

BACKUP_DIR="${BACKUP_DIR:-/backups/playbound}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="$BACKUP_DIR/$TIMESTAMP"

echo "[Backup] Starting MongoDB backup to $BACKUP_PATH..."

mkdir -p "$BACKUP_PATH"

mongodump --uri="$MONGO_URI" --out="$BACKUP_PATH"

if [ $? -eq 0 ]; then
    echo "[Backup] Backup completed successfully."
else
    echo "[Backup] ERROR: Backup failed!"
    exit 1
fi

# Prune old backups
echo "[Backup] Pruning backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +

echo "[Backup] Done."
