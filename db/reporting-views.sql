-- =====================================================================
-- REPORTING VIEWS for Metabase (schema "reporting" in analytics_db)
--
-- The raw tables store every column as text. These views expose the same
-- data with real timestamps, numbers and yes/no values, plus ready-made
-- fields (is_open, hours_to_resolve, age_days, ...) so dashboards can be
-- built point-and-click. Safe to re-run: every view is CREATE OR REPLACE.
--
-- The export is a frozen snapshot, so "now" for ages and "upcoming" is the
-- newest timestamp in the data (reporting.data_as_of), not today's date.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS reporting;

-- Text -> timestamp, treating '' as missing
CREATE OR REPLACE FUNCTION reporting.ts(value text) RETURNS timestamp
    LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(value, '')::timestamp $$;

CREATE OR REPLACE VIEW reporting.data_as_of AS
SELECT max(t) AS as_of FROM (
    SELECT max(reporting.ts(updated)) AS t FROM public.incident
    UNION ALL SELECT max(reporting.ts(updated)) FROM public.sc_task
    UNION ALL SELECT max(reporting.ts(updated)) FROM public.sc_req_item
    UNION ALL SELECT max(reporting.ts(created)) FROM public.change_request
) latest;

-- ---------------------------------------------------------------------
-- Incidents
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.incidents AS
SELECT
    i.number,
    reporting.ts(i.created)  AS created_at,
    reporting.ts(i.resolved) AS resolved_at,
    reporting.ts(i.closed)   AS closed_at,
    i.state,
    i.state IN ('New', 'In Progress', 'On Hold') AS is_open,
    i.priority,
    i.impact,
    i.urgency,
    i.category,
    i.subcategory,
    i.assignment_group,
    i.assigned_to,
    -- 'zzz' is a placeholder (about a third of incidents, nearly all monitoring
    -- alerts with no system attached), so it counts as "no system recorded"
    CASE WHEN i.configuration_item IN ('', 'zzz') THEN NULL ELSE i.configuration_item END AS configuration_item,
    i.location,
    i.contact_type,
    -- Monitoring alerts (Event Management) vs. tickets raised by people
    CASE WHEN i.contact_type = 'Event Management' THEN 'Monitoring alert' ELSE 'Person' END AS source,
    i.close_code,
    i.cause_code,
    nullif(i.on_hold_reason, '') AS on_hold_reason,
    nullif(i.breach_reason, '')  AS breach_reason,
    i.reassignment_count::int AS reassignment_count,
    i.reopen_count::int       AS reopen_count,
    i.reassignment_count::int > 0 AS was_reassigned,
    i.was_p1 = 'true' AS was_p1,
    nullif(i.caused_by_change, '') AS caused_by_change,
    round((extract(epoch FROM reporting.ts(i.resolved) - reporting.ts(i.created)) / 3600)::numeric, 2) AS hours_to_resolve,
    CASE WHEN i.state IN ('New', 'In Progress', 'On Hold')
         THEN round((extract(epoch FROM a.as_of - reporting.ts(i.created)) / 86400)::numeric, 1) END AS age_days,
    CASE WHEN i.state NOT IN ('New', 'In Progress', 'On Hold') THEN NULL
         WHEN a.as_of - reporting.ts(i.created) < interval '1 day'  THEN '1. Under 1 day'
         WHEN a.as_of - reporting.ts(i.created) < interval '3 days' THEN '2. 1-3 days'
         WHEN a.as_of - reporting.ts(i.created) < interval '7 days' THEN '3. 3-7 days'
         WHEN a.as_of - reporting.ts(i.created) < interval '30 days' THEN '4. 7-30 days'
         ELSE '5. Over 30 days' END AS age_bucket
FROM public.incident i CROSS JOIN reporting.data_as_of a;

