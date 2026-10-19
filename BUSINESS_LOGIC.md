# Business logic: plain English → structured query

This document explains how the tool turns an IT person's question into a Cube.dev JSON query. The executable version of this logic lives in [business_logic.mjs](business_logic.mjs); the server in [server.mjs](server.mjs) only wires it to the Claude API and to Cube.

## 1. The pipeline

```
user text ──► Claude (system prompt = this business logic, JSON schema enforced)
          ──► { intent, queries: [{ entity, query }, ...], message, assumptions }
          ──► normalizeAndValidate()  (member whitelist, one-cube-per-query rule, value spelling, limits, merge plan)
          ──► POST /cubejs-api/v1/load once per ticket type, in parallel
          ──► combineResults() when the per-type counts should be one table
          ──► tables + the restated question + the assumptions, back to the chat UI
```

Three intents can come back:

| intent | meaning | what the server does |
|---|---|---|
| `query` | the question maps onto the data | validates, runs it, returns rows |
| `clarify` | one short question back to the user (for example a person's real name, which is anonymized in the export) | returns the question, runs nothing |
| `unsupported` | the data model cannot answer it (averages, durations, cross-table joins) | returns the explanation and the nearest supported question |

The `assumptions` list is always shown to the user. It is how the tool stays honest about every interpretation it made ("treated 'open' as New / In Progress / On Hold").

## 2. The data, in ITIL terms

| cube | ServiceNow table | what it is | rows | date column |
|---|---|---|---|---|
| `incident` | INC | something broke or a monitor alerted | 23,334 | `created` |
| `change_request` | CHG | planned work: patching, deployments, network changes | 1,969 | `created`, `planned_start_date` |
| `change_approvals` | approval records for CHGs | one row per approval group per change | 9,942 | `created` |
| `sc_req_item` | RITM | things ordered from the catalog: software, laptops, AD, VDI | 17,501 | `opened` |
| `ritm_approvals` | approval records for RITMs | manager / software / security sign-off | 5,379 | `created` |
| `sc_task` | SCTASK | the fulfillment work items behind a RITM | 16,321 | `created` |

Relationships are by ticket number only (RITM → REQ, SCTASK → RITM, approvals → parent). The cubes are **not joined**, so each sub-query stays inside one table and the validator rejects any sub-query that mixes tables. Questions about several ticket types become several sub-queries whose results are shown side by side.

Export coverage is roughly 2026-06-01 to 2026-09-01 (incidents from 2026-07-05).

## 3. Entity resolution (which table?)

### "Ticket" means any ticket type

A ticket is any single event logged in ServiceNow. The four ticket types are incidents, changes, requested items, and catalog tasks. Approval records are sign-offs attached to a change or request, so they only count when the user asks about approvals.

Generic words fan out to every ticket type: ticket, tix, case, record, event, everything, anything, workload, volume, "what came in". A question with no type word at all is treated the same way.

The set is then narrowed to the types where every requested filter or grouping exists. The assumptions say which types were dropped and why.

| the question involves | ticket types that have it |
|---|---|
| priority, impact, urgency, category, P1–P4, how it was reported | incidents only |
| change type, risk, environment, outage, planned dates | changes only |
| catalog item | requests, tasks |
| team / group / queue | incidents and tasks (assigned team), changes (owning team). Requests have no team column. |
| location | incidents, requests |
| a person it is assigned to | incidents, tasks |
| status, date, summary, ticket number | all four, each in its own terms |

Each type gets the same filter in its own vocabulary. For example, "open" uses each type's own open states. "Last month" uses the opened date for requests and the created date for the others.

How the results are shown:

- **Counts** ("how many tickets", "tickets per month", "top teams by tickets") merge into one table with a column per ticket type and a total. For "top N", the server ranks on the merged totals, so the top 10 is a true combined top 10.
- **Lists** ("show me the Wintel team's open stuff") show one table per ticket type, 25 rows each by default.
- A request and the tasks created to fulfil it count as separate tickets, and the assumptions say so.

### When one type is named

| user says | cube |
|---|---|
| incident, INC, issue, outage, alert, P1/P2, sev1, "went down" | `incident` |
| change, CHG, CR, RFC, CAB, deploy, release, patch, reboot, maintenance window | `change_request` |
| request, RITM, REQ, catalog, ordered, onboarding, termination, software request, new laptop | `sc_req_item` |
| task, SCTASK, fulfillment task, work item | `sc_task` |
| "who approved", "which approval group", "sitting with the security approvers" | `change_approvals` / `ritm_approvals` |
| a bare ticket number | by prefix: INC, CHG, RITM, REQ, SCTASK |
| nothing recognizable | all four ticket types, as above |

"Changes pending approval" uses `change_request.approval`, not the approvals table. The approvals tables are only for questions about approvers.

## 4. Answer shape (what kind of query?)

| user says | shape |
|---|---|
| how many, count, volume, total | `count` only |
| by X, per X, breakdown, split, across teams | `count` grouped by X, ordered desc |
| top N, most, busiest, worst, noisiest | grouped, ordered desc, limit N (default 10) |
| trend, over time, per day / week / month | grouped by `*_day` / `*_week` / `*_month`, ordered asc |
| show, list, give me, pull, which tickets | the entity's standard list columns, newest first, limit 50 |
| details, status of, or a bare ticket number | the entity's detail columns, limit 1 |
| percent, share, rate | counts by dimension; the UI note says to derive the percentage |
| average, MTTR, time to resolve, aging in days | `unsupported` with an alternative |

The `*_day`, `*_week`, `*_month` dimensions are derived text buckets added to the Cube models ([model/cubes/](model/cubes/)) so trend questions can group, since every column in the export is text.

## 5. Status vocabulary (the biggest nuance)

| user says | incident | change_request | sc_req_item | sc_task |
|---|---|---|---|---|
| open, active, outstanding, backlog, still, currently, WIP | New, In Progress, On Hold | Pending, Pre-approve, Review, Build and Test, Work in Progress | Open, Pending | Open, Pending, Work in Progress |
| closed, done, finished | Resolved, Closed | Closed | Fulfilled, Closed Complete | Closed Complete |
| resolved | Resolved only | | | |
| cancelled, withdrawn | | **Canceled** (one L) | Closed Cancelled | Closed Cancelled |
| on hold, waiting on user / vendor | On Hold + `on_hold_reason` | | | |
| stuck, stale, aging | open + created before a cutoff (7 days default) | same | same | same |
| reopened, came back | `reopen_count` ≠ 0 | | | |
| bounced around, ping-ponged | `reassignment_count` ≥ 2 | | | |
| failed, blew up, rolled back | | `close_code` Unsuccessful (+ `failure_code`) | `stage` contains "fail" | |
| pending approval, awaiting CAB | | `approval` Requested | `approval` Requested | |
| SLA breached, late | `breach_reason` set | | | `sla_flag` true |

Spelling traps the validator repairs automatically: "Cancelled" → "Canceled" on changes, "p1" → "P1 - Critical", "closed" → "Closed", and any case-insensitive match against the known value lists.

## 6. Priority, teams, places, categories

- **Priority:** P1 / critical / sev1 / "on fire" → `P1 - Critical`; P2 / high / urgent → `P2 - High`; "high priority" alone → P1 and P2 together; P3 / normal → `P3 - Average`; P4 / low / minor → `P4 - Low`. "was a P1" → `was_p1` true.
- **Teams:** group names are codes (ACN = Accenture, TCS = Tata, MCBC/MC = Molson Coors internal). Always `contains` on a distinctive token: wintel → WINTEL, service desk / L1 → ServiceDesk, SAP basis → SAP-BASIS, IAM, EUS, VDI, M365, NOC, SQL, AZURE, AWS. Changes use `owner_group`; everything else uses `assignment_group`.
- **Source of the ticket:** monitoring / auto-generated → `contact_type` Event Management; called in → Phone; portal → Self-service; "real people" → not Event Management.
- **Places:** brewery names with `contains`. "Milwaukee" matches both the corporate office and the brewery and the assumption says so. HQ / corporate → `startsWith` "Corporate".
- **Categories:** password / locked out → subcategory Password Reset, Account Locked, Password Expired, Account Disabled; printer → category Printing; server → subcategory Server; slow → Performance; batch / IWS → Job Failure; email / Outlook → Email; phone → Telephony.
- **Catalog items:** software → item contains "Software"; new PC → "PC Request"; AD / account → "AD Request"; VDI; termination / offboarding; SharePoint; firewall; "non-standard" → Non-standard Service Request.
- **Changes:** prod / live → environment Production; downtime → outage Yes; SAP → sap_impact Yes; emergency / standard / normal → type; patching → sub_type contains "Patching"; brewery changes → brewery Yes.

## 7. Time phrases

The user turn tells Claude today's date; the system prompt never contains it, so the prompt stays cacheable.

| user says | filter |
|---|---|
| in August, last month | `startsWith "2026-08"` |
| yesterday, on Aug 14 | `startsWith "2026-08-14"` |
| last 30 days, since July, Q3, this week, YTD | `gte "YYYY-MM-DD"` and `lt "YYYY-MM-DD"` (exclusive upper bound) |
| resolved in, closed in | `resolved` / `closed` instead of `created` |
| scheduled for, upcoming, next week | `change_request.planned_start_date` |
| ever, all time, overall | no date filter |

Because the export is a frozen snapshot, relative phrases drift out of range as real time moves on. Set `ASSUME_TODAY=2026-09-02` in `.env` to pin the reference date for demos; the model also warns in assumptions when a computed window falls outside the export.

## 8. Logic words, typos, slang

- "and" → more filters. "or" on the same field → one filter with several values. "or" across fields → pick the dominant one, note it.
- "not / except / excluding / without" → `notEquals`, `notContains`, `notSet`.
- "at least / more than / under" → `gte` / `gt` / `lt` (only meaningful on small text digits like `reassignment_count`).
- "all / everything" drops status filters. "only / just" is restrictive.
- There is no conversation memory: "same thing but by team" is rebuilt from the current message alone.
- Typos and shorthand are expected and resolved: incdent, tkts, chg's, wrk in prog, assgn grp, prio, sev, cat, sub cat, CI, env, prod, svr, pw reset.

## 9. When it asks vs. assumes

Assume and state it whenever a sensible default exists. Ask (`clarify`) only when the entity is genuinely unknowable, a real person's name is given, or a place/group word matches several unrelated things. Say `unsupported` for averages, durations, joins, and anything not in the member list.

## 10. Server-side guardrails

`normalizeAndValidate()` in [business_logic.mjs](business_logic.mjs) runs on every response before Cube sees it:

- every member must exist in the catalog, and each sub-query's members must belong to its own cube
- each ticket type may appear at most once
- several count sub-queries, each grouped by at most one column, are merged. The server fetches all groups, then sorts and limits the merged totals.
- operators are whitelisted (`equals`, `notEquals`, `contains`, `notContains`, `startsWith`, `endsWith`, `set`, `notSet`, `gt`, `gte`, `lt`, `lte`)
- `equals` / `notEquals` values are snapped to the exact spelling in the data
- `order` may only reference selected members; list queries default to 50 rows; everything is capped at 500
- a query with neither measures nor dimensions is rejected

## 11. Maintaining it

- **New export?** Re-profile the distinct values (state, priority, category, item, etc.) and update `ENTITY_CATALOG` in [business_logic.mjs](business_logic.mjs). The system prompt, the member whitelist, and the value normalizer are all generated from that one object.
- **New column?** Add it to the cube YAML in [model/cubes/](model/cubes/) and to the cube's `dimensions` array in the catalog.
- **New phrase people use?** Add it to the matching section of the prompt in `buildSystemPrompt()`, or add a worked example at the bottom; examples are the strongest lever.
- **Testing:** start the server, then POST `{ "userPrompt": "..." }` to `/api/query` and read `message`, `assumptions`, and `aiInterpretation` before trusting the rows.
