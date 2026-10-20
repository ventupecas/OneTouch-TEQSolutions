#!/bin/sh
# Creates/updates the reporting views (db/reporting-views.sql) in analytics_db
# and the read-only role Metabase connects as (metabase_reader). The role can
# read the reporting views and nothing else.
#
# Runs on every `docker compose up` through the db-setup service. Safe to repeat;
# it also re-syncs metabase_reader's password with METABASE_DB_PASSWORD.
set -e
HERE=$(dirname "$0")

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname analytics_db -q -f "$HERE/reporting-views.sql"
echo "init-reporting: reporting views are up to date"

if [ -z "$METABASE_DB_PASSWORD" ]; then
  echo "init-reporting: METABASE_DB_PASSWORD not set; skipping the metabase_reader role"
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname analytics_db -q -v pw="$METABASE_DB_PASSWORD" <<'EOSQL'
SELECT 'CREATE ROLE metabase_reader LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'metabase_reader') \gexec
SELECT format('ALTER ROLE metabase_reader WITH LOGIN PASSWORD %L', :'pw') \gexec

GRANT CONNECT ON DATABASE analytics_db TO metabase_reader;
-- Only the reporting views: the views read the raw tables with their owner's
-- rights, so metabase_reader needs no access to the public schema at all
REVOKE ALL ON SCHEMA public FROM metabase_reader;
GRANT USAGE ON SCHEMA reporting TO metabase_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO metabase_reader;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA reporting TO metabase_reader;
EOSQL
echo "init-reporting: metabase_reader can read the reporting views"
