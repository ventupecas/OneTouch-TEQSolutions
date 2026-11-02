# ServiceNow blueprint: sending tickets to OneTouch

What to set up in the ServiceNow instance, once there's access, so that every
insert and update of an incident, change, requested item, catalog task and
approval reaches OneTouch the way the original export did:

- **The same tables and columns.** Each record goes into the table the export
  was loaded into (`incident`, `change_request`, `sc_req_item`, `sc_task`,
  `change_approvals`, `ritm_approvals`), under that table's own column names,
  written the way the export writes them: a person or group by name, a choice
  by its label, a linked ticket by its number.
- **The same families and teams.** A new ticket joins the family of whatever
  it's linked to, and so that family's team. A ticket linked to nothing gets
  a family of its own on the team with the fewest tickets. It arrives
  unassigned, for that team's project manager to hand out. See "What happens
  to a ticket" below.

The pieces: a system property holding the shared secret, one outbound REST
Message, one Script Include that turns a record into the export's columns,
and one async Business Rule per table.

## 1. The shared secret (System Property)

**System Properties > System Properties > New** (`sys_properties.list`):

| Field | Value |
| --- | --- |
| Name | `x_onetouch.webhook_secret` |
| Type | string |
| Value | the same long random value as `WEBHOOK_SECRET` in the listener's `.env` |
| Read roles | `admin` |
| Write roles | `admin` |

## 2. The outbound REST Message

**System Web Services > Outbound > REST Message > New**:

| Field | Value |
| --- | --- |
| Name | `OneTouch Webhook` |
| Endpoint | `https://<listener-host>/api/v1/servicenow-webhook` |
| Authentication type | No authentication (the token header does it) |

On its **HTTP Methods** tab, open the default method (or add one):

| Field | Value |
| --- | --- |
| Name | `post` |
| HTTP method | POST |
| HTTP Request headers | `Content-Type: application/json` |
| Content | `${payload}` |

Add one **Variable Substitution**: `payload` (test value below). The Script
Include fills it with the whole JSON body, already escaped, through
`setStringParameterNoEscape`.

### The outbound JSON payload

One record per call: the table, and the record under that table's column
names. The key must be there: a ticket's `number`, an approval's `approval_id`.

```json
{
  "table": "incident",
  "record": {
    "number": "INC1900001",
    "created": "2026-11-02 14:03:11",
    "short_description": "Printer offline on the packaging line",
    "state": "New",
    "priority": "P3 - Average",
    "assignment_group": "TCS-EUS-Remote-Support",
    "parent_incident": null,
    "problem": null,
    "caused_by_change": null,
    "updated": "2026-11-02 14:03:11"
  }
}
```

A column that's left out keeps what it had; one sent empty (`""` or `null`) is
emptied. A column the table doesn't have is refused (400), so a mapping
mistake shows up the first time it's tried.

## 3. The Script Include: a record as the export's columns

**System Definition > Script Includes > New**: Name `OneTouchWebhook`,
Accessible from: This application scope only, Active.

Each table's map says, for each export column, which ServiceNow field fills it
and how:

- `display`: what people see: a person's or group's name, a choice's label, a
  linked ticket's number. The export holds these.
- `value`: the stored value (numbers, true/false).
- `date`: the stored UTC time, `yyyy-MM-dd HH:mm:ss`.
- `journal`: the latest entry of a journal field (work notes).

Fields marked **check** don't have a standard ServiceNow field, or the export
used a custom one (`u_…`): fill in your instance's field name, or leave them
out (the column is then left as it is). The export's other custom columns
(`brewery`, `sap_impact`, `breach_reason`, …) can be added the same way.

