// =====================================================================
// RELATED TICKETS: the "families" a ticket belongs to, from the link columns
// in the export (nothing guessed), and what each family's members have in
// common and where they differ:
//
//   parent-incident  incident.parent_incident: a parent (master) incident and the
//                    child incidents raised for the same issue (one level only)
//   bundle-request   sc_req_item.parent: a bundle request and its child requests
//   order            sc_req_item.request: requests ordered together in one REQ
//   request-tasks    sc_task.request_item: a request and the tasks that fulfil it
//   change-incident  change_request.incident (the incident a change fixes) and
//                    incident.caused_by_change (incidents a change caused)
//   problem          incident.problem / change_request.problem: tickets linked to
//                    the same problem record (the PRB itself isn't in the export)
//
// One ticket gets every family it is in. A list of tickets gets only the
// families that two or more of them share, so a long list isn't buried.
// Every Cube query here is built from ticket numbers checked against
// TICKET_NUMBER, never from model output.
// =====================================================================

import { TICKET_KINDS, toTicket, prefixOf } from './tickets.mjs';

const TICKET_NUMBER = /^(INC|CHG|RITM|SCTASK)\d{7}$/;
const MAX_TICKETS = 500;      // tickets looked at per request
const MEMBER_LIMIT = 1000;    // members fetched per query (the largest problem has 870 incidents)
const MAX_FAMILIES = 6;

// Columns fetched besides the summary ones: the links, and the fields compared
const EXTRA = {
  INC: { system: 'configuration_item', subcategory: 'subcategory', location: 'location', parentIncident: 'parent_incident', problem: 'problem', causedByChange: 'caused_by_change' },
  CHG: { system: 'configuration_item', fixesIncident: 'incident', problem: 'problem' },
  RITM: { item: 'item', location: 'location', order: 'request', parentRequest: 'parent' },
  SCTASK: { item: 'item', requestItem: 'request_item' },
};

// Compared across a family's members; each applies to some ticket types only.
// (Each member's role already says its type, so type isn't compared.)
const COMPARE = [
  ['State', ['INC', 'CHG', 'RITM', 'SCTASK'], t => t.state],
  ['Priority / risk', ['INC', 'CHG'], t => t.level],
  ['Team', ['INC', 'CHG', 'SCTASK'], t => t.team],
  ['Server / system', ['INC', 'CHG'], t => t.system],
  ['Subcategory', ['INC'], t => t.subcategory],
  ['Catalog item', ['RITM', 'SCTASK'], t => t.item],
  ['Location', ['INC', 'RITM'], t => t.location],
  ['Assigned to / requested for', ['INC', 'CHG', 'RITM', 'SCTASK'], t => t.person],
];

// "zzz" is the export's placeholder for "no server / system"
const clean = v => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === 'zzz' ? '' : s;
};

// Tickets of one type matching every [column, values] filter, with their link columns
async function queryTickets(prefix, filters, runQuery) {
  if (filters.some(([, values]) => !values.length)) return [];
  const { cube, fields } = TICKET_KINDS[prefix];
  const columns = [...new Set(['number', ...Object.values(fields), ...Object.values(EXTRA[prefix])])];
  const rows = await runQuery({
    dimensions: columns.map(c => `${cube}.${c}`),
    filters: filters.map(([column, values]) => ({ member: `${cube}.${column}`, operator: 'equals', values })),
    order: { [`${cube}.number`]: 'asc' },
    limit: MEMBER_LIMIT,
  });
  return rows.map(row => {
    const t = toTicket(prefix, row);
    for (const [key, column] of Object.entries(EXTRA[prefix])) t[key] = clean(row[`${cube}.${column}`]);
    return t;
  });
}

