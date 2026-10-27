// =====================================================================
// TICKET LOOKUP: the home page's ticket search and the starred list.
// Every Cube query here is built by this file from numbers that matched
// TICKET_PATTERN, never from model output, so nothing unchecked reaches Cube.
// =====================================================================

import { createHash } from 'node:crypto';
import { ENTITY_CATALOG } from './business_logic.mjs';

// What each prefix is, which cube holds it, and which of its columns fill
// the summary table (summary / state / level / team / person / opened)
export const TICKET_KINDS = {
  INC: {
    cube: 'incident', label: 'Incident',
    fields: { summary: 'short_description', state: 'state', level: 'priority', team: 'assignment_group', person: 'assigned_to', opened: 'created' },
    lead: ['number', 'short_description', 'state', 'priority', 'assignment_group', 'assigned_to', 'created', 'resolved', 'closed', 'configuration_item', 'location', 'category', 'subcategory', 'contact_type'],
  },
  CHG: {
    cube: 'change_request', label: 'Change',
    fields: { summary: 'short_description', state: 'state', level: 'risk', team: 'owner_group', person: 'requested_by', opened: 'created' },
    lead: ['number', 'short_description', 'state', 'type', 'risk', 'approval', 'owner_group', 'requested_by', 'created', 'planned_start_date', 'planned_end_date', 'configuration_item', 'environment'],
  },
  RITM: {
    cube: 'sc_req_item', label: 'Request',
    // Requests have no team or priority; the catalog item stands in for a missing summary
    fields: { summary: 'short_description', item: 'item', state: 'state', person: 'requested_for', opened: 'opened', parent: 'request' },
    lead: ['number', 'short_description', 'item', 'state', 'stage', 'approval', 'requested_for', 'opened_by', 'opened', 'closed', 'request', 'location'],
  },
  SCTASK: {
    cube: 'sc_task', label: 'Catalog task',
    fields: { summary: 'short_description', state: 'state', team: 'assignment_group', person: 'assigned_to', opened: 'created', parent: 'request_item' },
    lead: ['number', 'short_description', 'state', 'assignment_group', 'assigned_to', 'created', 'sla_flag', 'request_item', 'request', 'item'],
  },
};

// A REQ is an order: searching one brings up the requests (RITMs) inside it
const ORDER_PREFIX = 'REQ';

// "INC1814467", "inc 1814467", "CHG-1100215", or a bare "1814467" (tried as every type)
const TICKET_PATTERN = /\b(INC|CHG|RITM|SCTASK|REQ)?[\s-]?(\d{7})\b/gi;
// What can be starred: one ticket, not an order
export const STARRABLE = /^(INC|CHG|RITM|SCTASK)\d{7}$/;

export const MAX_SEARCH_NUMBERS = 200;

// Text -> { wanted: [{ input, candidates }], ignored: [words that aren't ticket numbers] }
export function parseTicketNumbers(text) {
  const wanted = [];
  const seen = new Set();
  for (const [, prefix, digits] of String(text).matchAll(TICKET_PATTERN)) {
    const input = prefix ? prefix.toUpperCase() + digits : digits;
    if (seen.has(input)) continue;
    seen.add(input);
    const prefixes = prefix ? [prefix.toUpperCase()] : [...Object.keys(TICKET_KINDS), ORDER_PREFIX];
    wanted.push({ input, candidates: prefixes.map(p => p + digits) });
  }
  const ignored = String(text).replace(TICKET_PATTERN, ' ').split(/[\s,;|]+/).filter(w => /[a-z0-9]/i.test(w));
  return { wanted, ignored: [...new Set(ignored)].slice(0, 20) };
}

export const prefixOf = number => number.match(/^[A-Z]+/)[0];

// One Cube row -> the summary the ticket tables show (also used by relations.mjs)
export function toTicket(prefix, row) {
  const { cube, label, fields } = TICKET_KINDS[prefix];
  const value = key => (fields[key] ? row[`${cube}.${fields[key]}`] ?? '' : '');
  return {
    number: row[`${cube}.number`],
    kind: prefix,
    type: label,
    summary: value('summary') || value('item'),
    state: value('state'),
    level: value('level'),
    team: value('team'),
    person: value('person'),
    opened: value('opened'),
    parent: value('parent'),
  };
}

