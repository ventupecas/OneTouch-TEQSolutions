// =====================================================================
// POST /api/v1/servicenow-webhook: one ServiceNow record per call, as
//   { "table": "incident", "record": { "number": "INC1900001", "state": "New", … } }
// table: one of the six the export was loaded into (config/schema.js);
// record: that table's own column names, its key among them (a ticket's
// number, an approval's approval_id).
//
// The caller gets its answer as soon as the call is known to be good
// (right token, a table and columns that exist, a valid key):
// 200 { received: true }. Saving, and putting a ticket in its family, runs
// after that (processRecord.js), so a slow or failing database never makes
// ServiceNow wait or time out. Its outcome is logged here.
// =====================================================================

import { Router, json } from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import { TABLES, tableSchema } from '../config/schema.js';
import { processRecord } from '../processRecord.js';

// Work still running, so a shutdown can wait for it (app.js)
export const pending = new Set();

const SIMPLE = new Set(['string', 'number', 'boolean']);

// body -> { table, record } ready to save, or { error }
function checkBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'The body must be one JSON object: { "table": …, "record": { … } }.' };
  const { table, record } = body;
  if (!Object.hasOwn(TABLES, table)) return { error: `"table" must be one of: ${Object.keys(TABLES).join(', ')}.` };
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { error: '"record" must be a JSON object of column names and values.' };
  const { columns, key, numericKey } = tableSchema(table);
  const unknown = Object.keys(record).filter(c => !columns.has(c));
  if (unknown.length) return { error: `${table} has no ${unknown.map(c => `"${c}"`).join(', ')} column${unknown.length > 1 ? 's' : ''}.` };
  const notText = Object.keys(record).filter(c => record[c] !== null && !SIMPLE.has(typeof record[c]));
  if (notText.length) return { error: `${notText.join(', ')}: each value must be text, a number, true/false or null.` };

  const clean = { ...record };
  const id = String(record[key] ?? '').trim();
  if (TABLES[table]) {
    // A ticket's number as the export writes it, which families and the rest of OneTouch go by
    const number = id.toUpperCase();
    if (!new RegExp(`^${TABLES[table]}\\d{7}$`).test(number)) return { error: `"${key}" must be a ${TABLES[table]} number like ${TABLES[table]}1234567.` };
    clean[key] = number;
  } else if (numericKey ? !/^\d{1,18}$/.test(id) : !id) {
    return { error: `"${key}" must be ${numericKey ? 'a whole number' : 'given'}.` };
  } else {
    clean[key] = id;
  }
  return { table, record: clean, id: clean[key], key };
}

export function webhookRouter({ secret }) {
  const router = Router();

  router.post('/servicenow-webhook',
    verifyToken(secret),
    json({ limit: '1mb', type: ['application/json', 'application/*+json'] }),
    (req, res) => {
      const checked = checkBody(req.body);
      if (checked.error) return res.status(400).json({ error: checked.error });
      const { table, record, id, key } = checked;

      res.status(200).json({ received: true, table, [key]: id });

      const job = processRecord(table, record)
        .then(result => console.log(`📥 ${table} ${id}: ${result}`))
        .catch(error => console.error(`❌ ${table} ${id}: not saved: ${error.message}`))
        .finally(() => pending.delete(job));
      pending.add(job);
    });

  return router;
}
