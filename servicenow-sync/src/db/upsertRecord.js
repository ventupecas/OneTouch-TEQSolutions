// =====================================================================
// THE UPSERT: one record into its table, inserted or replaced by the
// table's key (a ticket's number, an approval's approval_id) in a single
// statement, safe with any number of deliveries at once. Only the columns
// the record names are written, so a record that leaves one out never
// blanks it.
// =====================================================================

import { analytics } from '../config/db.js';
import { tableSchema } from '../config/schema.js';

// Names come from the database's own schema (config/schema.js), quoted all the same
const quote = name => `"${name.replace(/"/g, '""')}"`;

// Empty text is stored as NULL, as the export has it; everything else as text
const columnValue = value => (value === undefined || value === null || value === '' ? null : String(value));

// table, record (column -> value, its key among them) -> 'inserted' | 'updated' | 'stale'
export async function upsertRecord(table, record) {
  const { key, updated, identityKey } = tableSchema(table);
  const columns = Object.keys(record);
  const others = columns.filter(c => c !== key);
  const t = quote(table);
  // An update older than the stored row (by "updated", where the table has
  // it) changes nothing: async deliveries can arrive out of order
  const newest = updated && columns.includes('updated')
    ? `WHERE ${t}."updated" IS NULL OR EXCLUDED."updated" IS NULL OR EXCLUDED."updated" >= ${t}."updated"` : '';
  const { rows } = await analytics.query(
    `INSERT INTO ${t} (${columns.map(quote).join(', ')}) ${identityKey ? 'OVERRIDING SYSTEM VALUE' : ''} VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (${quote(key)}) DO UPDATE SET ${(others.length ? others : [key]).map(c => `${quote(c)} = EXCLUDED.${quote(c)}`).join(', ')}
     ${newest}
     RETURNING (xmax = 0) AS inserted`,
    columns.map(c => columnValue(record[c])));
  if (!rows.length) return 'stale';
  return rows[0].inserted ? 'inserted' : 'updated';
}