// The summary rows for some numbers of one type (or the RITMs of some REQs)
async function lookUp(prefix, numbers, runQuery) {
  const kind = TICKET_KINDS[prefix === ORDER_PREFIX ? 'RITM' : prefix];
  const filterColumn = prefix === ORDER_PREFIX ? 'request' : 'number';
  const dimensions = [...new Set(['number', ...Object.values(kind.fields)])].map(c => `${kind.cube}.${c}`);
  const rows = await runQuery({
    dimensions,
    filters: [{ member: `${kind.cube}.${filterColumn}`, operator: 'equals', values: numbers }],
    order: { [`${kind.cube}.number`]: 'asc' },
    limit: 5000,
  });
  return rows.map(r => toTicket(prefix === ORDER_PREFIX ? 'RITM' : prefix, r));
}

// Text with ticket numbers -> the tickets found, in the order they were asked for.
// -> { found: [ticket], notFound: [input], ignored: [word], tooMany: bool }
export async function findTickets(text, runQuery) {
  const parsed = parseTicketNumbers(text);
  const wanted = parsed.wanted.slice(0, MAX_SEARCH_NUMBERS);

  const byPrefix = new Map();
  for (const w of wanted) {
    for (const n of w.candidates) {
      const p = prefixOf(n);
      if (!byPrefix.has(p)) byPrefix.set(p, []);
      byPrefix.get(p).push(n);
    }
  }
  const looked = await Promise.all([...byPrefix].map(async ([p, numbers]) => [p, await lookUp(p, numbers, runQuery)]));

  const byNumber = new Map();
  const byOrder = new Map();
  for (const [p, tickets] of looked) {
    for (const t of tickets) {
      if (p === ORDER_PREFIX) {
        if (!byOrder.has(t.parent)) byOrder.set(t.parent, []);
        byOrder.get(t.parent).push(t);
      } else {
        byNumber.set(t.number, t);
      }
    }
  }

  const found = [];
  const notFound = [];
  const listed = new Set();
  for (const w of wanted) {
    const hits = w.candidates.flatMap(n => byNumber.get(n) || byOrder.get(n) || []);
    if (!hits.length) notFound.push(w.input);
    for (const t of hits) {
      if (listed.has(t.number)) continue;
      listed.add(t.number);
      found.push(t);
    }
  }
  return { found, notFound, ignored: parsed.ignored, tooMany: parsed.wanted.length > MAX_SEARCH_NUMBERS };
}

// Summaries for a list of exact ticket numbers (e.g. everything someone has
// been shown), without the search's 200-number limit -> Map(number -> ticket)
export async function ticketSummaries(numbers, runQuery) {
  const byPrefix = new Map();
  for (const n of new Set(numbers)) {
    if (!STARRABLE.test(n)) continue;
    const p = prefixOf(n);
    if (!byPrefix.has(p)) byPrefix.set(p, []);
    byPrefix.get(p).push(n);
  }
  const looked = await Promise.all([...byPrefix].map(([p, list]) => lookUp(p, list, runQuery)));
  return new Map(looked.flat().map(t => [t.number, t]));
}

// ---------------------------------------------------------------------
// ASSIGNED TO ME (Home): someone's OneTouch tickets, most urgent first. Only
// incidents have a priority (P1-P4); a change's risk stands in for it, as the
// "Priority / Risk" column already does. Requests and catalog tasks have
// neither, so they come after everything that has one. The same priority:
// the oldest first.
// ---------------------------------------------------------------------

const RISK_RANK = { High: 2, Medium: 3, Low: 4, Standard: 4 };
const NO_PRIORITY = 5;
export function priorityRank(t) {
  if (t.kind === 'INC') return Number((/^P([1-4])\b/.exec(t.level) || [])[1]) || NO_PRIORITY;
  if (t.kind === 'CHG') return RISK_RANK[t.level] ?? NO_PRIORITY;
  return NO_PRIORITY;
}

const OPEN_STATES = Object.fromEntries(Object.entries(TICKET_KINDS)
  .map(([prefix, kind]) => [prefix, new Set(ENTITY_CATALOG[kind.cube].openStates)]));
export const isOpen = t => OPEN_STATES[t.kind]?.has(t.state) ?? false;

// The data is frozen, so one list of numbers always sorts the same: kept
// (newest 200), keyed by the numbers and who's asking
const sortedLists = new Map();
// numbers -> [ticket + { open, rank }], most urgent first
export function ticketsByPriority(numbers, runQuery) {
  const key = `${runQuery.scopeKey}:${createHash('sha256').update(numbers.join(',')).digest('hex')}`;
  if (sortedLists.has(key)) return sortedLists.get(key);
  const sorted = ticketSummaries(numbers, runQuery).then(found => [...found.values()]
    .map(t => ({ ...t, open: isOpen(t), rank: priorityRank(t) }))
    .sort((a, b) => a.rank - b.rank
      || (a.opened ? 0 : 1) - (b.opened ? 0 : 1)
      || String(a.opened).localeCompare(String(b.opened))
      || a.number.localeCompare(b.number)));
  sorted.catch(() => sortedLists.delete(key));
  sortedLists.set(key, sorted);
  if (sortedLists.size > 200) sortedLists.delete(sortedLists.keys().next().value);
  return sorted;
}

