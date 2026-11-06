// Which tickets get highlighted (kpis.mjs attentionFlagger), checked against
// tickets made up here (no Cube, no database, no API key).
//
//   npm test        (CI runs it on every push)
//
// Exits non-zero on the first wrong answer.

import { attentionFlagger } from '../kpis.mjs';

const NOW = '2026-09-01 12:00:00';
const daysAgo = n => new Date(Date.parse(`${NOW.replace(' ', 'T')}Z`) - n * 864e5).toISOString().slice(0, 19).replace('T', ' ');

// Twenty finished requests, taking 1 to 20 days: 95 in 100 took 19 days or less
const finishedRequests = Array.from({ length: 20 }, (_, i) => ({
  number: `RITM00001${String(i).padStart(2, '0')}`, state: 'Closed', opened: daysAgo(40), closed: daysAgo(40 - (i + 1)), updated: daysAgo(10),
}));

const DATA = {
  incident: [
    { number: 'INC0000001', state: 'Closed', priority: 'P3 - Moderate', created: daysAgo(30), resolved: daysAgo(28), updated: daysAgo(28) },
    { number: 'INC0000002', state: 'In Progress', priority: 'P3 - Moderate', created: daysAgo(1), updated: daysAgo(0), breach_reason: 'Vendor' },
    { number: 'INC0000003', state: 'In Progress', priority: 'P3 - Moderate', created: daysAgo(1), updated: daysAgo(0) },
    { number: 'INC0000004', state: 'In Progress', priority: 'P3 - Moderate', created: daysAgo(5), updated: daysAgo(0) },
    { number: 'INC0000005', state: 'Closed', priority: 'P4 - Low', created: daysAgo(90), closed: daysAgo(80), updated: daysAgo(80), breach_reason: 'Vendor' },
    // No finished P1 to compare it with
    { number: 'INC0000006', state: 'New', priority: 'P1 - Critical', created: daysAgo(6), updated: daysAgo(1) },
  ],
  change_request: [
    { number: 'CHG0000001', state: 'Review', created: daysAgo(60), planned_start_date: daysAgo(10), planned_end_date: daysAgo(3) },
    { number: 'CHG0000002', state: 'Review', created: daysAgo(60), planned_start_date: daysAgo(1), planned_end_date: daysAgo(-3) },
    { number: 'CHG0000003', state: 'Closed', created: daysAgo(60), planned_start_date: daysAgo(10), planned_end_date: daysAgo(3) },
  ],
  sc_req_item: [
    ...finishedRequests,
    { number: 'RITM0000001', state: 'Open', opened: daysAgo(25), updated: daysAgo(0) },
    { number: 'RITM0000002', state: 'Open', opened: daysAgo(18), updated: daysAgo(0) },
    { number: 'RITM0000003', state: 'Pending', opened: daysAgo(9), updated: daysAgo(7) },
    { number: 'RITM0000004', state: 'Pending', opened: daysAgo(9), updated: daysAgo(6) },
  ],
  sc_task: [
    { number: 'SCTASK0000001', state: 'Open', created: daysAgo(1), updated: NOW, sla_flag: 'true' },
    { number: 'SCTASK0000002', state: 'Closed', created: daysAgo(20), updated: daysAgo(15), sla_flag: 'true' },
  ],
};

// Stands in for Cube: every row of the asked-for cube, with "cube.column" keys
async function runCubeQuery({ dimensions }) {
  const [cube] = dimensions[0].split('.');
  return DATA[cube].map(row => Object.fromEntries(dimensions.map(d => [d, row[d.split('.')[1]] ?? ''])));
}

const flagged = await attentionFlagger(runCubeQuery);
const keys = (number, hasPerson = true) => flagged(number, hasPerson).map(f => f.key).join(',');

let failures = 0;
function check(what, got, want) {
  if (got === want) return;
  console.error(`FAIL ${what}: got "${got}", wanted "${want}"`);
  failures += 1;
}

check('a closed incident, unassigned', keys('INC0000001', false), '');
check('a closed incident with an SLA breach', keys('INC0000005'), '');
check('an open incident with an SLA breach', keys('INC0000002'), 'overdue');
check('an open incident within its usual time', keys('INC0000003'), '');
check('an open incident slower than 95 in 100', keys('INC0000004'), 'overdue');
check('nothing finished to compare with', keys('INC0000006'), '');
check('a change past its planned end', keys('CHG0000001'), 'overdue');
check('a change inside its window, with no update date', keys('CHG0000002'), '');
check('a closed change past its planned end', keys('CHG0000003'), '');
check('a request slower than 95 in 100', keys('RITM0000001'), 'overdue');
check('a request exactly under the limit', keys('RITM0000002'), '');
check('no update for exactly 7 days', keys('RITM0000003'), 'stale');
check('no update for 6 days', keys('RITM0000004'), '');
check('an open catalog task with a breached SLA', keys('SCTASK0000001'), 'overdue');
check('a closed catalog task with a breached SLA', keys('SCTASK0000002'), '');
check('open and nobody has it', keys('INC0000003', false), 'unassigned');
check('several flags at once', keys('RITM0000003', false), 'stale,unassigned');
check('a number not in the data', keys('INC9999999', false), '');
check('a flag says why', flagged('CHG0000001', true)[0].value, '3.0 days');

if (failures) process.exit(1);
console.log('Attention flags: all correct.');
