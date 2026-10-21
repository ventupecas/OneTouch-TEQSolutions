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
      { name: 'SLA breaches per week', ...TREND, sql: weeklyTrend('catalog_tasks', 'created_at', 'SLA breaches', 'sla_breached'),
        // Fewer breaches is good: show a drop in green, a rise in red
        viz: { 'scalar.switch_positive_negative': true },
        description: 'Catalog tasks that breached their SLA, by the week they were created; latest complete week vs. the one before.' },

      { name: 'Open incidents', ...SCALAR, sql: `SELECT count(*) AS "Open incidents" FROM reporting.incidents WHERE is_open` },
      { name: 'Open requests', ...SCALAR, sql: `SELECT count(*) AS "Open requests" FROM reporting.requests WHERE is_open` },
      { name: 'Open catalog tasks', ...SCALAR, sql: `SELECT count(*) AS "Open catalog tasks" FROM reporting.catalog_tasks WHERE is_open` },
      { name: 'Changes awaiting approval', ...SCALAR, sql: `SELECT count(*) AS "Changes awaiting approval" FROM reporting.changes WHERE is_open AND approval = 'Requested'` },

      { name: 'Weekly volume: incidents, changes and requests', ...line('Week', 'Incidents', 'Changes', 'Requests'), sql: WEEKLY_VOLUME,
        description: 'Complete weeks only. Incidents in this export start on 5 July 2026, so their line starts later.' },
      { name: 'Open work by age', ...stacked('Age', 'Type', 'Open items'), sql: OPEN_WORK_BY_AGE },

      { name: 'Teams with the most open work', ...table(24), sql: `
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
      { name: 'Changes affecting breweries', ...SCALAR, sql: `SELECT count(*) AS "Changes affecting breweries" FROM reporting.changes WHERE affects_brewery` },
      { name: 'Breweries touched by changes', ...SCALAR, sql: `SELECT count(DISTINCT brewery) AS "Breweries touched by changes" FROM reporting.change_breweries` },

      { name: 'Incidents by site (top 12)', ...row('Site', 'Incidents'), h: 8, sql: `
SELECT location AS "Site", count(*) AS "Incidents"
FROM reporting.incidents WHERE nullif(location, '') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },
      { name: 'Requests by site (top 12)', ...row('Site', 'Requests'), h: 8, sql: `
SELECT location AS "Site", count(*) AS "Requests"
FROM reporting.requests WHERE nullif(location, '') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },

      { name: 'Brewery scorecard', ...table(24, 8), sql: `
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

      { name: 'Changes by brewery (top 12)', ...row('Brewery', 'Changes'), h: 8, sql: `
SELECT brewery AS "Brewery", count(*) AS "Changes" FROM reporting.change_breweries GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        description: 'A change that lists several breweries counts once for each.' },
      { name: 'Weekly incidents at the 5 busiest breweries', ...lines('Week', 'Brewery', 'Incidents'), h: 8, sql: `
WITH ${fullPeriods('incidents', 'created_at')},
     top AS (SELECT location FROM reporting.incidents WHERE location ILIKE '%brewery%' GROUP BY 1 ORDER BY count(*) DESC LIMIT 5)
SELECT date_trunc('week', i.created_at)::date AS "Week", i.location AS "Brewery", count(*) AS "Incidents"
FROM reporting.incidents i JOIN top USING (location)
WHERE ${inFullPeriods("date_trunc('week', i.created_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },

      { name: 'Brewery changes with an outage in the next 14 days', ...table(24), sql: `
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
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week",
       count(*) FILTER (WHERE source = 'Monitoring alert') AS "Monitoring alerts",
       count(*) FILTER (WHERE source = 'Person') AS "Raised by people"
FROM reporting.incidents WHERE ${inFullPeriods("date_trunc('week', created_at)")} GROUP BY 1 ORDER BY 1` },
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
    key: 'problems',
    group: 'Incidents & Problems',
    name: 'Problems & Major Incidents',
    description: 'Problem Management: recurring issues, workarounds, knowledge articles and P1/P2 incidents.',
    cards: [
      { name: 'Incidents linked to a problem', ...SCALAR, sql: `SELECT count(problem) AS "Incidents linked to a problem" FROM reporting.incidents` },
      { name: 'Problem records with incidents', ...SCALAR, sql: `SELECT count(DISTINCT problem) AS "Problem records with incidents" FROM reporting.incidents` },
      { name: 'Closed with a workaround', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE closed_with_workaround) AS "Closed with a workaround" FROM reporting.incidents`,
        description: 'Workarounds point to an underlying problem that has not been fixed.' },
      { name: 'Reopened incidents', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE reopen_count > 0) AS "Reopened incidents" FROM reporting.incidents` },

      { name: 'Problem records with the most incidents', ...table(24, 9), sql: `
SELECT problem AS "Problem", count(*) AS "Incidents", count(*) FILTER (WHERE is_open) AS "Still open",
       mode() WITHIN GROUP (ORDER BY subcategory) AS "Main subcategory",
       mode() WITHIN GROUP (ORDER BY configuration_item) AS "Main system",
       min(created_at)::date AS "First seen", max(created_at)::date AS "Last seen"
FROM reporting.incidents WHERE problem IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 15` },

      { name: 'Weekly incidents for the 5 biggest problems', ...lines('Week', 'Problem', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')},
     top AS (SELECT problem FROM reporting.incidents WHERE problem IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 5)
SELECT date_trunc('week', i.created_at)::date AS "Week", i.problem AS "Problem", count(*) AS "Incidents"
FROM reporting.incidents i JOIN top USING (problem)
WHERE ${inFullPeriods("date_trunc('week', i.created_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Workarounds by subcategory (top 10)', ...row('Subcategory', 'Closed with a workaround'), sql: `
SELECT subcategory AS "Subcategory", count(*) AS "Closed with a workaround"
FROM reporting.incidents WHERE closed_with_workaround GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },

      { name: 'Recurring issues with no problem record', ...table(24), sql: `
SELECT configuration_item AS "Server / system", subcategory AS "Subcategory", count(*) AS "Incidents",
       count(DISTINCT date_trunc('week', created_at)) AS "Weeks it happened",
       round(100.0 * avg((source = 'Monitoring alert')::int)) AS "From monitoring (%)",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.incidents
WHERE problem IS NULL AND configuration_item IS NOT NULL
GROUP BY 1, 2 HAVING count(*) >= 20
ORDER BY 3 DESC LIMIT 15`,
        description: 'The same system and issue type keep coming back, but no problem record links them: candidates for Problem Management.' },

      { name: 'Most used knowledge articles', ...table(12), sql: `
SELECT kb_article AS "Knowledge article", count(*) AS "Incidents",
       mode() WITHIN GROUP (ORDER BY subcategory) AS "Main subcategory",
       round(avg(hours_to_resolve), 1) AS "Avg hours to resolve"
FROM reporting.incidents WHERE kb_article IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Incidents caused by changes', ...table(12), sql: `
SELECT number AS "Incident", caused_by_change AS "Caused by change", priority AS "Priority",
       created_at AS "Created", assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE caused_by_change IS NOT NULL ORDER BY created_at DESC` },

      { name: 'P1 and P2 incidents', ...table(24, 8), sql: `
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
      { name: 'Monitoring alerts', ...SCALAR, sql: `SELECT count(*) AS "Monitoring alerts" FROM reporting.incidents WHERE source = 'Monitoring alert'` },
      { name: 'Share of all incidents (%)', ...SCALAR, sql: `SELECT round(100.0 * avg((source = 'Monitoring alert')::int), 1) AS "Share of all incidents (%)" FROM reporting.incidents` },
      { name: 'Alerts closed within an hour (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((hours_to_resolve <= 1)::int), 1) AS "Alerts closed within an hour (%)"
FROM reporting.incidents WHERE source = 'Monitoring alert' AND hours_to_resolve IS NOT NULL`,
        description: 'Alerts that close within an hour often fixed themselves: candidates for tuning or auto-closing.' },
      { name: 'Alerts with no system recorded', ...SCALAR, sql: `
SELECT count(*) AS "Alerts with no system recorded" FROM reporting.incidents WHERE source = 'Monitoring alert' AND configuration_item IS NULL`,
        description: "Their system is the placeholder 'zzz', so they can't be traced to what raised them." },

      { name: 'Alerts per day', ...line('Day', 'Alerts'), sql: `
WITH ${fullPeriods('incidents', 'created_at', 'day')}
SELECT date_trunc('day', created_at)::date AS "Day", count(*) AS "Alerts"
FROM reporting.incidents
WHERE source = 'Monitoring alert' AND ${inFullPeriods("date_trunc('day', created_at)")}
GROUP BY 1 ORDER BY 1` },
      { name: 'Noisiest systems (top 10)', ...row('Server / system', 'Alerts'), sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' AND configuration_item IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },

      { name: 'Alerts by hour of day', ...bar('Hour', 'Alerts'), sql: `
SELECT to_char(created_at, 'HH24') AS "Hour", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' GROUP BY 1 ORDER BY 1`,
        description: 'Hours as recorded in ServiceNow.' },
      { name: 'How fast alerts close, by type', ...table(12), sql: `
SELECT subcategory AS "Alert type", count(*) AS "Alerts",
       round(100.0 * avg((hours_to_resolve <= 1)::int) FILTER (WHERE hours_to_resolve IS NOT NULL), 1) AS "Closed within 1 hour (%)",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_resolve) * 60)::numeric) AS "Median minutes to close",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.incidents WHERE source = 'Monitoring alert'
GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },

      { name: 'Teams receiving the most alerts', ...row('Team', 'Alerts'), sql: `
SELECT assignment_group AS "Team", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Where alerts come from', ...row('Raised by', 'Alerts'), sql: `
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
      { name: 'Incidents raised by people', ...SCALAR, sql: `SELECT count(*) AS "Incidents raised by people" FROM reporting.incidents WHERE source = 'Person'`,
        description: 'Everything except monitoring alerts.' },
      { name: 'Self-service share (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((contact_type = 'Self-service')::int), 1) AS "Self-service share (%)" FROM reporting.incidents WHERE source = 'Person'` },
      { name: 'Resolved without reassignment (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((reassignment_count = 0)::int), 1) AS "Resolved without reassignment (%)" FROM reporting.incidents WHERE source = 'Person'`,
        description: 'People-raised incidents that the first team handled all the way.' },
      { name: 'Password and account issues', ...SCALAR, sql: `
SELECT count(*) AS "Password and account issues" FROM reporting.incidents WHERE subcategory IN ${ACCOUNT_SUBCATEGORIES}` },

      { name: 'People-raised incidents by hour of day', ...bar('Hour', 'Incidents'), sql: `
SELECT to_char(created_at, 'HH24') AS "Hour", count(*) AS "Incidents"
FROM reporting.incidents WHERE source = 'Person' GROUP BY 1 ORDER BY 1`,
        description: 'Hours as recorded in ServiceNow. Useful for staffing the service desk.' },
      { name: 'People-raised incidents by day of week', ...bar('Day', 'Incidents'), sql: `
SELECT to_char(created_at, 'Dy') AS "Day", count(*) AS "Incidents"
FROM reporting.incidents WHERE source = 'Person'
GROUP BY 1, extract(isodow FROM created_at) ORDER BY extract(isodow FROM created_at)` },

      { name: 'Weekly incidents by channel', ...lines('Week', 'Channel', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", contact_type AS "Channel", count(*) AS "Incidents"
FROM reporting.incidents
WHERE source = 'Person' AND ${inFullPeriods("date_trunc('week', created_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Channel mix', ...pie('Channel', 'Incidents'), sql: `
SELECT contact_type AS "Channel", count(*) AS "Incidents"
FROM reporting.incidents WHERE source = 'Person' GROUP BY 1 ORDER BY 2 DESC` },

      { name: 'Team workload', ...table(24, 8), sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents", count(*) FILTER (WHERE is_open) AS "Open now",
       count(DISTINCT nullif(assigned_to, '')) AS "People",
       round(count(*)::numeric / nullif(count(DISTINCT nullif(assigned_to, '')), 0), 1) AS "Incidents per person",
       round(avg(hours_to_resolve), 1) AS "Avg hours to resolve",
       round(100.0 * avg(was_reassigned::int), 1) AS "Reassigned (%)",
       round(100.0 * avg((source = 'Monitoring alert')::int)) AS "From monitoring (%)"
FROM reporting.incidents
GROUP BY 1 HAVING count(*) >= 100
ORDER BY 2 DESC LIMIT 15` },

      { name: 'Why open incidents are waiting', ...row('Status', 'Open incidents'), sql: `
SELECT CASE WHEN state = 'On Hold' THEN 'On hold: ' || coalesce(on_hold_reason, 'no reason given') ELSE state END AS "Status",
       count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open GROUP BY 1 ORDER BY 2 DESC` },
      { name: 'Open incidents per person (top 10)', ...row('Assigned to', 'Open incidents'), sql: `
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
WITH ${fullPeriods('changes', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", type AS "Type", count(*) AS "Changes"
FROM reporting.changes WHERE ${inFullPeriods("date_trunc('week', created_at)")} GROUP BY 1, 2 ORDER BY 1, 2` },
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
    key: 'change-risk',
    group: 'Change',
    name: 'Change Risk & Business Impact',
    description: 'Changes that touch breweries and SAP, how much notice they get, and process failures.',
    cards: [
      { name: 'Changes affecting breweries', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE affects_brewery) AS "Changes affecting breweries" FROM reporting.changes` },
      { name: 'Changes affecting SAP', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE affects_sap) AS "Changes affecting SAP" FROM reporting.changes` },
      { name: 'Needing an SAP transport', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE needs_sap_transport) AS "Needing an SAP transport" FROM reporting.changes` },
      { name: 'Flagged as a process failure', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE process_failure) AS "Flagged as a process failure" FROM reporting.changes` },

      { name: 'Days of notice by change type', ...bar('Change type', 'Median days of notice'), h: 8, sql: `
SELECT type AS "Change type",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY lead_days))::numeric, 1) AS "Median days of notice",
       count(*) AS "Changes", count(*) FILTER (WHERE lead_days < 0) AS "Logged after it started"
FROM reporting.changes WHERE lead_days IS NOT NULL GROUP BY 1 ORDER BY 2`,
        description: 'How long before the planned start each kind of change is raised (median). "Logged after it started" counts changes recorded once work had begun.' },
      { name: 'Changes with an outage per week, by environment', ...stacked('Week', 'Environment', 'Changes with an outage'), h: 8, sql: `
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

      { name: 'Most changed systems (top 10)', ...row('Server / system', 'Changes'), h: 9, sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Changes"
FROM reporting.changes WHERE configuration_item IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Changes by category and risk', ...stacked('Category', 'Risk', 'Changes'), h: 9, sql: `
WITH top AS (SELECT sub_type FROM reporting.changes GROUP BY 1 ORDER BY count(*) DESC LIMIT 8)
SELECT c.sub_type AS "Category", coalesce(nullif(c.risk, ''), 'Not set') AS "Risk", count(*) AS "Changes"
FROM reporting.changes c JOIN top USING (sub_type)
GROUP BY 1, 2 ORDER BY 1, 2` },

      { name: 'SAP and brewery changes in the next 14 days', ...table(24), sql: `
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
      { name: 'Changes flagged as a process failure', ...table(24), sql: `
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
      { name: 'Open requests', ...SCALAR, sql: `SELECT count(*) AS "Open requests" FROM reporting.requests WHERE is_open` },
      { name: 'Open catalog tasks', ...SCALAR, sql: `SELECT count(*) AS "Open catalog tasks" FROM reporting.catalog_tasks WHERE is_open` },
      { name: 'Catalog task SLA breaches (%)', ...SCALAR, sql: `SELECT round(100.0 * avg(sla_breached::int), 1) AS "SLA breaches (%)" FROM reporting.catalog_tasks` },
      { name: 'Request approvals waiting', ...SCALAR, sql: `SELECT count(*) AS "Request approvals waiting" FROM reporting.approvals WHERE approval_for = 'Request' AND is_waiting` },

      { name: 'Most requested items (top 10)', ...row('Item', 'Requests'), sql: `
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
      { name: 'Rejected or cancelled requests', ...SCALAR, sql: `
SELECT count(*) AS "Rejected or cancelled requests" FROM reporting.requests
WHERE approval = 'Rejected' OR state = 'Closed Cancelled'`,
        description: 'Effort spent on requests that never went ahead.' },

      { name: 'Automation candidates', ...table(24, 8), sql: `
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
      { name: 'Password and account issues by channel', ...stacked('Issue', 'Channel', 'Incidents'), sql: `
SELECT subcategory AS "Issue", contact_type AS "Channel", count(*) AS "Incidents"
FROM reporting.incidents WHERE subcategory IN ${ACCOUNT_SUBCATEGORIES}
GROUP BY 1, 2 ORDER BY 1, 2`,
        description: 'Phone, chat and email contacts here are candidates for self-service password reset and unlock.' },

      { name: 'Most rejected or cancelled items (top 10)', ...row('Catalog item', 'Rejected or cancelled'), sql: `
SELECT item AS "Catalog item", count(*) AS "Rejected or cancelled"
FROM reporting.requests WHERE approval = 'Rejected' OR state = 'Closed Cancelled'
GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Requests by order guide', ...row('Order guide', 'Requests'), sql: `
SELECT coalesce(order_guide, 'Ordered directly (no guide)') AS "Order guide", count(*) AS "Requests"
FROM reporting.requests GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        description: 'Order guides bundle several items into one form, e.g. for new hires.' },
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
      // Shown as the (i) tip on the chart: how to read it
      description: c.description || null,
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
  return { key: def.key, group: def.group, name: def.name, description: def.description, uuid };
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
