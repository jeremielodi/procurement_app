#!/bin/sh
# zz_reapply_grants.sh — initialisation d'une base NEUVE uniquement (docker-entrypoint-initdb.d, dernier fichier).
#
# Docker exécute database/* par ordre alphabétique : 01_… à NN_… puis clean.sql et data.sql. Or data.sql crée les
# profils : quand les migrations s'exécutent, prof_logistic, prof_finance… n'existent pas encore et leurs attributions
# de permissions (« WHERE EXISTS (SELECT 1 FROM profiles …) ») sont ignorées — une base neuve n'avait que les droits de
# data.sql (ex. logistique sans VIEW_STOCK ni RECORD_GOODS_RECEIPT).
#
# Ce script rejoue, après data.sql et dans l'ordre (data.sql puis NN_*.sql), les seules instructions de droits :
# INSERT INTO permissions / profiles / profile_permissions et DELETE FROM profile_permissions (toutes idempotentes).
# État final = celui d'une base mise à jour migration par migration. Lu depuis les fichiers : une nouvelle migration
# qui attribue des droits est prise en compte sans modifier ce script. Une base existante n'est jamais concernée.
#
# Sourcé par l'entrypoint (fichier non exécutable) : pas d'« exit », variables POSTGRES_USER / POSTGRES_DB disponibles.

INITDB_DIR=/docker-entrypoint-initdb.d

echo "zz_reapply_grants : attributions de permissions des migrations rejouées après data.sql"
{
  echo 'BEGIN;'
  for f in "$INITDB_DIR/data.sql" $(ls "$INITDB_DIR" | grep -E '^[0-9][0-9]_.*\.sql$' | LC_ALL=C sort | sed "s|^|$INITDB_DIR/|"); do
    awk '
      { line = $0; sub(/\r$/, "", line) }
      !s && toupper(line) ~ /^(INSERT INTO (PERMISSIONS|PROFILES|PROFILE_PERMISSIONS)|DELETE FROM PROFILE_PERMISSIONS)([^A-Z_]|$)/ { s = 1 }
      s { print line }
      s && line ~ /;[ \t]*$/ { s = 0 }
    ' "$f"
  done
  echo 'COMMIT;'
} | psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
