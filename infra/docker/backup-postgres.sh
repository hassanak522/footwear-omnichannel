#!/usr/bin/env bash
set -euo pipefail
: "${POSTGRES_DB:?Set POSTGRES_DB}"
: "${POSTGRES_USER:?Set POSTGRES_USER}"
: "${BACKUP_DIR:?Set BACKUP_DIR to a secure off-host mounted directory}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/royal-step-$timestamp.dump"
# Run in the postgres container with POSTGRES_PASSWORD already provided by the deployment.
pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --file="$target"
chmod 600 "$target"
pg_restore --list "$target" >/dev/null
printf 'Created and verified archive format: %s\\n' "$target"
# Copy backups off-host, encrypt them and test actual restore on staging.
