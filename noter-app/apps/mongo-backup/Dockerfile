# Backup sidecar — reuses the same mongo image as the DB so mongodump/mongorestore match the
# server version exactly (no separate image to vet/keep in sync). Pin in lockstep with the mongodb
# service in docker-compose.yml.
FROM mongo:8.2
COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