```javascript
var OneTouchWebhook = Class.create();
OneTouchWebhook.prototype = {
    initialize: function () {},

    // export column: [ServiceNow field (dot-walking allowed), how]
    MAPS: {
        incident: {
            number: ['number', 'value'],
            created: ['sys_created_on', 'date'],
            short_description: ['short_description', 'value'],
            description: ['description', 'value'],
            affected_user: ['caller_id', 'display'],
            assignment_group: ['assignment_group', 'display'],
            assigned_to: ['assigned_to', 'display'],
            problem: ['problem_id', 'display'],             // family link: a problem
            state: ['state', 'display'],
            parent_incident: ['parent_incident', 'display'], // family link: parent incident
            priority: ['priority', 'display'],
            impact: ['impact', 'display'],
            urgency: ['urgency', 'display'],
            category: ['category', 'display'],
            subcategory: ['subcategory', 'display'],
            updated: ['sys_updated_on', 'date'],
            configuration_item: ['cmdb_ci', 'display'],
            contact_type: ['contact_type', 'display'],
            reassignment_count: ['reassignment_count', 'value'],
            reopen_count: ['reopen_count', 'value'],
            close_code: ['close_code', 'display'],
            close_notes: ['close_notes', 'value'],
            caused_by_change: ['caused_by', 'display'],      // family link: the change that caused it
            resolved: ['resolved_at', 'date'],
            closed: ['closed_at', 'date'],
            location: ['location', 'display'],
            on_hold_reason: ['hold_reason', 'display'],
            work_notes: ['work_notes', 'journal']
            // check: was_p1, opened_by_group, cause_code, cause_sub_code, business_impact_outage, ...
        },
        change_request: {
            number: ['number', 'value'],
            type: ['type', 'display'],
            created: ['sys_created_on', 'date'],
            short_description: ['short_description', 'value'],
            description: ['description', 'value'],
            configuration_item: ['cmdb_ci', 'display'],
            owner_group: ['assignment_group', 'display'],    // check: the export's owning group
            state: ['state', 'display'],
            approval: ['approval', 'display'],
            close_code: ['close_code', 'display'],
            risk: ['risk', 'display'],
            requested_by: ['requested_by', 'display'],
            planned_start_date: ['start_date', 'date'],
            planned_end_date: ['end_date', 'date'],
            change_plan: ['implementation_plan', 'value'],
            backout_plan: ['backout_plan', 'value'],
            verification_plan: ['test_plan', 'value'],
            purpose_of_change: ['justification', 'value'],
            work_notes: ['work_notes', 'journal']
            // check, and family links: incident (the incident it fixes), problem
            // check: outage, failure_code, environment, sub_type, ...
        },
        sc_req_item: {
            number: ['number', 'value'],
            item: ['cat_item', 'display'],
            description: ['description', 'value'],
            short_description: ['short_description', 'value'],
            opened: ['opened_at', 'date'],
            updated: ['sys_updated_on', 'date'],
            closed: ['closed_at', 'date'],
            stage: ['stage', 'display'],
            state: ['state', 'display'],
            parent: ['parent', 'display'],                   // family link: bundle request
            request: ['request', 'display'],                 // family link: the order (REQ)
            requested_for: ['requested_for', 'display'],
            opened_by: ['opened_by', 'display'],
            approval: ['approval', 'display'],
            approval_set: ['approval_set', 'date'],
            location: ['location', 'display'],
            order_guide: ['order_guide', 'display'],
            work_notes: ['work_notes', 'journal']
        },
        sc_task: {
            number: ['number', 'value'],
            item: ['request_item.cat_item', 'display'],
            state: ['state', 'display'],
            short_description: ['short_description', 'value'],
            description: ['description', 'value'],
            assignment_group: ['assignment_group', 'display'],
            assigned_to: ['assigned_to', 'display'],
            parent: ['parent', 'display'],
            opened_by: ['opened_by', 'display'],
            approval: ['approval', 'display'],
            approval_set: ['approval_set', 'date'],
            request: ['request', 'display'],
            request_item: ['request_item', 'display'],       // family link: its request
            created: ['sys_created_on', 'date'],
            updated: ['sys_updated_on', 'date'],
            active: ['active', 'value'],
            work_notes: ['work_notes', 'journal']
            // check: sla_flag (the export's "SLA breached" flag)
        },
        // sysapproval_approver records, split by what they approve
        approvals: {
            task_type: ['sysapproval.sys_class_name', 'display'],
            parent: ['sysapproval', 'display'],              // the change or request it approves
            assignment_group: ['group.assignment_group', 'display'],
            short_description: ['sysapproval.short_description', 'value'],
            created: ['sys_created_on', 'date'],
            approval: ['sysapproval.approval', 'display'],
            state: ['state', 'display']
        }
    },

    read: function (gr, field, how) {
        var el = gr.getElement(field);
        if (!el || el.nil()) return null;
        if (how === 'display') return el.getDisplayValue();
        if (how === 'journal') return el.getJournalEntry(1);
        return el.toString(); // 'value' and 'date' (stored UTC)
    },

    // table: incident, change_request, sc_req_item, sc_task, or 'approvals'
    send: function (table, gr) {
        try {
            var secret = gs.getProperty('x_onetouch.webhook_secret');
            if (!secret) {
                gs.error('OneTouch webhook: x_onetouch.webhook_secret is not set; ' + gr.getDisplayValue() + ' not sent');
                return;
            }
            var record = {};
            if (table === 'approvals') {
                // Only approvals of changes and requested items have a table in OneTouch
                var of = gr.sysapproval.sys_class_name + '';
                if (of !== 'change_request' && of !== 'sc_req_item') return;
                table = of === 'change_request' ? 'change_approvals' : 'ritm_approvals';
                // approval_id is a whole number in OneTouch: the sys_id's first 13
                // hex digits, the same every time for the same approval
                record.approval_id = String(parseInt(gr.getUniqueValue().substring(0, 13), 16));
                if (table === 'change_approvals') record.work_notes = this.read(gr, 'comments', 'journal');
            }
            var map = this.MAPS[table === 'change_approvals' || table === 'ritm_approvals' ? 'approvals' : table];
            for (var column in map) record[column] = this.read(gr, map[column][0], map[column][1]);

            var request = new sn_ws.RESTMessageV2('OneTouch Webhook', 'post');
            request.setRequestHeader('X-Webhook-Token', secret);
            request.setHttpTimeout(30000);
            request.setStringParameterNoEscape('payload', JSON.stringify({ table: table, record: record }));
            // Queued on the instance and sent from there; nothing waits for it
            request.executeAsync();
        } catch (ex) {
            gs.error('OneTouch webhook: could not send ' + gr.getDisplayValue() + ': ' + ex.message);
        }
    },

    type: 'OneTouchWebhook'
};
```

