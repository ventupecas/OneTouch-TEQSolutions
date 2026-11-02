// =====================================================================
// FAMILIES: which tickets a new one is linked to, by the same link columns
// OneTouch built every family from (LINKS in ../../teams.mjs): a parent
// incident, a problem, the change that caused it, a change's incident, a
// request's order and bundle, a task's request. Both ways: what it points
// at, what points at it (a child that arrived before its parent), and the
// tickets sharing its problem or order. teams.placeTicket then puts it in
// their family, and so on their team, as the first start would have.
// =====================================================================

import { analytics } from './config/db.js';
import { LINKS } from '../../teams.mjs';

// These name something several tickets share, not another ticket
const SHARED = new Set(['problem', 'request']);
// "zzz" is the export's placeholder for "none"
const clean = value => {
  const v = String(value ?? '').trim();
  return v && v !== 'zzz' ? v : '';
};
const quote = name => `"${name}"`;

// table, number -> the ticket numbers it's linked to (read from the data,
// after the upsert, so links saved by an earlier delivery count too)
export async function linkedTickets(table, number) {
  const links = LINKS[table];
  if (!links) return [];
  const { rows: [row] } = await analytics.query(`SELECT ${links.map(quote).join(', ')} FROM ${quote(table)} WHERE number = $1`, [number]);
  if (!row) return [];
  const found = new Set();
  const asked = [];
  for (const link of links) {
    const value = clean(row[link]);
    if (!value) continue;
    if (!SHARED.has(link)) found.add(value.toUpperCase());
    // Every ticket with the same problem, or in the same order
    else for (const [t, cols] of Object.entries(LINKS)) if (cols.includes(link)) asked.push([t, link, value]);
  }
  // Every ticket that points at this one
  for (const [t, cols] of Object.entries(LINKS)) for (const c of cols) if (!SHARED.has(c)) asked.push([t, c, number]);
  const answers = await Promise.all(asked.map(([t, c, value]) =>
    analytics.query(`SELECT number FROM ${quote(t)} WHERE ${quote(c)} = $1`, [value])));
  for (const { rows } of answers) for (const r of rows) found.add(String(r.number).toUpperCase());
  found.delete(number);
  return [...found];
}
