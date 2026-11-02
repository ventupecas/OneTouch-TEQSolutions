// =====================================================================
// THE TABLES: the six the ServiceNow export was loaded into (load_csv.sql),
// which Cube, the KPIs, families and Metabase all read. A record may only
// name columns its table has. The columns and keys are read from the
// database at start, so nothing here repeats the schema: change a table
// there and the listener follows.
// =====================================================================

import { analytics } from './db.js';

// Each table, and the prefix its ticket numbers have (as the export writes
// them: INC1814467). Approval records aren't tickets: they follow the ticket
// they approve, which must arrive first.
export const TABLES = {
  incident: 'INC',
  change_request: 'CHG',
  sc_req_item: 'RITM',
  sc_task: 'SCTASK',
  change_approvals: null,
  ritm_approvals: null,
};

let schema = null; // table -> { columns: Set, key, numericKey, updated }

export async function loadSchema() {
  const { rows } = await analytics.query(`
    SELECT c.relname AS table, array_agg(a.attname::text ORDER BY a.attnum) AS columns,
           max(a.attname::text) FILTER (WHERE a.attnum = ANY(i.indkey)) AS key,
           bool_or(a.attnum = ANY(i.indkey) AND format_type(a.atttypid, NULL) IN ('bigint', 'integer')) AS numeric_key,
           bool_or(a.attnum = ANY(i.indkey) AND a.attidentity <> '') AS identity_key
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
     WHERE c.relname = ANY($1::text[]) AND c.relkind = 'r'
     GROUP BY c.relname`, [Object.keys(TABLES)]);
  const missing = Object.keys(TABLES).filter(t => !rows.some(r => r.table === t));
  if (missing.length) throw new Error(`the database has no ${missing.join(', ')} table`);
  const keyless = rows.filter(r => !r.key).map(r => r.table);
  if (keyless.length) throw new Error(`${keyless.join(', ')} has no primary key to upsert on`);
  schema = new Map(rows.map(r => [r.table, {
    columns: new Set(r.columns), key: r.key, numericKey: r.numeric_key,
    // The approval tables number their rows themselves: ServiceNow's id overrides that
    identityKey: r.identity_key,
    // When ServiceNow last changed it: an older update never replaces a newer one
    updated: r.columns.includes('updated'),
  }]));
  return schema;
}

export const tableSchema = table => schema?.get(table) || null;