## 4. The async Business Rules, one per table

**System Definition > Business Rules > New**, five times:

| Name | Table | Script line |
| --- | --- | --- |
| `OneTouch: send incident` | Incident `[incident]` | `new OneTouchWebhook().send('incident', current);` |
| `OneTouch: send change` | Change Request `[change_request]` | `new OneTouchWebhook().send('change_request', current);` |
| `OneTouch: send requested item` | Requested Item `[sc_req_item]` | `new OneTouchWebhook().send('sc_req_item', current);` |
| `OneTouch: send catalog task` | Catalog Task `[sc_task]` | `new OneTouchWebhook().send('sc_task', current);` |
| `OneTouch: send approval` | Approval `[sysapproval_approver]` | `new OneTouchWebhook().send('approvals', current);` |

For each: Advanced ticked, **When: async**, Insert and Update ticked, Order
1000. On the Advanced tab:

```javascript
(function executeRule(current, previous /* null when async */) {
    new OneTouchWebhook().send('incident', current);   // the table, as in the list above
})(current, previous);
```

**async** runs after the record is saved, on a scheduler worker, so nobody
saving a ticket waits for the call. Async rules can run in any order (a
catalog task's before its request's). The listener keeps a record that
arrives before the one it belongs to, and saves it once that one arrives.

## What happens to a ticket

| It arrives… | It goes |
| --- | --- |
| linked to tickets in one family (its parent incident, problem, the change that caused it, the incident a change fixes, its order or bundle, a task's request), either way | into that family, on that family's team |
| linked to tickets in two or more families | they merge into the biggest, which keeps its id and team; the others' tickets join it, and any that change team that way become unassigned, and that team's project manager is told under the 🔔 |
| linked to nothing (or only to tickets OneTouch doesn't have) | into a family of its own, on the real team (not a test team) with the fewest tickets |
| again (an update) | stays where it is; a new link can still merge families, but a link that goes away never splits one |

New tickets arrive **unassigned**: they show in the team's "Not assigned yet"
and in an admin's 📥 Not assigned yet, for the project manager to hand out.
Who can see them follows at once; OneTouch re-reads its KPIs, sorting,
families and charts about 15 seconds later.

## What the listener answers

| Answer | When |
| --- | --- |
| `200 {"received": true, "table": "…", "number": "…"}` | Accepted. Saving and the family run straight after; the outcome is in the listener's log. |
| `401 {"error": "Unauthorized"}` | `X-Webhook-Token` missing or wrong. |
| `400` | Not `{ table, record }`; a table or column that doesn't exist; a key that isn't a ticket number of that table (`INC` + 7 digits for an incident) or a whole number (approvals); a value that isn't text, a number, true/false or null; or not valid JSON. |
| `413` | The body is over 1 MB. |

The listener answers before it writes, so ServiceNow never waits on it. A
failed write shows up in the listener's log, not in ServiceNow's outbound HTTP
log. Older updates (by `updated`, on the tables that have it) never replace
newer ones.

## Trying it before ServiceNow is connected

With the listener running (`npm start`):

```bash
curl -i -X POST http://localhost:8090/api/v1/servicenow-webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: $WEBHOOK_SECRET" \
  -d '{"table":"incident","record":{"number":"INC1900001","created":"2026-11-02 14:03:11","short_description":"Printer offline","state":"New","priority":"P3 - Average","updated":"2026-11-02 14:03:11"}}'
```

## Checklist for go-live

- [ ] `db/schema.sql` run on analytics_db (or the listener allowed to make `servicenow_pending`)
- [ ] An account for the listener with SELECT, INSERT and UPDATE on the six tables
- [ ] `.env` filled in on the listener's server (never committed)
- [ ] The listener reachable from ServiceNow over HTTPS (ServiceNow's cloud
      can't reach `localhost`; use a public host or a tunnel, and a MID Server
      only if the endpoint is on a private network)
- [ ] The system property, REST Message, Script Include and five Business
      Rules created, with the same secret on both sides
- [ ] The **check** fields filled in for your instance
- [ ] Times: the map sends UTC. If the export's times were in another time
      zone, send `getDisplayValue()` in that zone instead, so new and old
      tickets compare correctly in the KPIs
- [ ] One ticket saved in ServiceNow and seen in OneTouch, in the right family
