// =====================================================================
// CHARTS: the data behind the charts people build themselves (on their
// own dashboards and on Home). A chart is a set of choices from
// CHART_SOURCES: which tickets to count, which ones to include, and what
// to group them by. Every Cube query here is built by this file from
// those choices (checked by sanitizeChart), never from text the browser
// sends, so nothing unchecked reaches Cube.
// =====================================================================

import { ENTITY_CATALOG } from './business_logic.mjs';

// What can be counted, per ticket type: `fields` group into categories and
// can also filter; `times` group by when (oldest first). `day` is the
// opened date the date range filters on.
export const CHART_SOURCES = {
  incident: {
    label: 'Incidents', one: 'incident', many: 'incidents', day: 'created_day',
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
    label: 'Changes', one: 'change', many: 'changes', day: 'created_day',
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
    label: 'Requests', one: 'request', many: 'requests', day: 'opened_day',
    fields: { item: 'Catalog item', state: 'State', stage: 'Stage', approval: 'Approval', location: 'Location' },
    times: { opened_day: 'Day opened', opened_week: 'Week opened', opened_month: 'Month opened', closed_month: 'Month closed' },
  },
  sc_task: {
    label: 'Catalog tasks', one: 'catalog task', many: 'catalog tasks', day: 'created_day',
    fields: { state: 'State', assignment_group: 'Team', assigned_to: 'Assigned to', item: 'Catalog item', sla_flag: 'SLA breached' },
    times: { created_day: 'Day opened', created_week: 'Week opened', created_month: 'Month opened' },
  },
};

// The ways a chart can look and be cut; anything else falls back to the default
export const DISPLAYS = ['bar', 'hbar', 'line', 'area', 'donut', 'table', 'number'];
const SIZES = ['small', 'medium', 'large'];
const LIMITS = [5, 10, 15, 20, 30, 50];
const COLORS = ['accent', '1', '2', '3', '4', '5', '6', '7', '8'];
const STATUSES = ['all', 'open', 'closed'];
const DATE_PRESETS = ['all', '7', '30', '90', 'custom'];
const MAX_FILTERS = 6;
const MAX_FILTER_VALUES = 50;
// Plenty for any field (the biggest, people, has a few thousand); the tail beyond
// the chart's top N comes back as one "Other" count
const MAX_GROUPS = 5000;
// Day by day over the whole export is about 100 points
const MAX_TIME_POINTS = 400;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ChartError extends Error {}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
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
    if (!f || !src.fields[f.field] || filters.some(g => g.field === f.field)) continue;
    const values = [...new Set((Array.isArray(f.values) ? f.values : []).map(v => String(v).slice(0, 200)))].slice(0, MAX_FILTER_VALUES);
    if (values.length) filters.push({ field: f.field, values });
  }

  const dates = c.dates && typeof c.dates === 'object' ? c.dates : {};
  const preset = DATE_PRESETS.includes(String(dates.preset)) ? String(dates.preset) : 'all';
  let from = DAY.test(dates.from) ? dates.from : '';
  let to = DAY.test(dates.to) ? dates.to : '';
  if (from && to && from > to) [from, to] = [to, from];

  // One number needs nothing to group by; everything else does
  let display = DISPLAYS.includes(c.display) ? c.display : (groupBy ? 'bar' : 'number');
  if (!groupBy) display = 'number';

  return {
    id: ID.test(c.id) ? c.id : newId(),
    title: String(c.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    source: c.source,
    status: STATUSES.includes(c.status) ? c.status : 'all',
    dates: preset === 'custom' ? { preset, from, to } : { preset },
    filters,
    groupBy,
    display,
    limit: LIMITS.includes(Number(c.limit)) ? Number(c.limit) : 10,
    sort: c.sort === 'label' ? 'label' : 'count',
    size: SIZES.includes(c.size) ? c.size : 'medium',
    color: COLORS.includes(String(c.color)) ? String(c.color) : 'accent',
  };
}

// ---------------------------------------------------------------------
// Results are cached: the data is a frozen export, so the same question
// always has the same answer (a server restart empties the cache)
// ---------------------------------------------------------------------

const CACHE_SIZE = 400;
const cache = new Map();

async function cached(key, work) {
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
  return cached(`days:${cube}`, async () => {
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

// The chart's "which ones" as Cube filters
async function cubeFilters(chart, runQuery) {
  const cube = chart.source;
  const filters = [];
  if (chart.status !== 'all') {
    const states = chart.status === 'open' ? ENTITY_CATALOG[cube].openStates : ENTITY_CATALOG[cube].closedStates;
    filters.push({ member: `${cube}.state`, operator: 'equals', values: states });
  }
  for (const f of chart.filters) filters.push({ member: `${cube}.${f.field}`, operator: 'equals', values: f.values });

  const day = `${cube}.${CHART_SOURCES[cube].day}`;
  const { preset } = chart.dates;
  if (preset === 'custom') {
    if (chart.dates.from) filters.push({ member: day, operator: 'gte', values: [chart.dates.from] });
    if (chart.dates.to) filters.push({ member: day, operator: 'lte', values: [chart.dates.to] });
  } else if (preset !== 'all') {
    // "Last 30 days" of the export, counting back from its newest day
    const { last } = await dataDays(cube, runQuery);
    if (last) filters.push({ member: day, operator: 'gte', values: [daysBefore(last, Number(preset) - 1)] });
  }
  return filters;
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

// chart -> { chart, total, rows: [{ value, count }], other: { count, groups } | null, days }
// rows: for a time grouping every period, oldest first; otherwise the chart's
// top N by count, in the chart's order, with the rest as one "other" count.
export async function chartData(input, runQuery) {
  const chart = sanitizeChart(input);
  const cube = chart.source;
  const count = `${cube}.count`;
  const filters = await cubeFilters(chart, runQuery);
  const days = await dataDays(cube, runQuery);

  if (!chart.groupBy) {
    const total = await cached(JSON.stringify(['total', cube, filters]), async () => {
      const rows = await runQuery({ measures: [count], filters });
      return Number(rows[0]?.[count]) || 0;
    });
    return { chart, total, rows: [], other: null, days };
  }

  const member = `${cube}.${chart.groupBy}`;
  const isTime = Boolean(CHART_SOURCES[cube].times[chart.groupBy]);
  const groups = await cached(JSON.stringify(['groups', cube, chart.groupBy, filters]), async () => {
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
  if (isTime) return { chart, total, rows: groups, other: null, days };

  const top = groups.slice(0, chart.limit);
  const rest = groups.slice(chart.limit);
  if (chart.sort === 'label') top.sort(naturalOrder(cube, chart.groupBy));
  const other = rest.length ? { count: rest.reduce((sum, g) => sum + g.count, 0), groups: rest.length } : null;
  return { chart, total, rows: top, other, days };
}

// The values a filter can pick from, most common first: [{ value, count }]
export async function chartValues(source, field, runQuery) {
  const src = CHART_SOURCES[source];
  if (!src || !src.fields[field]) throw new ChartError('That field cannot be used as a filter.');
  const member = `${source}.${field}`;
  const count = `${source}.count`;
  return cached(JSON.stringify(['values', source, field]), async () => {
    const rows = await runQuery({ measures: [count], dimensions: [member], order: { [count]: 'desc' }, limit: 500 });
    return rows
      .map(r => ({ value: cleanValue(field, r[member]), count: Number(r[count]) || 0 }))
      .filter(v => v.value !== null);
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
      days: await dataDays(key, runQuery),
    };
  }
  return { sources };
}
