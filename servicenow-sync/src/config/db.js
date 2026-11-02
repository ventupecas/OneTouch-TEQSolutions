// =====================================================================
// THE DATABASES. Two, as OneTouch has them:
//
//   analytics   the ticket data (analytics_db): the tables the ServiceNow
//               export was loaded into, which Cube, KPIs and Metabase read.
//               pg reads the standard PGHOST, PGPORT, PGDATABASE, PGUSER and
//               PGPASSWORD variables itself.
//   onetouch    families, teams and who has each ticket (onetouch_auth),
//               through OneTouch's own code (../../auth.mjs, ../../teams.mjs),
//               which reads AUTH_DB_HOST, AUTH_DB_PORT, AUTH_DB_NAME,
//               AUTH_DB_USER and AUTH_DB_PASSWORD, as OneTouch does.
// =====================================================================

import pg from 'pg';

export const analytics = new pg.Pool({
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// A connection that dies while idle (database restarted, network dropped)
// is logged; without this listener pg would crash the process
analytics.on('error', error => {
  console.error('🐘 Idle database connection failed:', error.message);
});

export async function checkDatabase() {
  await analytics.query('SELECT 1');
}
