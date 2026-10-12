#!/usr/bin/env bash
# يتحقق من أن الإدخال يشير إلى migration مباشر وموجود تحت supabase/migrations فقط.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <repository-root> <migrations/file.sql>" >&2
  exit 64
fi

REPO_ROOT="$(realpath -e -- "$1")"
SQL_FILE="$2"
MIGRATIONS_DIR="$(realpath -e -- "$REPO_ROOT/supabase/migrations")"

case "$SQL_FILE" in
  migrations/*) ;;
  *)
    echo "SQL path must start with migrations/" >&2
    exit 65
    ;;
esac

if [[ "$SQL_FILE" == *$'\n'* || "$SQL_FILE" == *$'\r'* ]]; then
  echo "SQL path must not contain line breaks" >&2
  exit 65
fi

SQL_REQUESTED="$REPO_ROOT/supabase/$SQL_FILE"
if ! SQL_CANONICAL="$(realpath -e -- "$SQL_REQUESTED")"; then
  echo "SQL file does not exist" >&2
  exit 66
fi

# يرفض .. و// والروابط الرمزية أو أي إدخال لا يطابق canonical path حرفياً.
if [ "$SQL_REQUESTED" != "$SQL_CANONICAL" ]; then
  echo "SQL path must be canonical" >&2
  exit 65
fi

if [ ! -f "$SQL_CANONICAL" ] || [ "$(dirname -- "$SQL_CANONICAL")" != "$MIGRATIONS_DIR" ]; then
  echo "SQL file must be a direct regular file under supabase/migrations" >&2
  exit 65
fi

SQL_BASENAME="$(basename -- "$SQL_CANONICAL")"
if [[ ! "$SQL_BASENAME" =~ ^[0-9]{14}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$ ]]; then
  echo "SQL file name must be a timestamped migration" >&2
  exit 65
fi

printf '%s\n' "$SQL_CANONICAL"
