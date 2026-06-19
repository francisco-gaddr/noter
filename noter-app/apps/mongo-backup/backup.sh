#!/usr/bin/env bash
# Periodic mongodump of the noter DB with retention. Runs in a sidecar that REUSES the mongo image
# (so mongodump exactly matches the server version). Gzipped archives land in /backups — a named
# Docker volume, so they survive the container being recreated. Config via env (see docker-compose).
#
# Restore: see restore.sh + Doc/ops/disaster-recovery.md. A backup that has never been restored is
# not a backup — test the restore.
set -u

MONGO_URI="${MONGO_URI:-mongodb://mongodb:27017/noter}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"   # default daily
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"   # keep a week
DEST="/backups"

mkdir -p "$DEST"
echo "[mongo-backup] started: interval=${INTERVAL}s retention=${RETENTION_DAYS}d dest=${DEST}"

while true; do
  ts="$(date -u +%Y-%m-%d_%H-%M-%S)"
  archive="${DEST}/noter-${ts}.archive.gz"
  echo "[mongo-backup] dumping -> ${archive}"
  if mongodump --uri="${MONGO_URI}" --gzip --archive="${archive}"; then
    echo "[mongo-backup] ok ($(du -h "${archive}" 2>/dev/null | cut -f1))"
  else
    echo "[mongo-backup] DUMP FAILED for ${ts}" >&2
    rm -f "${archive}"
  fi
  # Retention: remove archives older than RETENTION_DAYS.
  find "${DEST}" -name 'noter-*.archive.gz' -type f -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
  sleep "${INTERVAL}"
done
