// =====================================================================
// CHARTS: the data behind the charts people build themselves (on their
// own dashboards and on Home), and behind AI answers shown as charts.
// A chart is a set of choices from CHART_SOURCES: which tickets to count,
// which ones to include, and what to group them by. Every Cube query here
// is built by this file from those choices (checked by sanitizeChart),
// never from text the browser sends, so nothing unchecked reaches Cube.
// =====================================================================

import { ENTITY_CATALOG } from './business_logic.mjs';
import { TICKET_KINDS, toTicket } from './tickets.mjs';

// What can be counted, per ticket type: `fields` group into categories and
// can also filter; `times` group by when (oldest first). `day` is the
// opened date the date range filters on; `opened` the full timestamp.
export const CHART_SOURCES = {
  incident: {
    label: 'Incidents', one: 'incident', many: 'incidents', day: 'created_day', opened: 'created', prefix: 'INC',
    fields: {
      priority: 'Priority', state: 'State', category: 'Category', subcategory: 'Subcategory',
      assignment_group: 'Team', assigned_to: 'Assigned to', contact_type: 'How it was reported',
      location: 'Location', configuration_item: 'System (CI)', impact: 'Impact', urgency: 'Urgency',
      close_code: 'How it was closed', cause_code: 'Cause', on_hold_reason: 'On-hold reason', was_p1: 'Was ever P1',
    },
    times: {
      created_day: 'Day opened', created_week: 'Week opened', created_month: 'Month opened',
      resolved_day: 'Day resolved', resolved_month: 'Month resolved',
    },
  },
  change_request: {
    label: 'Changes', one: 'change', many: 'changes', day: 'created_day', opened: 'created', prefix: 'CHG',
    fields: {
      risk: 'Risk', state: 'State', type: 'Type', sub_type: 'Sub-type', owner_group: 'Team',
      approval: 'Approval', environment: 'Environment', close_code: 'Outcome', failure_code: 'Failure reason',
      outage: 'Outage', configuration_item: 'System (CI)', requested_by: 'Requested by',
    },
    times: {
      created_day: 'Day opened', created_week: 'Week opened', created_month: 'Month opened',
      planned_start_month: 'Month planned to start',
    },
  },
  sc_req_item: {
    label: 'Requests', one: 'request', many: 'requests', day: 'opened_day', opened: 'opened', prefix: 'RITM',
    fields: { item: 'Catalog item', state: 'State', stage: 'Stage', approval: 'Approval', location: 'Location' },
    times: { opened_day: 'Day opened', opened_week: 'Week opened', opened_month: 'Month opened', closed_month: 'Month closed' },
  },
  sc_task: {
    label: 'Catalog tasks', one: 'catalog task', many: 'catalog tasks', day: 'created_day', opened: 'created', prefix: 'SCTASK',
    fields: { state: 'State', assignment_group: 'Team', assigned_to: 'Assigned to', item: 'Catalog item', sla_flag: 'SLA breached' },
    times: { created_day: 'Day opened', created_week: 'Week opened', created_month: 'Month opened' },
  },
};

// The team column, for a dashboard's "Team" filter (requests have no team)
export const TEAM_FIELDS = { incident: 'assignment_group', change_request: 'owner_group', sc_task: 'assignment_group' };

// The ways a chart can look and be cut; anything else falls back to the default
export const DISPLAYS = ['bar', 'hbar', 'line', 'area', 'donut', 'table', 'number'];
const SIZES = ['small', 'medium', 'large'];
const LIMITS = [5, 10, 15, 20, 30, 50];
const COLORS = ['accent', '1', '2', '3', '4', '5', '6', '7', '8'];
const STATUSES = ['all', 'open', 'closed'];
const DATE_PRESETS = ['all', '7', '30', '90', 'custom'];
// A condition: is one of the values, is none of them, or contains a word
const FILTER_OPS = ['equals', 'notEquals', 'contains'];
const MAX_FILTERS = 6;
const MAX_FILTER_VALUES = 50;
const MAX_SCOPE_TEAMS = 30;
// Plenty for any field (the biggest, people, has a few thousand); the tail beyond
// the chart's top N comes back as one "Other" count
const MAX_GROUPS = 5000;
// Day by day over the whole export is about 100 points
const MAX_TIME_POINTS = 400;
// The tickets behind one bar or slice: the newest this many are listed
export const MAX_DRILL_TICKETS = 200;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ChartError extends Error {}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function sanitizeDates(input) {
  const dates = input && typeof input === 'object' ? input : {};
  const preset = DATE_PRESETS.includes(String(dates.preset)) ? String(dates.preset) : 'all';
  if (preset !== 'custom') return { preset };
  let from = DAY.test(dates.from) ? dates.from : '';
  let to = DAY.test(dates.to) ? dates.to : '';
  if (from && to && from > to) [from, to] = [to, from];
  return { preset, from, to };
}

