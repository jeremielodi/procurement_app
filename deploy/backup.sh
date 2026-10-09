#!/usr/bin/env bash
# Sauvegarde de procureApp (serveur Docker) : base PostgreSQL + fichiers MinIO (+ ancien dossier d'uploads).
#
# Usage :   deploy/backup.sh
# Cron :    0 2 * * * /opt/procureapp/deploy/backup.sh >> /var/log/procureapp-backup.log 2>&1
#
# Variables (facultatives, dans l'environnement ou deploy/backup.env) :
#   BACKUP_DIR             dossier des sauvegardes                     (défaut : /var/backups/procureapp)
#   BACKUP_RETENTION_DAYS  nombre de jours conservés                   (défaut : 14)
#   BACKUP_REMOTE          copie hors serveur après la sauvegarde :
#                            « user@hote:/chemin » → rsync ; « remote:chemin » d'rclone → rclone copy
#   PG_CONTAINER / MINIO_VOLUME / UPLOADS_VOLUME                     (défaut : wwf_postgres / wwf_minio_data / wwf_uploads_data)
#
# Produit, dans BACKUP_DIR/AAAA-MM-JJ_HHMMSS/ :
#   procureapp.dump      pg_dump au format custom (vérifié par pg_restore --list)
#   minio.tar.gz         contenu du volume MinIO (bucket privé versionné : toutes les versions des fichiers)
#   uploads.tar.gz       ancien stockage disque (s'il existe)
#   SHA256SUMS           empreintes des fichiers
# Aucun mot de passe n'est lu ni écrit par ce script : pg_dump utilise les variables du conteneur PostgreSQL.
# backend/.env (secrets) n'est PAS sauvegardé ici : en garder une copie à part, en lieu sûr.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/backup.env" ] && . "$SCRIPT_DIR/backup.env"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/procureapp}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
PG_CONTAINER="${PG_CONTAINER:-wwf_postgres}"
MINIO_VOLUME="${MINIO_VOLUME:-wwf_minio_data}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-wwf_uploads_data}"
HELPER_IMAGE="${HELPER_IMAGE:-alpine:3}"

STAMP="$(date +%F_%H%M%S)"
TARGET="$BACKUP_DIR/$STAMP"
log() { echo "[$(date '+%F %T')] $*"; }
fail() { log "ÉCHEC : $*"; rm -rf "$TARGET.partial"; exit 1; }

command -v docker >/dev/null || fail "docker introuvable"
docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || fail "conteneur $PG_CONTAINER introuvable"
mkdir -p "$TARGET.partial"
chmod 700 "$BACKUP_DIR" "$TARGET.partial"
log "Sauvegarde → $TARGET"

# 1. Base de données (cohérente : pg_dump travaille sur un instantané transactionnel)
docker exec "$PG_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TARGET.partial/procureapp.dump" \
  || fail "pg_dump"
docker exec -i "$PG_CONTAINER" pg_restore --list < "$TARGET.partial/procureapp.dump" > /dev/null \
  || fail "dump illisible (pg_restore --list)"
log "  base : $(du -h "$TARGET.partial/procureapp.dump" | cut -f1)"

# 2. Fichiers MinIO (volume en lecture seule ; les objets sont immuables, le bucket est versionné)
if docker volume inspect "$MINIO_VOLUME" >/dev/null 2>&1; then
  docker run --rm -v "$MINIO_VOLUME":/data:ro -v "$TARGET.partial":/backup "$HELPER_IMAGE" \
    tar czf /backup/minio.tar.gz -C /data . || fail "archive MinIO"
  log "  fichiers MinIO : $(du -h "$TARGET.partial/minio.tar.gz" | cut -f1)"
else
  log "  volume $MINIO_VOLUME absent : fichiers MinIO ignorés"
fi

# 3. Ancien stockage disque (avant la migration vers MinIO)
if docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  docker run --rm -v "$UPLOADS_VOLUME":/data:ro -v "$TARGET.partial":/backup "$HELPER_IMAGE" \
    tar czf /backup/uploads.tar.gz -C /data . || fail "archive uploads"
fi

# 4. Vérification des archives et empreintes
for f in "$TARGET.partial"/*.tar.gz; do
  [ -e "$f" ] || continue
  gzip -t "$f" || fail "archive corrompue : $(basename "$f")"
done
(cd "$TARGET.partial" && sha256sum -- * > SHA256SUMS)
mv "$TARGET.partial" "$TARGET"
log "  terminé ($(du -sh "$TARGET" | cut -f1))"

# 5. Rétention : suppression des sauvegardes plus anciennes que BACKUP_RETENTION_DAYS jours
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$BACKUP_RETENTION_DAYS" -print -exec rm -rf {} + \
  | sed 's/^/  supprimée (rétention) : /'
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.partial' -mmin +720 -exec rm -rf {} +

# 6. Copie hors serveur (une sauvegarde sur le même disque ne protège pas d'une panne du serveur)
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if [[ "$BACKUP_REMOTE" == *@*:* ]]; then
    rsync -a "$TARGET" "$BACKUP_REMOTE"/ || fail "copie rsync vers $BACKUP_REMOTE"
  else
    command -v rclone >/dev/null || fail "rclone introuvable pour BACKUP_REMOTE=$BACKUP_REMOTE"
    rclone copy "$TARGET" "$BACKUP_REMOTE/$STAMP" || fail "copie rclone vers $BACKUP_REMOTE"
  fi
  log "  copiée vers $BACKUP_REMOTE"
fi
log "OK"
