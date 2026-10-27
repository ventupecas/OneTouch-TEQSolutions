// =====================================================================
// KPIs: how each ticket and each ticket family is doing. Home's "Assigned
// to me" shows each of someone's tickets' KPIs; a project manager's "Team
// families" shows each of their team's families' (a family being the linked
// group teams.mjs gives to one team). Who may see which is checked in
// server.mjs: a ticket's only by someone who may see the ticket, a family's
// only by its team's project manager or an admin.
//
// Worked out here from every ticket's fields, read from Cube once (the data
// is a frozen snapshot). "Now" is the newest timestamp in the data, as in
// the reporting views (reporting.data_as_of), so ages don't grow with the
// calendar. "Typical" is the median of every ticket of the same kind.
//
// A KPI: { key, label, value, tone, detail }. tone: good | warn | bad | info.
// =====================================================================

import { ENTITY_CATALOG } from './business_logic.mjs';
import { sortRows } from './tickets.mjs';

// The fields each ticket type's KPIs need (a fixed query: nobody's input reaches it)
const SOURCES = {
  INC: { cube: 'incident', fields: ['number', 'created', 'resolved', 'closed', 'updated', 'state', 'priority', 'reassignment_count', 'reopen_count', 'was_p1', 'breach_reason', 'close_code', 'caused_by_change', 'problem'] },
  CHG: { cube: 'change_request', fields: ['number', 'created', 'planned_start_date', 'planned_end_date', 'state', 'type', 'risk', 'approval', 'close_code', 'failure_code', 'outage'] },
  RITM: { cube: 'sc_req_item', fields: ['number', 'opened', 'closed', 'fulfilled_time', 'updated', 'state', 'approval'] },
  SCTASK: { cube: 'sc_task', fields: ['number', 'created', 'updated', 'state', 'sla_flag'] },
};
const KIND_NAMES = { INC: ['incident', 'incidents'], CHG: ['change', 'changes'], RITM: ['request', 'requests'], SCTASK: ['catalog task', 'catalog tasks'] };
const MAX_ROWS = 50000;

const HOUR = 3600e3;
const DAY = 24 * HOUR;
// "2026-08-17 09:15:56" (the export's text) -> ms; '' -> null
const ts = text => (text ? Date.parse(`${String(text).replace(' ', 'T')}Z`) || null : null);
const PRIORITY_NAME = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
const RISK_RANK = { High: 2, Medium: 3, Low: 4, Standard: 4 };

