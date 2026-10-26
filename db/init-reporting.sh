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

# What each person may see on the dashboards. Metabase reads the ticket views
# through reporting.visible_tickets(viewer), which looks up OneTouch's live
# assignments in onetouch_auth through postgres_fdw. It connects as
# access_reader, a role with no password that can only log in from inside the
# Postgres container (pg_hba trusts local connections) and can only read
# onetouch_auth's ticket_access view (ticket number, team id, assignee id),
# which the app creates and grants it on start (teams.mjs).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -q <<'EOSQL'
SELECT 'CREATE ROLE access_reader LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'access_reader') \gexec
ALTER ROLE access_reader WITH LOGIN PASSWORD NULL;
SELECT 'GRANT CONNECT ON DATABASE onetouch_auth TO access_reader'
 WHERE EXISTS (SELECT FROM pg_database WHERE datname = 'onetouch_auth') \gexec
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname onetouch_auth -q <<'EOSQL'
SELECT 'GRANT SELECT ON public.ticket_access TO access_reader'
 WHERE to_regclass('public.ticket_access') IS NOT NULL \gexec
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname analytics_db -q <<'EOSQL'
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
SELECT 'CREATE SERVER onetouch_auth FOREIGN DATA WRAPPER postgres_fdw OPTIONS (dbname ''onetouch_auth'')'
 WHERE NOT EXISTS (SELECT FROM pg_foreign_server WHERE srvname = 'onetouch_auth') \gexec
-- No host: the connection is made over the Postgres container's own socket,
-- which needs no password (only a superuser may allow that)
DROP USER MAPPING IF EXISTS FOR metabase_reader SERVER onetouch_auth;
CREATE USER MAPPING FOR metabase_reader SERVER onetouch_auth OPTIONS (user 'access_reader', password_required 'false');
DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER onetouch_auth;
CREATE USER MAPPING FOR CURRENT_USER SERVER onetouch_auth OPTIONS (user 'access_reader');

CREATE SCHEMA IF NOT EXISTS onetouch_access;
REVOKE ALL ON SCHEMA onetouch_access FROM PUBLIC;
CREATE FOREIGN TABLE IF NOT EXISTS onetouch_access.ticket_access (number text, team_id integer, assignee_id integer)
  SERVER onetouch_auth OPTIONS (schema_name 'public', table_name 'ticket_access');
GRANT USAGE ON SCHEMA onetouch_access TO metabase_reader;
GRANT SELECT ON onetouch_access.ticket_access TO metabase_reader;

-- The ticket numbers one viewer may see. viewer (from the person's signed
-- dashboard link, see dashboardViewer in teams.mjs): "team:<id>:<key>" for a
-- project manager, "person:<user id>:<key>" for anyone else. "all" (admins)
-- is handled by the dashboards' SQL without calling this.
CREATE OR REPLACE FUNCTION reporting.visible_tickets(viewer text)
RETURNS TABLE (number text) LANGUAGE sql STABLE AS $$
  SELECT t.number FROM onetouch_access.ticket_access t
   WHERE t.team_id = CASE WHEN split_part(viewer, ':', 1) = 'team' THEN nullif(split_part(viewer, ':', 2), '')::int END
      OR t.assignee_id = CASE WHEN split_part(viewer, ':', 1) = 'person' THEN nullif(split_part(viewer, ':', 2), '')::int END
$$;
GRANT EXECUTE ON FUNCTION reporting.visible_tickets(text) TO metabase_reader;
EOSQL
echo "init-reporting: dashboards read who may see which ticket from onetouch_auth"
