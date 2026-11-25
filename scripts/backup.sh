#!/usr/bin/env sh
# نسخة احتياطية للقاعدة والملفات. الاستخدام: DATABASE_URL=... ./scripts/backup.sh [مجلد]
set -eu
OUT="${1:-backups}/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
pg_dump --format=custom --file="$OUT/db.dump" "$DATABASE_URL"
tar -czf "$OUT/storage.tar.gz" -C "${STORAGE_DIR:-./storage}" .
echo "تم: $OUT"
# الاستعادة:
#   pg_restore --clean --if-exists --dbname="$DATABASE_URL" "$OUT/db.dump"
#   tar -xzf "$OUT/storage.tar.gz" -C "${STORAGE_DIR:-./storage}"
