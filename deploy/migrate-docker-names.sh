#!/usr/bin/env bash
# Passage des anciens noms Docker (préfixe « wwf_ ») aux noms procureApp (« procureapp_ »).
# À lancer UNE fois sur un serveur installé avant le renommage, AVANT « docker compose up -d ».
#
# Usage :   deploy/migrate-docker-names.sh [--yes]
#
# 1. arrête et supprime les anciens conteneurs (wwf_app, wwf_minio, wwf_postgres) — les données sont dans les volumes ;
# 2. copie chaque ancien volume dans le nouveau (wwf_postgres_data → procureapp_postgres_data…), sans toucher à l'ancien ;
# 3. supprime l'ancien réseau.
# Les anciens volumes sont conservés : les supprimer à la main (docker volume rm …) une fois procureApp vérifié.
# backend/.env n'est pas modifié : garder DB_NAME / POSTGRES_DB tels quels (la base copiée garde son nom).
set -euo pipefail

OLD_PREFIX="${OLD_PREFIX:-wwf}"
NEW_PREFIX="${NEW_PREFIX:-procureapp}"
CONTAINERS="app minio postgres"
VOLUMES="postgres_data uploads_data minio_data logs_data"

if [ "${1:-}" != "--yes" ]; then
  echo "Les conteneurs ${OLD_PREFIX}_* vont être arrêtés et leurs volumes copiés vers ${NEW_PREFIX}_*."
  read -r -p "Continuer ? [o/N] " answer
  case "$answer" in o|O|y|Y) ;; *) echo "Abandon."; exit 1 ;; esac
fi

for c in $CONTAINERS; do
  if docker container inspect "${OLD_PREFIX}_$c" >/dev/null 2>&1; then
    echo "→ arrêt du conteneur ${OLD_PREFIX}_$c"
    docker rm -f "${OLD_PREFIX}_$c" >/dev/null
  fi
done

for v in $VOLUMES; do
  old="${OLD_PREFIX}_$v"; new="${NEW_PREFIX}_$v"
  if ! docker volume inspect "$old" >/dev/null 2>&1; then
    echo "· $old absent, ignoré"; continue
  fi
  if docker volume inspect "$new" >/dev/null 2>&1; then
    echo "· $new existe déjà, non écrasé"; continue
  fi
  echo "→ copie $old → $new"
  docker volume create "$new" >/dev/null
  # cp -a conserve propriétaires et droits (PostgreSQL : 999, MinIO : 65532)
  docker run --rm -v "$old":/from:ro -v "$new":/to alpine sh -c 'cp -a /from/. /to/'
done

if docker network inspect "${OLD_PREFIX}_network" >/dev/null 2>&1; then
  docker network rm "${OLD_PREFIX}_network" >/dev/null && echo "→ réseau ${OLD_PREFIX}_network supprimé"
fi

echo "Terminé. Lancer : docker compose up -d"
echo "Après vérification : docker volume rm $(for v in $VOLUMES; do printf '%s_%s ' "$OLD_PREFIX" "$v"; done)"
