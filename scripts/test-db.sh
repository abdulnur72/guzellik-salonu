#!/usr/bin/env bash
# Veritabanı şemasını ve güvenlik kurallarını yerel bir PostgreSQL'de dener.
# Kullanım: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:db
set -euo pipefail
cd "$(dirname "$0")/.."
P="psql -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists salon_test" -c "create database salon_test"
$P -d salon_test -f supabase/tests/auth_stub.sql
$P -d salon_test -f supabase/migrations/0001_init.sql
$P -d salon_test -f supabase/tests/rls_test.sql