// What all members share, and where they differ (counts of each value)
function compare(members) {
  const same = [];
  const differ = [];
  for (const [field, kinds, get] of COMPARE) {
    const present = members.filter(m => kinds.includes(m.kind));
    if (present.length < 2) continue;
    const counts = new Map();
    for (const m of present) {
      const v = clean(get(m)) || 'not set';
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    if (counts.size === 1) {
      const [value] = counts.keys();
      if (value !== 'not set') same.push({ field, value });
    } else {
      const values = [...counts].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
      differ.push({ field, values: values.slice(0, 4), others: Math.max(values.length - 4, 0) });
    }
  }
  const summaries = new Set(members.map(m => clean(m.summary)).filter(Boolean));
  if (summaries.size === 1) same.push({ field: 'Summary', value: [...summaries][0] });
  else if (summaries.size > 1) differ.push({ field: 'Summary', note: summaries.size === members.length ? 'each one is different' : `${summaries.size} different summaries` });
  const opened = members.map(m => clean(m.opened)).filter(Boolean).sort();
  if (opened.length > 1) {
    if (opened[0] === opened.at(-1)) same.push({ field: 'Opened', value: opened[0] });
    else differ.push({ field: 'Opened', range: [opened[0], opened.at(-1)] });
  }
  return { same, differ };
}

// A linked ticket that isn't in the export still gets a row, marked as such
const missing = (number, type) => ({ number, kind: prefixOf(number), type, summary: 'Not in this export', state: '', level: '', team: '', person: '', opened: '', missing: true });

function family(kind, anchor, title, why, members, wanted) {
  const unique = [...new Map(members.map(m => [m.number, m])).values()];
  const touched = unique.filter(m => wanted.has(m.number)).length;
  const real = unique.filter(m => !m.missing);
  // Members the question was about first, then the anchor, then by when they were opened
  const ordered = [...unique].sort((a, b) =>
    (wanted.has(b.number) - wanted.has(a.number)) || ((b.number === anchor) - (a.number === anchor)) || clean(a.opened).localeCompare(clean(b.opened)));
  return {
    kind, anchor, title, why, touched, total: unique.length,
    // All of them (the page lists the first 25; downloads and the comparison use all)
    members: ordered.map(({ number, kind: k, type, role, summary, state, level, team, opened, missing: gone }) =>
      ({ number, kind: k, type, role, summary, state, level, team, opened, missing: Boolean(gone) })),
    ...compare(real),
  };
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const role = (t, label) => ({ ...t, role: label });

export async function relatedFamilies(numbers, runQuery) {
  const wantedList = [...new Set(numbers.map(n => String(n).toUpperCase()))].filter(n => TICKET_NUMBER.test(n)).slice(0, MAX_TICKETS);
  if (!wantedList.length) return [];
  const wanted = new Set(wantedList);
  const single = wantedList.length === 1;
  const of = prefix => wantedList.filter(n => prefixOf(n) === prefix);

  // The tickets asked about, with their links
  const [incs, chgs, ritms, tasks] = await Promise.all([
    queryTickets('INC', [['number', of('INC')]], runQuery),
    queryTickets('CHG', [['number', of('CHG')]], runQuery),
    queryTickets('RITM', [['number', of('RITM')]], runQuery),
    queryTickets('SCTASK', [['number', of('SCTASK')]], runQuery),
  ]);

  // Everything the families need, in one round of queries
  const parentIncidents = [...new Set([...incs.map(t => t.parentIncident).filter(Boolean), ...incs.map(t => t.number)])];
  const problems = [...new Set([...incs, ...chgs].map(t => t.problem).filter(Boolean))];
  const changeNumbers = [...new Set([...chgs.map(t => t.number), ...incs.map(t => t.causedByChange).filter(Boolean)])];
  const orders = [...new Set(ritms.map(t => t.order).filter(Boolean))];
  const parentRequests = [...new Set([...ritms.map(t => t.parentRequest).filter(Boolean), ...ritms.map(t => t.number)])];
  const requestItems = [...new Set([...ritms.map(t => t.number), ...tasks.map(t => t.requestItem).filter(Boolean)])];
  const [childIncs, parentIncs, problemIncs, problemChgs, fixChanges, causedIncs, changes, fixedIncs,
    orderRitms, childRitms, parentRitms, taskRitms, taskSiblings] = await Promise.all([
    queryTickets('INC', [['parent_incident', parentIncidents]], runQuery),
    queryTickets('INC', [['number', parentIncidents]], runQuery),
    queryTickets('INC', [['problem', problems]], runQuery),
    queryTickets('CHG', [['problem', problems]], runQuery),
    queryTickets('CHG', [['incident', incs.map(t => t.number)]], runQuery),
    queryTickets('INC', [['caused_by_change', changeNumbers]], runQuery),
    queryTickets('CHG', [['number', changeNumbers]], runQuery),
    queryTickets('INC', [['number', chgs.map(t => t.fixesIncident).filter(Boolean)]], runQuery),
    queryTickets('RITM', [['request', orders]], runQuery),
    queryTickets('RITM', [['parent', parentRequests]], runQuery),
    queryTickets('RITM', [['number', parentRequests]], runQuery),
    queryTickets('RITM', [['number', requestItems]], runQuery),
    queryTickets('SCTASK', [['request_item', requestItems]], runQuery),
  ]);
  const byNumber = list => new Map(list.map(t => [t.number, t]));
  const families = [];

  // Parent incident and its children
  const parentsByNumber = byNumber(parentIncs);
  for (const p of parentIncidents) {
    const children = childIncs.filter(c => c.parentIncident === p);
    if (!children.length) continue;
    const parent = parentsByNumber.get(p) || missing(p, 'Incident');
    families.push(family('parent-incident', p,
      `Parent incident ${p} and its ${plural(children.length, 'child incident', 'child incidents')}`,
      `${p} is a parent (master) incident: it groups incidents raised for the same issue, such as several alerts or reports about one fault, so they are worked and resolved together.`,
      [role(parent, 'Parent'), ...children.map(c => role(c, 'Child'))], wanted));
  }

  // Problem record
  for (const prb of problems) {
    const linked = [...problemIncs.filter(t => t.problem === prb).map(t => role(t, 'Incident')), ...problemChgs.filter(t => t.problem === prb).map(t => role(t, 'Change'))];
    if (linked.length < 2) continue;
    families.push(family('problem', prb,
      `${plural(linked.length, 'ticket', 'tickets')} linked to problem ${prb}`,
      `These tickets were all linked to problem ${prb}, the investigation into their shared root cause. The problem record itself isn't in this export.`,
      linked, wanted));
  }

  // Change <-> incident: the incident a change fixes, and incidents it caused
  const changesByNumber = byNumber([...changes, ...fixChanges]);
  const fixedByNumber = byNumber(fixedIncs);
  for (const c of new Set([...changeNumbers, ...fixChanges.map(t => t.number)])) {
    const change = changesByNumber.get(c) || missing(c, 'Change');
    const fixes = change.fixesIncident ? [fixedByNumber.get(change.fixesIncident) || incs.find(t => t.number === change.fixesIncident) || missing(change.fixesIncident, 'Incident')] : [];
    const caused = causedIncs.filter(t => t.causedByChange === c);
    if (!fixes.length && !caused.length) continue;
    const parts = [fixes.length ? `raised to fix ${fixes[0].number}` : '', caused.length ? `the cause of ${plural(caused.length, 'incident', 'incidents')}` : ''].filter(Boolean);
    families.push(family('change-incident', c,
      `Change ${c}: ${parts.join(', and ')}`,
      fixes.length && caused.length ? `${c} was raised to fix an incident, and other incidents name it as their cause.`
        : fixes.length ? `${c} was raised to fix incident ${fixes[0].number}.` : `These incidents name change ${c} as their cause.`,
      [role(change, 'Change'), ...fixes.map(t => role(t, 'Incident it fixes')), ...caused.map(t => role(t, 'Incident it caused'))], wanted));
  }

  // Requests ordered together
  for (const order of orders) {
    const together = orderRitms.filter(t => t.order === order);
    if (together.length < 2) continue;
    families.push(family('order', order,
      `${plural(together.length, 'request', 'requests')} ordered together in ${order}`,
      `${order} is one order (REQ); each request (RITM) in it is a separate item that was ordered at the same time.`,
      together.map(t => role(t, 'Request')), wanted));
  }

  // Bundle request and its child requests
  const parentRitmsByNumber = byNumber(parentRitms);
  for (const p of parentRequests) {
    const children = childRitms.filter(t => t.parentRequest === p);
    if (!children.length) continue;
    const parent = parentRitmsByNumber.get(p) || missing(p, 'Request');
    families.push(family('bundle-request', p,
      `Request ${p} and its ${plural(children.length, 'child request', 'child requests')}`,
      `${p} is a bundle request; it was split into child requests, one for each part of the work (for example one per server to start or stop).`,
      [role(parent, 'Parent request'), ...children.map(c => role(c, 'Child request'))], wanted));
  }

  // A request and the catalog tasks that fulfil it
  const taskRitmsByNumber = byNumber(taskRitms);
  for (const r of requestItems) {
    const itsTasks = taskSiblings.filter(t => t.requestItem === r);
    if (!itsTasks.length) continue;
    const request = taskRitmsByNumber.get(r) || missing(r, 'Request');
    families.push(family('request-tasks', r,
      `Request ${r} and its ${plural(itsTasks.length, 'catalog task', 'catalog tasks')}`,
      `Catalog tasks are the pieces of work that fulfil request ${r}; each is done by a fulfilment team.`,
      [role(request, 'Request'), ...itsTasks.map(t => role(t, 'Task'))], wanted));
  }

  // One ticket: every family it is in. A list: families two or more of them share.
  return families
    .filter(f => (single ? f.touched >= 1 : f.touched >= 2))
    .sort((a, b) => (b.touched - a.touched) || (b.total - a.total))
    .slice(0, MAX_FAMILIES);
}

// One line per family, for Claude: what the next question can build on
export function describeFamilies(families) {
  return families.map(f => {
    const same = f.same.filter(s => s.field !== 'Summary').map(s => `${s.field} ${s.value}`).join(', ');
    const differ = f.differ.map(d => d.field).join(', ');
    return `${f.title}${same ? `; all share ${same}` : ''}${differ ? `; they differ in ${differ}` : ''}.`;
  }).join(' ');
}