// ---------------------------------------------------------------------
// SORTING long lists by any column (the Team tab's tickets, the Families
// page): every ticket's summary, read from Cube once (the data is frozen),
// so thousands of tickets sort without asking Cube again. It only ever
// orders tickets someone may already see; what they're shown still comes
// from their own queries.
// ---------------------------------------------------------------------

const INDEX_MAX_ROWS = 50000;
let ticketIndex = null; // Promise of Map(number -> ticket summary)

export function loadTicketIndex(runCubeQuery) {
  if (!ticketIndex) {
    ticketIndex = (async () => {
      const index = new Map();
      for (const [prefix, kind] of Object.entries(TICKET_KINDS)) {
        const dimensions = [...new Set(['number', ...Object.values(kind.fields)])].map(c => `${kind.cube}.${c}`);
        const rows = await runCubeQuery({ dimensions, limit: INDEX_MAX_ROWS });
        if (rows.length >= INDEX_MAX_ROWS) throw new Error(`${kind.cube} has ${INDEX_MAX_ROWS.toLocaleString()} tickets or more; tickets.mjs indexes at most that many`);
        for (const row of rows) {
          const t = toTicket(prefix, row);
          index.set(t.number, t);
        }
      }
      return index;
    })();
    ticketIndex.catch(() => { ticketIndex = null; }); // try again next time
  }
  return ticketIndex;
}

// What a ticket sorts by in each column people can sort (Priority / Risk by
// how urgent, as Assigned to me; requests and tasks have neither, so none)
export const TICKET_SORTS = {
  number: t => t.number,
  type: t => t.type,
  summary: t => t.summary,
  state: t => t.state,
  level: t => (t.level ? priorityRank(t) : null),
  team: t => t.team,
  person: t => t.person,
  opened: t => t.opened,
};

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// rows sorted by valueOf(row): numbers as numbers, text A to Z ('P2' before
// 'P10'). dir: 'asc' | 'desc'. Rows with no value (null or '') come last
// either way, and ties keep the order they came in.
export function sortRows(rows, valueOf, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  const empty = v => v === null || v === undefined || v === '';
  return rows
    .map((row, i) => ({ row, i, v: valueOf(row) }))
    .sort((a, b) => {
      if (empty(a.v) || empty(b.v)) return (empty(a.v) - empty(b.v)) || a.i - b.i;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return sign * c || a.i - b.i;
    })
    .map(k => k.row);
}

// The ticket numbers anywhere in a set of result rows, in the order they appear
export function ticketNumbersIn(rows) {
  const found = new Set();
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === 'string' && STARRABLE.test(value)) found.add(value);
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------
// One ticket's full record: every column its cube has, leading with the
// ones people look at first, and leaving out the empty ones
// ---------------------------------------------------------------------

let cubeColumns = null; // Promise<Map<cube, [member]>>, from Cube's /meta

function loadCubeColumns(cubeUrl, token) {
  if (!cubeColumns) {
    cubeColumns = (async () => {
      const response = await fetch(cubeUrl.replace(/\/load$/, '/meta'), { headers: { Authorization: token } });
      if (!response.ok) throw new Error(`Cube /meta answered ${response.status}`);
      const { cubes } = await response.json();
      return new Map(cubes.map(c => [c.name, c.dimensions.map(d => d.name)
        // created_day / opened_week / planned_start_month repeat a date already shown in full
        .filter(name => !/_(day|week|month)$/.test(name))]));
    })();
    cubeColumns.catch(() => { cubeColumns = null; }); // try again next time
  }
  return cubeColumns;
}

export async function ticketRecord(number, runQuery, { cubeUrl, token }) {
  const prefix = prefixOf(number);
  const kind = TICKET_KINDS[prefix];
  if (!kind) return null;
  const members = (await loadCubeColumns(cubeUrl, token)).get(kind.cube) || [];
  const lead = kind.lead.map(c => `${kind.cube}.${c}`).filter(m => members.includes(m));
  const ordered = [...lead, ...members.filter(m => !lead.includes(m))];

  const [row] = await runQuery({
    dimensions: ordered,
    filters: [{ member: `${kind.cube}.number`, operator: 'equals', values: [number] }],
    limit: 1,
  });
  if (!row) return null;
  const fields = {};
  for (const m of ordered) {
    const v = row[m];
    if (v !== null && v !== undefined && String(v).trim() !== '') fields[m] = v;
  }
  return { cube: kind.cube, fields };
}