-- ---------------------------------------------------------------------
-- Changes
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.changes AS
SELECT
    c.number,
    reporting.ts(c.created)            AS created_at,
    reporting.ts(c.planned_start_date) AS planned_start,
    reporting.ts(c.planned_end_date)   AS planned_end,
    c.type,
    c.sub_type,
    c.type IN ('Emergency', 'Expedited') AS is_emergency_or_expedited,
    c.state,
    c.state NOT IN ('Closed', 'Canceled') AS is_open,
    c.approval,
    c.risk,
    c.outage = 'Yes' AS has_outage,
    c.environment,
    c.owner_group,
    c.configuration_item,
    c.short_description,
    nullif(c.close_code, '')   AS close_code,
    nullif(c.failure_code, '') AS failure_code,
    CASE c.close_code WHEN 'Successful' THEN true WHEN 'Unsuccessful' THEN false END AS succeeded,
    -- Planned to start within 7 days after the snapshot
    reporting.ts(c.planned_start_date) >= a.as_of
        AND reporting.ts(c.planned_start_date) < a.as_of + interval '7 days' AS starts_next_7_days
FROM public.change_request c CROSS JOIN reporting.data_as_of a;

-- ---------------------------------------------------------------------
-- Requested items (RITMs)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.requests AS
SELECT
    r.number,
    r.item,
    reporting.ts(r.opened)         AS opened_at,
    reporting.ts(r.fulfilled_time) AS fulfilled_at,
    reporting.ts(r.closed)         AS closed_at,
    r.state,
    r.state IN ('Open', 'Pending', 'Work in Progress') AS is_open,
    r.stage,
    r.approval,
    r.location,
    r.requested_for,
    round((extract(epoch FROM coalesce(reporting.ts(r.fulfilled_time), reporting.ts(r.closed)) - reporting.ts(r.opened)) / 3600)::numeric, 2)
        AS hours_to_fulfil,
    CASE WHEN r.state IN ('Open', 'Pending', 'Work in Progress')
         THEN round((extract(epoch FROM a.as_of - reporting.ts(r.opened)) / 86400)::numeric, 1) END AS age_days
FROM public.sc_req_item r CROSS JOIN reporting.data_as_of a;

-- ---------------------------------------------------------------------
-- Catalog tasks (fulfilment work, with SLA)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.catalog_tasks AS
SELECT
    t.number,
    t.item,
    reporting.ts(t.created) AS created_at,
    reporting.ts(t.updated) AS updated_at,
    t.state,
    t.active = 'true' AS is_open,
    t.assignment_group,
    t.assigned_to,
    t.sla_flag = 'true' AS sla_breached,
    t.request_item,
    CASE WHEN t.active = 'true'
         THEN round((extract(epoch FROM a.as_of - reporting.ts(t.created)) / 86400)::numeric, 1) END AS age_days
FROM public.sc_task t CROSS JOIN reporting.data_as_of a;

-- ---------------------------------------------------------------------
-- Approvals (changes and requests together)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.approvals AS
SELECT
    'Change' AS approval_for,
    ca.parent,
    ca.assignment_group AS approver_group,
    ca.approval,
    ca.state,
    ca.approval = 'Requested' AS is_waiting,
    reporting.ts(ca.created) AS created_at,
    CASE WHEN ca.approval = 'Requested'
         THEN round((extract(epoch FROM a.as_of - reporting.ts(ca.created)) / 86400)::numeric, 1) END AS waiting_days
FROM public.change_approvals ca CROSS JOIN reporting.data_as_of a
UNION ALL
SELECT
    'Request',
    ra.parent,
    ra.assignment_group,
    ra.approval,
    ra.state,
    ra.approval = 'Requested',
    reporting.ts(ra.created),
    CASE WHEN ra.approval = 'Requested'
         THEN round((extract(epoch FROM a.as_of - reporting.ts(ra.created)) / 86400)::numeric, 1) END
FROM public.ritm_approvals ra CROSS JOIN reporting.data_as_of a;
