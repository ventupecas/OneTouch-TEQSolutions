#!/bin/sh
# Creates the OneTouch account database (onetouch_auth) and the only role
# allowed into it (onetouch_app). The tables themselves are created by the
# app on start (auth.mjs -> ensureSchema).
#
# Runs automatically when the Postgres volume is first created. For an
# existing volume, run it once by hand (safe to repeat; it also re-syncs the
# role's password with AUTH_DB_PASSWORD):
#   docker exec analytics_postgres sh /docker-entrypoint-initdb.d/20-init-auth.sh
set -e

if [ -z "$AUTH_DB_PASSWORD" ]; then
  echo "init-auth: AUTH_DB_PASSWORD is not set; add it to .env" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v pw="$AUTH_DB_PASSWORD" <<'EOSQL'
SELECT 'CREATE ROLE onetouch_app LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'onetouch_app') \gexec
SELECT format('ALTER ROLE onetouch_app WITH LOGIN PASSWORD %L', :'pw') \gexec

SELECT 'CREATE DATABASE onetouch_auth OWNER onetouch_app'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'onetouch_auth') \gexec

-- Only onetouch_app (and the admin superuser) can open the account database
REVOKE CONNECT ON DATABASE onetouch_auth FROM PUBLIC;
GRANT CONNECT ON DATABASE onetouch_auth TO onetouch_app;

-- ...and onetouch_app can't open the analytics data
SELECT 'REVOKE CONNECT ON DATABASE analytics_db FROM PUBLIC'
 WHERE EXISTS (SELECT FROM pg_database WHERE datname = 'analytics_db') \gexec
EOSQL

echo "init-auth: onetouch_auth database and onetouch_app role are ready"