// "45 min", "5.2 h", "3.4 days"
export function duration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const abs = Math.abs(ms);
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / 60000))} min`;
  if (abs < 2 * DAY) return `${(abs / HOUR).toFixed(1)} h`;
  return `${(abs / DAY).toFixed(1)} days`;
}

const kpi = (key, label, value, tone = 'info', detail = '') => ({ key, label, value: String(value), tone, detail });
// At or under the typical time: good; up to three times it: warn; beyond: bad
const vsTypical = (ms, typical) => (typical == null ? 'info' : ms <= typical ? 'good' : ms <= 3 * typical ? 'warn' : 'bad');
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// ---------------------------------------------------------------------
// The data: every ticket, loaded once. load() starts it (server start-up
// calls it once Cube answers); everything else waits for it.
// ---------------------------------------------------------------------

let loading = null;
let data = null; // { asOf, tickets: Map(number -> ticket), typical }

export function load(runCubeQuery) {
  if (!loading) {
    loading = readAll(runCubeQuery).then(d => { data = d; return d; });
    loading.catch(() => { loading = null; }); // try again next time
  }
  return loading;
}

async function readAll(runCubeQuery) {
  const tickets = new Map();
  for (const [kind, { cube, fields }] of Object.entries(SOURCES)) {
    const rows = await runCubeQuery({ dimensions: fields.map(f => `${cube}.${f}`), limit: MAX_ROWS });
    if (rows.length >= MAX_ROWS) throw new Error(`${cube} has ${MAX_ROWS.toLocaleString()} tickets or more; kpis.mjs reads at most that many`);
    const open = new Set(ENTITY_CATALOG[cube].openStates);
    for (const row of rows) {
      const raw = Object.fromEntries(fields.map(f => [f, String(row[`${cube}.${f}`] ?? '').trim()]));
      tickets.set(raw.number, toTicket(kind, raw, open.has(raw.state)));
    }
  }
  // "Now": the newest moment the data knows of (as reporting.data_as_of)
  let asOf = 0;
  for (const t of tickets.values()) asOf = Math.max(asOf, t.updated || 0, t.kind === 'CHG' ? t.created || 0 : 0);
  const finished = kind => [...tickets.values()].filter(t => t.kind === kind && t.done && t.created);
  const typical = {
    INC: Object.fromEntries([1, 2, 3, 4].map(p => [p, median(finished('INC').filter(t => t.priority === p).map(t => t.done - t.created))])),
    CHG: median([...tickets.values()].filter(t => t.kind === 'CHG' && t.plannedStart && t.created).map(t => t.plannedStart - t.created)),
    RITM: median(finished('RITM').map(t => t.done - t.created)),
    SCTASK: median(finished('SCTASK').map(t => t.done - t.created)),
  };
  return { asOf, tickets, typical };
}

// One row of the export -> what the KPIs read. done: when it was finished
// (an incident resolved, a request fulfilled or closed, a catalog task's last
// update once it closed: tasks have no closing date of their own)
function toTicket(kind, r, open) {
  const t = { number: r.number, kind, state: r.state, open };
  if (kind === 'INC') {
    Object.assign(t, {
      created: ts(r.created), updated: ts(r.updated), done: ts(r.resolved) || ts(r.closed),
      priority: Number((/^P([1-4])\b/.exec(r.priority) || [])[1]) || null,
      reassigned: Number(r.reassignment_count) || 0, reopened: Number(r.reopen_count) || 0,
      wasP1: r.was_p1 === 'true', breach: r.breach_reason, workaround: r.close_code === 'Solved (Work Around)',
      causedBy: r.caused_by_change && r.caused_by_change !== 'zzz' ? r.caused_by_change : '',
      problem: r.problem && r.problem !== 'zzz' ? r.problem : '',
    });
  } else if (kind === 'CHG') {
    Object.assign(t, {
      created: ts(r.created), updated: ts(r.created), done: null,
      plannedStart: ts(r.planned_start_date), plannedEnd: ts(r.planned_end_date),
      type: r.type, risk: r.risk, approval: r.approval, closeCode: r.close_code, failure: r.failure_code, outage: r.outage === 'Yes',
    });
  } else if (kind === 'RITM') {
    Object.assign(t, { created: ts(r.opened), updated: ts(r.updated), done: ts(r.fulfilled_time) || ts(r.closed), approval: r.approval });
  } else {
    Object.assign(t, { created: ts(r.created), updated: ts(r.updated), done: open ? null : ts(r.updated), sla: r.sla_flag === 'true' });
  }
  return t;
}

// How urgent a ticket is: an incident's priority, a change's risk (as the
// "Priority / Risk" column), nothing for requests and tasks (5)
const rankOf = t => (t.kind === 'INC' ? t.priority || 5 : t.kind === 'CHG' ? RISK_RANK[t.risk] ?? 5 : 5);

// ---------------------------------------------------------------------
// One ticket's KPIs
// ---------------------------------------------------------------------

function idleKpi(t, asOf) {
  if (!t.open || !t.updated) return null;
  const idle = asOf - t.updated;
  return kpi('idle', 'Last update', `${duration(idle)} ago`, idle < 3 * DAY ? 'good' : idle < 7 * DAY ? 'warn' : 'bad',
    'Time since anyone last updated it. A week or more without an update usually means it is stuck.');
}

function incidentKpis(t, { asOf, typical }) {
  const usual = typical.INC[t.priority];
  const prio = PRIORITY_NAME[t.priority] || 'incident';
  const list = [];
  if (t.open) {
    const age = asOf - t.created;
    list.push(kpi('age', 'Open for', duration(age), vsTypical(age, usual), `A ${prio} incident is typically resolved in ${duration(usual)}.`));
  } else if (t.done) {
    const took = t.done - t.created;
    list.push(kpi('resolve', 'Resolved in', duration(took), vsTypical(took, usual), `Typical for a ${prio} incident: ${duration(usual)}.`));
  }
  list.push(idleKpi(t, asOf));
  list.push(kpi('reassigned', 'Reassigned', `${t.reassigned}×`, t.reassigned === 0 ? 'good' : t.reassigned < 3 ? 'info' : 'bad',
    'How many times it was passed to another team. 3 or more usually means it was routed to the wrong team.'));
  list.push(kpi('reopened', 'Reopened', `${t.reopened}×`, t.reopened ? 'bad' : 'good', 'Reopened after it was resolved: the first fix didn\'t hold.'));
  list.push(t.breach
    ? kpi('sla', 'SLA', 'breached', 'bad', `Reason given: ${t.breach}.`)
    : kpi('sla', 'SLA', 'no breach recorded', 'good', 'No SLA breach reason was recorded on it.'));
  if (t.workaround) list.push(kpi('workaround', 'Fixed with', 'a workaround', 'warn', 'Closed with a workaround, not a permanent fix: a candidate for problem management.'));
  if (t.wasP1) list.push(kpi('p1', 'Was a', 'P1', 'warn', 'It was a P1 (critical) at some point.'));
  if (t.causedBy) list.push(kpi('cause', 'Caused by', t.causedBy, 'warn', 'The change that caused it.'));
  if (t.problem) list.push(kpi('problem', 'Problem', t.problem, 'info', 'The problem record investigating its root cause.'));
  return list;
}

function changeKpis(t, { asOf, typical }) {
  const list = [];
  if (t.open) list.push(kpi('age', 'Open for', duration(asOf - t.created), 'info', 'Since it was raised.'));
  if (t.plannedStart && t.created) {
    const lead = t.plannedStart - t.created;
    list.push(lead < 0
      ? kpi('lead', 'Raised', `${duration(lead)} after its start`, 'bad', 'Logged after the work had already started.')
      : kpi('lead', 'Raised', `${duration(lead)} ahead`, lead < 2 * DAY ? 'warn' : 'good',
        `How far ahead of its planned start it was raised. Typical: ${duration(typical.CHG)}. Under 2 days is short notice for approval.`));
  }
  if (t.plannedStart && t.plannedEnd) list.push(kpi('window', 'Window', duration(t.plannedEnd - t.plannedStart), 'info', 'How long the planned change window is.'));
  if (t.open && t.plannedEnd && t.plannedEnd < asOf) {
    list.push(kpi('overdue', 'Past its planned end by', duration(asOf - t.plannedEnd), 'bad', 'Still open after its window should have ended.'));
  } else if (t.open && t.plannedStart && t.plannedStart >= asOf && t.plannedStart < asOf + 7 * DAY) {
    list.push(kpi('upcoming', 'Starts in', duration(t.plannedStart - asOf), 'info', 'Planned to start within the next week.'));
  }
  if (!t.open) {
    if (t.closeCode === 'Successful') list.push(kpi('outcome', 'Outcome', 'successful', 'good'));
    else if (t.closeCode === 'Unsuccessful') list.push(kpi('outcome', 'Outcome', `unsuccessful${t.failure ? ` (${t.failure})` : ''}`, 'bad'));
    else if (t.state === 'Canceled') list.push(kpi('outcome', 'Outcome', 'canceled', 'info'));
    else list.push(kpi('outcome', 'Outcome', 'not recorded', 'warn', 'Closed without saying whether it worked.'));
  }
  if (t.approval === 'Requested') list.push(kpi('approval', 'Approval', 'waiting', t.open ? 'warn' : 'info', 'Approval was requested and not yet given.'));
  else if (t.approval === 'Rejected') list.push(kpi('approval', 'Approval', 'rejected', 'bad'));
  else if (t.approval === 'Approved') list.push(kpi('approval', 'Approval', 'approved', 'good'));
  else if (t.open && t.approval) list.push(kpi('approval', 'Approval', 'not requested yet', 'info'));
  if (t.outage) list.push(kpi('outage', 'Needs', 'an outage', 'warn', 'The service is down while the change is carried out.'));
  if (['Emergency', 'Expedited'].includes(t.type)) list.push(kpi('type', 'Type', t.type.toLowerCase(), 'warn', 'Approved and carried out under time pressure.'));
  return list;
}

function requestKpis(t, { asOf, typical }) {
  const list = [];
  if (t.open) {
    const age = asOf - t.created;
    list.push(kpi('age', 'Open for', duration(age), vsTypical(age, typical.RITM), `A request is typically fulfilled in ${duration(typical.RITM)}.`));
  } else if (t.done) {
    const took = t.done - t.created;
    list.push(kpi('fulfil', 'Fulfilled in', duration(took), vsTypical(took, typical.RITM), `Typical: ${duration(typical.RITM)}.`));
  }
  list.push(idleKpi(t, asOf));
  if (t.open && t.approval === 'Requested') list.push(kpi('approval', 'Approval', 'waiting', 'warn', 'Waiting for someone to approve it.'));
  else if (t.approval === 'Rejected') list.push(kpi('approval', 'Approval', 'rejected', 'bad'));
  return list;
}

function taskKpis(t, { asOf, typical }) {
  const list = [];
  if (t.open) {
    const age = asOf - t.created;
    list.push(kpi('age', 'Open for', duration(age), vsTypical(age, typical.SCTASK), `A catalog task is typically closed in ${duration(typical.SCTASK)}.`));
  } else if (t.done) {
    const took = t.done - t.created;
    list.push(kpi('close', 'Closed in about', duration(took), vsTypical(took, typical.SCTASK),
      `Measured to its last update (catalog tasks have no closing date). Typical: ${duration(typical.SCTASK)}.`));
  }
  list.push(idleKpi(t, asOf));
  list.push(t.sla ? kpi('sla', 'SLA', 'breached', 'bad') : kpi('sla', 'SLA', 'met', 'good'));
  return list;
}

const BUILDERS = { INC: incidentKpis, CHG: changeKpis, RITM: requestKpis, SCTASK: taskKpis };

// numbers -> { asOf, kpis: { number: [kpi] } } (numbers not in the data are left out)
export async function ticketKpis(numbers, runCubeQuery) {
  const d = data || await load(runCubeQuery);
  const kpis = {};
  for (const n of numbers) {
    const t = d.tickets.get(n);
    if (t) kpis[n] = BUILDERS[t.kind](t, d).filter(Boolean);
  }
  return { asOf: new Date(d.asOf).toISOString(), kpis };
}

// ---------------------------------------------------------------------
// One family's KPIs: its tickets taken together. members: [{ number, assigneeId }]
// ---------------------------------------------------------------------

function familySummary(members, d) {
  const tickets = members.map(m => d.tickets.get(m.number)).filter(Boolean);
  const open = tickets.filter(t => t.open);
  const kinds = {};
  for (const t of tickets) kinds[t.kind] = (kinds[t.kind] || 0) + 1;
  return {
    tickets, open, kinds,
    rank: Math.min(5, ...open.map(rankOf)),
    oldestOpen: open.length ? Math.min(...open.map(t => t.created || Infinity)) : null,
  };
}

function familyKpis(members, d, summary = familySummary(members, d)) {
  const { tickets, open, kinds } = summary;
  const { asOf, typical } = d;
  const list = [];
  const mix = Object.entries(kinds).map(([k, n]) => `${n} ${KIND_NAMES[k][n === 1 ? 0 : 1]}`).join(', ');
  list.push(kpi('tickets', 'Tickets', tickets.length, 'info', mix));
  const closed = tickets.length - open.length;
  list.push(kpi('progress', 'Closed', `${closed} of ${tickets.length}`, open.length ? 'warn' : 'good',
    `${tickets.length ? Math.round((closed / tickets.length) * 100) : 0}% of its tickets are closed.`));
  if (open.length) {
    const age = asOf - summary.oldestOpen;
    list.push(kpi('oldest', 'Oldest open', duration(age), age < 3 * DAY ? 'good' : age < 7 * DAY ? 'warn' : 'bad', 'How long its oldest open ticket has been open.'));
    const stale = open.filter(t => t.updated && asOf - t.updated >= 7 * DAY).length;
    list.push(kpi('stale', 'No update for a week', stale, stale ? 'bad' : 'good', 'Open tickets nobody has updated for 7 days or more.'));
  }
  const incidents = tickets.filter(t => t.kind === 'INC');
  const top = Math.min(...incidents.map(t => t.priority || 5));
  if (top < 5) list.push(kpi('priority', 'Highest priority', PRIORITY_NAME[top], top <= 2 ? 'bad' : 'info', 'The most urgent incident in the family.'));
  const resolved = incidents.filter(t => t.done).map(t => t.done - t.created);
  if (resolved.length) {
    const usual = median(Object.values(typical.INC).filter(v => v != null));
    const took = median(resolved);
    list.push(kpi('resolve', 'Incidents resolved in', `${duration(took)} (median)`, vsTypical(took, usual), `Across its ${resolved.length} resolved incidents. Typical for any incident: ${duration(usual)}.`));
  }
  const fulfilled = tickets.filter(t => t.kind === 'RITM' && t.done).map(t => t.done - t.created);
  if (fulfilled.length) {
    const took = median(fulfilled);
    list.push(kpi('fulfil', 'Requests fulfilled in', `${duration(took)} (median)`, vsTypical(took, typical.RITM), `Typical: ${duration(typical.RITM)}.`));
  }
  const breaches = incidents.filter(t => t.breach).length + tickets.filter(t => t.kind === 'SCTASK' && t.sla).length;
  if (incidents.length || kinds.SCTASK) list.push(kpi('sla', 'SLA breaches', breaches, breaches ? 'bad' : 'good'));
  if (incidents.length) {
    const passes = incidents.reduce((n, t) => n + t.reassigned, 0);
    list.push(kpi('reassigned', 'Reassignments', passes, incidents.some(t => t.reassigned >= 3) ? 'bad' : passes ? 'info' : 'good',
      'Times its incidents were passed to another team, in total. Red when one was passed 3 times or more.'));
    const reopens = incidents.reduce((n, t) => n + t.reopened, 0);
    list.push(kpi('reopened', 'Reopens', reopens, reopens ? 'bad' : 'good'));
  }
  const changes = tickets.filter(t => t.kind === 'CHG' && !t.open && t.closeCode);
  if (changes.length) {
    const failed = changes.filter(t => t.closeCode === 'Unsuccessful').length;
    list.push(kpi('changes', 'Successful changes', `${changes.length - failed} of ${changes.length}`, failed ? 'bad' : 'good'));
  }
  const familyChanges = new Set(tickets.filter(t => t.kind === 'CHG').map(t => t.number));
  const caused = incidents.filter(t => familyChanges.has(t.causedBy)).length;
  if (familyChanges.size) list.push(kpi('caused', 'Incidents caused by its changes', caused, caused ? 'bad' : 'good'));
  const first = Math.min(...tickets.map(t => t.created || Infinity));
  const last = Math.max(...tickets.map(t => (t.open ? asOf : t.done || t.updated || t.created || 0)));
  if (Number.isFinite(first) && last > first) list.push(kpi('span', 'Active over', duration(last - first), 'info', 'From its first ticket being opened to its last being closed (or now, while any is open).'));
  const people = new Set(members.map(m => m.assigneeId).filter(Boolean)).size;
  const unassigned = members.filter(m => !m.assigneeId && d.tickets.get(m.number)?.open).length;
  list.push(kpi('people', 'People on it', people, 'info', 'How many people on the team have one of its tickets.'));
  if (unassigned) list.push(kpi('unassigned', 'Open and unassigned', unassigned, 'warn', 'Open tickets nobody on the team has yet.'));
  return list;
}

// How much a list of KPIs needs attention, for sorting by it: each red one
// counts for more than any number of amber ones (public/app.js kpiAttention
// works it out the same way from the chips on the page)
export const attention = list => list.reduce((n, k) => n + (k.tone === 'bad' ? 100 : k.tone === 'warn' ? 1 : 0), 0);

// A team's families, most in need of attention first: those with open
// tickets, by their most urgent open ticket, then their oldest open one.
// families: Map(id -> { id, size, members }). status: 'open' | 'all';
// linked: only families of 2 or more tickets. sort: 'family' (its first
// ticket's number), 'size' or 'kpis' (how much needs attention), with dir
// 'asc' | 'desc', instead of the most urgent first.
// -> { asOf, counts: { open, all }, total, families: [{ id, size, kinds, open, kpis }] } (one page)
export async function teamFamilyKpis(families, { status = 'open', linked = true, offset = 0, limit = 25, sort = null, dir = 'asc' }, runCubeQuery) {
  const d = data || await load(runCubeQuery);
  const rows = [];
  for (const f of families.values()) {
    if (linked && f.size < 2) continue;
    rows.push({ f, s: familySummary(f.members, d) });
  }
  const counts = { open: rows.filter(r => r.s.open.length).length, all: rows.length };
  let shown = status === 'all' ? rows : rows.filter(r => r.s.open.length);
  shown.sort((a, b) => (b.s.open.length ? 1 : 0) - (a.s.open.length ? 1 : 0)
    || a.s.rank - b.s.rank
    || (a.s.oldestOpen ?? Infinity) - (b.s.oldestOpen ?? Infinity)
    || b.f.size - a.f.size
    || a.f.id.localeCompare(b.f.id));
  if (sort === 'kpis') for (const r of shown) r.kpis = familyKpis(r.f.members, d, r.s);
  const valueOf = { family: r => r.f.id, size: r => r.f.size, kpis: r => attention(r.kpis) }[sort];
  if (valueOf) shown = sortRows(shown, valueOf, dir);
  const page = shown.slice(offset, offset + limit);
  return {
    asOf: new Date(d.asOf).toISOString(),
    counts,
    total: shown.length,
    families: page.map(({ f, s, kpis }) => ({ id: f.id, size: f.size, kinds: s.kinds, open: s.open.length, kpis: kpis || familyKpis(f.members, d, s) })),
  };
}

// One family's KPIs and each of its tickets' (for a project manager opening it)
export async function oneFamilyKpis(members, runCubeQuery) {
  const d = data || await load(runCubeQuery);
  const { kpis } = await ticketKpis(members.map(m => m.number), runCubeQuery);
  return { asOf: new Date(d.asOf).toISOString(), kpis: familyKpis(members, d), tickets: kpis };
}
