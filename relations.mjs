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

// The six kinds of family, built the same way for a ticket's related tickets
// and for the Ticket families page
function parentIncidentFamily(p, parent, children, wanted) {
  return family('parent-incident', p,
    `Parent incident ${p} and its ${plural(children.length, 'child incident', 'child incidents')}`,
    `${p} is a parent (master) incident: it groups incidents raised for the same issue, such as several alerts or reports about one fault, so they are worked and resolved together.`,
    [role(parent || missing(p, 'Incident'), 'Parent'), ...children.map(c => role(c, 'Child'))], wanted);
}

function problemFamily(prb, incidents, changes, wanted) {
  const linked = [...incidents.map(t => role(t, 'Incident')), ...changes.map(t => role(t, 'Change'))];
  return family('problem', prb,
    `${plural(linked.length, 'ticket', 'tickets')} linked to problem ${prb}`,
    `These tickets were all linked to problem ${prb}, the investigation into their shared root cause. The problem record itself isn't in this export.`,
    linked, wanted);
}

// A change, the incident it was raised to fix (if any), and the incidents it caused
function changeFamily(c, change, fixes, caused, wanted) {
  const parts = [fixes.length ? `raised to fix ${fixes[0].number}` : '', caused.length ? `the cause of ${plural(caused.length, 'incident', 'incidents')}` : ''].filter(Boolean);
  return family('change-incident', c,
    `Change ${c}: ${parts.join(', and ')}`,
    fixes.length && caused.length ? `${c} was raised to fix an incident, and other incidents name it as their cause.`
      : fixes.length ? `${c} was raised to fix incident ${fixes[0].number}.` : `These incidents name change ${c} as their cause.`,
    [role(change || missing(c, 'Change'), 'Change'), ...fixes.map(t => role(t, 'Incident it fixes')), ...caused.map(t => role(t, 'Incident it caused'))], wanted);
}

function orderFamily(order, together, wanted) {
  return family('order', order,
    `${plural(together.length, 'request', 'requests')} ordered together in ${order}`,
    `${order} is one order (REQ); each request (RITM) in it is a separate item that was ordered at the same time.`,
    together.map(t => role(t, 'Request')), wanted);
}

function bundleFamily(p, parent, children, wanted) {
  return family('bundle-request', p,
    `Request ${p} and its ${plural(children.length, 'child request', 'child requests')}`,
    `${p} is a bundle request; it was split into child requests, one for each part of the work (for example one per server to start or stop).`,
    [role(parent || missing(p, 'Request'), 'Parent request'), ...children.map(c => role(c, 'Child request'))], wanted);
}

