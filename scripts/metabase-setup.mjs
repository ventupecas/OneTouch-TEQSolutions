// Sets up Metabase for OneTouch, through Metabase's API:
//   1. the admin account (first run only; METABASE_ADMIN_EMAIL / _PASSWORD in .env)
//   2. the connection to the reporting views, as the read-only metabase_reader role
//   3. the ITIL dashboards defined in DASHBOARDS below (overview, sites, service
//      desk, problems, monitoring, workload, change, change risk, requests,
//      automation), rebuilt from scratch on every run inside the "OneTouch ITIL"
//      collection
//   4. public links for them, saved to metabase-dashboards.json, which the
//      OneTouch Dashboards tab reads (its drawer groups them by `group`)
//
// Safe to re-run (e.g. after changing a chart below):
//   docker exec analytics_node_app node scripts/metabase-setup.mjs

import { randomUUID } from 'node:crypto';
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
// Last value with the change vs. the one before (rows: date, number; oldest first)
const TREND = { display: 'smartscalar', w: 6, h: 4 };
const line = (x, ...ys) => ({ display: 'line', w: 12, h: 7, viz: { 'graph.dimensions': [x], 'graph.metrics': ys } });
// One line per value of `series` (rows: x, series, y)
const lines = (x, series, y) => ({ display: 'line', w: 12, h: 7, viz: { 'graph.dimensions': [x, series], 'graph.metrics': [y] } });
const bar = (x, ...ys) => ({ display: 'bar', w: 12, h: 7, viz: { 'graph.dimensions': [x], 'graph.metrics': ys } });
const stacked = (x, series, y) => ({ display: 'bar', w: 12, h: 7, viz: { 'graph.dimensions': [x, series], 'graph.metrics': [y], 'stackable.stack_type': 'stacked' } });
const row = (x, y) => ({ display: 'row', w: 12, h: 7, viz: { 'graph.dimensions': [x], 'graph.metrics': [y] } });
const pie = (x, y) => ({ display: 'pie', w: 12, h: 7, viz: { 'pie.dimension': x, 'pie.metric': y } });
const table = (w = 24, h = 7) => ({ display: 'table', w, h });

// Only weeks (or days) that the export covers completely: the first and last
// are partial and would look like a sudden collapse. Arguments: the view, the
// date column that starts it, and the period ('week' or 'day').
const fullPeriods = (view, col, unit = 'week') => `
full_periods AS (
  SELECT date_trunc('${unit}', min(${col})) + interval '1 ${unit}' AS first_period,
         date_trunc('${unit}', (SELECT as_of FROM reporting.data_as_of)) AS end_period
  FROM reporting.${view}
)`;
const inFullPeriods = expr => `${expr} >= (SELECT first_period FROM full_periods) AND ${expr} < (SELECT end_period FROM full_periods)`;

// Catalog items that start, stop or snooze servers
const SERVER_POWER_ITEMS = `('Virtual Server - Start', 'Virtual Server - Stop', 'Start and Snooze Applications/Servers')`;
const ACCOUNT_SUBCATEGORIES = `('Password Reset', 'Account Locked', 'Password Expired', 'Account Disabled')`;

// Open incidents, requests and catalog tasks bucketed by age, for stacking
const OPEN_WORK_BY_AGE = `
WITH open_items AS (
  SELECT 'Incidents' AS type, age_days FROM reporting.incidents WHERE is_open
  UNION ALL SELECT 'Requests', age_days FROM reporting.requests WHERE is_open
  UNION ALL SELECT 'Catalog tasks', age_days FROM reporting.catalog_tasks WHERE is_open
),
bucketed AS (
  SELECT type, CASE WHEN age_days < 1 THEN 1 WHEN age_days < 3 THEN 2 WHEN age_days < 7 THEN 3
                    WHEN age_days < 30 THEN 4 ELSE 5 END AS bucket
  FROM open_items
)
SELECT (ARRAY['Under 1 day', '1-3 days', '3-7 days', '7-30 days', 'Over 30 days'])[bucket] AS "Age",
       type AS "Type", count(*) AS "Open items"
FROM bucketed GROUP BY bucket, type ORDER BY bucket, type`;

// Incidents, changes and requests per week on one chart. Each starts at its
// own first complete week (incidents only begin on 5 July).
const WEEKLY_VOLUME = `
WITH first_full AS (
  SELECT (SELECT date_trunc('week', min(created_at)) + interval '1 week' FROM reporting.incidents) AS incidents,
         (SELECT date_trunc('week', min(created_at)) + interval '1 week' FROM reporting.changes) AS changes,
         (SELECT date_trunc('week', min(opened_at)) + interval '1 week' FROM reporting.requests) AS requests,
         (SELECT date_trunc('week', as_of) FROM reporting.data_as_of) AS end_week
),
weeks AS (
  SELECT generate_series(least(incidents, changes, requests), end_week - interval '1 week', interval '1 week') AS week
  FROM first_full
),
inc AS (SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM reporting.incidents GROUP BY 1),
chg AS (SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM reporting.changes GROUP BY 1),
req AS (SELECT date_trunc('week', opened_at) AS week, count(*) AS n FROM reporting.requests GROUP BY 1)
SELECT w.week::date AS "Week",
       CASE WHEN w.week >= f.incidents THEN coalesce(inc.n, 0) END AS "Incidents",
       CASE WHEN w.week >= f.changes THEN coalesce(chg.n, 0) END AS "Changes",
       CASE WHEN w.week >= f.requests THEN coalesce(req.n, 0) END AS "Requests"
FROM weeks w CROSS JOIN first_full f
LEFT JOIN inc ON inc.week = w.week
LEFT JOIN chg ON chg.week = w.week
LEFT JOIN req ON req.week = w.week
ORDER BY 1`;

// "Opened per week" for a trend card: complete weeks only, oldest first
const weeklyTrend = (view, col, label, where = 'true') => `
WITH ${fullPeriods(view, col)}
SELECT date_trunc('week', ${col})::date AS "Week", count(*) FILTER (WHERE ${where}) AS "${label}"
FROM reporting.${view} WHERE ${inFullPeriods(`date_trunc('week', ${col})`)}
GROUP BY 1 ORDER BY 1`;

const WEEKLY_INCIDENTS = `
WITH ${fullPeriods('incidents', 'created_at')},
     opened AS (SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM reporting.incidents GROUP BY 1),
     resolved AS (SELECT date_trunc('week', resolved_at) AS week, count(*) AS n FROM reporting.incidents WHERE resolved_at IS NOT NULL GROUP BY 1)
SELECT coalesce(o.week, r.week)::date AS "Week", coalesce(o.n, 0) AS "Opened", coalesce(r.n, 0) AS "Resolved"
FROM opened o FULL JOIN resolved r ON o.week = r.week
WHERE ${inFullPeriods('coalesce(o.week, r.week)')} ORDER BY 1`;

// ---------------------------------------------------------------------
// DRILL-DOWN: what a click opens. A card's `click` applies to its bars,
// slices, points or number; a table's `links` applies per column. Each
// opens a detail dashboard (DETAILS, further down) with its filters set to
// the clicked row's values (col('Column')) or to fixed text.
// ---------------------------------------------------------------------

const col = name => ({ col: name });
const go = (to, params = {}) => ({ to, params });
const toIncident = c => go('incident-detail', { number: col(c) });
const toChange = c => go('change-detail', { number: col(c) });
const toRequest = c => go('request-detail', { number: col(c) });
const toTeam = c => go('team-detail', { team: col(c) });
const toSystem = c => go('system-detail', { system: col(c) });
const toSite = c => go('site-detail', { site: col(c) });
const toProblem = c => go('problem-detail', { problem: col(c) });
const toItem = c => go('item-detail', { item: col(c) });

