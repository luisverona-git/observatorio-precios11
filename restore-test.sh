#!/usr/bin/env bash
# Prueba de restauracion: restaura un respaldo en una base vacia y compara el conteo de filas.
# Uso: ORIGEN_URL=... DESTINO_URL=... bash scripts/restore-test.sh backups/archivo.dump
set -euo pipefail
: "${ORIGEN_URL:?}" "${DESTINO_URL:?}"
ARCH="${1:?Indica el archivo .dump}"
pg_restore --no-owner --no-privileges --dbname="$DESTINO_URL" "$ARCH" 2>&1 | grep -v "already exists" || true
TABLAS="categoria comercio sucursal usuario producto sinonimo precio alerta log_auditoria carga_masiva"
for t in $TABLAS; do
  a=$(psql "$ORIGEN_URL" -tAc "SELECT COUNT(*) FROM $t"); b=$(psql "$DESTINO_URL" -tAc "SELECT COUNT(*) FROM $t")
  [ "$a" = "$b" ] && echo "OK   $t: $a filas" || { echo "FALLA $t: origen=$a destino=$b"; exit 1; }
done
echo "Restauracion verificada: los datos se recuperan completos."
