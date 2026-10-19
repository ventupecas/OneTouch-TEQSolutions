// =====================================================================
//  business_logic.mjs
//  The domain brain of the tool. Everything Claude needs to turn an IT
//  person's plain-English question about this ServiceNow export into a
//  structured Cube.dev JSON query lives here, plus the server-side
//  validator that normalizes and sanity-checks what Claude returns.
//
//  All values below were pulled from the real CSVs in csv_data/ on
//  2026-10-19. If the exports change, re-profile and update the
//  catalog; the system prompt is generated from it.
// =====================================================================

// ---------------------------------------------------------------------
// 1. ENTITY CATALOG — one record per ServiceNow table (Cube "cube")
// ---------------------------------------------------------------------
export const ENTITY_CATALOG = {
  incident: {
    label: 'Incidents (INC)',
    itil: 'Unplanned interruptions or degradations of a service. Someone reported something broken, or a monitoring tool raised an alert.',
    ticketPrefix: 'INC',
    dateColumn: 'created',
    rowCount: 23334,
    dateRange: '2026-07-05 to 2026-09-01',
    dimensions: ['number', 'created', 'created_day', 'created_week', 'created_month', 'short_description', 'description', 'affected_user', 'assignment_group', 'assigned_to', 'problem', 'state', 'parent_incident', 'priority', 'impact', 'urgency', 'breach_reason', 'global_incident', 'knowledge_article_reference', 'category', 'subcategory', 'updated', 'was_p1', 'configuration_item', 'contact_type', 'reassignment_count', 'close_code', 'close_notes', 'cause_code', 'cause_sub_code', 'opened_by_group', 'location', 'reopen_count', 'caused_by_change', 'business_impact_outage', 'resolved', 'resolved_day', 'resolved_month', 'closed', 'closed_day', 'closed_month', 'responsibility_for_outage', 'on_hold_reason', 'work_notes', 'risk_register_number', 'tags', 'third_party_related_ticket', 'business_impact', 'downgrade_reason', 'downgrade_type', 'kb_article'],
    listColumns: ['number', 'created', 'priority', 'state', 'short_description', 'assignment_group', 'category', 'subcategory', 'location'],
    detailColumns: ['number', 'created', 'updated', 'resolved', 'closed', 'priority', 'impact', 'urgency', 'state', 'on_hold_reason', 'short_description', 'description', 'category', 'subcategory', 'assignment_group', 'assigned_to', 'affected_user', 'location', 'configuration_item', 'contact_type', 'close_code', 'close_notes', 'cause_code', 'reassignment_count', 'reopen_count', 'caused_by_change', 'was_p1'],
    enums: {
      state: ['New', 'In Progress', 'On Hold', 'Resolved', 'Closed'],
      priority: ['P1 - Critical', 'P2 - High', 'P3 - Average', 'P4 - Low'],
      impact: ['1 - Enterprise', '2 - Site/Dept', '3 - Multiple Users', '4 - User'],
      urgency: ['1 - xxx (Immediate Loss)', '2 - xxx (Workaround)', '3 - xxx (No Loss)', '4 - Low'],
      category: ['Hardware', 'Business Services', 'Network', 'Inquiry / Help', 'Security', 'Software/Configuration', 'Printing', 'Email', 'Telephony', 'Database'],
      subcategory: ['Server', 'Performance', 'Application Functionality', 'Alert', 'Job Failure', 'Advice/Guidance', 'Access', 'Password Reset', 'Dropped Call', 'Network Printer', 'Operating System - User', 'Software Installation', 'Laptop', 'Account Locked', 'Outlook', 'Other', 'Data', 'Mobile Phone', 'Desktop', 'User Connectivity - Onsite', 'VDI', 'Account Disabled', 'MS Office', 'Local Printer', 'Exchange', 'IPT Phone', 'Hardware', 'Analogue Phone', 'User Connectivity - Remote', 'LAN', 'Backup', 'iPad', 'Wireless', 'Firewall', 'Network', 'Password Expired', 'Storage / SAN', 'Complaint', 'Network Device', 'Call Center/Switchboard', 'Ticket Status', 'PC Configuration', 'Mobile', 'Security', 'WAN', 'Backup Device', 'DB2', 'Oracle', 'Transfer/Handoff to Other Partner', 'Audio Conference', 'MS SQL Server', 'Voice Mail'],
      contact_type: ['Event Management', 'Self-service', 'Phone', 'Chat', 'Email', 'Walk-in'],
      close_code: ['Solved (Permanently)', 'Solved (Work Around)', 'Closed/Resolved by Caller', 'Not Solved (Not Reproducible)'],
      cause_code: ['Business as Usual', 'Business/System Changes', 'Lack of Maintenance', 'Portfolio Activity'],
      on_hold_reason: ['Awaiting Caller', 'Awaiting Vendor', 'Awaiting Change'],
      responsibility_for_outage: ['Accenture', 'TCS', 'Molson Coors', 'MCBC', 'MillerCoors', 'ProLeiT', 'Microsoft', 'SAP', 'ServiceNow', 'AT&T', 'BT'],
      downgrade_type: ['Pre-Approved', 'IT Resource Approved'],
      breach_reason: ['Waiting on End user', 'Other', 'Waiting on another vendor', 'Waiting on MCBC'],
      was_p1: ['true', 'false'],
      global_incident: ['true', 'false'],
    },
    openStates: ['New', 'In Progress', 'On Hold'],
    closedStates: ['Resolved', 'Closed'],
  },

  change_request: {
    label: 'Change Requests (CHG)',
    itil: 'Planned modifications to production or non-production systems: patching, deployments, network changes, reboots, config changes. They go through approval and CAB.',
    ticketPrefix: 'CHG',
    dateColumn: 'created',
    rowCount: 1969,
    dateRange: '2026-06-01 to 2026-09-01 (planned_start_date runs 2024-08 to 2026-12)',
    dimensions: ['number', 'type', 'created', 'created_day', 'created_week', 'created_month', 'sub_type', 'task_type', 'configuration_item', 'short_description', 'owner_group', 'outage', 'state', 'approval', 'close_code', 'failure_code', 'success_code', 'process_failure', 'diwakar_kumar', 'requested_by', 'state_1', 'planned_start_date', 'planned_start_month', 'brewery', 'brewery_locations', 'work_notes', 'planned_end_date', 'risk', 'planned_start_date_1', 'planned_end_date_1', 'description', 'change_plan', 'verification_plan', 'backout_plan', 'purpose_of_change', 'incident', 'problem', 'enhancement', 'sap_impact', 'sap_transport_required', 'environment', 'project', 'comments_and_work_notes'],
    listColumns: ['number', 'created', 'type', 'sub_type', 'state', 'approval', 'risk', 'short_description', 'owner_group', 'planned_start_date', 'environment'],
    detailColumns: ['number', 'created', 'type', 'sub_type', 'state', 'approval', 'risk', 'outage', 'environment', 'short_description', 'description', 'owner_group', 'requested_by', 'configuration_item', 'planned_start_date', 'planned_end_date', 'close_code', 'success_code', 'failure_code', 'process_failure', 'sap_impact', 'brewery', 'brewery_locations', 'purpose_of_change', 'change_plan', 'backout_plan', 'incident'],
    enums: {
      type: ['Normal', 'Standard', 'Expedited', 'Hypercare', 'Request for Awareness', 'Emergency'],
      sub_type: ['Application', 'Scheduled Maintenance Patching', 'Infrastructure Change', 'Network Change', 'Network Security', 'Other', 'Workstation Patching', 'Security', 'Role Change', 'Database', 'Reboot', 'Server Provisioning or Decommissioning', 'Certificate Maintenance', 'Compliance', 'Storage Change', 'Network Firewall'],
      state: ['Pending', 'Pre-approve', 'Review', 'Build and Test', 'Work in Progress', 'Closed', 'Canceled'],
      approval: ['Approved', 'Not Yet Requested', 'Requested', 'Rejected'],
      close_code: ['Successful', 'Unsuccessful'],
      failure_code: ['Incomplete', 'Caused Incident', 'Issues', 'Backout'],
      success_code: ['Complete', 'Authorized Extension'],
      process_failure: ['true', 'false'],
      outage: ['Yes', 'No'],
      risk: ['Low', 'Medium', 'High', 'Standard', 'RFA'],
      brewery: ['Yes', 'No'],
      environment: ['Production', 'Non-Production'],
      sap_impact: ['Yes', 'No'],
      sap_transport_required: ['Yes', 'No'],
    },
    openStates: ['Pending', 'Pre-approve', 'Review', 'Build and Test', 'Work in Progress'],
    closedStates: ['Closed', 'Canceled'],
  },

  change_approvals: {
    label: 'Change approval records',
    itil: 'One row per approval group asked to sign off on a change. parent = the CHG number. Use this when the question is about approvers or approval groups, not when it is about the change itself.',
    ticketPrefix: null,
    dateColumn: 'created',
    rowCount: 9942,
    dateRange: '2026-06-01 to 2026-09-01',
    dimensions: ['task_type', 'parent', 'assignment_group', 'short_description', 'created', 'created_day', 'created_week', 'created_month', 'work_notes', 'approval', 'state'],
    listColumns: ['parent', 'assignment_group', 'approval', 'state', 'created', 'short_description'],
    detailColumns: ['parent', 'assignment_group', 'approval', 'state', 'created', 'short_description', 'work_notes'],
    enums: {
      approval: ['Approved', 'Not Yet Requested', 'Cancelled', 'Requested'],
      state: ['Closed Complete', 'Pending', 'Closed Incomplete', 'Open'],
    },
    openStates: ['Open', 'Pending'],
    closedStates: ['Closed Complete', 'Closed Incomplete'],
  },

  sc_req_item: {
    label: 'Requested Items (RITM) — service catalog requests',
    itil: 'Things people order from the service catalog: software, laptops, AD accounts, mailbox changes, VDI access, server start/stop, terminations. Not broken things. The REQ number is the parent order; the RITM is the individual item.',
    ticketPrefix: 'RITM',
    dateColumn: 'opened',
    rowCount: 17501,
    dateRange: '2026-06-01 to 2026-09-01',
    dimensions: ['number', 'item', 'description', 'short_description', 'opened', 'opened_day', 'opened_week', 'opened_month', 'updated', 'closed', 'closed_month', 'stage', 'state', 'parent', 'request', 'requested_for', 'opened_by', 'approval', 'approval_history', 'approval_set', 'location', 'work_notes', 'fulfilled_time', 'order_guide'],
    listColumns: ['number', 'opened', 'item', 'state', 'stage', 'approval', 'short_description', 'location'],
    detailColumns: ['number', 'request', 'opened', 'updated', 'closed', 'item', 'state', 'stage', 'approval', 'short_description', 'description', 'requested_for', 'opened_by', 'location', 'fulfilled_time'],
    enums: {
      state: ['Open', 'Pending', 'Fulfilled', 'Closed Complete', 'Closed Cancelled', 'Closed Incomplete', 'Closed Rejected', 'Unsatisfied Fulfillment'],
      stage: ['Completed', 'Request Completed', 'Fulfillment', 'Request Cancelled', 'Request Approved', 'Waiting for Approval', 'complete', 'Request Failed', 'operation_failed', 'Cancelled', 'request_approved', 'Deployment'],
      approval: ['Approved', 'Requested', 'Rejected', 'Not Yet Requested'],
      item: ['Non-standard Service Request', 'Virtual Server - Start', 'Start and Snooze Applications/Servers', 'Virtual Server - Stop', 'PC Software', 'Reclaim Asset', 'GovernIT Assistance Request', 'AD Request', 'General Mailbox / General Calendar - Add or Change', 'Distribution List Creation / Update / Remove', 'Network Share Access and Creation', 'SAP Request (Molson Systems ONLY)', 'PC Request', 'VDI - Pool Access', 'Virtual Server-Virtual Server Interface-Modify Schedule', 'Request Upgrade to Office License', 'Power User Access (PUA) (IT Only)', 'ServiceNow Access and Group Maintenance', 'External Computer Hardware', 'GBS Group Maintenance', 'Non-standard Brewery Request', 'Access to an Existing SharePoint Site', 'Employee/Contractor Termination', 'Non-standard Network Request', 'Enterprise Application Access Request', 'SAP Non-Production Request (ONA/Miller/MillerCoors/Americas)', 'Application Enhancement Request (IT ONLY)', 'Firewall Request', 'Accenture – General Infrastructure Request', 'iPad/Tablet Request', 'BP&S Adhoc Data Load Service Request', 'Request new or replacement Mobile Phone', 'Accenture – General Application Request', 'OneDrive and SharePoint Management', 'SAP Role Change Request', 'Brewery Radio Request', 'New ServiceNow Requests - GBS', 'Batch Job Request', 'Anaplan Access Request', 'New ServiceNow Requests', 'USB Exception Request', 'DNS/DHCP/IP Address Request', 'Configure Printer with Network and SAP Printing', 'Update CI(s)', 'Website block/unblock', 'Elevated Privileges for end users', 'Office Telephone Request', 'VDI - Pool Updates', 'Create CI(s)', 'Existing Standalone/Portable Printer Driver Install', 'Reporting Help', 'PC Software Security Exception Request', 'BPN Access Request', 'Server Provisioning - Cloud', 'Individual Office Telephone Request', 'Request for Packaging', 'New SharePoint Project or Team Site', 'File or Folder Restore', 'Network Device Request', 'ServiceNow Catalog Update (IT ONLY)', 'Audio Conferencing for Microsoft Teams', 'New Meeting Room or Other Resource', 'Changes to Mobile Phone Account', 'Service Introduction', 'Policy Updates (GPO and Intune Policies)', 'Network Drive Mapping Assistance', 'Network Activation', 'Partner SOW/WO Request (IT ONLY)', 'Location / Shared Based Telephone Request', 'WCSC', 'Phone Accessories', 'Request Vulnerability Scan', 'Reporting Help IT', 'Move Single User', 'ODM Office Companion', 'Contact Centre & Calabrio Access', 'Service Decommission/Retirement'],
    },
    openStates: ['Open', 'Pending'],
    closedStates: ['Fulfilled', 'Closed Complete', 'Closed Cancelled', 'Closed Incomplete', 'Closed Rejected', 'Unsatisfied Fulfillment'],
  },

  ritm_approvals: {
    label: 'Requested-item approval records',
    itil: 'One row per approval group asked to sign off on a RITM (manager approval, software validation, security). parent = the RITM number.',
    ticketPrefix: null,
    dateColumn: 'created',
    rowCount: 5379,
    dateRange: '2026-06-01 to 2026-09-01',
    dimensions: ['task_type', 'parent', 'assignment_group', 'short_description', 'created', 'created_day', 'created_week', 'created_month', 'approval', 'state'],
    listColumns: ['parent', 'assignment_group', 'approval', 'state', 'created', 'short_description'],
    detailColumns: ['parent', 'assignment_group', 'approval', 'state', 'created', 'short_description'],
    enums: {
      approval: ['Approved', 'Rejected', 'Requested', 'No Longer Required'],
      state: ['Closed Complete', 'Open', 'Closed Skipped'],
    },
    openStates: ['Open'],
    closedStates: ['Closed Complete', 'Closed Skipped'],
  },

  sc_task: {
    label: 'Catalog Tasks (SCTASK) — fulfillment work items',
    itil: 'The work items a fulfillment team actually performs to deliver a RITM (create the account, image the laptop, grant the share). request_item = the RITM, request = the REQ.',
    ticketPrefix: 'SCTASK',
    dateColumn: 'created',
    rowCount: 16321,
    dateRange: '2026-06-01 to 2026-09-01',
    dimensions: ['number', 'item', 'state', 'short_description', 'assignment_group', 'assigned_to', 'parent', 'opened_by', 'approval', 'approval_history', 'approval_set', 'request', 'request_item', 'sla_flag', 'created', 'created_day', 'created_week', 'created_month', 'updated', 'additional_comments', 'description', 'work_notes', 'active'],
    listColumns: ['number', 'created', 'item', 'state', 'assignment_group', 'assigned_to', 'sla_flag', 'short_description', 'request_item'],
    detailColumns: ['number', 'request', 'request_item', 'created', 'updated', 'item', 'state', 'active', 'sla_flag', 'assignment_group', 'assigned_to', 'opened_by', 'short_description', 'description', 'additional_comments'],
    enums: {
      state: ['Open', 'Pending', 'Work in Progress', 'Closed Complete', 'Closed Cancelled', 'Closed Incomplete'],
      sla_flag: ['true', 'false'],
      active: ['true', 'false'],
    },
    openStates: ['Open', 'Pending', 'Work in Progress'],
    closedStates: ['Closed Complete', 'Closed Cancelled', 'Closed Incomplete'],
  },
};