// In the order they appear in OneTouch's drawer, under their `group` heading
const DASHBOARDS = [
  {
    key: 'overview',
    group: 'Overview',
    name: 'IT Operations Overview',
    description: 'The latest complete week at a glance across incidents, changes and requests.',
    cards: [
      { name: 'Incidents opened per week', ...TREND, sql: weeklyTrend('incidents', 'created_at', 'Incidents opened'),
        description: 'The latest complete week, compared with the week before.' },
      { name: 'Changes raised per week', ...TREND, sql: weeklyTrend('changes', 'created_at', 'Changes raised'),
        description: 'The latest complete week, compared with the week before.' },
      { name: 'Requests opened per week', ...TREND, sql: weeklyTrend('requests', 'opened_at', 'Requests opened'),
        description: 'The latest complete week, compared with the week before.' },
      { name: 'SLA breaches per week', click: go('task-list', { sla: 'Breached' }), ...TREND, sql: weeklyTrend('catalog_tasks', 'created_at', 'SLA breaches', 'sla_breached'),
        // Fewer breaches is good: show a drop in green, a rise in red
        viz: { 'scalar.switch_positive_negative': true },
        description: 'Catalog tasks that breached their SLA, by the week they were created; latest complete week vs. the one before.' },

      { name: 'Open incidents', click: go('incident-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open incidents" FROM reporting.incidents WHERE is_open` },
      { name: 'Open requests', click: go('request-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open requests" FROM reporting.requests WHERE is_open` },
      { name: 'Open catalog tasks', click: go('task-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open catalog tasks" FROM reporting.catalog_tasks WHERE is_open` },
      { name: 'Changes awaiting approval', click: go('change-list', { status: 'Open', approval: 'Requested' }), ...SCALAR, sql: `SELECT count(*) AS "Changes awaiting approval" FROM reporting.changes WHERE is_open AND approval = 'Requested'` },

      { name: 'Weekly volume: incidents, changes and requests', ...line('Week', 'Incidents', 'Changes', 'Requests'), sql: WEEKLY_VOLUME,
        description: 'Complete weeks only. Incidents in this export start on 5 July 2026, so their line starts later.' },
      { name: 'Open work by age', ...stacked('Age', 'Type', 'Open items'), sql: OPEN_WORK_BY_AGE },

      { name: 'Teams with the most open work', links: { Team: toTeam('Team') }, ...table(24), sql: `
WITH inc AS (SELECT assignment_group AS team, count(*) AS n, max(age_days) AS oldest FROM reporting.incidents WHERE is_open GROUP BY 1),
     task AS (SELECT assignment_group AS team, count(*) AS n, max(age_days) AS oldest FROM reporting.catalog_tasks WHERE is_open GROUP BY 1)
SELECT coalesce(inc.team, task.team) AS "Team",
       coalesce(inc.n, 0) AS "Open incidents", coalesce(task.n, 0) AS "Open catalog tasks",
       coalesce(inc.n, 0) + coalesce(task.n, 0) AS "Total open",
       greatest(inc.oldest, task.oldest) AS "Oldest (days)"
FROM inc FULL JOIN task ON inc.team = task.team
ORDER BY 4 DESC LIMIT 15` },
    ],
  },
  {
    key: 'sites',
    group: 'Overview',
    name: 'Sites & Breweries',
    description: 'Where the work comes from: offices, breweries and cloud sites.',
    cards: [
      { name: 'Sites with incidents', ...SCALAR, sql: `SELECT count(DISTINCT nullif(location, '')) AS "Sites with incidents" FROM reporting.incidents` },
      { name: 'Incidents at breweries', ...SCALAR, sql: `SELECT count(*) AS "Incidents at breweries" FROM reporting.incidents WHERE location ILIKE '%brewery%'` },
      { name: 'Changes affecting breweries', click: go('change-list', { brewery: 'Yes' }), ...SCALAR, sql: `SELECT count(*) AS "Changes affecting breweries" FROM reporting.changes WHERE affects_brewery` },
      { name: 'Breweries touched by changes', ...SCALAR, sql: `SELECT count(DISTINCT brewery) AS "Breweries touched by changes" FROM reporting.change_breweries` },

      { name: 'Incidents by site (top 12)', click: toSite('Site'), ...row('Site', 'Incidents'), h: 8, sql: `
SELECT location AS "Site", count(*) AS "Incidents"
FROM reporting.incidents WHERE nullif(location, '') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },
      { name: 'Requests by site (top 12)', click: toSite('Site'), ...row('Site', 'Requests'), h: 8, sql: `
SELECT location AS "Site", count(*) AS "Requests"
FROM reporting.requests WHERE nullif(location, '') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },

      { name: 'Brewery scorecard', links: { Brewery: toSite('Brewery') }, ...table(24, 8), sql: `
WITH inc AS (SELECT location AS site, count(*) AS incidents, count(*) FILTER (WHERE is_open) AS open_incidents,
                    round(avg(hours_to_resolve), 1) AS avg_hours
             FROM reporting.incidents WHERE location ILIKE '%brewery%' GROUP BY 1),
     req AS (SELECT location AS site, count(*) AS requests FROM reporting.requests WHERE location ILIKE '%brewery%' GROUP BY 1),
     chg AS (SELECT brewery AS site, count(*) AS changes, count(*) FILTER (WHERE has_outage) AS outage_changes
             FROM reporting.change_breweries GROUP BY 1)
SELECT coalesce(inc.site, req.site, chg.site) AS "Brewery",
       coalesce(inc.incidents, 0) AS "Incidents", coalesce(inc.open_incidents, 0) AS "Open incidents",
       inc.avg_hours AS "Avg hours to resolve", coalesce(req.requests, 0) AS "Requests",
       coalesce(chg.changes, 0) AS "Changes", coalesce(chg.outage_changes, 0) AS "Changes with an outage"
FROM inc
FULL JOIN req ON req.site = inc.site
FULL JOIN chg ON chg.site = coalesce(inc.site, req.site)
ORDER BY coalesce(inc.incidents, 0) + coalesce(req.requests, 0) + coalesce(chg.changes, 0) DESC` },

      { name: 'Changes by brewery (top 12)', click: toSite('Brewery'), ...row('Brewery', 'Changes'), h: 8, sql: `
SELECT brewery AS "Brewery", count(*) AS "Changes" FROM reporting.change_breweries GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        description: 'A change that lists several breweries counts once for each.' },
      { name: 'Weekly incidents at the 5 busiest breweries', click: toSite('Brewery'), ...lines('Week', 'Brewery', 'Incidents'), h: 8, sql: `
WITH ${fullPeriods('incidents', 'created_at')},
     top AS (SELECT location FROM reporting.incidents WHERE location ILIKE '%brewery%' GROUP BY 1 ORDER BY count(*) DESC LIMIT 5)
SELECT date_trunc('week', i.created_at)::date AS "Week", i.location AS "Brewery", count(*) AS "Incidents"
FROM reporting.incidents i JOIN top USING (location)
WHERE ${inFullPeriods("date_trunc('week', i.created_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },

      { name: 'Brewery changes with an outage in the next 14 days', links: { Brewery: toSite('Brewery'), Change: toChange('Change') }, ...table(24), sql: `
SELECT b.brewery AS "Brewery", b.number AS "Change", b.planned_start AS "Planned start", b.type AS "Type", b.risk AS "Risk",
       CASE WHEN b.affects_sap THEN 'Yes' ELSE 'No' END AS "Affects SAP", b.state AS "State", b.short_description AS "Summary"
FROM reporting.change_breweries b CROSS JOIN reporting.data_as_of a
WHERE b.has_outage AND b.state <> 'Canceled'
  AND b.planned_start >= a.as_of AND b.planned_start < a.as_of + interval '14 days'
ORDER BY b.planned_start, b.brewery`,
        description: 'Measured from the newest record in the export (1 September 2026), not from today.' },
    ],
  },
  {
    key: 'service-desk',
    group: 'Incidents & Problems',
    name: 'Service Desk',
    description: 'Incident Management: backlog, flow, resolution time, routing and noise.',
    cards: [
      { name: 'Open incidents', click: go('incident-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open incidents" FROM reporting.incidents WHERE is_open` },
      { name: 'Open more than 7 days', click: go('incident-list', { status: 'Open', older_than: '7' }), ...SCALAR, sql: `SELECT count(*) AS "Open more than 7 days" FROM reporting.incidents WHERE is_open AND age_days >= 7` },
      { name: 'Average hours to resolve', ...SCALAR, sql: `SELECT round(avg(hours_to_resolve), 1) AS "Average hours to resolve" FROM reporting.incidents` },
      { name: 'Reassigned at least once (%)', click: go('incident-list', { reassigned: 'Yes' }), ...SCALAR, sql: `SELECT round(100.0 * avg(was_reassigned::int), 1) AS "Reassigned at least once (%)" FROM reporting.incidents` },

      { name: 'Opened vs. resolved per week', ...line('Week', 'Opened', 'Resolved'), sql: WEEKLY_INCIDENTS },
      { name: 'Open incidents by age', click: go('incident-list', { status: 'Open', age: col('Age') }), ...bar('Age', 'Open incidents'), sql: `
SELECT substr(age_bucket, 4) AS "Age", count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open GROUP BY age_bucket ORDER BY age_bucket` },

      { name: 'Average hours to resolve by priority', click: go('incident-list', { priority: col('Priority') }), ...bar('Priority', 'Average hours to resolve'), sql: `
SELECT priority AS "Priority", round(avg(hours_to_resolve), 1) AS "Average hours to resolve", count(*) AS "Incidents"
FROM reporting.incidents WHERE hours_to_resolve IS NOT NULL GROUP BY 1 ORDER BY 1` },
      { name: 'Open incidents by team (top 10)', click: toTeam('Team'), ...row('Team', 'Open incidents'), sql: `
SELECT assignment_group AS "Team", count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },

      { name: 'Monitoring alerts vs. people, per week', ...line('Week', 'Monitoring alerts', 'Raised by people'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week",
       count(*) FILTER (WHERE source = 'Monitoring alert') AS "Monitoring alerts",
       count(*) FILTER (WHERE source = 'Person') AS "Raised by people"
FROM reporting.incidents WHERE ${inFullPeriods("date_trunc('week', created_at)")} GROUP BY 1 ORDER BY 1` },
      { name: 'Ticket ping-pong: reassignment by team', links: { Team: toTeam('Team') }, ...table(12), sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents",
       round(100.0 * avg(was_reassigned::int), 1) AS "Reassigned (%)",
       count(*) FILTER (WHERE reassignment_count >= 3) AS "Reassigned 3+ times"
FROM reporting.incidents GROUP BY 1 HAVING count(*) >= 50 ORDER BY 3 DESC LIMIT 15` },

      { name: 'Problem candidates: systems with the most incidents', links: { 'Server / system': toSystem('Server / system') }, ...table(24), sql: `
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
    key: 'problems',
    group: 'Incidents & Problems',
    name: 'Problems & Major Incidents',
    description: 'Problem Management: recurring issues, workarounds, knowledge articles and P1/P2 incidents.',
    cards: [
      { name: 'Incidents linked to a problem', ...SCALAR, sql: `SELECT count(problem) AS "Incidents linked to a problem" FROM reporting.incidents` },
      { name: 'Problem records with incidents', ...SCALAR, sql: `SELECT count(DISTINCT problem) AS "Problem records with incidents" FROM reporting.incidents` },
      { name: 'Closed with a workaround', click: go('incident-list', { workaround: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE closed_with_workaround) AS "Closed with a workaround" FROM reporting.incidents`,
        description: 'Workarounds point to an underlying problem that has not been fixed.' },
      { name: 'Reopened incidents', click: go('incident-list', { reopened: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE reopen_count > 0) AS "Reopened incidents" FROM reporting.incidents` },

      { name: 'Problem records with the most incidents', links: { Problem: toProblem('Problem'), 'Main system': toSystem('Main system') }, ...table(24, 9), sql: `
SELECT problem AS "Problem", count(*) AS "Incidents", count(*) FILTER (WHERE is_open) AS "Still open",
       mode() WITHIN GROUP (ORDER BY subcategory) AS "Main subcategory",
       mode() WITHIN GROUP (ORDER BY configuration_item) AS "Main system",
       min(created_at)::date AS "First seen", max(created_at)::date AS "Last seen"
FROM reporting.incidents WHERE problem IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 15` },

      { name: 'Weekly incidents for the 5 biggest problems', click: toProblem('Problem'), ...lines('Week', 'Problem', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')},
     top AS (SELECT problem FROM reporting.incidents WHERE problem IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 5)
SELECT date_trunc('week', i.created_at)::date AS "Week", i.problem AS "Problem", count(*) AS "Incidents"
FROM reporting.incidents i JOIN top USING (problem)
WHERE ${inFullPeriods("date_trunc('week', i.created_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Workarounds by subcategory (top 10)', click: go('incident-list', { workaround: 'Yes', subcategory: col('Subcategory') }), ...row('Subcategory', 'Closed with a workaround'), sql: `
SELECT subcategory AS "Subcategory", count(*) AS "Closed with a workaround"
FROM reporting.incidents WHERE closed_with_workaround GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },

      { name: 'Recurring issues with no problem record', links: { 'Server / system': toSystem('Server / system'), Subcategory: go('incident-list', { system: col('Server / system'), subcategory: col('Subcategory') }) }, ...table(24), sql: `
SELECT configuration_item AS "Server / system", subcategory AS "Subcategory", count(*) AS "Incidents",
       count(DISTINCT date_trunc('week', created_at)) AS "Weeks it happened",
       round(100.0 * avg((source = 'Monitoring alert')::int)) AS "From monitoring (%)",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.incidents
WHERE problem IS NULL AND configuration_item IS NOT NULL
GROUP BY 1, 2 HAVING count(*) >= 20
ORDER BY 3 DESC LIMIT 15`,
        description: 'The same system and issue type keep coming back, but no problem record links them: candidates for Problem Management.' },

      { name: 'Most used knowledge articles', links: { 'Knowledge article': go('incident-list', { kb: col('Knowledge article') }) }, ...table(12), sql: `
SELECT kb_article AS "Knowledge article", count(*) AS "Incidents",
       mode() WITHIN GROUP (ORDER BY subcategory) AS "Main subcategory",
       round(avg(hours_to_resolve), 1) AS "Avg hours to resolve"
FROM reporting.incidents WHERE kb_article IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Incidents caused by changes', links: { Incident: toIncident('Incident'), 'Caused by change': toChange('Caused by change'), Team: toTeam('Team') }, ...table(12), sql: `
SELECT number AS "Incident", caused_by_change AS "Caused by change", priority AS "Priority",
       created_at AS "Created", assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE caused_by_change IS NOT NULL ORDER BY created_at DESC` },

      { name: 'P1 and P2 incidents', links: { Incident: toIncident('Incident'), Team: toTeam('Team'), 'Server / system': toSystem('Server / system') }, ...table(24, 8), sql: `
SELECT number AS "Incident", priority AS "Priority", created_at AS "Created", hours_to_resolve AS "Hours to resolve",
       state AS "State", assignment_group AS "Team", configuration_item AS "Server / system", short_description AS "Summary"
FROM reporting.incidents
WHERE priority IN ('P1 - Critical', 'P2 - High') OR was_p1
ORDER BY priority, created_at DESC` },
    ],
  },
  {
    key: 'monitoring',
    group: 'Incidents & Problems',
    name: 'Monitoring & Alerts',
    description: 'Event Management: alert volume, noisy systems and alerts that close themselves.',
    cards: [
      { name: 'Monitoring alerts', click: go('incident-list', { source: 'Monitoring alert' }), ...SCALAR, sql: `SELECT count(*) AS "Monitoring alerts" FROM reporting.incidents WHERE source = 'Monitoring alert'` },
      { name: 'Share of all incidents (%)', ...SCALAR, sql: `SELECT round(100.0 * avg((source = 'Monitoring alert')::int), 1) AS "Share of all incidents (%)" FROM reporting.incidents` },
      { name: 'Alerts closed within an hour (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((hours_to_resolve <= 1)::int), 1) AS "Alerts closed within an hour (%)"
FROM reporting.incidents WHERE source = 'Monitoring alert' AND hours_to_resolve IS NOT NULL`,
        description: 'Alerts that close within an hour often fixed themselves: candidates for tuning or auto-closing.' },
      { name: 'Alerts with no system recorded', ...SCALAR, sql: `
SELECT count(*) AS "Alerts with no system recorded" FROM reporting.incidents WHERE source = 'Monitoring alert' AND configuration_item IS NULL`,
        description: "Their system is the placeholder 'zzz', so they can't be traced to what raised them." },

      { name: 'Alerts per day', click: go('incident-list', { source: 'Monitoring alert', date: col('Day') }), ...line('Day', 'Alerts'), sql: `
WITH ${fullPeriods('incidents', 'created_at', 'day')}
SELECT date_trunc('day', created_at)::date AS "Day", count(*) AS "Alerts"
FROM reporting.incidents
WHERE source = 'Monitoring alert' AND ${inFullPeriods("date_trunc('day', created_at)")}
GROUP BY 1 ORDER BY 1` },
      { name: 'Noisiest systems (top 10)', click: toSystem('Server / system'), ...row('Server / system', 'Alerts'), sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' AND configuration_item IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },

      { name: 'Alerts by hour of day', click: go('incident-list', { source: 'Monitoring alert', hour: col('Hour') }), ...bar('Hour', 'Alerts'), sql: `
SELECT to_char(created_at, 'HH24') AS "Hour", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' GROUP BY 1 ORDER BY 1`,
        description: 'Hours as recorded in ServiceNow.' },
      { name: 'How fast alerts close, by type', links: { 'Alert type': go('incident-list', { source: 'Monitoring alert', subcategory: col('Alert type') }) }, ...table(12), sql: `
SELECT subcategory AS "Alert type", count(*) AS "Alerts",
       round(100.0 * avg((hours_to_resolve <= 1)::int) FILTER (WHERE hours_to_resolve IS NOT NULL), 1) AS "Closed within 1 hour (%)",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_resolve) * 60)::numeric) AS "Median minutes to close",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.incidents WHERE source = 'Monitoring alert'
GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },

      { name: 'Teams receiving the most alerts', click: toTeam('Team'), ...row('Team', 'Alerts'), sql: `
SELECT assignment_group AS "Team", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Where alerts come from', click: go('incident-list', { source: 'Monitoring alert', opened_by: col('Raised by') }), ...row('Raised by', 'Alerts'), sql: `
SELECT coalesce(opened_by_group, 'Not recorded') AS "Raised by", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        description: 'The group that opened the alert, which usually identifies the monitoring tool or automation.' },
    ],
  },
  {
    key: 'workload',
    group: 'Incidents & Problems',
    name: 'Workload & Channels',
    description: 'When and how people contact IT, and how the work spreads across teams.',
    cards: [
      { name: 'Incidents raised by people', click: go('incident-list', { source: 'Person' }), ...SCALAR, sql: `SELECT count(*) AS "Incidents raised by people" FROM reporting.incidents WHERE source = 'Person'`,
        description: 'Everything except monitoring alerts.' },
      { name: 'Self-service share (%)', click: go('incident-list', { channel: 'Self-service' }), ...SCALAR, sql: `
SELECT round(100.0 * avg((contact_type = 'Self-service')::int), 1) AS "Self-service share (%)" FROM reporting.incidents WHERE source = 'Person'` },
      { name: 'Resolved without reassignment (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((reassignment_count = 0)::int), 1) AS "Resolved without reassignment (%)" FROM reporting.incidents WHERE source = 'Person'`,
        description: 'People-raised incidents that the first team handled all the way.' },
      { name: 'Password and account issues', ...SCALAR, sql: `
SELECT count(*) AS "Password and account issues" FROM reporting.incidents WHERE subcategory IN ${ACCOUNT_SUBCATEGORIES}` },

      { name: 'People-raised incidents by hour of day', click: go('incident-list', { source: 'Person', hour: col('Hour') }), ...bar('Hour', 'Incidents'), sql: `
SELECT to_char(created_at, 'HH24') AS "Hour", count(*) AS "Incidents"
FROM reporting.incidents WHERE source = 'Person' GROUP BY 1 ORDER BY 1`,
        description: 'Hours as recorded in ServiceNow. Useful for staffing the service desk.' },
      { name: 'People-raised incidents by day of week', click: go('incident-list', { source: 'Person', weekday: col('Day') }), ...bar('Day', 'Incidents'), sql: `
SELECT to_char(created_at, 'Dy') AS "Day", count(*) AS "Incidents"
FROM reporting.incidents WHERE source = 'Person'
GROUP BY 1, extract(isodow FROM created_at) ORDER BY extract(isodow FROM created_at)` },

      { name: 'Weekly incidents by channel', click: go('incident-list', { channel: col('Channel') }), ...lines('Week', 'Channel', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", contact_type AS "Channel", count(*) AS "Incidents"
FROM reporting.incidents
WHERE source = 'Person' AND ${inFullPeriods("date_trunc('week', created_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Channel mix', click: go('incident-list', { channel: col('Channel') }), ...pie('Channel', 'Incidents'), sql: `
SELECT contact_type AS "Channel", count(*) AS "Incidents"
FROM reporting.incidents WHERE source = 'Person' GROUP BY 1 ORDER BY 2 DESC` },

      { name: 'Team workload', links: { Team: toTeam('Team') }, ...table(24, 8), sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents", count(*) FILTER (WHERE is_open) AS "Open now",
       count(DISTINCT nullif(assigned_to, '')) AS "People",
       round(count(*)::numeric / nullif(count(DISTINCT nullif(assigned_to, '')), 0), 1) AS "Incidents per person",
       round(avg(hours_to_resolve), 1) AS "Avg hours to resolve",
       round(100.0 * avg(was_reassigned::int), 1) AS "Reassigned (%)",
       round(100.0 * avg((source = 'Monitoring alert')::int)) AS "From monitoring (%)"
FROM reporting.incidents
GROUP BY 1 HAVING count(*) >= 100
ORDER BY 2 DESC LIMIT 15` },

      { name: 'Why open incidents are waiting', click: go('incident-list', { waiting: col('Status') }), ...row('Status', 'Open incidents'), sql: `
SELECT CASE WHEN state = 'On Hold' THEN 'On hold: ' || coalesce(on_hold_reason, 'no reason given') ELSE state END AS "Status",
       count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open GROUP BY 1 ORDER BY 2 DESC` },
      { name: 'Open incidents per person (top 10)', click: go('incident-list', { status: 'Open', assignee: col('Assigned to') }), ...row('Assigned to', 'Open incidents'), sql: `
SELECT assigned_to AS "Assigned to", count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open AND nullif(assigned_to, '') IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        description: 'People are anonymized in this export.' },
    ],
  },
  {
    key: 'change',
    group: 'Change',
    name: 'Change / CAB',
    description: 'Change Management: volume, success, risk, what is coming up, and approvals.',
    cards: [
      { name: 'Changes in the export', ...SCALAR, sql: `SELECT count(*) AS "Changes" FROM reporting.changes` },
      { name: 'Change success rate (%)', ...SCALAR, sql: `
SELECT round(100.0 * count(*) FILTER (WHERE succeeded) / nullif(count(*) FILTER (WHERE succeeded IS NOT NULL), 0), 1) AS "Success rate (%)"
FROM reporting.changes` },
      { name: 'Emergency or expedited (%)', click: go('change-list', { urgent: 'Yes' }), ...SCALAR, sql: `SELECT round(100.0 * avg(is_emergency_or_expedited::int), 1) AS "Emergency or expedited (%)" FROM reporting.changes` },
      { name: 'Starting in the next 7 days', click: go('change-list', { starts_within: '7' }), ...SCALAR, sql: `SELECT count(*) AS "Starting in the next 7 days" FROM reporting.changes WHERE starts_next_7_days AND state <> 'Canceled'` },

      { name: 'Upcoming Production changes (next 7 days)', links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') }, ...table(24, 8), sql: `
SELECT number AS "Change", planned_start AS "Planned start", planned_end AS "Planned end",
       CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage", type AS "Type", risk AS "Risk",
       state AS "State", approval AS "Approval", owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes
WHERE starts_next_7_days AND environment = 'Production' AND state <> 'Canceled'
ORDER BY has_outage DESC, planned_start` },

      { name: 'Changes per week by type', click: go('change-list', { type: col('Type') }), ...stacked('Week', 'Type', 'Changes'), sql: `
WITH ${fullPeriods('changes', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", type AS "Type", count(*) AS "Changes"
FROM reporting.changes WHERE ${inFullPeriods("date_trunc('week', created_at)")} GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Changes by risk', click: go('change-list', { risk: col('Risk') }), ...pie('Risk', 'Changes'), sql: `
SELECT coalesce(nullif(risk, ''), 'Not set') AS "Risk", count(*) AS "Changes" FROM reporting.changes GROUP BY 1 ORDER BY 2 DESC` },

      { name: 'Change approvals waiting, by approver group', click: toTeam('Approver group'), ...row('Approver group', 'Waiting'), sql: `
SELECT approver_group AS "Approver group", count(*) AS "Waiting", round(max(waiting_days), 1) AS "Oldest (days)"
FROM reporting.approvals WHERE approval_for = 'Change' AND is_waiting GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Failed changes and changes that caused incidents', links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') }, ...table(12), sql: `
SELECT number AS "Change", created_at AS "Created", type AS "Type", close_code AS "Result",
       failure_code AS "Failure", owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes WHERE succeeded = false OR failure_code IS NOT NULL ORDER BY created_at DESC` },
    ],
  },
  {
    key: 'change-risk',
    group: 'Change',
    name: 'Change Risk & Business Impact',
    description: 'Changes that touch breweries and SAP, how much notice they get, and process failures.',
    cards: [
      { name: 'Changes affecting breweries', click: go('change-list', { brewery: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE affects_brewery) AS "Changes affecting breweries" FROM reporting.changes` },
      { name: 'Changes affecting SAP', click: go('change-list', { sap: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE affects_sap) AS "Changes affecting SAP" FROM reporting.changes` },
      { name: 'Needing an SAP transport', click: go('change-list', { transport: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE needs_sap_transport) AS "Needing an SAP transport" FROM reporting.changes` },
      { name: 'Flagged as a process failure', click: go('change-list', { process_failure: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE process_failure) AS "Flagged as a process failure" FROM reporting.changes` },

      { name: 'Days of notice by change type', click: go('change-list', { type: col('Change type') }), ...bar('Change type', 'Median days of notice'), h: 8, sql: `
SELECT type AS "Change type",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY lead_days))::numeric, 1) AS "Median days of notice",
       count(*) AS "Changes", count(*) FILTER (WHERE lead_days < 0) AS "Logged after it started"
FROM reporting.changes WHERE lead_days IS NOT NULL GROUP BY 1 ORDER BY 2`,
        description: 'How long before the planned start each kind of change is raised (median). "Logged after it started" counts changes recorded once work had begun.' },
      { name: 'Changes with an outage per week, by environment', click: go('change-list', { outage: 'Yes', environment: col('Environment') }), ...stacked('Week', 'Environment', 'Changes with an outage'), h: 8, sql: `
WITH bounds AS (
  SELECT date_trunc('week', min(created_at)) AS first_week,
         date_trunc('week', (SELECT as_of FROM reporting.data_as_of)) + interval '4 weeks' AS last_week
  FROM reporting.changes
)
SELECT date_trunc('week', planned_start)::date AS "Week", coalesce(environment, 'Not set') AS "Environment",
       count(*) AS "Changes with an outage"
FROM reporting.changes CROSS JOIN bounds
WHERE has_outage AND state <> 'Canceled' AND planned_start >= first_week AND planned_start < last_week
GROUP BY 1, 2 ORDER BY 1, 2`,
        description: 'By the week the change is planned to start, up to four weeks past the end of the export.' },

      { name: 'Most changed systems (top 10)', click: toSystem('Server / system'), ...row('Server / system', 'Changes'), h: 9, sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Changes"
FROM reporting.changes WHERE configuration_item IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Changes by category and risk', click: go('change-list', { category: col('Category'), risk: col('Risk') }), ...stacked('Category', 'Risk', 'Changes'), h: 9, sql: `
WITH top AS (SELECT sub_type FROM reporting.changes GROUP BY 1 ORDER BY count(*) DESC LIMIT 8)
SELECT c.sub_type AS "Category", coalesce(nullif(c.risk, ''), 'Not set') AS "Risk", count(*) AS "Changes"
FROM reporting.changes c JOIN top USING (sub_type)
GROUP BY 1, 2 ORDER BY 1, 2` },

      { name: 'SAP and brewery changes in the next 14 days', links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') }, ...table(24), sql: `
SELECT c.number AS "Change", c.planned_start AS "Planned start",
       CASE WHEN c.has_outage THEN 'Yes' ELSE 'No' END AS "Outage",
       CASE WHEN c.affects_sap THEN 'Yes' ELSE 'No' END AS "SAP",
       coalesce(c.brewery_locations, '') AS "Breweries", c.risk AS "Risk", c.approval AS "Approval",
       c.owner_group AS "Owning team", c.short_description AS "Summary"
FROM reporting.changes c CROSS JOIN reporting.data_as_of a
WHERE (c.affects_sap OR c.affects_brewery) AND c.state <> 'Canceled'
  AND c.planned_start >= a.as_of AND c.planned_start < a.as_of + interval '14 days'
ORDER BY c.planned_start`,
        description: 'Measured from the newest record in the export (1 September 2026), not from today.' },
      { name: 'Changes flagged as a process failure', links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') }, ...table(24), sql: `
SELECT number AS "Change", created_at AS "Created", type AS "Type", sub_type AS "Category", state AS "State",
       close_code AS "Result", owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes WHERE process_failure ORDER BY created_at DESC` },
    ],
  },
  {
    key: 'requests',
    group: 'Requests',
    name: 'Requests',
    description: 'Request Fulfilment: demand, backlog, fulfilment time, SLA and approvals.',
    cards: [
      { name: 'Open requests', click: go('request-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open requests" FROM reporting.requests WHERE is_open` },
      { name: 'Open catalog tasks', click: go('task-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open catalog tasks" FROM reporting.catalog_tasks WHERE is_open` },
      { name: 'Catalog task SLA breaches (%)', click: go('task-list', { sla: 'Breached' }), ...SCALAR, sql: `SELECT round(100.0 * avg(sla_breached::int), 1) AS "SLA breaches (%)" FROM reporting.catalog_tasks` },
      { name: 'Request approvals waiting', ...SCALAR, sql: `SELECT count(*) AS "Request approvals waiting" FROM reporting.approvals WHERE approval_for = 'Request' AND is_waiting` },

      { name: 'Most requested items (top 10)', click: toItem('Item'), ...row('Item', 'Requests'), sql: `
SELECT item AS "Item", count(*) AS "Requests" FROM reporting.requests GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      // "Completed" = fulfilled, or closed without a fulfilled time (same rule as hours_to_fulfil)
      { name: 'Requests opened vs. completed per week', ...line('Week', 'Opened', 'Completed'), sql: `
WITH ${fullPeriods('requests', 'opened_at')},
     o AS (SELECT date_trunc('week', opened_at) AS week, count(*) AS n FROM reporting.requests GROUP BY 1),
     c AS (SELECT date_trunc('week', coalesce(fulfilled_at, closed_at)) AS week, count(*) AS n
           FROM reporting.requests WHERE coalesce(fulfilled_at, closed_at) IS NOT NULL GROUP BY 1)
SELECT coalesce(o.week, c.week)::date AS "Week", coalesce(o.n, 0) AS "Opened", coalesce(c.n, 0) AS "Completed"
FROM o FULL JOIN c ON o.week = c.week
WHERE ${inFullPeriods('coalesce(o.week, c.week)')} ORDER BY 1` },

      { name: 'Fulfilment time for the most requested items', links: { Item: toItem('Item') }, ...table(12), sql: `
SELECT item AS "Item", count(*) AS "Requests",
       round(avg(hours_to_fulfil), 1) AS "Avg hours",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_fulfil))::numeric, 1) AS "Median hours",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.requests GROUP BY 1 ORDER BY 2 DESC LIMIT 15` },
      { name: 'SLA breaches by team', links: { Team: toTeam('Team') }, ...table(12), sql: `
SELECT assignment_group AS "Team", count(*) AS "Tasks",
       count(*) FILTER (WHERE sla_breached) AS "Breached",
       round(100.0 * avg(sla_breached::int), 1) AS "Breached (%)",
       count(*) FILTER (WHERE is_open) AS "Open now"
FROM reporting.catalog_tasks GROUP BY 1 HAVING count(*) >= 50 ORDER BY 3 DESC LIMIT 15` },

      { name: 'Open catalog tasks by team and state', click: go('task-list', { status: 'Open', team: col('Team'), state: col('State') }), ...stacked('Team', 'State', 'Open tasks'), sql: `
WITH top AS (SELECT assignment_group FROM reporting.catalog_tasks WHERE is_open GROUP BY 1 ORDER BY count(*) DESC LIMIT 8)
SELECT t.assignment_group AS "Team", t.state AS "State", count(*) AS "Open tasks"
FROM reporting.catalog_tasks t JOIN top USING (assignment_group) WHERE t.is_open GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Request approvals waiting, by approver group', click: toTeam('Approver group'), ...row('Approver group', 'Waiting'), sql: `
SELECT approver_group AS "Approver group", count(*) AS "Waiting", round(max(waiting_days), 1) AS "Oldest (days)"
FROM reporting.approvals WHERE approval_for = 'Request' AND is_waiting GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
    ],
  },
  {
    key: 'automation',
    group: 'Requests',
    name: 'Automation & Self-service',
    description: 'Where automation and self-service would save the most effort.',
    cards: [
      { name: 'Server start/stop requests', ...SCALAR, sql: `
SELECT count(*) AS "Server start/stop requests" FROM reporting.requests WHERE item IN ${SERVER_POWER_ITEMS}`,
        description: 'Virtual Server Start, Stop, and Start and Snooze requests.' },
      { name: 'Server start/stop requests: weekly average', ...SCALAR, sql: `
WITH ${fullPeriods('requests', 'opened_at')}
SELECT round(count(*)::numeric / nullif(count(DISTINCT date_trunc('week', opened_at)), 0)) AS "Weekly average"
FROM reporting.requests
WHERE item IN ${SERVER_POWER_ITEMS} AND ${inFullPeriods("date_trunc('week', opened_at)")}`,
        description: 'Average over complete weeks.' },
      { name: 'Requests completed within an hour (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((hours_to_fulfil <= 1)::int), 1) AS "Completed within an hour (%)"
FROM reporting.requests WHERE hours_to_fulfil IS NOT NULL` },
      { name: 'Rejected or cancelled requests', click: go('request-list', { outcome: 'Rejected or cancelled' }), ...SCALAR, sql: `
SELECT count(*) AS "Rejected or cancelled requests" FROM reporting.requests
WHERE approval = 'Rejected' OR state = 'Closed Cancelled'`,
        description: 'Effort spent on requests that never went ahead.' },

      { name: 'Automation candidates', links: { 'Catalog item': toItem('Catalog item') }, ...table(24, 8), sql: `
WITH ${fullPeriods('requests', 'opened_at')},
     span AS (SELECT extract(epoch FROM end_period - first_period) / 604800 AS weeks FROM full_periods)
SELECT item AS "Catalog item", count(*) AS "Requests",
       round(count(*) FILTER (WHERE ${inFullPeriods("date_trunc('week', opened_at)")}) / (SELECT weeks FROM span)::numeric, 1) AS "Per week",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_fulfil))::numeric, 1) AS "Median hours to complete",
       round(100.0 * avg((hours_to_fulfil <= 1)::int) FILTER (WHERE hours_to_fulfil IS NOT NULL), 1) AS "Done within 1 hour (%)",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.requests
GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
        description: 'High volume and slow to complete: good candidates for automation. High volume and already done within an hour: probably automated already.' },

      { name: 'Server start/stop requests per week', ...lines('Week', 'Request', 'Requests'), sql: `
WITH ${fullPeriods('requests', 'opened_at')}
SELECT date_trunc('week', opened_at)::date AS "Week",
       CASE item WHEN 'Virtual Server - Start' THEN 'Start' WHEN 'Virtual Server - Stop' THEN 'Stop'
                 ELSE 'Start and snooze' END AS "Request",
       count(*) AS "Requests"
FROM reporting.requests
WHERE item IN ${SERVER_POWER_ITEMS} AND ${inFullPeriods("date_trunc('week', opened_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Password and account issues by channel', click: go('incident-list', { subcategory: col('Issue'), channel: col('Channel') }), ...stacked('Issue', 'Channel', 'Incidents'), sql: `
SELECT subcategory AS "Issue", contact_type AS "Channel", count(*) AS "Incidents"
FROM reporting.incidents WHERE subcategory IN ${ACCOUNT_SUBCATEGORIES}
GROUP BY 1, 2 ORDER BY 1, 2`,
        description: 'Phone, chat and email contacts here are candidates for self-service password reset and unlock.' },

      { name: 'Most rejected or cancelled items (top 10)', click: toItem('Catalog item'), ...row('Catalog item', 'Rejected or cancelled'), sql: `
SELECT item AS "Catalog item", count(*) AS "Rejected or cancelled"
FROM reporting.requests WHERE approval = 'Rejected' OR state = 'Closed Cancelled'
GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Requests by order guide', click: go('request-list', { guide: col('Order guide') }), ...row('Order guide', 'Requests'), sql: `
SELECT coalesce(order_guide, 'Ordered directly (no guide)') AS "Order guide", count(*) AS "Requests"
FROM reporting.requests GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        description: 'Order guides bundle several items into one form, e.g. for new hires.' },
    ],
  },
];

// ---------------------------------------------------------------------
// DETAIL DASHBOARDS: what the clicks above open. Not in the drawer; each
// takes filters (`params`) from the link. {{slug}} in a card's SQL is filled
// from the filter with that slug. Record pages (incident, change, request)
// put a one-row "Go to" table under the record, because Metabase's record
// view can't hold links.
// ---------------------------------------------------------------------

// Lists: every filter is optional; Metabase leaves out a [[...]] part when
// its filter is empty. Each entry: [slug, label, SQL condition].
const listParams = filters => filters.map(([slug, name]) => ({ slug, name }));
const listWhere = filters => `WHERE true\n${filters.map(([, , cond]) => `  [[AND ${cond}]]`).join('\n')}`;
const OPEN_OR_CLOSED = slug => `CASE WHEN is_open THEN 'Open' ELSE 'Closed' END = {{${slug}}}`;

const INCIDENT_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status')],
  ['priority', 'Priority', 'priority = {{priority}}'],
  ['subcategory', 'Subcategory', 'subcategory = {{subcategory}}'],
  ['channel', 'Reported via', 'contact_type = {{channel}}'],
  ['source', 'Source', 'source = {{source}}'],
  ['age', 'Open for', 'is_open AND substr(age_bucket, 4) = {{age}}'],
  ['older_than', 'Open at least (days)', 'age_days >= CAST({{older_than}} AS numeric)'],
  ['hour', 'Hour of day', "to_char(created_at, 'HH24') = {{hour}}"],
  ['weekday', 'Day of week', "to_char(created_at, 'Dy') = {{weekday}}"],
  // Chart clicks send dates as 2026-08-17T00:00:00Z
  ['date', 'Date', 'created_at::date = CAST(left({{date}}, 10) AS date)'],
  ['team', 'Team', 'assignment_group = {{team}}'],
  ['system', 'Server / system', 'configuration_item = {{system}}'],
  ['site', 'Site', 'location = {{site}}'],
  ['kb', 'Knowledge article', 'kb_article = {{kb}}'],
  ['workaround', 'Closed with a workaround', "closed_with_workaround = ({{workaround}} = 'Yes')"],
  ['reopened', 'Reopened', "(reopen_count > 0) = ({{reopened}} = 'Yes')"],
  ['reassigned', 'Reassigned', "was_reassigned = ({{reassigned}} = 'Yes')"],
  ['waiting', 'Status detail', "is_open AND (CASE WHEN state = 'On Hold' THEN 'On hold: ' || coalesce(on_hold_reason, 'no reason given') ELSE state END) = {{waiting}}"],
  ['assignee', 'Assigned to', 'assigned_to = {{assignee}}'],
  ['opened_by', 'Raised by', "coalesce(opened_by_group, 'Not recorded') = {{opened_by}}"],
];

const CHANGE_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status')],
  ['type', 'Type', 'type = {{type}}'],
  ['risk', 'Risk', "coalesce(nullif(risk, ''), 'Not set') = {{risk}}"],
  ['category', 'Category', 'sub_type = {{category}}'],
  ['environment', 'Environment', "coalesce(environment, 'Not set') = {{environment}}"],
  ['outage', 'Outage', "has_outage = ({{outage}} = 'Yes')"],
  ['approval', 'Approval', 'approval = {{approval}}'],
  ['sap', 'Affects SAP', "affects_sap = ({{sap}} = 'Yes')"],
  ['transport', 'Needs SAP transport', "needs_sap_transport = ({{transport}} = 'Yes')"],
  ['brewery', 'Affects breweries', "affects_brewery = ({{brewery}} = 'Yes')"],
  ['process_failure', 'Process failure', "process_failure = ({{process_failure}} = 'Yes')"],
  ['urgent', 'Emergency or expedited', "is_emergency_or_expedited = ({{urgent}} = 'Yes')"],
  ['starts_within', 'Starts within (days)', "state <> 'Canceled' AND planned_start >= (SELECT as_of FROM reporting.data_as_of) AND planned_start < (SELECT as_of FROM reporting.data_as_of) + make_interval(days => CAST({{starts_within}} AS int))"],
];

const REQUEST_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status')],
  ['item', 'Catalog item', 'item = {{item}}'],
  ['site', 'Site', 'location = {{site}}'],
  ['approval', 'Approval', 'approval = {{approval}}'],
  ['outcome', 'Outcome', "{{outcome}} = 'Rejected or cancelled' AND (approval = 'Rejected' OR state = 'Closed Cancelled')"],
  ['guide', 'Order guide', "coalesce(order_guide, 'Ordered directly (no guide)') = {{guide}}"],
];

const TASK_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status')],
  ['team', 'Team', 'assignment_group = {{team}}'],
  ['state', 'State', 'state = {{state}}'],
  ['sla', 'SLA', "CASE WHEN sla_breached THEN 'Breached' ELSE 'Met' END = {{sla}}"],
  ['item', 'Catalog item', 'item = {{item}}'],
];

// Full-width record view, and the clickable "Go to" row under it
const RECORD = { display: 'object', w: 24, h: 12 };
const GO_TO = { display: 'table', w: 24, h: 3 };

const DETAILS = [
  {
    key: 'incident-detail',
    name: 'Incident',
    params: [{ slug: 'number', name: 'Incident' }],
    cards: [
      { name: 'Incident record', ...RECORD, h: 14, sql: `
SELECT number AS "Incident", short_description AS "Summary", state AS "State", priority AS "Priority",
       impact AS "Impact", urgency AS "Urgency", category AS "Category", subcategory AS "Subcategory",
       assignment_group AS "Team", nullif(assigned_to, '') AS "Assigned to", configuration_item AS "Server / system",
       nullif(location, '') AS "Site", contact_type AS "Reported via", source AS "Source", opened_by_group AS "Opened by",
       created_at AS "Created", resolved_at AS "Resolved", closed_at AS "Closed", hours_to_resolve AS "Hours to resolve",
       reassignment_count AS "Times reassigned", reopen_count AS "Times reopened", on_hold_reason AS "On hold because",
       close_code AS "Close result", cause_code AS "Cause", problem AS "Problem", kb_article AS "Knowledge article",
       caused_by_change AS "Caused by change", CASE WHEN was_p1 THEN 'Yes' ELSE 'No' END AS "Ever P1",
       description AS "Description", close_notes AS "Close notes"
FROM reporting.incidents WHERE number = {{number}}` },
      { name: 'Go to', ...GO_TO, description: 'Click a value to open its page.', sql: `
SELECT assignment_group AS "Team", configuration_item AS "Server / system", nullif(location, '') AS "Site",
       problem AS "Problem", caused_by_change AS "Caused by change"
FROM reporting.incidents WHERE number = {{number}}`,
        links: { Team: toTeam('Team'), 'Server / system': toSystem('Server / system'), Site: toSite('Site'), Problem: toProblem('Problem'), 'Caused by change': toChange('Caused by change') } },
      { name: 'Other incidents on the same system', ...table(24, 8), sql: `
SELECT i.number AS "Incident", i.created_at AS "Created", i.priority AS "Priority", i.state AS "State",
       i.subcategory AS "Subcategory", i.short_description AS "Summary"
FROM reporting.incidents i
WHERE i.configuration_item = (SELECT configuration_item FROM reporting.incidents WHERE number = {{number}})
  AND i.number <> {{number}}
ORDER BY i.created_at DESC LIMIT 25`,
        links: { Incident: toIncident('Incident') } },
    ],
  },
  {
    key: 'change-detail',
    name: 'Change',
    params: [{ slug: 'number', name: 'Change' }],
    cards: [
      { name: 'Change record', ...RECORD, h: 14, sql: `
SELECT number AS "Change", short_description AS "Summary", type AS "Type", sub_type AS "Category", state AS "State",
       approval AS "Approval", risk AS "Risk", environment AS "Environment",
       CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage",
       planned_start AS "Planned start", planned_end AS "Planned end", planned_hours AS "Planned hours",
       lead_days AS "Days of notice", owner_group AS "Owning team", configuration_item AS "Server / system",
       CASE WHEN affects_sap THEN 'Yes' ELSE 'No' END AS "Affects SAP",
       CASE WHEN needs_sap_transport THEN 'Yes' ELSE 'No' END AS "Needs SAP transport",
       brewery_locations AS "Breweries", close_code AS "Result", failure_code AS "Failure",
       CASE WHEN process_failure THEN 'Yes' ELSE 'No' END AS "Process failure",
       linked_incident AS "Linked incident", linked_problem AS "Linked problem", project AS "Project",
       created_at AS "Created", purpose_of_change AS "Purpose", description AS "Description"
FROM reporting.changes WHERE number = {{number}}` },
      { name: 'Go to', ...GO_TO, description: 'Click a value to open its page.', sql: `
SELECT owner_group AS "Owning team", configuration_item AS "Server / system",
       linked_incident AS "Linked incident", linked_problem AS "Linked problem"
FROM reporting.changes WHERE number = {{number}}`,
        links: { 'Owning team': toTeam('Owning team'), 'Server / system': toSystem('Server / system'), 'Linked incident': toIncident('Linked incident'), 'Linked problem': toProblem('Linked problem') } },
      { name: 'Approvals for this change', ...table(12), sql: `
SELECT approver_group AS "Approver group", approval AS "Approval", state AS "State",
       created_at AS "Requested", waiting_days AS "Waiting (days)"
FROM reporting.approvals WHERE approval_for = 'Change' AND parent = {{number}} ORDER BY created_at`,
        links: { 'Approver group': toTeam('Approver group') } },
      { name: 'Incidents caused by this change', ...table(12), sql: `
SELECT number AS "Incident", created_at AS "Created", priority AS "Priority",
       assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE caused_by_change = {{number}} ORDER BY created_at DESC`,
        links: { Incident: toIncident('Incident'), Team: toTeam('Team') } },
      { name: 'Breweries affected', ...table(24, 5), sql: `
SELECT brewery AS "Brewery" FROM reporting.change_breweries WHERE number = {{number}} ORDER BY 1`,
        links: { Brewery: toSite('Brewery') } },
    ],
  },
  {
    key: 'request-detail',
    name: 'Request',
    params: [{ slug: 'number', name: 'Request' }],
    cards: [
      { name: 'Request record', ...RECORD, sql: `
SELECT number AS "Request", item AS "Catalog item", short_description AS "Summary", state AS "State", stage AS "Stage",
       approval AS "Approval", opened_at AS "Opened", fulfilled_at AS "Fulfilled", closed_at AS "Closed",
       hours_to_fulfil AS "Hours to complete", age_days AS "Open for (days)", nullif(location, '') AS "Site",
       requested_for AS "Requested for", order_guide AS "Order guide"
FROM reporting.requests WHERE number = {{number}}` },
      { name: 'Go to', ...GO_TO, description: 'Click a value to open its page.', sql: `
SELECT item AS "Catalog item", nullif(location, '') AS "Site" FROM reporting.requests WHERE number = {{number}}`,
        links: { 'Catalog item': toItem('Catalog item'), Site: toSite('Site') } },
      { name: 'Catalog tasks for this request', ...table(12), sql: `
SELECT number AS "Task", assignment_group AS "Team", state AS "State",
       CASE WHEN sla_breached THEN 'Yes' ELSE 'No' END AS "SLA breached",
       created_at AS "Created", age_days AS "Open for (days)"
FROM reporting.catalog_tasks WHERE request_item = {{number}} ORDER BY created_at`,
        links: { Team: toTeam('Team') } },
      { name: 'Approvals for this request', ...table(12), sql: `
SELECT approver_group AS "Approver group", approval AS "Approval", state AS "State",
       created_at AS "Requested", waiting_days AS "Waiting (days)"
FROM reporting.approvals WHERE approval_for = 'Request' AND parent = {{number}} ORDER BY created_at`,
        links: { 'Approver group': toTeam('Approver group') } },
    ],
  },
  {
    key: 'team-detail',
    name: 'Team',
    params: [{ slug: 'team', name: 'Team' }],
    cards: [
      { name: 'Open incidents', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Open incidents" FROM reporting.incidents WHERE assignment_group = {{team}}` },
      { name: 'Average hours to resolve', ...SCALAR, sql: `SELECT round(avg(hours_to_resolve), 1) AS "Average hours to resolve" FROM reporting.incidents WHERE assignment_group = {{team}}` },
      { name: 'Open catalog tasks', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Open catalog tasks" FROM reporting.catalog_tasks WHERE assignment_group = {{team}}` },
      { name: 'Approvals waiting on this team', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_waiting) AS "Approvals waiting" FROM reporting.approvals WHERE approver_group = {{team}}` },

      { name: 'Incidents opened per week', ...line('Week', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", count(*) AS "Incidents"
FROM reporting.incidents
WHERE assignment_group = {{team}} AND ${inFullPeriods("date_trunc('week', created_at)")}
GROUP BY 1 ORDER BY 1` },
      { name: 'Systems this team works on (top 10)', ...row('Server / system', 'Incidents'), sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Incidents"
FROM reporting.incidents WHERE assignment_group = {{team}} AND configuration_item IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toSystem('Server / system') },

      { name: 'Open incidents', ...table(24, 8), sql: `
SELECT number AS "Incident", priority AS "Priority", state AS "State", age_days AS "Open for (days)",
       configuration_item AS "Server / system", short_description AS "Summary"
FROM reporting.incidents WHERE assignment_group = {{team}} AND is_open
ORDER BY age_days DESC LIMIT 100`,
        links: { Incident: toIncident('Incident'), 'Server / system': toSystem('Server / system') } },

      { name: 'Issue types', ...table(12), sql: `
SELECT subcategory AS "Subcategory", count(*) AS "Incidents", count(*) FILTER (WHERE is_open) AS "Open now",
       round(avg(hours_to_resolve), 1) AS "Avg hours to resolve", assignment_group AS "Team"
FROM reporting.incidents WHERE assignment_group = {{team}}
GROUP BY subcategory, assignment_group ORDER BY 2 DESC LIMIT 15`,
        links: { Subcategory: go('incident-list', { team: col('Team'), subcategory: col('Subcategory') }) } },
      { name: 'Open incidents per person', ...row('Assigned to', 'Open incidents'), sql: `
SELECT assigned_to AS "Assigned to", count(*) AS "Open incidents"
FROM reporting.incidents WHERE assignment_group = {{team}} AND is_open AND nullif(assigned_to, '') IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: go('incident-list', { status: 'Open', assignee: col('Assigned to') }) },

      { name: 'Open catalog tasks', ...table(12), sql: `
SELECT number AS "Task", request_item AS "Request", item AS "Catalog item", state AS "State",
       CASE WHEN sla_breached THEN 'Yes' ELSE 'No' END AS "SLA breached", age_days AS "Open for (days)"
FROM reporting.catalog_tasks WHERE assignment_group = {{team}} AND is_open
ORDER BY age_days DESC LIMIT 100`,
        links: { Request: toRequest('Request'), 'Catalog item': toItem('Catalog item') } },
      { name: 'Approvals waiting on this team', ...table(12), sql: `
SELECT CASE WHEN approval_for = 'Change' THEN parent END AS "Change",
       CASE WHEN approval_for = 'Request' THEN parent END AS "Request",
       created_at AS "Requested", waiting_days AS "Waiting (days)"
FROM reporting.approvals WHERE approver_group = {{team}} AND is_waiting
ORDER BY waiting_days DESC LIMIT 100`,
        links: { Change: toChange('Change'), Request: toRequest('Request') } },

      { name: 'Changes owned by this team', ...table(24), sql: `
SELECT number AS "Change", planned_start AS "Planned start", type AS "Type", risk AS "Risk", state AS "State",
       CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage", short_description AS "Summary"
FROM reporting.changes WHERE owner_group = {{team}}
ORDER BY planned_start DESC NULLS LAST LIMIT 50`,
        links: { Change: toChange('Change') } },
    ],
  },
  {
    key: 'system-detail',
    name: 'Server / system',
    params: [{ slug: 'system', name: 'Server / system' }],
    cards: [
      { name: 'Incidents', ...SCALAR, sql: `SELECT count(*) AS "Incidents" FROM reporting.incidents WHERE configuration_item = {{system}}` },
      { name: 'From monitoring (%)', ...SCALAR, sql: `SELECT round(100.0 * avg((source = 'Monitoring alert')::int), 1) AS "From monitoring (%)" FROM reporting.incidents WHERE configuration_item = {{system}}` },
      { name: 'Open incidents', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Open incidents" FROM reporting.incidents WHERE configuration_item = {{system}}` },
      { name: 'Changes to this system', ...SCALAR, sql: `SELECT count(*) AS "Changes" FROM reporting.changes WHERE configuration_item = {{system}}` },

      { name: 'Incidents and changes per week', ...line('Week', 'Incidents', 'Changes'), sql: `
WITH ${fullPeriods('incidents', 'created_at')},
     inc AS (SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM reporting.incidents WHERE configuration_item = {{system}} GROUP BY 1),
     chg AS (SELECT date_trunc('week', planned_start) AS week, count(*) AS n FROM reporting.changes WHERE configuration_item = {{system}} GROUP BY 1),
     weeks AS (SELECT generate_series((SELECT first_period FROM full_periods), (SELECT end_period FROM full_periods) - interval '1 week', interval '1 week') AS week)
SELECT w.week::date AS "Week", coalesce(inc.n, 0) AS "Incidents", coalesce(chg.n, 0) AS "Changes"
FROM weeks w LEFT JOIN inc USING (week) LEFT JOIN chg USING (week) ORDER BY 1`,
        description: 'Changes by the week they were planned to start. A change followed by a jump in incidents is worth a look.' },
      { name: 'Teams handling it', ...row('Team', 'Incidents'), sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents"
FROM reporting.incidents WHERE configuration_item = {{system}} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toTeam('Team') },

      { name: 'Issue types', ...table(24, 6), sql: `
SELECT subcategory AS "Subcategory", count(*) AS "Incidents",
       round(100.0 * avg((source = 'Monitoring alert')::int)) AS "From monitoring (%)",
       count(*) FILTER (WHERE is_open) AS "Open now", configuration_item AS "Server / system"
FROM reporting.incidents WHERE configuration_item = {{system}}
GROUP BY subcategory, configuration_item ORDER BY 2 DESC LIMIT 15`,
        links: { Subcategory: go('incident-list', { system: col('Server / system'), subcategory: col('Subcategory') }) } },

      { name: 'Recent incidents', ...table(24, 8), sql: `
SELECT number AS "Incident", created_at AS "Created", priority AS "Priority", state AS "State",
       assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE configuration_item = {{system}}
ORDER BY created_at DESC LIMIT 100`,
        links: { Incident: toIncident('Incident'), Team: toTeam('Team') } },
      { name: 'Changes to this system', ...table(24), sql: `
SELECT number AS "Change", planned_start AS "Planned start", type AS "Type", risk AS "Risk", state AS "State",
       owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes WHERE configuration_item = {{system}}
ORDER BY planned_start DESC NULLS LAST LIMIT 50`,
        links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') } },
    ],
  },
  {
    key: 'site-detail',
    name: 'Site',
    params: [{ slug: 'site', name: 'Site' }],
    cards: [
      { name: 'Incidents', ...SCALAR, sql: `SELECT count(*) AS "Incidents" FROM reporting.incidents WHERE location = {{site}}` },
      { name: 'Open incidents', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Open incidents" FROM reporting.incidents WHERE location = {{site}}` },
      { name: 'Requests', ...SCALAR, sql: `SELECT count(*) AS "Requests" FROM reporting.requests WHERE location = {{site}}` },
      { name: 'Changes at this brewery', ...SCALAR, sql: `SELECT count(*) AS "Changes at this brewery" FROM reporting.change_breweries WHERE brewery = {{site}}`,
        description: 'Only breweries are recorded on changes.' },

      { name: 'Incidents opened per week', ...line('Week', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", count(*) AS "Incidents"
FROM reporting.incidents
WHERE location = {{site}} AND ${inFullPeriods("date_trunc('week', created_at)")}
GROUP BY 1 ORDER BY 1` },
      { name: 'Most requested items here', ...row('Catalog item', 'Requests'), sql: `
SELECT item AS "Catalog item", count(*) AS "Requests"
FROM reporting.requests WHERE location = {{site}} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toItem('Catalog item') },

      { name: 'Issue types', ...table(12), sql: `
SELECT subcategory AS "Subcategory", count(*) AS "Incidents", count(*) FILTER (WHERE is_open) AS "Open now",
       location AS "Site"
FROM reporting.incidents WHERE location = {{site}}
GROUP BY subcategory, location ORDER BY 2 DESC LIMIT 15`,
        links: { Subcategory: go('incident-list', { site: col('Site'), subcategory: col('Subcategory') }) } },
      { name: 'Open incidents', ...table(12), sql: `
SELECT number AS "Incident", priority AS "Priority", state AS "State", age_days AS "Open for (days)",
       assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE location = {{site}} AND is_open
ORDER BY age_days DESC LIMIT 100`,
        links: { Incident: toIncident('Incident'), Team: toTeam('Team') } },

      { name: 'Changes at this brewery', ...table(24), sql: `
SELECT number AS "Change", planned_start AS "Planned start", type AS "Type", risk AS "Risk",
       CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage", state AS "State", short_description AS "Summary"
FROM reporting.change_breweries WHERE brewery = {{site}}
ORDER BY planned_start DESC NULLS LAST LIMIT 50`,
        links: { Change: toChange('Change') } },
    ],
  },
  {
    key: 'problem-detail',
    name: 'Problem',
    params: [{ slug: 'problem', name: 'Problem' }],
    cards: [
      { name: 'Linked incidents', ...SCALAR, sql: `SELECT count(*) AS "Linked incidents" FROM reporting.incidents WHERE problem = {{problem}}` },
      { name: 'Still open', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Still open" FROM reporting.incidents WHERE problem = {{problem}}` },
      { name: 'Systems affected', ...SCALAR, sql: `SELECT count(DISTINCT configuration_item) AS "Systems affected" FROM reporting.incidents WHERE problem = {{problem}}` },
      { name: 'Average hours to resolve', ...SCALAR, sql: `SELECT round(avg(hours_to_resolve), 1) AS "Average hours to resolve" FROM reporting.incidents WHERE problem = {{problem}}` },

      { name: 'Linked incidents per week', ...line('Week', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", count(*) AS "Incidents"
FROM reporting.incidents
WHERE problem = {{problem}} AND ${inFullPeriods("date_trunc('week', created_at)")}
GROUP BY 1 ORDER BY 1` },
      { name: 'Systems affected', ...row('Server / system', 'Incidents'), sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Incidents"
FROM reporting.incidents WHERE problem = {{problem}} AND configuration_item IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toSystem('Server / system') },

      { name: 'Linked incidents', ...table(24, 8), sql: `
SELECT number AS "Incident", created_at AS "Created", priority AS "Priority", state AS "State",
       configuration_item AS "Server / system", assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE problem = {{problem}}
ORDER BY created_at DESC LIMIT 200`,
        links: { Incident: toIncident('Incident'), 'Server / system': toSystem('Server / system'), Team: toTeam('Team') } },
      { name: 'Teams involved', ...row('Team', 'Incidents'), sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents"
FROM reporting.incidents WHERE problem = {{problem}} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toTeam('Team') },
      { name: 'Changes linked to this problem', ...table(12), sql: `
SELECT number AS "Change", planned_start AS "Planned start", type AS "Type", state AS "State",
       owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes WHERE linked_problem = {{problem}}
ORDER BY planned_start DESC NULLS LAST`,
        links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') } },
    ],
  },
  {
    key: 'item-detail',
    name: 'Catalog item',
    params: [{ slug: 'item', name: 'Catalog item' }],
    cards: [
      { name: 'Requests', ...SCALAR, sql: `SELECT count(*) AS "Requests" FROM reporting.requests WHERE item = {{item}}` },
      { name: 'Median hours to complete', ...SCALAR, sql: `
SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_fulfil))::numeric, 1) AS "Median hours to complete"
FROM reporting.requests WHERE item = {{item}}` },
      { name: 'Done within 1 hour (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((hours_to_fulfil <= 1)::int), 1) AS "Done within 1 hour (%)"
FROM reporting.requests WHERE item = {{item}} AND hours_to_fulfil IS NOT NULL` },
      { name: 'Still open', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Still open" FROM reporting.requests WHERE item = {{item}}` },

      { name: 'Opened vs. completed per week', ...line('Week', 'Opened', 'Completed'), sql: `
WITH ${fullPeriods('requests', 'opened_at')},
     o AS (SELECT date_trunc('week', opened_at) AS week, count(*) AS n FROM reporting.requests WHERE item = {{item}} GROUP BY 1),
     c AS (SELECT date_trunc('week', coalesce(fulfilled_at, closed_at)) AS week, count(*) AS n
           FROM reporting.requests WHERE item = {{item}} AND coalesce(fulfilled_at, closed_at) IS NOT NULL GROUP BY 1)
SELECT coalesce(o.week, c.week)::date AS "Week", coalesce(o.n, 0) AS "Opened", coalesce(c.n, 0) AS "Completed"
FROM o FULL JOIN c ON o.week = c.week
WHERE ${inFullPeriods('coalesce(o.week, c.week)')} ORDER BY 1` },
      { name: 'Requests by site', ...row('Site', 'Requests'), sql: `
SELECT location AS "Site", count(*) AS "Requests"
FROM reporting.requests WHERE item = {{item}} AND nullif(location, '') IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toSite('Site') },

      { name: 'Open requests', ...table(24, 8), sql: `
SELECT number AS "Request", state AS "State", stage AS "Stage", opened_at AS "Opened",
       age_days AS "Open for (days)", nullif(location, '') AS "Site", requested_for AS "Requested for"
FROM reporting.requests WHERE item = {{item}} AND is_open
ORDER BY age_days DESC LIMIT 100`,
        links: { Request: toRequest('Request'), Site: toSite('Site') } },
      { name: 'Teams fulfilling it', ...table(12), sql: `
SELECT assignment_group AS "Team", count(*) AS "Tasks", count(*) FILTER (WHERE sla_breached) AS "SLA breached",
       round(100.0 * avg(sla_breached::int), 1) AS "Breached (%)", count(*) FILTER (WHERE is_open) AS "Open now"
FROM reporting.catalog_tasks WHERE item = {{item}} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
        links: { Team: toTeam('Team') } },
      { name: 'Approval outcomes', ...table(12), sql: `
SELECT approval AS "Approval", count(*) AS "Requests", item AS "Catalog item"
FROM reporting.requests WHERE item = {{item}} GROUP BY approval, item ORDER BY 2 DESC`,
        links: { Approval: go('request-list', { item: col('Catalog item'), approval: col('Approval') }) } },
    ],
  },
  {
    key: 'incident-list',
    name: 'Incidents',
    params: listParams(INCIDENT_FILTERS),
    cards: [
      { name: 'Matching incidents', ...SCALAR, sql: `SELECT count(*) AS "Matching incidents" FROM reporting.incidents ${listWhere(INCIDENT_FILTERS)}` },
      { name: 'By team (top 8)', ...row('Team', 'Incidents'), w: 9, h: 6, sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents" FROM reporting.incidents ${listWhere(INCIDENT_FILTERS)}
GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        click: toTeam('Team') },
      { name: 'By server / system (top 8)', ...row('Server / system', 'Incidents'), w: 9, h: 6, sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Incidents" FROM reporting.incidents ${listWhere(INCIDENT_FILTERS)}
  AND configuration_item IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        click: toSystem('Server / system') },
      { name: 'Incidents', ...table(24, 10), description: 'Newest first, up to 500.', sql: `
SELECT number AS "Incident", created_at AS "Created", priority AS "Priority", state AS "State",
       assignment_group AS "Team", configuration_item AS "Server / system", subcategory AS "Subcategory",
       short_description AS "Summary"
FROM reporting.incidents ${listWhere(INCIDENT_FILTERS)}
ORDER BY created_at DESC LIMIT 500`,
        links: { Incident: toIncident('Incident'), Team: toTeam('Team'), 'Server / system': toSystem('Server / system') } },
    ],
  },
  {
    key: 'change-list',
    name: 'Changes',
    params: listParams(CHANGE_FILTERS),
    cards: [
      { name: 'Matching changes', ...SCALAR, sql: `SELECT count(*) AS "Matching changes" FROM reporting.changes ${listWhere(CHANGE_FILTERS)}` },
      { name: 'By owning team (top 8)', ...row('Owning team', 'Changes'), w: 18, h: 6, sql: `
SELECT owner_group AS "Owning team", count(*) AS "Changes" FROM reporting.changes ${listWhere(CHANGE_FILTERS)}
GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        click: toTeam('Owning team') },
      { name: 'Changes', ...table(24, 10), description: 'Latest planned start first, up to 500.', sql: `
SELECT number AS "Change", planned_start AS "Planned start", type AS "Type", risk AS "Risk", state AS "State",
       approval AS "Approval", CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage",
       owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes ${listWhere(CHANGE_FILTERS)}
ORDER BY planned_start DESC NULLS LAST LIMIT 500`,
        links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') } },
    ],
  },
  {
    key: 'request-list',
    name: 'Requests',
    params: listParams(REQUEST_FILTERS),
    cards: [
      { name: 'Matching requests', ...SCALAR, sql: `SELECT count(*) AS "Matching requests" FROM reporting.requests ${listWhere(REQUEST_FILTERS)}` },
      { name: 'By catalog item (top 8)', ...row('Catalog item', 'Requests'), w: 18, h: 6, sql: `
SELECT item AS "Catalog item", count(*) AS "Requests" FROM reporting.requests ${listWhere(REQUEST_FILTERS)}
GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        click: toItem('Catalog item') },
      { name: 'Requests', ...table(24, 10), description: 'Newest first, up to 500.', sql: `
SELECT number AS "Request", item AS "Catalog item", state AS "State", stage AS "Stage", opened_at AS "Opened",
       age_days AS "Open for (days)", nullif(location, '') AS "Site", requested_for AS "Requested for"
FROM reporting.requests ${listWhere(REQUEST_FILTERS)}
ORDER BY opened_at DESC LIMIT 500`,
        links: { Request: toRequest('Request'), 'Catalog item': toItem('Catalog item'), Site: toSite('Site') } },
    ],
  },
  {
    key: 'task-list',
    name: 'Catalog tasks',
    params: listParams(TASK_FILTERS),
    cards: [
      { name: 'Matching catalog tasks', ...SCALAR, sql: `SELECT count(*) AS "Matching catalog tasks" FROM reporting.catalog_tasks ${listWhere(TASK_FILTERS)}` },
      { name: 'By team (top 8)', ...row('Team', 'Tasks'), w: 18, h: 6, sql: `
SELECT assignment_group AS "Team", count(*) AS "Tasks" FROM reporting.catalog_tasks ${listWhere(TASK_FILTERS)}
GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        click: toTeam('Team') },
      { name: 'Catalog tasks', ...table(24, 10), description: 'Newest first, up to 500.', sql: `
SELECT number AS "Task", request_item AS "Request", item AS "Catalog item", assignment_group AS "Team", state AS "State",
       CASE WHEN sla_breached THEN 'Breached' ELSE 'Met' END AS "SLA", created_at AS "Created", age_days AS "Open for (days)"
FROM reporting.catalog_tasks ${listWhere(TASK_FILTERS)}
ORDER BY created_at DESC LIMIT 500`,
        links: { Request: toRequest('Request'), 'Catalog item': toItem('Catalog item'), Team: toTeam('Team') } },
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

// The {{name}} variables a card's SQL uses, as Metabase template tags. Each
// must be one of the dashboard's filters (`params`), which fill it.
function templateTags(sql, def) {
  const names = [...new Set([...sql.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(m => m[1]))];
  return Object.fromEntries(names.map(name => {
    const param = (def.params || []).find(p => p.slug === name);
    if (!param) throw new Error(`"${def.name}": {{${name}}} is not one of its filters.`);
    return [name, { id: randomUUID(), name, 'display-name': param.name, type: 'text' }];
  }));
}

// A click (go(...)) as a Metabase click behaviour: a link to the target's
// public page, its filters set from the clicked row (Metabase URL-encodes
// {{Column}} values) or to fixed text. Filters the link doesn't set are
// hidden, and the page title too: OneTouch's toolbar names the page.
function clickBehavior(link, shells) {
  const target = shells.get(link.to);
  if (!target) throw new Error(`Click target "${link.to}" is not a dashboard.`);
  const slugs = (target.def.params || []).map(p => p.slug);
  const query = Object.entries(link.params).map(([slug, value]) => {
    if (!slugs.includes(slug)) throw new Error(`"${target.def.name}" has no filter "${slug}".`);
    return `${slug}=${value.col ? `{{${value.col}}}` : encodeURIComponent(value)}`;
  }).join('&');
  const unused = slugs.filter(s => !(s in link.params));
  const hash = ['titled=false', 'bordered=false', ...(unused.length ? [`hide_parameters=${unused.join(',')}`] : [])].join('&');
  return { type: 'link', linkType: 'url', linkTemplate: `/public/dashboard/${target.uuid}?${query}#${hash}` };
}

// A card's click settings for its dashboard: whole-card `click`, per-column `links`
function clickSettings(c, shells) {
  const settings = {};
  if (c.click) settings.click_behavior = clickBehavior(c.click, shells);
  if (c.links) {
    settings.column_settings = Object.fromEntries(Object.entries(c.links).map(([column, link]) =>
      [JSON.stringify(['name', column]), { click_behavior: clickBehavior(link, shells) }]));
  }
  return settings;
}

// Catches mistakes in DASHBOARDS / DETAILS before anything in Metabase changes
function checkDefinitions() {
  const all = [...DASHBOARDS, ...DETAILS];
  const keys = all.map(d => d.key);
  const dupe = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dupe) throw new Error(`Two dashboards use the key "${dupe}".`);
  const fake = new Map(all.map(def => [def.key, { def, uuid: 'check' }]));
  for (const def of all) {
    for (const c of def.cards) {
      templateTags(c.sql, def);
      clickSettings(c, fake);
    }
  }
}

// Step 1: an empty dashboard with its public link, so every page's address
// is known before any link to it is written
async function createShell(def, collectionId) {
  const dash = await api('POST', '/api/dashboard', { name: def.name, description: def.description || null, collection_id: collectionId });
  const { uuid } = await api('POST', `/api/dashboard/${dash.id}/public_link`);
  return { id: dash.id, uuid, def };
}

// Step 2: its cards, filters, and what clicking each card opens
async function fillDashboard(shell, databaseId, collectionId, shells) {
  const { def } = shell;
  const positions = layout(def.cards);
  const dashcards = [];
  for (const [i, c] of def.cards.entries()) {
    const tags = templateTags(c.sql, def);
    const card = await api('POST', '/api/card', {
      name: c.name,
      // Shown as the (i) tip on the chart: how to read it
      description: c.description || null,
      collection_id: collectionId,
      display: c.display,
      visualization_settings: c.viz || {},
      dataset_query: { type: 'native', native: { query: c.sql.trim(), 'template-tags': tags }, database: databaseId },
    });
    dashcards.push({
      id: -(i + 1), card_id: card.id, ...positions[i],
      visualization_settings: clickSettings(c, shells),
      parameter_mappings: Object.keys(tags).map(tag => ({
        parameter_id: `p_${tag}`, card_id: card.id, target: ['variable', ['template-tag', tag]],
      })),
    });
  }
  await api('PUT', `/api/dashboard/${shell.id}`, {
    parameters: (def.params || []).map(p => ({ id: `p_${p.slug}`, name: p.name, slug: p.slug, type: 'string/=', sectionId: 'string' })),
    dashcards,
  });
  console.log(`Built "${def.name}"${def.params ? ' (detail page)' : ''}: ${def.cards.length} charts.`);
}

// ---------------------------------------------------------------------

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !READER_PASSWORD) {
    throw new Error('Set METABASE_ADMIN_EMAIL, METABASE_ADMIN_PASSWORD and METABASE_DB_PASSWORD in .env, ' +
      'then run `docker compose up -d` so the app container sees them.');
  }
  checkDefinitions();
  await waitForMetabase();
  await signIn();
  await api('PUT', '/api/setting/enable-public-sharing', { value: true });
  const databaseId = await connectDatabase();
  const collectionId = await freshCollection();

  const shells = new Map();
  for (const def of [...DASHBOARDS, ...DETAILS]) shells.set(def.key, await createShell(def, collectionId));
  for (const shell of shells.values()) await fillDashboard(shell, databaseId, collectionId, shells);

  // The drawer lists `dashboards`; `details` lets OneTouch name the page a click opened
  await writeFile(OUTPUT_FILE, JSON.stringify({
    dashboards: DASHBOARDS.map(d => ({ key: d.key, group: d.group, name: d.name, description: d.description, uuid: shells.get(d.key).uuid })),
    details: DETAILS.map(d => ({ key: d.key, name: d.name, uuid: shells.get(d.key).uuid, params: d.params })),
  }, null, 2) + '\n');
  console.log(`Saved the public links to ${OUTPUT_FILE}; the OneTouch Dashboards tab shows them now.`);
}

try {
  await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
