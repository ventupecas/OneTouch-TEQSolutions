// =====================================================================
// TICKET LOOKUP: the home page's ticket search and the starred list.
// Every Cube query here is built by this file from numbers that matched
// TICKET_PATTERN, never from model output, so nothing unchecked reaches Cube.
// =====================================================================

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