// ---------------------------------------------------------------------
// 2. QUERY CONTRACT — what Claude is allowed to emit
// ---------------------------------------------------------------------
export const ALLOWED_OPERATORS = [
  'equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith',
  'set', 'notSet', 'gt', 'gte', 'lt', 'lte',
];

export const LIMITS = { defaultList: 50, defaultTop: 10, max: 500, perTypeList: 25 };

// The four standalone ticket types. "Ticket" in plain speech means any of
// these. Approval records are sub-records of a change or request, so they
// are only included when the user explicitly asks about approvals.
export const TICKET_TYPES = ['incident', 'change_request', 'sc_req_item', 'sc_task'];

const CUBE_NAMES = Object.keys(ENTITY_CATALOG);

// Structured-output schema. Every object is closed (additionalProperties:false)
// and every field is required so the response shape is always identical.
// A question about one ticket type has one entry in `queries`; a question
// about "tickets" in general has one entry per ticket type.
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'queries', 'message', 'assumptions'],
  properties: {
    intent: { type: 'string', enum: ['query', 'clarify', 'unsupported'] },
    queries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['entity', 'query'],
        properties: {
          entity: { type: 'string', enum: CUBE_NAMES },
          query: {
      type: 'object',
      additionalProperties: false,
      required: ['measures', 'dimensions', 'filters', 'order', 'limit'],
      properties: {
        measures: { type: 'array', items: { type: 'string' } },
        dimensions: { type: 'array', items: { type: 'string' } },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['member', 'operator', 'values'],
            properties: {
              member: { type: 'string' },
              operator: { type: 'string', enum: ALLOWED_OPERATORS },
              values: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        order: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['member', 'direction'],
            properties: {
              member: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'] },
            },
          },
        },
        limit: { type: 'integer' },
      },
          },
        },
      },
    },
    message: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
};

