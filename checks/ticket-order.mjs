// Assigned to me's order, checked against tickets made up here (no Cube, no
// database, no API key): most urgent first, a change's risk standing in for
// a priority, requests and tasks last, and the oldest first within each.
//
//   npm test        (CI runs it on every push)
//
// Exits non-zero on the first wrong answer.

import { ticketsByPriority, sortRows } from '../tickets.mjs';

// cube -> its rows, with the columns tickets.mjs asks for
const DATA = {
  incident: [
    { number: 'INC0000001', priority: 'P3 - Moderate', state: 'In Progress', created: '2026-07-10' },
    { number: 'INC0000002', priority: 'P1 - Critical', state: 'New', created: '2026-08-01' },
    { number: 'INC0000003', priority: 'P1 - Critical', state: 'Closed', created: '2026-07-05' },
    { number: 'INC0000004', priority: 'P4 - Low', state: 'New', created: '2026-07-12' },
  ],
  change_request: [
    { number: 'CHG0000001', risk: 'High', state: 'Pending', created: '2026-07-20' },
    { number: 'CHG0000002', risk: 'Low', state: 'Closed', created: '2026-07-15' },
  ],
  sc_req_item: [
    { number: 'RITM0000001', state: 'Open', opened: '2026-07-01' },
  ],
  sc_task: [
    { number: 'SCTASK0000001', state: 'Closed', created: '2026-07-02' },
  ],
};

// Stands in for req.runQuery: answers the number filter tickets.mjs sends,
// with Cube's "cube.column" keys
async function runQuery({ filters }) {
  const [cube] = filters[0].member.split('.');
  const wanted = new Set(filters[0].values);
  return DATA[cube]
    .filter(row => wanted.has(row.number))
    .map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [`${cube}.${k}`, v])));
}
runQuery.scopeKey = 'check';

let failed = 0;
function expect(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`PASS: ${label}`);
  else { console.error(`FAIL: ${label}\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`); failed++; }
}

const numbers = Object.values(DATA).flat().map(r => r.number);
const sorted = await ticketsByPriority(numbers, runQuery);

expect('Assigned to me: P1s (oldest first), High-risk change, P3, P4 and Low risk, then requests and tasks',
  sorted.map(t => t.number),
  ['INC0000003', 'INC0000002', 'CHG0000001', 'INC0000001', 'INC0000004', 'CHG0000002', 'RITM0000001', 'SCTASK0000001']);

expect('Assigned to me: 5 of the 8 are open',
  sorted.filter(t => t.open).length, 5);

expect('a column sorts P2 before P10, and blanks come last',
  sortRows(['P10', '', 'P2', null, 'P1'], v => v),
  ['P1', 'P2', 'P10', '', null]);

expect('blanks still come last sorted the other way',
  sortRows(['P10', '', 'P2', null, 'P1'], v => v, 'desc'),
  ['P10', 'P2', 'P1', '', null]);

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
