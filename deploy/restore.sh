#!/usr/bin/env bash
# Restauration d'une sauvegarde produite par deploy/backup.sh — ÉCRASE les données actuelles.
#
# Usage :   deploy/restore.sh /var/backups/procureapp/2026-10-09_020000 [--db-only | --files-only] [--yes]
#
# Étapes : vérification des empreintes → arrêt de l'application → base (pg_restore --clean) →
#          fichiers MinIO (volume vidé puis rempli, MinIO arrêté pendant la copie) → redémarrage.
# À lancer depuis le dossier du projet (celui du docker-compose.yml) ou avec COMPOSE_DIR=/chemin.
# Après la restauration d'une sauvegarde plus ancienne que le code : appliquer les migrations de database/
# (idempotentes), comme pour une mise à jour.
set -euo pipefail

SRC="${1:-}"
shift || true
DB=1; FILES=1; YES=0
for arg in "$@"; do
  case "$arg" in
    --db-only) FILES=0 ;;
    --files-only) DB=0 ;;
    --yes) YES=1 ;;
    *) echo "Option inconnue : $arg"; exit 2 ;;
  esac
done
[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "Usage : $0 <dossier de sauvegarde> [--db-only|--files-only] [--yes]"; exit 2; }

COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PG_CONTAINER="${PG_CONTAINER:-wwf_postgres}"
MINIO_VOLUME="${MINIO_VOLUME:-wwf_minio_data}"
HELPER_IMAGE="${HELPER_IMAGE:-alpine:3}"
log() { echo "[$(date '+%F %T')] $*"; }
compose() { (cd "$COMPOSE_DIR" && docker compose "$@"); }

(cd "$SRC" && sha256sum -c --quiet SHA256SUMS) || { log "Empreintes invalides : sauvegarde incomplète ou modifiée"; exit 1; }
[ "$DB" = 0 ] || [ -f "$SRC/procureapp.dump" ] || { log "procureapp.dump absent"; exit 1; }
[ "$FILES" = 0 ] || [ -f "$SRC/minio.tar.gz" ] || { log "minio.tar.gz absent (utiliser --db-only)"; exit 1; }

if [ "$YES" != 1 ]; then
  echo "Les données actuelles ($([ "$DB" = 1 ] && echo 'base ')$([ "$FILES" = 1 ] && echo 'fichiers'))seront remplacées par $SRC."
  read -r -p "Taper RESTAURER pour continuer : " answer
  [ "$answer" = "RESTAURER" ] || { echo "Abandon."; exit 1; }
fi

log "Arrêt de l'application"
compose stop app

if [ "$DB" = 1 ]; then
  log "Restauration de la base"
  # Connexions restantes fermées, puis objets remplacés (--clean --if-exists) ; une seule transaction
  docker exec "$PG_CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '"'"'$POSTGRES_DB'"'"' AND pid <> pg_backend_pid();"' > /dev/null
  docker exec -i "$PG_CONTAINER" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction --exit-on-error' \
    < "$SRC/procureapp.dump"
fi

if [ "$FILES" = 1 ]; then
  log "Restauration des fichiers MinIO"
  compose stop minio
  docker run --rm -v "$MINIO_VOLUME":/data -v "$SRC":/backup:ro "$HELPER_IMAGE" \
    sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/minio.tar.gz -C /data && chown -R 65532:65532 /data'
  compose start minio
fi

log "Redémarrage de l'application"
compose start app
log "Restauration terminée — vérifier : docker compose logs -f app"
