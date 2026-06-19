#!/usr/bin/env bash
# Restore a noter mongodump archive produced by backup.sh.
#
#   USAGE (from the Pi):
#     docker exec -it noter-mongo-backup /usr/local/bin/restore.sh /backups/noter-<ts>.archive.gz
#
# DESTRUCTIVE: --drop replaces each restored collection. Take a fresh dump first if unsure.
# To verify a backup WITHOUT touching prod, restore into a throwaway DB:
#     MONGO_URI=mongodb://mongodb:27017/noter_restore_test /usr/local/bin/restore.sh <archive>
# then check counts, then drop the test DB. (Test your restores — see Doc/ops/disaster-recovery.md.)
set -euo pipefail

ARCHIVE="${1:?usage: restore.sh <archive.gz> (e.g. /backups/noter-2026-06-19_03-00-00.archive.gz)}"
MONGO_URI="${MONGO_URI:-mongodb://mongodb:27017/noter}"

echo "Restoring ${ARCHIVE} -> ${MONGO_URI} (with --drop)"
mongorestore --uri="${MONGO_URI}" --gzip --archive="${ARCHIVE}" --drop
echo "Restore complete."
