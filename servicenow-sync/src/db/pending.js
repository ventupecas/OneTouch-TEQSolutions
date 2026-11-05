// =====================================================================
// WAITING RECORDS (servicenow_pending, db/schema.sql): ones that can't be
// saved yet. A catalog task before its request, an approval before its
// ticket (the tables link them), or a ticket that couldn't be put in a
// family. The newest version of each is kept, and tried again.
// =====================================================================

import { analytics } from '../config/db.js';

// Looked for first: asking to create it is refused without the right to create
// tables, even when it's already there, and db/schema.sql is the usual way it's made
export async function ensurePendingTable() {
  const { rows: [{ found }] } = await analytics.query(`SELECT to_regclass('servicenow_pending') IS NOT NULL AS found`);
  if (found) return;
  await analytics.query(`
    CREATE TABLE IF NOT EXISTS servicenow_pending (
      id bigserial PRIMARY KEY, table_name text NOT NULL, record_key text NOT NULL, record jsonb NOT NULL,
      reason text NOT NULL, tries integer NOT NULL DEFAULT 1,
      received_at timestamptz NOT NULL DEFAULT now(), last_tried_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (table_name, record_key))`);
}

export async function park(table, key, record, reason) {
  await analytics.query(
    `INSERT INTO servicenow_pending (table_name, record_key, record, reason) VALUES ($1, $2, $3, $4)
     ON CONFLICT (table_name, record_key) DO UPDATE
        SET record = EXCLUDED.record, reason = EXCLUDED.reason, tries = servicenow_pending.tries + 1, last_tried_at = now()`,
    [table, String(key), JSON.stringify(record), reason]);
}

// Saved after all (or a newer version was): it waits no more
export async function unpark(table, key) {
  await analytics.query('DELETE FROM servicenow_pending WHERE table_name = $1 AND record_key = $2', [table, String(key)]);
}

// The ones that name this key anywhere (a task's request_item, an approval's
// parent): it has just been saved, so they may be saved now too
export async function waitingFor(key, limit = 200) {
  const { rows } = await analytics.query(
    `SELECT table_name, record_key, record, tries FROM servicenow_pending
      WHERE EXISTS (SELECT 1 FROM jsonb_each_text(record) e WHERE upper(e.value) = upper($1))
        AND record_key <> $1 ORDER BY id LIMIT $2`, [String(key), limit]);
  return rows;
}

// Every minute: the oldest waiting first, not the ones just tried
export async function waiting(limit = 200) {
  const { rows } = await analytics.query(
    `SELECT table_name, record_key, record, tries FROM servicenow_pending
      WHERE last_tried_at < now() - interval '2 seconds' ORDER BY id LIMIT $1`, [limit]);
  return rows;
}