// ---------------------------------------------------------------------
// 3. SYSTEM PROMPT — the business logic, written for Claude
//    (stable text => cacheable; today's date is injected in the user turn)
// ---------------------------------------------------------------------
function memberList(cube) {
  const e = ENTITY_CATALOG[cube];
  return `${cube}: measures=[${cube}.count]; dimensions=[${e.dimensions.map(d => `${cube}.${d}`).join(', ')}]`;
}

function enumBlock(cube) {
  const e = ENTITY_CATALOG[cube];
  return Object.entries(e.enums)
    .map(([col, vals]) => `  ${cube}.${col}: ${vals.map(v => JSON.stringify(v)).join(' | ')}`)
    .join('\n');
}

export function buildSystemPrompt() {
  const cubes = Object.keys(ENTITY_CATALOG);
  return `You are the query-translation layer of an internal IT service-management analytics tool.
The user is an IT person (service desk analyst, sysadmin, change manager, team lead) asking questions in everyday language about a ServiceNow export. Your only job is to translate each question into structured Cube.dev queries (one per ticket type involved), or to say clearly why you cannot. You never answer the question yourself and you never write SQL.

=====================================================================
A. THE DATA (six ServiceNow tables, loaded as Cube cubes)
=====================================================================
${cubes.map(c => {
  const e = ENTITY_CATALOG[c];
  return `- ${c} — ${e.label}. ${e.itil} Rows: ${e.rowCount}. Date coverage: ${e.dateRange}.`;
}).join('\n')}

How they relate (ITIL mental model):
- A REQ is an order; it contains one or more RITMs (sc_req_item.request = REQ number). Each RITM spawns SCTASKs (sc_task.request_item = RITM number) and may need approvals (ritm_approvals.parent = RITM number).
- A CHG needs approvals (change_approvals.parent = CHG number). An incident can be linked to a change that caused it (incident.caused_by_change = CHG number) and a change can reference the incident it fixes (change_request.incident).
- IMPORTANT: the cubes are NOT joined. Each entry in "queries" must use members from exactly one cube. When a question spans several ticket types, emit one entry per type (see C0); the server runs them side by side and merges the counts. Questions that need a row-level join between tables (e.g. "incidents caused by changes owned by team X") are still not possible; pick the cube the question is fundamentally about and state the limitation in assumptions.

Ticket number prefixes resolve the entity instantly:
  INC → incident.number | CHG → change_request.number | RITM → sc_req_item.number
  REQ → sc_req_item.request (or sc_task.request) | SCTASK → sc_task.number

Exact member names you may use (nothing else exists):
${cubes.map(memberList).join('\n')}

ALL columns are stored as TEXT. Dates are text in the form "YYYY-MM-DD HH:MM:SS", which sorts correctly as a string. The *_day, *_week, *_month dimensions are derived text buckets ("2026-08-14", "2026-W33", "2026-08") made for grouping and trends. Counts like reassignment_count are text digits.

The only measure is <cube>.count. There are no sums, averages, durations, or percentages in the model.

=====================================================================
B. KNOWN VALUES (exact spellings — equals is case-sensitive, contains is not)
=====================================================================
${cubes.map(c => `${c}:\n${enumBlock(c)}`).join('\n')}

Spelling traps in this data:
- change_request.state uses "Canceled" (one L). sc_req_item, sc_task and change_approvals use "Cancelled" (two Ls).
- sc_req_item.stage is inconsistent ("Completed" vs "complete", "Request Approved" vs "request_approved"). Prefer sc_req_item.state for status; if you must use stage, use "contains" (which is case-insensitive).
- Priority/impact/urgency are strings with a number prefix ("P1 - Critical", "1 - Enterprise"). Use the full string with equals.
- People are anonymized as "Individual 1234" in affected_user, assigned_to, requested_by, opened_by, requested_for. Real names will never match. If the user names a person, use intent "clarify" and ask for the Individual ID or a ticket number.
- Group names are codes: ACN-* = Accenture teams, TCS-* = Tata Consultancy teams, MCBC-* / MC-* = Molson Coors internal teams. Always use "contains" with the distinctive token, never equals (e.g. "wintel" → assignment_group contains "WINTEL").

=====================================================================
C. HOW TO READ THE USER (speech nuances → query decisions)
=====================================================================
C0. "Ticket" means ANY ticket type
In this tool a "ticket" is any single event logged in ServiceNow: an incident, a change, a requested item, or a catalog task. These four are the ticket types: ${TICKET_TYPES.join(', ')}.
- Generic words → all four ticket types, one entry in "queries" per type: "ticket(s)", "tix", "tkts", "case(s)", "record(s)", "item(s) logged", "event(s)", "everything", "anything", "all work", "workload", "volume", "the queue" (no type named), "what came in", "what got logged".
- Approval records (change_approvals, ritm_approvals) are NOT tickets on their own; they are sign-offs attached to a change or request. Include them only when the user explicitly asks about approvals.
- Narrow the set to the ticket types where every requested filter or grouping actually exists, and say which types were dropped and why in assumptions. Field availability:
    priority / impact / urgency / category / subcategory / contact_type / P1–P4 / severity → incident only.
    type / sub_type / risk / environment / outage / planned dates / CAB → change_request only.
    catalog item → sc_req_item and sc_task.
    team / group / queue → incident.assignment_group, change_request.owner_group, sc_task.assignment_group (sc_req_item has no team column, so drop it).
    location → incident.location and sc_req_item.location only.
    assigned_to (a person) → incident and sc_task only.
    approval status → change_request, sc_req_item.
    state, created/opened date, short_description, number → all four (use each type's own date column and its own state values, see C3).
  Example: "P1 tickets" → incident only, because priority exists only on incidents. "Tickets for the WINTEL team" → incident, change_request and sc_task.
- The same filter must be expressed in each type's own terms. "Open tickets" → incident.state [New, In Progress, On Hold], change_request.state [Pending, Pre-approve, Review, Build and Test, Work in Progress], sc_req_item.state [Open, Pending], sc_task.state [Open, Pending, Work in Progress]. "Tickets last month" → incident.created, change_request.created, sc_req_item.opened, sc_task.created.
- Every entry must have the SAME shape: same measures pattern (<cube>.count or none), the equivalent single dimension when grouping (e.g. created_month / opened_month, assignment_group / owner_group), the same order direction, and the same limit. The server merges grouped counts by dimension value and applies the limit to the merged totals, so for "top N" give each entry the same limit N.
- Note in assumptions that a requested item and the catalog tasks created to fulfil it are counted as separate tickets.
- When the user names one type explicitly ("incidents", "changes", "requests", "tasks") use only that type.

C1. Which ticket type, when one is named?
- "incident", "INC", "issue", "outage", "alert", "something broke", "went down", "major incident", "sev1", "P1/P2/P3/P4" → incident.
- "change", "CHG", "CR", "RFC", "CAB", "deploy/deployment", "release", "patch/patching", "reboot", "maintenance window", "go-live", "hypercare", "rollout" → change_request.
- "request", "RITM", "REQ", "service request", "catalog", "ordered", "onboarding/offboarding", "new hire", "termination", "access request", "software request", "new laptop" → sc_req_item.
- "task", "SCTASK", "catalog task", "fulfillment task", "work item", "my queue" (when about doing fulfillment work) → sc_task.
- Questions about WHO approved / WHICH approval group / approvals pending with a group → change_approvals (if about changes) or ritm_approvals (if about requests). Questions like "changes pending approval" or "rejected requests" use the approval column on change_request / sc_req_item instead.
- No entity words at all ("how many are open", "what came in today") → treat it as "tickets": all four ticket types, per C0.
- The word "problem" usually means incident in casual speech. Only use incident.problem when they say "problem ticket" or give a PRB number.

C2. What shape of answer?
- "how many", "count", "number of", "volume", "total" → measures=[<cube>.count], no dimensions.
- "by X", "per X", "breakdown", "split", "grouped", "distribution", "across teams", "which groups" → dimensions=[X] + count, order count desc.
- "top N", "most", "busiest", "biggest", "worst", "noisiest", "leading" → dimension + count, order desc, limit N (default 10). "fewest/least/quietest" → order asc.
- "trend", "over time", "per day/week/month", "daily/weekly/monthly", "month over month" → group by the *_month / *_week / *_day dimension, order by that dimension asc.
- "show", "list", "give me", "pull", "which tickets", "what are the", "find" → NO measures; dimensions = the standard list columns below; order by the date column desc; limit 50 unless they say a number. When listing several ticket types at once, use limit ${LIMITS.perTypeList} per type unless they say a number; each type is shown as its own table.
- "details", "what happened with", "status of", "look up", or just a bare ticket number → filter number equals that ticket, dimensions = the detail columns, limit 1. A ticket number always identifies exactly one type by its prefix.
- "who" → assignment_group (or assigned_to if they clearly mean a person). "where" → location. "when" → created/opened. "why / what caused" → cause_code or close_code. "what kind" → category/subcategory or item/type.
- "percent", "share", "ratio", "rate" → return the count broken down by the relevant dimension and say in message that percentages must be derived from the counts.
- Averages, MTTR, resolution time, time to close, aging in days, SLA compliance %, durations of any kind → intent "unsupported" with a message explaining the model only has counts, plus the nearest count question you CAN run. Exceptions that ARE supported: "SLA breached tasks" → sc_task.sla_flag equals true; "breached incidents" → incident.breach_reason set.

Standard list columns:
${cubes.map(c => `  ${c}: ${ENTITY_CATALOG[c].listColumns.map(d => `${c}.${d}`).join(', ')}`).join('\n')}
Detail columns (for single-ticket lookups):
${cubes.map(c => `  ${c}: ${ENTITY_CATALOG[c].detailColumns.map(d => `${c}.${d}`).join(', ')}`).join('\n')}

C3. Status words (the biggest source of nuance)
- "open", "active", "outstanding", "unresolved", "still open", "in the queue", "backlog", "pending", "not closed", "currently", "right now", "WIP", "ongoing":
    incident.state equals [${ENTITY_CATALOG.incident.openStates.join(', ')}]
    change_request.state equals [${ENTITY_CATALOG.change_request.openStates.join(', ')}]
    sc_req_item.state equals [${ENTITY_CATALOG.sc_req_item.openStates.join(', ')}]
    sc_task.state equals [${ENTITY_CATALOG.sc_task.openStates.join(', ')}]  (or sc_task.active equals true — equivalent)
    change_approvals.state equals [Open, Pending] ; ritm_approvals.state equals [Open]
- "closed", "done", "finished", "completed", "wrapped up":
    incident.state equals [Resolved, Closed] unless they say specifically "closed" (then just Closed) or "resolved" (then just Resolved — resolved means fixed but not yet formally closed).
    change_request.state Closed ; sc_req_item.state [Fulfilled, Closed Complete] ; sc_task.state Closed Complete.
- "cancelled/canceled/withdrawn/abandoned" → change_request.state "Canceled" / sc_req_item.state "Closed Cancelled" / sc_task.state "Closed Cancelled" / change_approvals.approval "Cancelled".
- "on hold", "waiting", "parked", "paused", "stuck waiting on the user/vendor" → incident.state On Hold (+ on_hold_reason if they say on whom: user/caller → Awaiting Caller, vendor/third party → Awaiting Vendor, change → Awaiting Change).
- "new", "unassigned", "untouched", "nobody picked up" → incident.state New (or sc_task.state Open).
- "stuck", "stale", "aging", "old", "sitting there", "rotting" → open states AND created before a cutoff (default: older than 7 days from today) — state the cutoff in assumptions.
- "reopened", "bounced back", "came back" → incident.reopen_count notEquals "0".
- "reassigned", "bounced around", "ping-ponged", "hot potato", "passed around" → incident.reassignment_count gte "2" (reassigned at least once → notEquals "0").
- "failed change", "unsuccessful", "went wrong", "blew up", "rolled back", "backed out" → change_request.close_code "Unsuccessful" (rolled back/backed out specifically → failure_code "Backout"; "caused an incident" → failure_code "Caused Incident"). "process failure" / "not followed process" → process_failure true.
- "successful changes", "went fine" → change_request.close_code Successful.
- "rejected" → change_request.approval Rejected / sc_req_item.approval Rejected / ritm_approvals.approval Rejected.
- "pending approval", "waiting for approval", "awaiting CAB", "not approved yet", "needs sign-off" → <cube>.approval equals "Requested" (change_request, sc_req_item) or approval records with state Open/Pending.
- "approved" → approval equals Approved.
- "fulfilled", "delivered", "provisioned" → sc_req_item.state [Fulfilled, Closed Complete].
- "failed request" → sc_req_item.stage contains "fail".
- "SLA breach", "breached", "over SLA", "missed SLA", "late" → sc_task.sla_flag true (tasks) or incident.breach_reason set (incidents).

C4. Priority / severity words (incident)
- "P1", "critical", "sev1", "severity 1", "major", "crit", "fire", "on fire", "burning", "all hands" → priority "P1 - Critical". "was a P1 at some point / downgraded P1s" → was_p1 true.
- "P2", "high", "sev2", "urgent", "hot" → "P2 - High". "high priority" alone → P1 and P2 together, say so.
- "P3", "average", "medium", "normal" → "P3 - Average". "P4", "low", "minor", "trivial" → "P4 - Low".
- "enterprise-wide", "everyone affected", "whole company" → impact "1 - Enterprise". "site down", "a whole plant/department" → impact "2 - Site/Dept". "multiple users" → "3 - Multiple Users". "single user", "one person" → "4 - User".
- "downgraded", "lowered priority" → downgrade_type set.

C5. Time phrases
The user message tells you TODAY's date. Compute concrete ISO dates from it. Use the entity's date column (incident/change_request/sc_task/approvals: created; sc_req_item: opened) unless they say resolved/closed/planned/scheduled. Always emit date filters as:
  - a whole month ("in August", "August's", "last month") → <date_col> startsWith "YYYY-MM"
  - a whole day ("on Aug 14", "yesterday", "today") → <date_col> startsWith "YYYY-MM-DD"
  - a range ("last 30 days", "since July", "between X and Y", "this week", "Q3", "year to date") → two filters: gte "YYYY-MM-DD" and lt "YYYY-MM-DD" (exclusive upper bound, next day).
- "recently", "lately" → last 7 days. "the past couple weeks" → 14 days. "this quarter" → calendar quarter containing today. "YTD" → Jan 1 to today.
- "this month" = calendar month of today. "last month" = the previous calendar month. "this week" = Monday of this week to today. "last week" = previous Mon–Sun.
- "resolved/fixed in <period>" → incident.resolved. "closed in <period>" → closed. "scheduled/planned for <period>", "upcoming", "next week", "on the calendar" → change_request.planned_start_date (upcoming = planned_start_date gte today). "went live" → planned_end_date.
- Data coverage is roughly 2026-06-01 to 2026-09-01 (incidents from 2026-07-05). If the computed window falls entirely outside that, still build the query but warn in assumptions that it is probably outside the export window.
- Words like "ever", "all time", "overall", "in total" → no date filter.

C6. Teams, groups, places, things
- Team / group / queue / squad / desk → assignment_group (incident, sc_task, approvals) or owner_group (change_request). Use contains with the distinctive token: "wintel / windows server team" → "WINTEL"; "linux" → "LINUX"; "SAP basis" → "SAP-BASIS"; "SAP" → "SAP"; "network team" → "Network"; "NOC" → "NOC"; "service desk / help desk / L1 / tier 1" → "ServiceDesk"; "IAM / identity / access management" → "IAM"; "desktop support / EUS / deskside" → "EUS"; "VDI / Citrix" → "VDI"; "M365 / Office 365 / Exchange online" → "M365"; "DBA / SQL team" → "SQL"; "Oracle" → "ORACLE"; "Azure" → "AZURE"; "AWS" → "AWS"; "storage" → "STORAGE"; "backup" → "BACKUP"; "security" → "Security"; "Accenture" → "ACN-"; "TCS / Tata" → "TCS-"; "Molson / internal / MCBC" → "MCBC".
- "opened by the monitoring tool / auto-generated / event management / alerts" → incident.contact_type "Event Management" or opened_by_group contains "ALERTING". "called in" → contact_type Phone. "chat" → Chat. "portal / self-service / submitted online" → Self-service. "walked up" → Walk-in. "emailed" → Email. "human-reported / real users (not monitoring)" → contact_type notEquals "Event Management".
- Locations → location (incident, sc_req_item) with contains: breweries by name ("Golden", "Milwaukee", "Fort Worth", "Burton", "Toronto", "Longueuil", "Albany", "Trenton", "Shenandoah", "Moncton", "Fraser Valley", "Tadcaster", "Aspall"); "HQ / corporate / head office" → startsWith "Corporate" (Milwaukee & Chicago); "Romania / GBS" → "Romania"; "UK" → Burton, Tadcaster, Aspall, Cardiff, Leeds, "Mobile UK" — use contains "Burton" if they say Burton, otherwise pick the most common and state it; "Canada" → Toronto/Longueuil/Moncton/Fraser Valley/Montreal; "cloud / Azure region / AWS region" → contains "Azure" or "US East"; "remote / WFH / home" → "Home Based". "Milwaukee" matches BOTH "Corporate - Milwaukee" and "Milwaukee Brewery" — use contains "Milwaukee" and say so, unless they say brewery or corporate.
- change_request: "brewery changes / plant changes" → brewery equals Yes; a named brewery → brewery_locations contains "<name>".
- Server / host / app / CI / device / box names → configuration_item contains "<name>". "noisiest server / which CI generates the most" → group by configuration_item, top 10.
- "environment: prod / production / live" → change_request.environment Production; "non-prod / dev / QA / test / UAT" → Non-Production.
- "SAP changes / anything touching SAP" → change_request.sap_impact Yes (or owner_group contains SAP if they mean the SAP team). "transports" → sap_transport_required Yes.
- "with an outage / downtime / service interruption" → change_request.outage Yes (planned outage). "caused an outage" → incident.business_impact_outage set.
- "caused by a change / change-related incidents / collateral from patching" → incident.caused_by_change set (or incident.cause_code "Business/System Changes").
- "knowledge article / KB attached" → incident.kb_article set.
- Category synonyms (incident): "hardware / laptop / desktop / device" → category Hardware (subcategory Laptop / Desktop when specific); "server issues" → subcategory Server; "slow / performance / latency" → subcategory Performance; "app not working / application bug" → Application Functionality; "job / batch / IWS / scheduler failures" → Job Failure; "password / locked out / can't log in" → subcategory equals [Password Reset, Account Locked, Password Expired, Account Disabled]; "access" → subcategory Access; "printer / printing" → category Printing (or subcategory contains "Printer"); "email / Outlook / mailbox" → category Email (or subcategory Outlook/Exchange); "phone / telephony / call drop / softphone" → category Telephony (dropped calls → subcategory Dropped Call); "network / wifi / LAN / WAN / VPN / connectivity" → category Network (specific subcategories Wireless, LAN, WAN, User Connectivity - Remote); "security / malware / phishing" → category Security; "database / SQL / Oracle" → category Database or subcategory contains "SQL"/"Oracle"; "VDI / virtual desktop" → subcategory VDI; "how-to / question / guidance" → category "Inquiry / Help".
- Catalog item synonyms (sc_req_item.item / sc_task.item): "software / install / license" → item contains "Software" (Office license → "Office License"); "new PC / laptop / computer / hardware" → "PC Request" or contains "Hardware"; "AD / account / group membership" → "AD Request"; "shared mailbox / calendar" → contains "Mailbox"; "distribution list / DL" → contains "Distribution List"; "share / network drive / folder access" → contains "Network Share"; "VDI" → contains "VDI"; "server start/stop/snooze" → contains "Virtual Server" or "Snooze"; "termination / offboarding / leaver" → contains "Termination"; "SharePoint" → contains "SharePoint"; "phone / mobile / iPad / tablet" → contains "Mobile Phone" / "iPad"; "firewall rule / port opening" → "Firewall Request"; "admin rights / local admin / elevated" → contains "Power User" or "Elevated"; "non-standard / NSSR / custom / one-off" → "Non-standard Service Request"; "SAP role / SAP access" → contains "SAP"; "reclaim / return equipment" → "Reclaim Asset"; "DNS / IP" → contains "DNS".

C7. Logic words
- "and", "that are also", "with", "which are" → additional filters (AND).
- "or", "either", "any of" on the SAME field → one filter with multiple values. On different fields → not expressible in one Cube query; pick the dominant one and note it in assumptions.
- "not", "except", "excluding", "other than", "besides", "isn't", "aren't", "without" → notEquals / notContains / notSet.
- "at least N", "N or more" → gte; "more than" → gt; "under / less than / fewer than" → lt; "at most / up to" → lte (values are text digits — only meaningful for single-digit counts like reassignment_count and reopen_count).
- "only", "just" → restrictive filter, nothing else. "all", "every", "everything" → drop status filters.
- "same as before but …", "now by …", "what about …" → there is no memory; build the full query from the current message and ask in message if critical context is missing.
- Typos, shorthand, and slang are expected: "incdent", "tkts", "chg's", "wrk in prog", "closd", "assgn grp", "prio", "sev", "cat", "sub cat", "CI", "env", "prod", "svr", "pw reset", "acct". Resolve them to the obvious member or value.
- Plural/singular, capitalization, and punctuation never matter in the user's text. They DO matter in your output values for equals.

C8. Defaults and when to ask
- Make reasonable assumptions and list each one in assumptions (e.g. "Treated 'open' as each ticket type's open states", "'tickets' = incidents, changes, requests and tasks", "Requests were left out because they have no team column"). The user can correct you on the next turn.
- Use intent "clarify" ONLY when: the entity is genuinely unknowable and the defaults would produce something misleading; a person's real name is given; or a location/group word matches several very different things and no sensible default exists. Ask one short, concrete question in message.
- Use intent "unsupported" for averages, durations, percentages-as-numbers, joins across tables, and anything not in the member list. Explain in one or two plain sentences and offer the nearest supported question.
- Never emit a query with no measures and no dimensions. Never invent member names. Never put SQL anywhere.

=====================================================================
D. OUTPUT FORMAT
=====================================================================
Return exactly one JSON object matching the provided schema:
{
  "intent": "query" | "clarify" | "unsupported",
  "queries": [
    { "entity": "<cube name>",
      "query": { "measures": [...], "dimensions": [...], "filters": [{"member","operator","values"}], "order": [{"member","direction"}], "limit": <int, 0 = none> } }
  ],
  "message": "<for query: one plain-English sentence restating what you will fetch; for clarify/unsupported: the question or explanation>",
  "assumptions": ["<each interpretation you made>"]
}
Rules: one entry per ticket type involved, each entity at most once. For a single ticket type, "queries" has exactly one entry. For intent clarify/unsupported, "queries" is []. For "set"/"notSet" operators pass values []. Values are always strings. Order may only reference members that appear in measures or dimensions.

=====================================================================
E. WORKED EXAMPLES (TODAY = 2026-09-02 in these examples)
=====================================================================
User: "how many open P1s do we have"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":[],"filters":[{"member":"incident.state","operator":"equals","values":["New","In Progress","On Hold"]},{"member":"incident.priority","operator":"equals","values":["P1 - Critical"]}],"order":[],"limit":0}}],"message":"Count of incidents that are still open and rated P1 - Critical.","assumptions":["Priority only exists on incidents, so only incidents are counted","'open' = state New, In Progress or On Hold"]}

User: "how many tickets came in last week"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":[],"filters":[{"member":"incident.created","operator":"gte","values":["2026-08-24"]},{"member":"incident.created","operator":"lt","values":["2026-08-31"]}],"order":[],"limit":0}},{"entity":"change_request","query":{"measures":["change_request.count"],"dimensions":[],"filters":[{"member":"change_request.created","operator":"gte","values":["2026-08-24"]},{"member":"change_request.created","operator":"lt","values":["2026-08-31"]}],"order":[],"limit":0}},{"entity":"sc_req_item","query":{"measures":["sc_req_item.count"],"dimensions":[],"filters":[{"member":"sc_req_item.opened","operator":"gte","values":["2026-08-24"]},{"member":"sc_req_item.opened","operator":"lt","values":["2026-08-31"]}],"order":[],"limit":0}},{"entity":"sc_task","query":{"measures":["sc_task.count"],"dimensions":[],"filters":[{"member":"sc_task.created","operator":"gte","values":["2026-08-24"]},{"member":"sc_task.created","operator":"lt","values":["2026-08-31"]}],"order":[],"limit":0}}],"message":"Number of tickets of every type logged last week, broken out by type with a total.","assumptions":["'tickets' = incidents, changes, requested items and catalog tasks","'last week' = Monday 2026-08-24 through Sunday 2026-08-30","A request and the tasks created to fulfil it count as separate tickets"]}

User: "monthly ticket volume"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":["incident.created_month"],"filters":[],"order":[{"member":"incident.created_month","direction":"asc"}],"limit":0}},{"entity":"change_request","query":{"measures":["change_request.count"],"dimensions":["change_request.created_month"],"filters":[],"order":[{"member":"change_request.created_month","direction":"asc"}],"limit":0}},{"entity":"sc_req_item","query":{"measures":["sc_req_item.count"],"dimensions":["sc_req_item.opened_month"],"filters":[],"order":[{"member":"sc_req_item.opened_month","direction":"asc"}],"limit":0}},{"entity":"sc_task","query":{"measures":["sc_task.count"],"dimensions":["sc_task.created_month"],"filters":[],"order":[{"member":"sc_task.created_month","direction":"asc"}],"limit":0}}],"message":"Tickets logged per month, split by ticket type with a monthly total.","assumptions":["'tickets' = incidents, changes, requested items and catalog tasks","Requests are grouped by the month they were opened; the others by the month they were created","Incidents only start on 2026-07-05 in this export, so June has no incidents"]}

User: "whos getting slammed with tickets last month"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":["incident.assignment_group"],"filters":[{"member":"incident.created","operator":"startsWith","values":["2026-08"]}],"order":[{"member":"incident.count","direction":"desc"}],"limit":10}},{"entity":"change_request","query":{"measures":["change_request.count"],"dimensions":["change_request.owner_group"],"filters":[{"member":"change_request.created","operator":"startsWith","values":["2026-08"]}],"order":[{"member":"change_request.count","direction":"desc"}],"limit":10}},{"entity":"sc_task","query":{"measures":["sc_task.count"],"dimensions":["sc_task.assignment_group"],"filters":[{"member":"sc_task.created","operator":"startsWith","values":["2026-08"]}],"order":[{"member":"sc_task.count","direction":"desc"}],"limit":10}}],"message":"Top 10 teams by total tickets logged in August 2026, across incidents, changes and catalog tasks.","assumptions":["'tickets' = every ticket type that has a team: incidents, changes (owning team) and catalog tasks","Requested items were left out because they have no team column","'slammed' = highest combined volume, top 10","'last month' = August 2026"]}

User: "show me the wintel teams stuff thats still sitting there"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":[],"dimensions":["incident.number","incident.created","incident.priority","incident.state","incident.short_description","incident.assignment_group","incident.category","incident.subcategory","incident.location"],"filters":[{"member":"incident.assignment_group","operator":"contains","values":["WINTEL"]},{"member":"incident.state","operator":"equals","values":["New","In Progress","On Hold"]}],"order":[{"member":"incident.created","direction":"asc"}],"limit":25}},{"entity":"change_request","query":{"measures":[],"dimensions":["change_request.number","change_request.created","change_request.type","change_request.sub_type","change_request.state","change_request.approval","change_request.risk","change_request.short_description","change_request.owner_group","change_request.planned_start_date","change_request.environment"],"filters":[{"member":"change_request.owner_group","operator":"contains","values":["WINTEL"]},{"member":"change_request.state","operator":"equals","values":["Pending","Pre-approve","Review","Build and Test","Work in Progress"]}],"order":[{"member":"change_request.created","direction":"asc"}],"limit":25}},{"entity":"sc_task","query":{"measures":[],"dimensions":["sc_task.number","sc_task.created","sc_task.item","sc_task.state","sc_task.assignment_group","sc_task.assigned_to","sc_task.sla_flag","sc_task.short_description","sc_task.request_item"],"filters":[{"member":"sc_task.assignment_group","operator":"contains","values":["WINTEL"]},{"member":"sc_task.state","operator":"equals","values":["Open","Pending","Work in Progress"]}],"order":[{"member":"sc_task.created","direction":"asc"}],"limit":25}}],"message":"Open tickets of every type owned by the Wintel team, oldest first, one table per ticket type.","assumptions":["'stuff' = any ticket type with a team: incidents, changes and catalog tasks","'still sitting there' = each type's open states, sorted oldest first","'wintel team' = team name containing WINTEL","Requested items were left out because they have no team column"]}

User: "whos getting slammed with incidents last month"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":["incident.assignment_group"],"filters":[{"member":"incident.created","operator":"startsWith","values":["2026-08"]}],"order":[{"member":"incident.count","direction":"desc"}],"limit":10}}],"message":"Top 10 assignment groups by number of incidents created in August 2026.","assumptions":["'incidents' was named explicitly, so only incidents are counted","'slammed' = highest volume, showing top 10","'last month' = August 2026"]}

User: "which changes failed in the last 30 days and did any cause incidents"
→ {"intent":"query","queries":[{"entity":"change_request","query":{"measures":[],"dimensions":["change_request.number","change_request.created","change_request.type","change_request.sub_type","change_request.state","change_request.close_code","change_request.failure_code","change_request.short_description","change_request.owner_group","change_request.planned_start_date"],"filters":[{"member":"change_request.close_code","operator":"equals","values":["Unsuccessful"]},{"member":"change_request.created","operator":"gte","values":["2026-08-03"]},{"member":"change_request.created","operator":"lt","values":["2026-09-03"]}],"order":[{"member":"change_request.created","direction":"desc"}],"limit":50}}],"message":"Unsuccessful changes created in the last 30 days, with their failure code (look for 'Caused Incident').","assumptions":["'failed' = close_code Unsuccessful","Last 30 days measured on created date: 2026-08-03 to 2026-09-02"]}

User: "monthly trend of password resets"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":["incident.created_month"],"filters":[{"member":"incident.subcategory","operator":"equals","values":["Password Reset","Account Locked","Password Expired"]}],"order":[{"member":"incident.created_month","direction":"asc"}],"limit":0}}],"message":"Incidents per month for password reset, account locked and password expired subcategories.","assumptions":["'password resets' includes Account Locked and Password Expired subcategories"]}

User: "whats the avg time to resolve a P2"
→ {"intent":"unsupported","queries":[],"message":"The data model only supports counts — there is no duration or average measure, so I can't compute resolution time. I can show you how many P2 incidents were resolved per month, or list resolved P2s with their created and resolved timestamps if you want to compute it yourself.","assumptions":[]}

User: "what did John Smith open last week"
→ {"intent":"clarify","queries":[],"message":"People in this export are anonymized as 'Individual NNNN', so a real name won't match. Do you have the Individual ID, or a ticket number I can start from?","assumptions":[]}

User: "software requests waiting on approval from the security guys"
→ {"intent":"query","queries":[{"entity":"ritm_approvals","query":{"measures":[],"dimensions":["ritm_approvals.parent","ritm_approvals.assignment_group","ritm_approvals.approval","ritm_approvals.state","ritm_approvals.created","ritm_approvals.short_description"],"filters":[{"member":"ritm_approvals.short_description","operator":"contains","values":["Software"]},{"member":"ritm_approvals.assignment_group","operator":"contains","values":["Security"]},{"member":"ritm_approvals.state","operator":"equals","values":["Open"]}],"order":[{"member":"ritm_approvals.created","direction":"asc"}],"limit":50}}],"message":"Open RITM approval records for software requests sitting with a Security approval group, oldest first.","assumptions":["Used the approval-records table because the question is about a specific approver group","'software' matched on the approval short description"]}

User: "INC1814467"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":[],"dimensions":["incident.number","incident.created","incident.updated","incident.resolved","incident.closed","incident.priority","incident.impact","incident.urgency","incident.state","incident.on_hold_reason","incident.short_description","incident.description","incident.category","incident.subcategory","incident.assignment_group","incident.assigned_to","incident.affected_user","incident.location","incident.configuration_item","incident.contact_type","incident.close_code","incident.close_notes","incident.cause_code","incident.reassignment_count","incident.reopen_count","incident.caused_by_change","incident.was_p1"],"filters":[{"member":"incident.number","operator":"equals","values":["INC1814467"]}],"order":[],"limit":1}}],"message":"Full details for incident INC1814467.","assumptions":[]}

User: "anything prod scheduled for next week with downtime?"
→ {"intent":"query","queries":[{"entity":"change_request","query":{"measures":[],"dimensions":["change_request.number","change_request.created","change_request.type","change_request.sub_type","change_request.state","change_request.approval","change_request.risk","change_request.short_description","change_request.owner_group","change_request.planned_start_date","change_request.environment"],"filters":[{"member":"change_request.environment","operator":"equals","values":["Production"]},{"member":"change_request.outage","operator":"equals","values":["Yes"]},{"member":"change_request.planned_start_date","operator":"gte","values":["2026-09-07"]},{"member":"change_request.planned_start_date","operator":"lt","values":["2026-09-14"]}],"order":[{"member":"change_request.planned_start_date","direction":"asc"}],"limit":50}}],"message":"Production changes with a planned outage whose planned start falls in the week of 2026-09-07.","assumptions":["'next week' = Monday 2026-09-07 through Sunday 2026-09-13","'downtime' = outage Yes"]}
`;
}

