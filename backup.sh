#!/usr/bin/env bash
# Respaldo logico de la base (formato custom de pg_dump). Uso: DATABASE_URL=... npm run backup
set -euo pipefail
: "${DATABASE_URL:?Define DATABASE_URL}"
mkdir -p backups
ARCHIVO="backups/observatorio_$(date +%Y-%m-%d_%H%M).dump"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$ARCHIVO"
echo "Respaldo creado: $ARCHIVO"
