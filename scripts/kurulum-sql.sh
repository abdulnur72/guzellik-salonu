#!/usr/bin/env bash
# supabase/migrations/*.sql dosyalarını tek bir supabase/kurulum.sql dosyasında birleştirir.
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "-- Supabase SQL Editor'e tek seferde yapıştırılacak dosya."
  echo "-- supabase/migrations klasöründeki dosyaların birleşimidir (scripts/kurulum-sql.sh ile üretilir)."
  for f in supabase/migrations/*.sql; do echo; echo "-- ===== $f ====="; cat "$f"; done
} > supabase/kurulum.sql