function requestTasksFamily(r, request, tasks, wanted) {
  return family('request-tasks', r,
    `Request ${r} and its ${plural(tasks.length, 'catalog task', 'catalog tasks')}`,
    `Catalog tasks are the pieces of work that fulfil request ${r}; each is done by a fulfilment team.`,
    [role(request || missing(r, 'Request'), 'Request'), ...tasks.map(t => role(t, 'Task'))], wanted);
}

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
    if (children.length) families.push(parentIncidentFamily(p, parentsByNumber.get(p), children, wanted));
  }

  // Problem record
  for (const prb of problems) {
    const incidents = problemIncs.filter(t => t.problem === prb);
    const linkedChanges = problemChgs.filter(t => t.problem === prb);
    if (incidents.length + linkedChanges.length >= 2) families.push(problemFamily(prb, incidents, linkedChanges, wanted));
  }

  // Change <-> incident: the incident a change fixes, and incidents it caused
  const changesByNumber = byNumber([...changes, ...fixChanges]);
  const fixedByNumber = byNumber(fixedIncs);
  for (const c of new Set([...changeNumbers, ...fixChanges.map(t => t.number)])) {
    const change = changesByNumber.get(c) || missing(c, 'Change');
    const fixes = change.fixesIncident ? [fixedByNumber.get(change.fixesIncident) || incs.find(t => t.number === change.fixesIncident) || missing(change.fixesIncident, 'Incident')] : [];
    const caused = causedIncs.filter(t => t.causedByChange === c);
    if (fixes.length || caused.length) families.push(changeFamily(c, change, fixes, caused, wanted));
  }

  // Requests ordered together
  for (const order of orders) {
    const together = orderRitms.filter(t => t.order === order);
    if (together.length >= 2) families.push(orderFamily(order, together, wanted));
  }

  // Bundle request and its child requests
  const parentRitmsByNumber = byNumber(parentRitms);
  for (const p of parentRequests) {
    const children = childRitms.filter(t => t.parentRequest === p);
    if (children.length) families.push(bundleFamily(p, parentRitmsByNumber.get(p), children, wanted));
  }

  // A request and the catalog tasks that fulfil it
  const taskRitmsByNumber = byNumber(taskRitms);
  for (const r of requestItems) {
    const itsTasks = taskSiblings.filter(t => t.requestItem === r);
    if (itsTasks.length) families.push(requestTasksFamily(r, taskRitmsByNumber.get(r), itsTasks, wanted));
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

// =====================================================================
// PARENT AND FAMILY, for lists (Ticket results, Starred tickets): each
// ticket's parent, and the families it is in with how many tickets each
// has, from the ticket's own link columns plus one count per kind of
// family. Lighter than relatedFamilies (no members are fetched), so it
// works for a whole list. The export is frozen, so a ticket's answer is
// kept and reused.
// =====================================================================

const MAX_LINK_TICKETS = 2000;
// Each ticket's link columns
const LINK_COLUMNS = {
  INC: ['parent_incident', 'problem', 'caused_by_change'],
  CHG: ['incident', 'problem'],
  RITM: ['parent', 'request'],
  SCTASK: ['request_item'],
};
const linkCache = new Map(); // number -> { parent, families }
const LINK_CACHE_SIZE = 50000;

async function linkRows(prefix, column, values, runQuery) {
  if (!values.length) return [];
  const { cube } = TICKET_KINDS[prefix];
  const columns = ['number', ...LINK_COLUMNS[prefix]];
  const rows = await runQuery({
    dimensions: columns.map(c => `${cube}.${c}`),
    filters: [{ member: `${cube}.${column}`, operator: 'equals', values }],
    limit: 5000,
  });
  return rows.map(r => Object.fromEntries(columns.map(c => [c, clean(r[`${cube}.${c}`])])));
}

// How many tickets of a type have each of these values in a link column
async function countBy(cube, column, values, runQuery) {
  if (!values.length) return new Map();
  const rows = await runQuery({
    measures: [`${cube}.count`],
    dimensions: [`${cube}.${column}`],
    filters: [{ member: `${cube}.${column}`, operator: 'equals', values }],
    limit: 5000,
  });
  return new Map(rows.map(r => [clean(r[`${cube}.${column}`]), Number(r[`${cube}.count`]) || 0]));
}

// numbers -> Map(number -> { parent: number or '', families: [{ key, kind, anchor, name, size }] }).
// key (kind + anchor) is the same for every member of one family, so a list
// can be grouped by issue.
export async function ticketLinks(numbers, runQuery) {
  const wanted = [...new Set(numbers.map(n => String(n).toUpperCase()))].filter(n => TICKET_NUMBER.test(n)).slice(0, MAX_LINK_TICKETS);
  // Family sizes count only the tickets this person may see (teams.mjs), so each set has its own entries
  const cacheKey = n => `${runQuery.scopeKey ?? ''}|${n}`;
  const todo = wanted.filter(n => !linkCache.has(cacheKey(n)));
  if (todo.length) {
    const of = prefix => todo.filter(n => prefixOf(n) === prefix);
    const uniq = list => [...new Set(list.filter(Boolean))];
    const [incs, chgs, ritms, tasks, fixers] = await Promise.all([
      linkRows('INC', 'number', of('INC'), runQuery),
      linkRows('CHG', 'number', of('CHG'), runQuery),
      linkRows('RITM', 'number', of('RITM'), runQuery),
      linkRows('SCTASK', 'number', of('SCTASK'), runQuery),
      // Changes raised to fix these incidents
      linkRows('CHG', 'incident', of('INC'), runQuery),
    ]);
    const parentIncidents = uniq([...incs.map(t => t.parent_incident), ...incs.map(t => t.number)]);
    const problems = uniq([...incs, ...chgs].map(t => t.problem));
    const changes = uniq([...incs.map(t => t.caused_by_change), ...chgs.map(t => t.number), ...fixers.map(f => f.number)]);
    const orders = uniq(ritms.map(t => t.request));
    const bundles = uniq([...ritms.map(t => t.parent), ...ritms.map(t => t.number)]);
    const requestItems = uniq([...ritms.map(t => t.number), ...tasks.map(t => t.request_item)]);
    const [children, problemIncs, problemChgs, caused, orderSize, bundleSize, taskCount, changeRows] = await Promise.all([
      countBy('incident', 'parent_incident', parentIncidents, runQuery),
      countBy('incident', 'problem', problems, runQuery),
      countBy('change_request', 'problem', problems, runQuery),
      countBy('incident', 'caused_by_change', changes, runQuery),
      countBy('sc_req_item', 'request', orders, runQuery),
      countBy('sc_req_item', 'parent', bundles, runQuery),
      countBy('sc_task', 'request_item', requestItems, runQuery),
      linkRows('CHG', 'number', changes, runQuery),
    ]);
    const fixes = new Map(changeRows.map(c => [c.number, c.incident]));
    const family = (kind, anchor, name, size) => ({ key: `${kind}:${anchor}`, kind, anchor, name, size });
    const problemFamily = prb => family('problem', prb, `Problem ${prb}`, (problemIncs.get(prb) || 0) + (problemChgs.get(prb) || 0));
    // A change, the incident it fixes, and the incidents it caused
    const changeFamily = c => family('change', c, `Change ${c}`, 1 + (fixes.get(c) ? 1 : 0) + (caused.get(c) || 0));
    const found = new Map();

    for (const t of incs) {
      const families = [];
      const parent = t.parent_incident;
      if (parent) families.push(family('parent-incident', parent, `Parent incident ${parent}`, (children.get(parent) || 0) + 1));
      else if (children.get(t.number)) families.push(family('parent-incident', t.number, `Parent incident ${t.number}`, children.get(t.number) + 1));
      if (t.problem) families.push(problemFamily(t.problem));
      for (const c of uniq([t.caused_by_change, ...fixers.filter(f => f.incident === t.number).map(f => f.number)])) families.push(changeFamily(c));
      found.set(t.number, { parent, families });
    }
    for (const t of chgs) {
      const families = [];
      if (t.incident || caused.get(t.number)) families.push(changeFamily(t.number));
      if (t.problem) families.push(problemFamily(t.problem));
      found.set(t.number, { parent: '', families });
    }
    for (const t of ritms) {
      const families = [];
      if (t.parent) families.push(family('bundle', t.parent, `Bundle request ${t.parent}`, (bundleSize.get(t.parent) || 0) + 1));
      else if (bundleSize.get(t.number)) families.push(family('bundle', t.number, `Bundle request ${t.number}`, bundleSize.get(t.number) + 1));
      if (t.request && (orderSize.get(t.request) || 0) >= 2) families.push(family('order', t.request, `Order ${t.request}`, orderSize.get(t.request)));
      if (taskCount.get(t.number)) families.push(family('request-tasks', t.number, `Request ${t.number} and its tasks`, taskCount.get(t.number) + 1));
      // A child request's parent is its bundle request; otherwise its order (REQ)
      found.set(t.number, { parent: t.parent || t.request, families });
    }
    for (const t of tasks) {
      const families = t.request_item
        ? [family('request-tasks', t.request_item, `Request ${t.request_item} and its tasks`, (taskCount.get(t.request_item) || 0) + 1)] : [];
      found.set(t.number, { parent: t.request_item, families });
    }
    for (const n of todo) {
      linkCache.set(cacheKey(n), found.get(n) || { parent: '', families: [] });
      if (linkCache.size > LINK_CACHE_SIZE) linkCache.delete(linkCache.keys().next().value);
    }
  }
  return new Map(wanted.map(n => [n, linkCache.get(cacheKey(n))]));
}

// =====================================================================
// THE TICKET FAMILIES PAGE (the Dashboards tab): every family of one kind,
// biggest first, and one family with all its members. The lists come from
// one grouped count per kind and are kept (the data never changes).
// =====================================================================

export const FAMILY_KINDS = ['parent-incident', 'bundle-request', 'request-tasks', 'order', 'problem', 'change-incident'];
// What each kind's families are anchored on
export const FAMILY_ANCHOR = {
  'parent-incident': /^INC\d{7}$/, 'bundle-request': /^RITM\d{7}$/, 'request-tasks': /^RITM\d{7}$/,
  order: /^REQ\d{7}$/, problem: /^PRB\d{7}$/, 'change-incident': /^CHG\d{7}$/,
};
// ticketLinks names two kinds differently
export const LINK_KIND = { 'parent-incident': 'parent-incident', bundle: 'bundle-request', 'request-tasks': 'request-tasks', order: 'order', problem: 'problem', change: 'change-incident' };

// How many tickets of a type have each value in a link column (every value)
async function allCounts(cube, column, runQuery) {
  const rows = await runQuery({
    measures: [`${cube}.count`],
    dimensions: [`${cube}.${column}`],
    filters: [{ member: `${cube}.${column}`, operator: 'set' }],
    limit: 50000,
  });
  return new Map(rows.map(r => [clean(r[`${cube}.${column}`]), Number(r[`${cube}.count`]) || 0]).filter(([key]) => key));
}

// kind -> [{ anchor, children, size }], biggest first. children: the tickets
// besides the anchor (for an order or a problem, every ticket in it).
async function buildFamilyList(kind, runQuery) {
  const entries = map => [...map];
  let list = [];
  if (kind === 'parent-incident') list = entries(await allCounts('incident', 'parent_incident', runQuery)).map(([anchor, n]) => ({ anchor, children: n, size: n + 1 }));
  if (kind === 'bundle-request') list = entries(await allCounts('sc_req_item', 'parent', runQuery)).map(([anchor, n]) => ({ anchor, children: n, size: n + 1 }));
  if (kind === 'request-tasks') list = entries(await allCounts('sc_task', 'request_item', runQuery)).map(([anchor, n]) => ({ anchor, children: n, size: n + 1 }));
  if (kind === 'order') list = entries(await allCounts('sc_req_item', 'request', runQuery)).filter(([, n]) => n >= 2).map(([anchor, n]) => ({ anchor, children: n, size: n }));
  if (kind === 'problem') {
    const [incs, chgs] = await Promise.all([allCounts('incident', 'problem', runQuery), allCounts('change_request', 'problem', runQuery)]);
    list = [...new Set([...incs.keys(), ...chgs.keys()])].map(anchor => {
      const n = (incs.get(anchor) || 0) + (chgs.get(anchor) || 0);
      return { anchor, children: n, size: n };
    });
  }
  if (kind === 'change-incident') {
    const [fixRows, caused] = await Promise.all([
      runQuery({ dimensions: ['change_request.number', 'change_request.incident'], filters: [{ member: 'change_request.incident', operator: 'set' }], limit: 50000 }),
      allCounts('incident', 'caused_by_change', runQuery),
    ]);
    const fixes = new Set(fixRows.map(r => clean(r['change_request.number'])).filter(Boolean));
    list = [...new Set([...fixes, ...caused.keys()])].map(anchor => {
      const n = (fixes.has(anchor) ? 1 : 0) + (caused.get(anchor) || 0);
      return { anchor, children: n, size: n + 1 };
    });
  }
  return list.filter(f => FAMILY_ANCHOR[kind].test(f.anchor)).sort((a, b) => (b.size - a.size) || b.anchor.localeCompare(a.anchor));
}

// One set of lists per set of tickets someone may see (runQuery.scopeKey, teams.mjs)
const familyLists = new Map();
const FAMILY_LISTS_KEPT = 600;
export function familyList(kind, runQuery) {
  const key = `${runQuery.scopeKey ?? ''}|${kind}`;
  if (!familyLists.has(key)) {
    const pending = buildFamilyList(kind, runQuery);
    familyLists.set(key, pending);
    if (familyLists.size > FAMILY_LISTS_KEPT) familyLists.delete(familyLists.keys().next().value);
    pending.catch(() => familyLists.delete(key));
  }
  return familyLists.get(key);
}

// For the page's tabs: per kind, how many families and how many tickets they hold
export async function familySummary(runQuery) {
  const lists = await Promise.all(FAMILY_KINDS.map(kind => familyList(kind, runQuery)));
  return Object.fromEntries(FAMILY_KINDS.map((kind, i) => [kind, {
    families: lists[i].length,
    tickets: lists[i].reduce((sum, f) => sum + f.children, 0),
  }]));
}

// One family with every member, compared (the same shape as relatedFamilies'), or null
export async function familyOf(kind, anchor, runQuery) {
  if (!FAMILY_KINDS.includes(kind) || !FAMILY_ANCHOR[kind].test(anchor)) return null;
  const wanted = new Set([anchor]);
  const one = async (prefix, column) => (await queryTickets(prefix, [[column, [anchor]]], runQuery));
  if (kind === 'parent-incident') {
    const [parent, children] = await Promise.all([one('INC', 'number'), one('INC', 'parent_incident')]);
    return children.length ? parentIncidentFamily(anchor, parent[0], children, wanted) : null;
  }
  if (kind === 'bundle-request') {
    const [parent, children] = await Promise.all([one('RITM', 'number'), one('RITM', 'parent')]);
    return children.length ? bundleFamily(anchor, parent[0], children, wanted) : null;
  }
  if (kind === 'request-tasks') {
    const [request, tasks] = await Promise.all([one('RITM', 'number'), one('SCTASK', 'request_item')]);
    return tasks.length ? requestTasksFamily(anchor, request[0], tasks, wanted) : null;
  }
  if (kind === 'order') {
    const together = await one('RITM', 'request');
    return together.length ? orderFamily(anchor, together, wanted) : null;
  }
  if (kind === 'problem') {
    const [incidents, changes] = await Promise.all([one('INC', 'problem'), one('CHG', 'problem')]);
    return incidents.length + changes.length ? problemFamily(anchor, incidents, changes, wanted) : null;
  }
  const [change, caused] = await Promise.all([one('CHG', 'number'), one('INC', 'caused_by_change')]);
  const fixesNumber = change[0]?.fixesIncident;
  const fixes = fixesNumber ? (await queryTickets('INC', [['number', [fixesNumber]]], runQuery)) : [];
  const fixed = fixesNumber ? [fixes[0] || missing(fixesNumber, 'Incident')] : [];
  return fixed.length || caused.length ? changeFamily(anchor, change[0], fixed, caused, wanted) : null;
}