function sanitizeFilter(f, src) {
  if (!f || !src.fields[f.field]) return null;
  const op = FILTER_OPS.includes(f.op) ? f.op : 'equals';
  const list = Array.isArray(f.values) ? f.values : [];
  const values = op === 'contains'
    ? [...new Set(list.map(v => String(v).trim().slice(0, 100)).filter(Boolean))].slice(0, 10)
    : [...new Set(list.map(v => String(v).slice(0, 200)))].slice(0, MAX_FILTER_VALUES);
  return values.length ? { field: f.field, op, values } : null;
}

// Browser input -> a chart with every setting checked and filled in.
// Throws ChartError for what can't be a chart at all (an unknown ticket type).
export function sanitizeChart(input) {
  const c = input && typeof input === 'object' ? input : {};
  const src = CHART_SOURCES[c.source];
  if (!src) throw new ChartError('Choose what to count: incidents, changes, requests or catalog tasks.');
  const groupBy = typeof c.groupBy === 'string' && (src.fields[c.groupBy] || src.times[c.groupBy]) ? c.groupBy : '';

  const filters = [];
  for (const f of (Array.isArray(c.filters) ? c.filters : []).slice(0, MAX_FILTERS)) {
    const clean = sanitizeFilter(f, src);
    if (clean && !filters.some(g => g.field === clean.field)) filters.push(clean);
  }

  // One number needs nothing to group by; everything else does
  let display = DISPLAYS.includes(c.display) ? c.display : (groupBy ? 'bar' : 'number');
  if (!groupBy) display = 'number';

  return {
    id: typeof c.id === 'string' && ID.test(c.id) ? c.id : newId(),
    title: String(c.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    source: c.source,
    status: STATUSES.includes(c.status) ? c.status : 'all',
    dates: sanitizeDates(c.dates),
    filters,
    groupBy,
    display,
    limit: LIMITS.includes(Number(c.limit)) ? Number(c.limit) : 10,
    sort: c.sort === 'label' ? 'label' : 'count',
    size: SIZES.includes(c.size) ? c.size : 'medium',
    color: COLORS.includes(String(c.color)) ? String(c.color) : 'accent',
  };
}

// A dashboard's filter row, applied to every chart on it: when the tickets
// were opened, and which teams. -> { dates, teams }
export function sanitizeScope(input) {
  const s = input && typeof input === 'object' ? input : {};
  const teams = [...new Set((Array.isArray(s.teams) ? s.teams : []).map(t => String(t).slice(0, 200)).filter(Boolean))].slice(0, MAX_SCOPE_TEAMS);
  return { dates: sanitizeDates(s.dates), teams };
}

// ---------------------------------------------------------------------
// Results are cached: the data is a frozen export, so the same question
// always has the same answer (a server restart empties the cache). Each
// set of tickets someone may see (runQuery.scopeKey, teams.mjs) has its own.
// ---------------------------------------------------------------------

const CACHE_SIZE = 400;
const cache = new Map();

async function cached(runQuery, name, work) {
  const key = `${runQuery.scopeKey ?? ''}|${name}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit); // most recently used last
    return hit;
  }
  const pending = work();
  cache.set(key, pending);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  try {
    return await pending;
  } catch (error) {
    cache.delete(key); // try again next time
    throw error;
  }
}

// The first and last day each ticket type has (for "last 30 days" and the date pickers)
async function dataDays(cube, runQuery) {
  return cached(runQuery, `days:${cube}`, async () => {
    const member = `${cube}.${CHART_SOURCES[cube].day}`;
    const ends = await Promise.all(['asc', 'desc'].map(direction => runQuery({
      dimensions: [member],
      filters: [{ member, operator: 'set' }],
      order: { [member]: direction },
      limit: 1,
    })));
    return { first: ends[0][0]?.[member] || '', last: ends[1][0]?.[member] || '' };
  });
}

// '2026-09-01' minus 29 days -> '2026-08-03'
function daysBefore(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// A date range as Cube filters on the opened day
async function dateFilters(cube, dates, runQuery) {
  const day = `${cube}.${CHART_SOURCES[cube].day}`;
  if (dates.preset === 'custom') {
    return [
      ...(dates.from ? [{ member: day, operator: 'gte', values: [dates.from] }] : []),
      ...(dates.to ? [{ member: day, operator: 'lte', values: [dates.to] }] : []),
    ];
  }
  if (dates.preset === 'all') return [];
  // "Last 30 days" of the export, counting back from its newest day
  const { last } = await dataDays(cube, runQuery);
  return last ? [{ member: day, operator: 'gte', values: [daysBefore(last, Number(dates.preset) - 1)] }] : [];
}

// The chart's "which ones" (and its dashboard's filter row) as Cube filters.
// -> { filters, skipped: ['team'] when the dashboard's team filter can't apply }
async function cubeFilters(chart, runQuery, scope = sanitizeScope()) {
  const cube = chart.source;
  const filters = [];
  if (chart.status !== 'all') {
    const states = chart.status === 'open' ? ENTITY_CATALOG[cube].openStates : ENTITY_CATALOG[cube].closedStates;
    filters.push({ member: `${cube}.state`, operator: 'equals', values: states });
  }
  for (const f of chart.filters) filters.push({ member: `${cube}.${f.field}`, operator: f.op, values: f.values });
  filters.push(...await dateFilters(cube, chart.dates, runQuery));
  filters.push(...await dateFilters(cube, scope.dates, runQuery));
  const skipped = [];
  if (scope.teams.length) {
    if (TEAM_FIELDS[cube]) filters.push({ member: `${cube}.${TEAM_FIELDS[cube]}`, operator: 'equals', values: scope.teams });
    else skipped.push('team');
  }
  return { filters, skipped };
}

// No value, or the export's placeholder for "no system": both show as "(Not set)"
function cleanValue(field, value) {
  if (value === null || value === undefined || value === '') return null;
  if (field === 'configuration_item' && value === 'zzz') return null;
  return String(value);
}

// The order a field's values naturally go in (P1 before P2, New before Closed)
function naturalOrder(cube, field) {
  const known = ENTITY_CATALOG[cube]?.enums?.[field] || [];
  return (a, b) => {
    if (a.value === null || b.value === null) return a.value === null ? 1 : -1;
    const ia = known.indexOf(a.value), ib = known.indexOf(b.value);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    return a.value.localeCompare(b.value, 'en', { numeric: true, sensitivity: 'base' });
  };
}

// chart (+ its dashboard's filter row) -> { chart, total, rows: [{ value, count }],
// other: { count, groups } | null, days, skipped }. rows: for a time grouping every
// period, oldest first; otherwise the chart's top N by count, in the chart's order,
// with the rest as one "other" count.
export async function chartData(input, runQuery, scopeInput) {
  const chart = sanitizeChart(input);
  const scope = sanitizeScope(scopeInput);
  const cube = chart.source;
  const count = `${cube}.count`;
  const { filters, skipped } = await cubeFilters(chart, runQuery, scope);
  const days = await dataDays(cube, runQuery);

  if (!chart.groupBy) {
    const total = await cached(runQuery, JSON.stringify(['total', cube, filters]), async () => {
      const rows = await runQuery({ measures: [count], filters });
      return Number(rows[0]?.[count]) || 0;
    });
    return { chart, total, rows: [], other: null, days, skipped };
  }

  const member = `${cube}.${chart.groupBy}`;
  const isTime = Boolean(CHART_SOURCES[cube].times[chart.groupBy]);
  const groups = await cached(runQuery, JSON.stringify(['groups', cube, chart.groupBy, filters]), async () => {
    const rows = await runQuery({
      measures: [count],
      dimensions: [member],
      filters,
      order: isTime ? { [member]: 'asc' } : { [count]: 'desc' },
      limit: isTime ? MAX_TIME_POINTS : MAX_GROUPS,
    });
    // Merge what shows the same ("(Not set)" can be several raw values)
    const merged = new Map();
    for (const r of rows) {
      const value = cleanValue(chart.groupBy, r[member]);
      merged.set(value, (merged.get(value) || 0) + (Number(r[count]) || 0));
    }
    const list = [...merged].map(([value, n]) => ({ value, count: n }));
    if (isTime) return list.filter(g => g.value !== null); // tickets with no date aren't a point in time
    return list.sort((a, b) => b.count - a.count);
  });

  const total = groups.reduce((sum, g) => sum + g.count, 0);
  if (isTime) return { chart, total, rows: groups, other: null, days, skipped };

  const top = groups.slice(0, chart.limit);
  const rest = groups.slice(chart.limit);
  if (chart.sort === 'label') top.sort(naturalOrder(cube, chart.groupBy));
  const other = rest.length ? { count: rest.reduce((sum, g) => sum + g.count, 0), groups: rest.length } : null;
  return { chart, total, rows: top, other, days, skipped };
}

// The tickets behind one bar, slice or point (value: that group's value; null
// for "(Not set)"), or behind a one-number chart (no grouping): how many
// there are, and the newest MAX_DRILL_TICKETS as ticket summaries
export async function chartTickets(input, value, runQuery, scopeInput) {
  const chart = sanitizeChart(input);
  const scope = sanitizeScope(scopeInput);
  const cube = chart.source;
  const src = CHART_SOURCES[cube];
  const { filters } = await cubeFilters(chart, runQuery, scope);
  if (chart.groupBy) {
    const member = `${cube}.${chart.groupBy}`;
    if (value === null || value === undefined) {
      filters.push(chart.groupBy === 'configuration_item'
        ? { or: [{ member, operator: 'notSet' }, { member, operator: 'equals', values: ['zzz'] }] }
        : { member, operator: 'notSet' });
    } else {
      filters.push({ member, operator: 'equals', values: [String(value).slice(0, 200)] });
    }
  }
  const kind = TICKET_KINDS[src.prefix];
  const dimensions = [...new Set(['number', ...Object.values(kind.fields)])].map(c => `${cube}.${c}`);
  const [totalRows, rows] = await Promise.all([
    runQuery({ measures: [`${cube}.count`], filters }),
    runQuery({ dimensions, filters, order: { [`${cube}.${src.opened}`]: 'desc' }, limit: MAX_DRILL_TICKETS }),
  ]);
  return { chart, total: Number(totalRows[0]?.[`${cube}.count`]) || 0, tickets: rows.map(r => toTicket(src.prefix, r)) };
}

// The values a filter can pick from, most common first: [{ value, count }]
export async function chartValues(source, field, runQuery) {
  const src = CHART_SOURCES[source];
  if (!src || !src.fields[field]) throw new ChartError('That field cannot be used as a filter.');
  const member = `${source}.${field}`;
  const count = `${source}.count`;
  return cached(runQuery, JSON.stringify(['values', source, field]), async () => {
    const rows = await runQuery({ measures: [count], dimensions: [member], order: { [count]: 'desc' }, limit: 500 });
    return rows
      .map(r => ({ value: cleanValue(field, r[member]), count: Number(r[count]) || 0 }))
      .filter(v => v.value !== null);
  });
}

// Every team, across incidents, changes and catalog tasks, busiest first
export async function teamValues(runQuery) {
  return cached(runQuery, 'teams', async () => {
    const lists = await Promise.all(Object.entries(TEAM_FIELDS).map(([source, field]) => chartValues(source, field, runQuery)));
    const merged = new Map();
    for (const list of lists) for (const v of list) merged.set(v.value, (merged.get(v.value) || 0) + v.count);
    return [...merged].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  });
}

// What the chart builder offers, with each ticket type's open / closed
// states and the dates its data covers
export async function chartCatalog(runQuery) {
  const sources = {};
  for (const [key, src] of Object.entries(CHART_SOURCES)) {
    sources[key] = {
      label: src.label, one: src.one, many: src.many,
      fields: Object.entries(src.fields),
      times: Object.entries(src.times),
      openStates: ENTITY_CATALOG[key].openStates,
      closedStates: ENTITY_CATALOG[key].closedStates,
      hasTeam: Boolean(TEAM_FIELDS[key]),
      days: await dataDays(key, runQuery),
    };
  }
  return { sources };
}

// ---------------------------------------------------------------------
// AI answers as charts: a validated Cube query that counts one ticket type
// by one field becomes a chart. Conditions a chart can't hold are listed
// in plain English (`dropped`), so the page can say what didn't carry over.
// ---------------------------------------------------------------------

const OP_WORDS = {
  equals: 'is', notEquals: 'is not', contains: 'contains', notContains: 'does not contain',
  startsWith: 'starts with', endsWith: 'ends with', set: 'has a value', notSet: 'is empty',
  gt: 'is after', gte: 'is on or after', lt: 'is before', lte: 'is on or before',
};

const sameSet = (a, b) => a.length === b.length && a.every(v => b.includes(v));

function dayBefore(day) {
  return daysBefore(day, 1);
}

// cube query -> { chart, dropped } or null when it isn't a count by one field
export function chartFromQuery(entity, query) {
  const src = CHART_SOURCES[entity];
  if (!src || !query) return null;
  const dimensions = query.dimensions || [];
  const measures = query.measures || [];
  if (dimensions.length !== 1 || measures.length !== 1 || measures[0] !== `${entity}.count`) return null;
  const groupBy = dimensions[0].slice(entity.length + 1);
  if (!src.fields[groupBy] && !src.times[groupBy]) return null;
  const isTime = Boolean(src.times[groupBy]);

  const label = field => src.fields[field] || src.times[field] || field.replace(/_/g, ' ');
  const chart = { source: entity, groupBy, display: isTime ? 'line' : 'bar', status: 'all', filters: [], sort: isTime ? 'label' : 'count' };
  const dropped = [];
  let from = '', to = '';
  for (const f of query.filters || []) {
    if (!f.member) { dropped.push('a combined "or / and" condition'); continue; }
    const field = f.member.slice(entity.length + 1);
    const values = (f.values || []).map(String);
    if (field === 'state' && f.operator === 'equals' && sameSet(values, ENTITY_CATALOG[entity].openStates)) { chart.status = 'open'; continue; }
    if (field === 'state' && f.operator === 'equals' && sameSet(values, ENTITY_CATALOG[entity].closedStates)) { chart.status = 'closed'; continue; }
    if (src.fields[field] && FILTER_OPS.includes(f.operator) && values.length && !chart.filters.some(g => g.field === field)) {
      chart.filters.push({ field, op: f.operator, values });
      continue;
    }
    // A range on the opened date (the timestamp or its day)
    if ([src.opened, src.day].includes(field) && ['gte', 'gt', 'lt', 'lte'].includes(f.operator) && DAY.test(String(values[0]).slice(0, 10))) {
      const day = values[0].slice(0, 10);
      if (f.operator === 'gte' || f.operator === 'gt') from = day;
      else to = f.operator === 'lt' ? dayBefore(day) : day;
      continue;
    }
    const shown = values.length > 3 ? `${values.slice(0, 3).join(', ')} and ${values.length - 3} more` : values.join(', ');
    dropped.push(`${label(field)} ${OP_WORDS[f.operator] || f.operator}${shown ? ` ${shown}` : ''}`);
  }
  if (from || to) chart.dates = { preset: 'custom', from, to };
  // Sorted by the field itself (A to Z, P1 first) rather than by the count
  const order = Array.isArray(query.order) ? query.order.map(o => o?.member ?? o?.[0]) : Object.keys(query.order || {});
  if (!isTime && order[0] === dimensions[0]) chart.sort = 'label';
  // The answer's "top N", as the nearest a chart offers
  const limit = Number(query.limit) || 0;
  if (!isTime && limit) chart.limit = LIMITS.find(n => n >= limit) || 50;
  return { chart: sanitizeChart(chart), dropped };
}