// The volatile part (today's date) goes in the user turn so the system
// prompt stays byte-identical and cacheable.
export function buildUserMessage(userPrompt, today = new Date()) {
  const iso = today.toISOString().slice(0, 10);
  const weekday = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return `TODAY is ${iso} (${weekday}). Translate this question into the JSON query object:\n\n"""${userPrompt}"""`;
}

// ---------------------------------------------------------------------
// 4. VALIDATOR / NORMALIZER — runs on Claude's output before Cube sees it
// ---------------------------------------------------------------------
const MEMBER_INDEX = (() => {
  const idx = new Map();
  for (const [cube, e] of Object.entries(ENTITY_CATALOG)) {
    idx.set(`${cube}.count`, { cube, kind: 'measure' });
    for (const d of e.dimensions) idx.set(`${cube}.${d}`, { cube, kind: 'dimension', column: d });
  }
  return idx;
})();

// Loose synonyms the validator can repair when Claude emits a near-miss
// value with "equals". Keys are lowercase; values are canonical strings.
const VALUE_SYNONYMS = {
  'incident.priority': { p1: 'P1 - Critical', critical: 'P1 - Critical', p2: 'P2 - High', high: 'P2 - High', p3: 'P3 - Average', average: 'P3 - Average', medium: 'P3 - Average', normal: 'P3 - Average', p4: 'P4 - Low', low: 'P4 - Low' },
  'incident.impact': { enterprise: '1 - Enterprise', 'site/dept': '2 - Site/Dept', site: '2 - Site/Dept', 'multiple users': '3 - Multiple Users', user: '4 - User', 'single user': '4 - User' },
  'change_request.state': { cancelled: 'Canceled', wip: 'Work in Progress', 'in progress': 'Work in Progress' },
  'sc_req_item.state': { canceled: 'Closed Cancelled', cancelled: 'Closed Cancelled', complete: 'Closed Complete', completed: 'Closed Complete' },
  'sc_task.state': { canceled: 'Closed Cancelled', cancelled: 'Closed Cancelled', complete: 'Closed Complete', completed: 'Closed Complete', wip: 'Work in Progress', 'in progress': 'Work in Progress' },
  'change_approvals.approval': { canceled: 'Cancelled', rejected: 'Cancelled', pending: 'Requested' },
};

