// =====================================================================
// ONE RECORD, AFTER THE WEBHOOK HAS ANSWERED: saved in its table, then (a
// ticket) put in its family, as OneTouch's own rules do it
// (teams.placeTicket); an approval just tells OneTouch the data changed.
// Anything that can't be done yet waits in servicenow_pending, and is tried
// again as soon as what it names is saved, and every minute.
// =====================================================================

import { TABLES, tableSchema } from './config/schema.js';
import { upsertRecord } from './db/upsertRecord.js';
import { park, unpark, waiting, waitingFor } from './db/pending.js';
import { linkedTickets } from './families.js';
import { placeTicket, announceTicketsChanged } from '../../teams.mjs';

const FOREIGN_KEY_VIOLATION = '23503';

// -> what happened, for the log
export async function processRecord(table, record) {
  const { key } = tableSchema(table);
  const id = String(record[key]);
  let saved;
  try {
    saved = await upsertRecord(table, record);
  } catch (error) {
    // A task before its request, an approval before its ticket
    if (error.code !== FOREIGN_KEY_VIOLATION) throw error;
    await park(table, id, record, `waiting for what it belongs to (${error.constraint})`);
    return 'waiting for what it belongs to';
  }
  await unpark(table, id);
  if (saved === 'stale') return 'stale: an older update than the one saved';
  let result = saved;
  try {
    if (TABLES[table]) {
      const placed = await placeTicket(id, await linkedTickets(table, id));
      result += placed.action === 'kept' ? `, in family ${placed.family}`
        : `, ${placed.action} family ${placed.family} (team ${placed.team ?? 'none'})${placed.moved ? `; ${placed.moved} moved team` : ''}`;
    } else {
      await announceTicketsChanged(`${table}:${id}`);
    }
  } catch (error) {
    // Saved, but OneTouch's database didn't take it: tried again, so it never stays family-less
    await park(table, id, record, `saved, not yet in a family: ${error.message}`);
    result += `, not yet in a family (${error.message}): waiting`;
  }
  retryWaitingFor(id);
  return result;
}

// ---- Trying the waiting ones again ----

// The ones waiting for this key, now it's saved (a request's tasks, a ticket's approvals)
function retryWaitingFor(id) {
  waitingFor(id).then(retry).catch(error => console.error(`⏳ Could not try what waits for ${id}:`, error.message));
}

// Every minute: all of them, one round at a time
let round = null;
export function retryWaitingSoon() {
  if (round) return;
  round = waiting().then(retry)
    .catch(error => console.error('⏳ Could not try the waiting records:', error.message))
    .finally(() => { round = null; });
}

async function retry(rows) {
  for (const row of rows) {
    if (!tableSchema(row.table_name)) continue;
    try {
      const result = await processRecord(row.table_name, row.record);
      if (!result.startsWith('waiting')) console.log(`📥 ${row.table_name} ${row.record_key} (waited, ${row.tries}× tried): ${result}`);
    } catch (error) {
      await park(row.table_name, row.record_key, row.record, error.message).catch(() => {});
    }
  }
}
