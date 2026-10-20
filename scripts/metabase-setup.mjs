// Sets up Metabase for OneTouch, through Metabase's API:
//   1. the admin account (first run only; METABASE_ADMIN_EMAIL / _PASSWORD in .env)
//   2. the connection to the reporting views, as the read-only metabase_reader role
//   3. three ITIL dashboards (Service Desk, Change / CAB, Requests), rebuilt from
//      scratch on every run inside the "OneTouch ITIL" collection
//   4. public links for them, saved to metabase-dashboards.json, which the
//      OneTouch Dashboards tab reads
//
// Safe to re-run (e.g. after changing a chart below):
//   docker exec analytics_node_app node scripts/metabase-setup.mjs

import { writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const MB = (process.env.METABASE_URL || 'http://metabase:3000').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD;
const READER_PASSWORD = process.env.METABASE_DB_PASSWORD;
const DB_NAME = 'ServiceNow (OneTouch reporting)';
const COLLECTION_NAME = 'OneTouch ITIL';
const OUTPUT_FILE = 'metabase-dashboards.json';

// ---------------------------------------------------------------------
// The dashboards. Every chart is a SQL query against the reporting views
// (db/reporting-views.sql). Layout: Metabase's grid is 24 columns wide.
// ---------------------------------------------------------------------

const SCALAR = { display: 'scalar', w: 6, h: 3 };
const line = (x, ...ys) => ({ display: 'line', w: 12, h: 7, viz: { 'graph.dimensions': [x], 'graph.metrics': ys } });
const bar = (x, ...ys) => ({ display: 'bar', w: 12, h: 7, viz: { 'graph.dimensions': [x], 'graph.metrics': ys } });
const stacked = (x, series, y) => ({ display: 'bar', w: 12, h: 7, viz: { 'graph.dimensions': [x, series], 'graph.metrics': [y], 'stackable.stack_type': 'stacked' } });
const row = (x, y) => ({ display: 'row', w: 12, h: 7, viz: { 'graph.dimensions': [x], 'graph.metrics': [y] } });
const pie = (x, y) => ({ display: 'pie', w: 12, h: 7, viz: { 'pie.dimension': x, 'pie.metric': y } });
const table = (w = 24, h = 7) => ({ display: 'table', w, h });

// Only weeks that the export covers completely: the first and last weeks are
// partial and would look like a sudden collapse. (view, and the date column that starts it)
const fullWeeks = (view, col) => `
full_weeks AS (
  SELECT date_trunc('week', min(${col})) + interval '1 week' AS first_week,
         date_trunc('week', (SELECT as_of FROM reporting.data_as_of)) AS end_week
  FROM reporting.${view}
)`;
const inFullWeeks = expr => `${expr} >= (SELECT first_week FROM full_weeks) AND ${expr} < (SELECT end_week FROM full_weeks)`;

const WEEKLY_INCIDENTS = `
WITH ${fullWeeks('incidents', 'created_at')},
     opened AS (SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM reporting.incidents GROUP BY 1),
     resolved AS (SELECT date_trunc('week', resolved_at) AS week, count(*) AS n FROM reporting.incidents WHERE resolved_at IS NOT NULL GROUP BY 1)
SELECT coalesce(o.week, r.week)::date AS "Week", coalesce(o.n, 0) AS "Opened", coalesce(r.n, 0) AS "Resolved"
FROM opened o FULL JOIN resolved r ON o.week = r.week
WHERE ${inFullWeeks('coalesce(o.week, r.week)')} ORDER BY 1`;

const DASHBOARDS = [
  {
    key: 'service-desk',
    name: 'Service Desk',
    description: 'Incident Management: backlog, flow, resolution time, routing and noise.',
    cards: [
      { name: 'Open incidents', ...SCALAR, sql: `SELECT count(*) AS "Open incidents" FROM reporting.incidents WHERE is_open` },
      { name: 'Open more than 7 days', ...SCALAR, sql: `SELECT count(*) AS "Open more than 7 days" FROM reporting.incidents WHERE is_open AND age_days >= 7` },
      { name: 'Average hours to resolve', ...SCALAR, sql: `SELECT round(avg(hours_to_resolve), 1) AS "Average hours to resolve" FROM reporting.incidents` },
      { name: 'Reassigned at least once (%)', ...SCALAR, sql: `SELECT round(100.0 * avg(was_reassigned::int), 1) AS "Reassigned at least once (%)" FROM reporting.incidents` },

      { name: 'Opened vs. resolved per week', ...line('Week', 'Opened', 'Resolved'), sql: WEEKLY_INCIDENTS },
      { name: 'Open incidents by age', ...bar('Age', 'Open incidents'), sql: `
SELECT substr(age_bucket, 4) AS "Age", count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open GROUP BY age_bucket ORDER BY age_bucket` },

      { name: 'Average hours to resolve by priority', ...bar('Priority', 'Average hours to resolve'), sql: `
SELECT priority AS "Priority", round(avg(hours_to_resolve), 1) AS "Average hours to resolve", count(*) AS "Incidents"
FROM reporting.incidents WHERE hours_to_resolve IS NOT NULL GROUP BY 1 ORDER BY 1` },
      { name: 'Open incidents by team (top 10)', ...row('Team', 'Open incidents'), sql: `
SELECT assignment_group AS "Team", count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },

      { name: 'Monitoring alerts vs. people, per week', ...line('Week', 'Monitoring alerts', 'Raised by people'), sql: `
WITH ${fullWeeks('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week",
       count(*) FILTER (WHERE source = 'Monitoring alert') AS "Monitoring alerts",
       count(*) FILTER (WHERE source = 'Person') AS "Raised by people"
FROM reporting.incidents WHERE ${inFullWeeks("date_trunc('week', created_at)")} GROUP BY 1 ORDER BY 1` },
      { name: 'Ticket ping-pong: reassignment by team', ...table(12), sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents",
       round(100.0 * avg(was_reassigned::int), 1) AS "Reassigned (%)",
       count(*) FILTER (WHERE reassignment_count >= 3) AS "Reassigned 3+ times"
FROM reporting.incidents GROUP BY 1 HAVING count(*) >= 50 ORDER BY 3 DESC LIMIT 15` },

      { name: 'Problem candidates: systems with the most incidents', ...table(24), sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Incidents",
       count(*) FILTER (WHERE source = 'Monitoring alert') AS "From monitoring",
       count(*) FILTER (WHERE is_open) AS "Still open",
       mode() WITHIN GROUP (ORDER BY subcategory) AS "Most common subcategory",
       round(avg(hours_to_resolve), 1) AS "Avg hours to resolve"
FROM reporting.incidents WHERE coalesce(configuration_item, '') <> ''
GROUP BY 1 ORDER BY 2 DESC LIMIT 15` },
    ],
  },
  {
    key: 'change',
    name: 'Change / CAB',
    description: 'Change Management: volume, success, risk, what is coming up, and approvals.',
    cards: [
      { name: 'Changes in the export', ...SCALAR, sql: `SELECT count(*) AS "Changes" FROM reporting.changes` },
      { name: 'Change success rate (%)', ...SCALAR, sql: `
SELECT round(100.0 * count(*) FILTER (WHERE succeeded) / nullif(count(*) FILTER (WHERE succeeded IS NOT NULL), 0), 1) AS "Success rate (%)"
FROM reporting.changes` },
      { name: 'Emergency or expedited (%)', ...SCALAR, sql: `SELECT round(100.0 * avg(is_emergency_or_expedited::int), 1) AS "Emergency or expedited (%)" FROM reporting.changes` },
      { name: 'Starting in the next 7 days', ...SCALAR, sql: `SELECT count(*) AS "Starting in the next 7 days" FROM reporting.changes WHERE starts_next_7_days AND state <> 'Canceled'` },

      { name: 'Upcoming Production changes (next 7 days)', ...table(24, 8), sql: `
SELECT number AS "Change", planned_start AS "Planned start", planned_end AS "Planned end",
       CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage", type AS "Type", risk AS "Risk",
       state AS "State", approval AS "Approval", owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes
WHERE starts_next_7_days AND environment = 'Production' AND state <> 'Canceled'
ORDER BY has_outage DESC, planned_start` },

      { name: 'Changes per week by type', ...stacked('Week', 'Type', 'Changes'), sql: `
WITH ${fullWeeks('changes', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", type AS "Type", count(*) AS "Changes"
FROM reporting.changes WHERE ${inFullWeeks("date_trunc('week', created_at)")} GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Changes by risk', ...pie('Risk', 'Changes'), sql: `
SELECT coalesce(nullif(risk, ''), 'Not set') AS "Risk", count(*) AS "Changes" FROM reporting.changes GROUP BY 1 ORDER BY 2 DESC` },

      { name: 'Change approvals waiting, by approver group', ...row('Approver group', 'Waiting'), sql: `
SELECT approver_group AS "Approver group", count(*) AS "Waiting", round(max(waiting_days), 1) AS "Oldest (days)"
FROM reporting.approvals WHERE approval_for = 'Change' AND is_waiting GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Failed changes and changes that caused incidents', ...table(12), sql: `
SELECT number AS "Change", created_at AS "Created", type AS "Type", close_code AS "Result",
       failure_code AS "Failure", owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes WHERE succeeded = false OR failure_code IS NOT NULL ORDER BY created_at DESC` },
    ],
  },
  {
    key: 'requests',
    name: 'Requests',
    description: 'Request Fulfilment: demand, backlog, fulfilment time, SLA and approvals.',
    cards: [
      { name: 'Open requests', ...SCALAR, sql: `SELECT count(*) AS "Open requests" FROM reporting.requests WHERE is_open` },
      { name: 'Open catalog tasks', ...SCALAR, sql: `SELECT count(*) AS "Open catalog tasks" FROM reporting.catalog_tasks WHERE is_open` },
      { name: 'Catalog task SLA breaches (%)', ...SCALAR, sql: `SELECT round(100.0 * avg(sla_breached::int), 1) AS "SLA breaches (%)" FROM reporting.catalog_tasks` },
      { name: 'Request approvals waiting', ...SCALAR, sql: `SELECT count(*) AS "Request approvals waiting" FROM reporting.approvals WHERE approval_for = 'Request' AND is_waiting` },

      { name: 'Most requested items (top 10)', ...row('Item', 'Requests'), sql: `
SELECT item AS "Item", count(*) AS "Requests" FROM reporting.requests GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      // "Completed" = fulfilled, or closed without a fulfilled time (same rule as hours_to_fulfil)
      { name: 'Requests opened vs. completed per week', ...line('Week', 'Opened', 'Completed'), sql: `
WITH ${fullWeeks('requests', 'opened_at')},
     o AS (SELECT date_trunc('week', opened_at) AS week, count(*) AS n FROM reporting.requests GROUP BY 1),
     c AS (SELECT date_trunc('week', coalesce(fulfilled_at, closed_at)) AS week, count(*) AS n
           FROM reporting.requests WHERE coalesce(fulfilled_at, closed_at) IS NOT NULL GROUP BY 1)
SELECT coalesce(o.week, c.week)::date AS "Week", coalesce(o.n, 0) AS "Opened", coalesce(c.n, 0) AS "Completed"
FROM o FULL JOIN c ON o.week = c.week
WHERE ${inFullWeeks('coalesce(o.week, c.week)')} ORDER BY 1` },

      { name: 'Fulfilment time for the most requested items', ...table(12), sql: `
SELECT item AS "Item", count(*) AS "Requests",
       round(avg(hours_to_fulfil), 1) AS "Avg hours",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_fulfil))::numeric, 1) AS "Median hours",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.requests GROUP BY 1 ORDER BY 2 DESC LIMIT 15` },
      { name: 'SLA breaches by team', ...table(12), sql: `
SELECT assignment_group AS "Team", count(*) AS "Tasks",
       count(*) FILTER (WHERE sla_breached) AS "Breached",
       round(100.0 * avg(sla_breached::int), 1) AS "Breached (%)",
       count(*) FILTER (WHERE is_open) AS "Open now"
FROM reporting.catalog_tasks GROUP BY 1 HAVING count(*) >= 50 ORDER BY 3 DESC LIMIT 15` },

      { name: 'Open catalog tasks by team and state', ...stacked('Team', 'State', 'Open tasks'), sql: `
WITH top AS (SELECT assignment_group FROM reporting.catalog_tasks WHERE is_open GROUP BY 1 ORDER BY count(*) DESC LIMIT 8)
SELECT t.assignment_group AS "Team", t.state AS "State", count(*) AS "Open tasks"
FROM reporting.catalog_tasks t JOIN top USING (assignment_group) WHERE t.is_open GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Request approvals waiting, by approver group', ...row('Approver group', 'Waiting'), sql: `
SELECT approver_group AS "Approver group", count(*) AS "Waiting", round(max(waiting_days), 1) AS "Oldest (days)"
FROM reporting.approvals WHERE approval_for = 'Request' AND is_waiting GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
    ],
  },
];

// ---------------------------------------------------------------------
// Metabase API helpers
// ---------------------------------------------------------------------

let session = null;

async function api(method, path, body) {
  const res = await fetch(MB + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Metabase-Session': session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForMetabase() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(MB + '/api/health');
      if (r.ok && (await r.json()).status === 'ok') return;
    } catch { /* still starting */ }
    if (i === 0) console.log(`Waiting for Metabase at ${MB} ...`);
    await sleep(2000);
  }
  throw new Error(`Metabase at ${MB} did not become ready.`);
}

// Lays cards out left to right, wrapping at 24 columns
function layout(cards) {
  let x = 0, y = 0, rowHeight = 0;
  return cards.map(c => {
    if (x + c.w > 24) { x = 0; y += rowHeight; rowHeight = 0; }
    const pos = { col: x, row: y, size_x: c.w, size_y: c.h };
    x += c.w; rowHeight = Math.max(rowHeight, c.h);
    return pos;
  });
}

// ---------------------------------------------------------------------
// Setup steps
// ---------------------------------------------------------------------

async function signIn() {
  const props = await api('GET', '/api/session/properties');
  if (!props['has-user-setup']) {
    const r = await api('POST', '/api/setup', {
      token: props['setup-token'],
      user: { first_name: 'OneTouch', last_name: 'Admin', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, site_name: 'OneTouch' },
      prefs: { site_name: 'OneTouch', site_locale: 'en', allow_tracking: false },
    });
    session = r.id;
    console.log(`Created the Metabase admin account (${ADMIN_EMAIL}).`);
  } else {
    try {
      session = (await api('POST', '/api/session', { username: ADMIN_EMAIL, password: ADMIN_PASSWORD })).id;
    } catch (err) {
      throw new Error(`Metabase is already set up, but signing in as ${ADMIN_EMAIL} failed. ` +
        'Put the Metabase admin email and password in .env (METABASE_ADMIN_EMAIL / METABASE_ADMIN_PASSWORD). ' + err.message);
    }
    console.log(`Signed in to Metabase as ${ADMIN_EMAIL}.`);
  }
}

async function connectDatabase() {
  const details = {
    host: 'postgres', port: 5432, dbname: 'analytics_db',
    user: 'metabase_reader', password: READER_PASSWORD, ssl: false,
    'schema-filters-type': 'inclusion', 'schema-filters-patterns': 'reporting',
  };
  const list = await api('GET', '/api/database');
  const existing = (list.data || list).find(d => d.name === DB_NAME);
  let id;
  if (existing) {
    id = existing.id;
    await api('PUT', `/api/database/${id}`, { details, engine: 'postgres', name: DB_NAME });
  } else {
    id = (await api('POST', '/api/database', { engine: 'postgres', name: DB_NAME, details, is_full_sync: true })).id;
    console.log(`Connected Metabase to the reporting views as metabase_reader.`);
  }
  await api('POST', `/api/database/${id}/sync_schema`);
  // Wait until Metabase has seen the views, so cards can be saved against them
  for (let i = 0; i < 60; i++) {
    const meta = await api('GET', `/api/database/${id}/metadata`);
    const names = (meta.tables || []).map(t => t.name);
    if (['incidents', 'changes', 'requests', 'catalog_tasks', 'approvals'].every(n => names.includes(n))) return id;
    await sleep(2000);
  }
  throw new Error('Metabase did not finish reading the reporting views. Is the db-setup service done?');
}

async function freshCollection() {
  const collections = await api('GET', '/api/collection');
  const existing = collections.find(c => c.name === COLLECTION_NAME && !c.archived && !c.personal_owner_id);
  if (existing) {
    // Rebuild from scratch: archive what the previous run made
    const items = await api('GET', `/api/collection/${existing.id}/items`);
    for (const item of items.data || items) {
      if (item.model === 'dashboard') await api('PUT', `/api/dashboard/${item.id}`, { archived: true });
      if (item.model === 'card') await api('PUT', `/api/card/${item.id}`, { archived: true });
    }
    return existing.id;
  }
  return (await api('POST', '/api/collection', { name: COLLECTION_NAME, color: '#10a37f', description: 'Dashboards built by OneTouch (scripts/metabase-setup.mjs). Re-running the script rebuilds them.' })).id;
}

async function buildDashboard(def, databaseId, collectionId) {
  const cardIds = [];
  for (const c of def.cards) {
    const card = await api('POST', '/api/card', {
      name: c.name,
      collection_id: collectionId,
      display: c.display,
      visualization_settings: c.viz || {},
      dataset_query: { type: 'native', native: { query: c.sql.trim(), 'template-tags': {} }, database: databaseId },
    });
    cardIds.push(card.id);
  }

  const dash = await api('POST', '/api/dashboard', { name: def.name, description: def.description, collection_id: collectionId });
  const positions = layout(def.cards);
  await api('PUT', `/api/dashboard/${dash.id}`, {
    dashcards: cardIds.map((cardId, i) => ({
      id: -(i + 1), card_id: cardId, ...positions[i], parameter_mappings: [], visualization_settings: {},
    })),
  });
  const { uuid } = await api('POST', `/api/dashboard/${dash.id}/public_link`);
  console.log(`Built "${def.name}" (${def.cards.length} charts).`);
  return { key: def.key, name: def.name, description: def.description, uuid };
}

// ---------------------------------------------------------------------

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !READER_PASSWORD) {
    throw new Error('Set METABASE_ADMIN_EMAIL, METABASE_ADMIN_PASSWORD and METABASE_DB_PASSWORD in .env, ' +
      'then run `docker compose up -d` so the app container sees them.');
  }
  await waitForMetabase();
  await signIn();
  await api('PUT', '/api/setting/enable-public-sharing', { value: true });
  const databaseId = await connectDatabase();
  const collectionId = await freshCollection();

  const dashboards = [];
  for (const def of DASHBOARDS) dashboards.push(await buildDashboard(def, databaseId, collectionId));

  await writeFile(OUTPUT_FILE, JSON.stringify({ dashboards }, null, 2) + '\n');
  console.log(`Saved the public links to ${OUTPUT_FILE}; the OneTouch Dashboards tab shows them now.`);
}

try {
  await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