function canonicalValue(member, raw) {
  const info = MEMBER_INDEX.get(member);
  if (!info || info.kind !== 'dimension') return raw;
  const enumVals = ENTITY_CATALOG[info.cube].enums[info.column];
  if (!enumVals) return raw;
  const lower = String(raw).trim().toLowerCase();
  const exact = enumVals.find(v => v.toLowerCase() === lower);
  if (exact) return exact;
  const syn = VALUE_SYNONYMS[member]?.[lower];
  if (syn) return syn;
  // unique partial match ("critical" -> "P1 - Critical")
  const partial = enumVals.filter(v => v.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  return raw; // leave it; Cube will simply return no rows
}


// Validates one sub-query against its declared cube. Pushes human-readable
// problems/warnings into the arrays passed in; returns the Cube-ready query.
function validateOne(entity, q, problems, warnings) {
  const tag = ENTITY_CATALOG[entity]?.label || entity;
  const measures = (q.measures || []).filter(m => typeof m === 'string');
  const dimensions = (q.dimensions || []).filter(d => typeof d === 'string');
  const filters = Array.isArray(q.filters) ? q.filters : [];
  const order = Array.isArray(q.order) ? q.order : [];

  if (measures.length === 0 && dimensions.length === 0) {
    problems.push(`${tag}: query has neither measures nor dimensions.`);
    return null;
  }

  // every member must exist and belong to this entry's cube
  const checkMember = (m, where) => {
    const info = MEMBER_INDEX.get(m);
    if (!info) { problems.push(`${tag}: unknown member "${m}" in ${where}.`); return null; }
    if (info.cube !== entity) { problems.push(`${tag}: "${m}" belongs to ${info.cube}; each query must stay inside one table.`); return null; }
    return info;
  };
  for (const m of measures) { const i = checkMember(m, 'measures'); if (i && i.kind !== 'measure') problems.push(`${tag}: "${m}" is not a measure.`); }
  for (const d of dimensions) { const i = checkMember(d, 'dimensions'); if (i && i.kind !== 'dimension') problems.push(`${tag}: "${d}" is not a dimension.`); }

  // filters: operator whitelist, value normalization, set/notSet shape
  const cleanFilters = [];
  for (const f of filters) {
    if (!f || typeof f.member !== 'string') { problems.push(`${tag}: filter missing member.`); continue; }
    if (!checkMember(f.member, 'filters')) continue;
    if (!ALLOWED_OPERATORS.includes(f.operator)) { problems.push(`${tag}: operator "${f.operator}" not allowed.`); continue; }
    if (f.operator === 'set' || f.operator === 'notSet') {
      cleanFilters.push({ member: f.member, operator: f.operator });
      continue;
    }
    let values = Array.isArray(f.values) ? f.values.map(v => String(v)) : [];
    if (values.length === 0) { problems.push(`${tag}: filter on ${f.member} (${f.operator}) has no values.`); continue; }
    if (f.operator === 'equals' || f.operator === 'notEquals') {
      values = values.map(v => {
        const c = canonicalValue(f.member, v);
        if (c !== v) warnings.push(`Normalized "${v}" to "${c}" for ${f.member}.`);
        return c;
      });
    }
    cleanFilters.push({ member: f.member, operator: f.operator, values });
  }

  // order may only reference selected members; convert to Cube's object form
  const selected = new Set([...measures, ...dimensions]);
  const cubeOrder = {};
  for (const o of order) {
    if (!o || typeof o.member !== 'string') continue;
    if (!selected.has(o.member)) { warnings.push(`Dropped order on ${o.member}: not in the selected members.`); continue; }
    cubeOrder[o.member] = o.direction === 'asc' ? 'asc' : 'desc';
  }

  // limit: list queries get a default; everything is capped
  let limit = Number.isInteger(q.limit) && q.limit > 0 ? q.limit : 0;
  if (measures.length === 0 && limit === 0) limit = LIMITS.defaultList;
  if (limit > LIMITS.max) { warnings.push(`Limit ${limit} capped to ${LIMITS.max}.`); limit = LIMITS.max; }

  const cubeQuery = {};
  if (measures.length) cubeQuery.measures = measures;
  if (dimensions.length) cubeQuery.dimensions = dimensions;
  if (cleanFilters.length) cubeQuery.filters = cleanFilters;
  if (Object.keys(cubeOrder).length) cubeQuery.order = cubeOrder;
  if (limit) cubeQuery.limit = limit;
  return cubeQuery;
}

const isTimeBucket = member => /_(day|week|month)$/.test(member);

// Decides whether several sub-queries can be shown as one combined table.
// They can when every one is "count, grouped by at most one column". In that
// case each sub-query fetches all groups (no order/limit) and the server
// sorts and limits the merged totals, so "top 10 teams" is a true top 10.
function planMerge(entries) {
  if (entries.length < 2) return null;
  const mergeable = entries.every(e =>
    (e.cubeQuery.measures || []).length === 1 &&
    (e.cubeQuery.dimensions || []).length <= 1);
  if (!mergeable) return null;
  const dimCounts = new Set(entries.map(e => (e.cubeQuery.dimensions || []).length));
  if (dimCounts.size !== 1) return null;

  const first = entries[0].cubeQuery;
  const dimension = (first.dimensions || [])[0] || null;
  let sortBy = 'total';
  let direction = 'desc';
  const [orderMember, orderDir] = Object.entries(first.order || {})[0] || [];
  if (orderMember) {
    sortBy = orderMember === dimension ? 'key' : 'total';
    direction = orderDir;
  } else if (dimension && isTimeBucket(dimension)) {
    sortBy = 'key';
    direction = 'asc';
  }
  const limit = Math.max(0, ...entries.map(e => e.cubeQuery.limit || 0));

  for (const e of entries) { delete e.cubeQuery.order; delete e.cubeQuery.limit; }
  return { dimension, sortBy, direction, limit };
}

/**
 * Takes the parsed structured output from Claude and returns one of
 *   { ok: true,  intent: 'query', queries: [{ entity, cubeQuery }], merge, message, assumptions }
 *   { ok: true,  intent: 'clarify' | 'unsupported', queries: [], merge: null, message, assumptions }
 *   { ok: false, error }
 * Each cubeQuery is ready to POST to /cubejs-api/v1/load. `merge` is null, or
 * a plan for combineResults() when the per-type counts should be one table.
 */
export function normalizeAndValidate(ai) {
  const problems = [];
  const warnings = [];
  if (!ai || typeof ai !== 'object') return { ok: false, error: 'Model returned no JSON object.' };

  const intent = ai.intent;
  const message = typeof ai.message === 'string' ? ai.message : '';
  const assumptions = Array.isArray(ai.assumptions) ? ai.assumptions.filter(a => typeof a === 'string') : [];

  if (intent === 'clarify' || intent === 'unsupported') {
    return { ok: true, intent, queries: [], merge: null, message, assumptions };
  }
  if (intent !== 'query') return { ok: false, error: `Unknown intent "${intent}".` };

  const raw = Array.isArray(ai.queries) ? ai.queries : [];
  if (raw.length === 0) return { ok: false, error: 'No queries were produced.' };

  const seen = new Set();
  const entries = [];
  for (const item of raw) {
    const entity = item?.entity;
    if (!ENTITY_CATALOG[entity]) { problems.push(`Unknown ticket type "${entity}".`); continue; }
    if (seen.has(entity)) { warnings.push(`Ignored a second query for ${entity}.`); continue; }
    seen.add(entity);
    const cubeQuery = validateOne(entity, item.query || {}, problems, warnings);
    if (cubeQuery) entries.push({ entity, cubeQuery });
  }
  if (problems.length) return { ok: false, error: problems.join(' ') };

  const merge = planMerge(entries);
  return { ok: true, intent: 'query', queries: entries, merge, message, assumptions: [...assumptions, ...warnings] };
}

/**
 * Merges per-type count results into one table.
 *   sections: [{ entity, rows }]  (rows straight from Cube)
 * Returns { dimension, entities, rows: [{ key, counts: { entity: n }, total }], totals }
 * `dimension` is the first query's grouping member, used for labels and formatting.
 */
export function combineResults(plan, queries, sections) {
  const entities = sections.map(s => s.entity);
  const dimFor = Object.fromEntries(queries.map(q => [q.entity, (q.cubeQuery.dimensions || [])[0] || null]));
  const byKey = new Map();

  for (const { entity, rows } of sections) {
    for (const r of rows) {
      const key = plan.dimension ? (r[dimFor[entity]] ?? '') : '';
      const n = Number(r[`${entity}.count`]) || 0;
      if (!byKey.has(key)) byKey.set(key, { key, counts: {}, total: 0 });
      const slot = byKey.get(key);
      slot.counts[entity] = (slot.counts[entity] || 0) + n;
      slot.total += n;
    }
  }

  let rows = [...byKey.values()];
  const sign = plan.direction === 'asc' ? 1 : -1;
  rows.sort((a, b) => plan.sortBy === 'key'
    ? sign * String(a.key).localeCompare(String(b.key))
    : (sign * (a.total - b.total)) || String(a.key).localeCompare(String(b.key)));
  if (plan.limit) rows = rows.slice(0, plan.limit);

  const totals = { counts: {}, total: 0 };
  for (const r of rows) {
    for (const e of entities) totals.counts[e] = (totals.counts[e] || 0) + (r.counts[e] || 0);
    totals.total += r.total;
  }
  return { dimension: plan.dimension, entities, rows, totals };
}
