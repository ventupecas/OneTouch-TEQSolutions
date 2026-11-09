# OneTouch: teams, roles, and who works which tickets

This file records how OneTouch's teams work today and which role **should**
work which kinds of tickets. It's a working draft: today every ticket is
assigned at random within its team, and the routing below is the proposal for
replacing that.

## How it works today (teams.mjs)

- **Admins** (`ADMIN_USERNAMES` in `teams.mjs`: vperez, lvang, lbell) see every
  ticket. They put people on teams, set roles, move families between teams,
  and assign any ticket. The Team tab's **📥 Not assigned yet**
  (`GET /api/teams/unassigned/tickets`, `teams.unassignedTickets`; admins only)
  lists every ticket nobody has, on a team or on none, under a row for its
  family, where the family is moved to a team or given whole to one person.
- **Everyone gets the Metabase dashboards, each showing only their own
  tickets.** The server signs a Metabase embed link per person
  (`signedDashboardPath` in `server.mjs`) with a locked `viewer` filter
  (`dashboardViewer` in `teams.mjs`: `all`, `team:<id>:<key>` or
  `person:<id>:<key>`). Every chart's SQL reads the ticket views through
  `scopedSql` (`scripts/metabase-setup.mjs`), which keeps only
  `reporting.visible_tickets(viewer)`. That function reads OneTouch's live
  assignments from `onetouch_auth` through `postgres_fdw`, as `access_reader`,
  which can read only the `ticket_access` view (number, team id, assignee id)
  and can't log in from outside the Postgres container (`db/init-reporting.sh`).
  Public links are off. A chart may only use a view listed in `SCOPED_VIEWS`,
  and the script refuses any other view. Filter suggestions (team names,
  sites, …) still list every value, but the charts don't.
- **Assigning** is done by typing a name (`public/picker.js`): a project
  manager or admin types part of a team member's name and picks from the
  matches, for one ticket, the ticked tickets, or a whole family at once
  ("Give all…" on the Team tab, "Give it all to" in Team families;
  `PUT /api/ticket-families/:id/assignee`, `teams.assignFamily`). Only the
  family's team's people can be picked, and they're notified.
- **Project manager**: sees every ticket of their team, assigns them to the
  team's members, and sees each member's workload (Team tab).
- **Process excellence** and **project team member**: see only the tickets
  assigned to them.
- People on no team, and the `warmup` service account, see no tickets.
- Test accounts (`tester1`, `tester2`, …, and any `test.<name>`) only ever
  join a **test team** (`teams.is_test`), never a real one. Seeding skips them,
  an admin can only put them on a test team, and the server takes any that
  are on a real team off it when it starts (`takeTestAccountsOffTeams`). Their
  tickets stay with the team, unassigned. `tester1` and `tester2` are on no team.
- An admin takes someone off a team with **Remove from team** in the Team tab
  (or by picking "No team"). They lose their role and stop seeing the team's
  tickets, and their tickets go back to the team, unassigned.
- There are six real teams, Example Team 1 to Example Team 6. Each has one
  project manager, one process excellence member, and 2–4 project team
  members (the first members were placed at random).
- One test team, the **Milwaukee Brewers**, for trying out the project manager's
  side: `vperez` (an admin, who still sees everything) is its project manager.
  Its players are test accounts made on this server only (they're not in
  `db/accounts.json`): William Contreras (`test.wcontreras`, process
  excellence), and Christian Yelich (`test.cyelich`), Jackson Chourio
  (`test.jchourio`) and Brice Turang (`test.bturang`) as project team members.
  Their passwords are random; set one with
  `docker exec -it analytics_node_app npm run users -- reset-password test.cyelich`.
  It starts with no tickets: an admin moves families to it from 📥 Not assigned
  yet or with "Move tickets to another team". For presentations, `db/demo-tickets.sql` adds 11 made-up
  "[Demo]" tickets in 5 families (numbers `…99000xx`, outside the export) on no
  team, ready to move to the Brewers live; running it again resets them, and
  `db/demo-tickets-remove.sql` removes them (restart the app after either).
  Without a restart, an admin's **Before a presentation** card (Team tab)
  puts them back (`POST /api/demo-tickets/reset`, `teams.resetDemoTickets`: no
  team, nobody, and their statuses, notifications, stars and ticket results
  gone) and undoes every status (`POST /api/ticket-statuses/undo-all`,
  `teams.undoAllStatuses`: all of `ticket_reports` and the 'report'
  notifications). Real tickets keep their teams and people.
- **Everyone an admin, after a presentation** (the same card's "After the presentation",
  `PUT /api/everyone-admin` `{ on }`, `teams.setEveryoneAdmin`): every account but the
  service accounts gets an admin's scope (`access.admin`), so stakeholders can try every
  feature. Only the permanent admins (`access.permanentAdmin`, `ADMIN_USERNAMES`) can
  switch it; 🚩 reports still go only to them. Saved in `app_settings` ('everyone_admin'),
  so it survives a restart. Teams, roles and assignments never change.

**Assigned to me** (Home's first tab, `GET /api/my-tickets`): everyone's
OneTouch tickets, most urgent first, then oldest (`ticketsByPriority` in
`tickets.mjs`). Only incidents have a priority (P1–P4). A change ranks by its
risk (High like P2, Medium like P3, Low and Standard like P4). Requests and
catalog tasks have no priority, so they come after everything else. The list
opens on open tickets, with Closed and All a click away.

**KPIs** (`kpis.mjs`). Every ticket's KPI fields are read from Cube once at
start, because the data is frozen. Ages count to the end of the data, not
today, and "typical" means the median for that kind of ticket.

- **Each ticket's KPIs** appear in "Assigned to me" (`POST /api/kpis/tickets`).
  Anyone may get them for a ticket they can see, so most people only see
  their own tickets' KPIs.
  - Incidents: open for / resolved in (against the median for its
    priority), last update, reassigned, reopened, SLA breach recorded, plus
    workaround, was a P1, caused by a change and problem when they apply.
  - Changes: open for, lead time, window, past its planned end / starts
    soon, outcome, approval, outage, emergency or expedited.
  - Requests: open for / fulfilled in, last update, approval.
  - Catalog tasks: open for / closed in (to their last update, since tasks
    have no closing date), last update, SLA.
- **Each family's KPIs** are only for its team's project manager and admins
  (Home's "Team families", `GET /api/kpis/families` and
  `/api/kpis/families/:id`). They cover: tickets, how many are closed,
  oldest open, no update for a week, highest priority, median resolve and
  fulfil times, SLA breaches, reassignments, reopens, successful changes,
  incidents caused by its changes, how long it's been active, people on it,
  and open-but-unassigned. Families with open tickets come first.

**Highlighted tickets** (`kpis.mjs` `attentionFlagger`, `server.mjs` `attentionCheck` and
`withFlags`). Open tickets that need attention get a red row and say why under their number
(`t.flags`, `attentionFlagsHtml` in `app.js`), in Assigned to me, the Team tab, 📥 Not assigned
yet, a family's tickets in Team families, ticket search, Ticket results and Starred tickets.
Assigned to me and the Team tab's lists have a **Needs attention (n)** filter
(`?attention=1`). Closed tickets aren't flagged, nor are ones someone said they resolved or
closed (`ticket_reports`), since the data never changes to clear them.

- **Overdue**: the export has few deadlines, so a change is overdue past its planned end, an
  incident or catalog task with a breached SLA while still open, and anything else once it has
  been open longer than 95 in 100 finished tickets of its kind took (an incident's kind includes
  its priority). Nothing finished to compare with: not overdue. No fixed targets are invented.
- **No update**: 7 days or more, as the red "Last update" KPI. The export has no update date
  for changes, so they never get this one.
- **Not assigned**: nobody has it in OneTouch (`ticket_assignments`), not ServiceNow's `assigned_to`.

**Sorting** (`public/sorting.js`). Every ticket list and table sorts by any of its
columns: a heading sorts ascending, then descending, then back to the list's own order.
Lists shown a page at a time sort all of their tickets, not just the page; the Team tab,
Team families and the Families page are sorted by the server, from every ticket's summary
read once at start (`tickets.mjs` `loadTicketIndex`). That index only orders tickets the
person may already see; it never decides what they see. Charts sort with their ⇅ menu,
the builder's Order, or an answer's Order menu: by count or by their groups, either way.

**Looking up** (`public/lookup.js`). Every ticket list has a 🔍 box that finds its
tickets by any of its columns (or one picked column): every word must appear, "quoted
words" stay together. Lists the page holds whole are looked up where they are; lists
shown a page at a time look through all of their tickets, the Team tab, Team families
and the Families page on the server (`?q=&col=`, `tickets.mjs` `lookupMatches`), only
ever among the tickets that person may already see.

**No blank cells.** Where the data has nothing, a list says why ("No priority" for
requests and catalog tasks, "Not assigned", "No parent", …; `blankText` in `app.js` and
`tickets.mjs`). A request's team is the team of its catalog tasks, and a request with no
"requested for" shows who opened it. On the Families page, an order, a problem record or
a parent that isn't the person's own gets its row from the family's tickets they may see
(`relations.mjs` `familyRow`), never from a ticket they can't see.

**My charts** (Home): the tickets assigned to that person, drawn by type, state, priority,
KPIs, week opened and ServiceNow team, from the same list as "Assigned to me"; a click on a
bar shows those tickets in "Assigned to me". **The AI assistant** is the Ask bar in the
header (right of 👥 Team) on every page; a click anywhere outside the chat closes it.
Every full ticket number in the chat (typed questions, answers, answer tables, family notes
under an answer) is a button that opens that ticket (`linkTicketsHtml` in `app.js`).

**♿ Accessibility** (`public/accessibility.js`, the ♿ in the header and on the sign-in page,
Alt+A): text size, high contrast, easier-to-read text, bold word beginnings (like Bionic
Reading: each text node wrapped in `span.a11y-bionic` with a `<b>` per word, text unchanged,
new text wrapped as it arrives), underlined links, a strong focus
outline, a big pointer, a reading guide and less motion; a 🔍 magnifier for the text under
the pointer; 🔊 read aloud (Alt+R, a 🔊 Read on every answer, optionally answers as they
arrive, selected text or what's pointed at); 🎤 dictation by the Ask bar and the chat, or
Alt+M in any text box (the browser's speech service, so `microphone=(self)` in the
Permissions-Policy). Kept in the browser and saved as the `access` preference. The file is
one function, so its names can't clash with the other page scripts.

**🧊 Architecture** (`architecture.mjs`, `public/architecture.js`, the 🧊 in the header,
admins only): a 3D map of how OneTouch is built, drawn with three.js (unchanged, in
`public/vendor/three-0.186.1/`, loaded the first time an admin opens the map), with the same
content in a list for screen readers. **🗺️ 2D** (`buildPlanView`, no three.js) draws the same
blocks, links, flows and health on a flat sheet, with each block's `doing` sentence and each link's
label written on it; browsers that can't draw 3D get it. It comes first (2D, 3D, List) and is
the view a browser opens on until someone picks another. It and the 3D scene answer to the same calls
(`scene()`), so the page's buttons and steps don't care which is showing. The 3D scene doesn't draw
`pos` as written: `at()` in `buildWorld` spreads it (`SPREAD`) inside the Docker frame and moves what's
outside the frame out with its edge, so blocks have room without the map getting much wider. `public/` can be read
without signing in, so everything the map says is in `architecture.mjs` and comes from
`GET /api/architecture` (401 signed out, 403 for anyone who isn't an admin); the page's
script only draws. Versions are read from `package-lock.json` and `docker-compose.yml`.
`checks/architecture.mjs` (`npm test`) fails if a file the map names is gone, a link or a
flow's step doesn't join real blocks, a container in `docker-compose.yml` isn't on it, the
map's facts appear in `public/`, or the 2D drawing doesn't add up (a block with no `plan` or `doing`, two
blocks overlapping, a `route` that doesn't start and end on its own blocks or runs through another):
**a new container or service goes in `NODES`, with its place on the sheet, and its links get a `route`
and `labelAt`.**
**The ServiceNow live push is on it as built, but needing ServiceNow's authentication:** a
dashed amber path that stops at a locked gate, and a "What happens when…" that animates it
(nothing is sent). It says so until this server really hears a record (`servicenowPush` in
`server.mjs`, counted from `onetouch_tickets_changed`, `GET /api/architecture/push`, read
every 20 s while the map is open); then it turns green and its words move on. The count is
in memory, so after a restart it says "needs authentication" until the next record arrives.
The notice's ✕ hides only that notice, in that browser (`onetouch-arch-push-bar-hidden`), until
a ServiceNow button in the left side bar brings it back or records start arriving.
The page also reports **anything else that stops working** (`health.mjs`,
`GET /api/architecture/health`, admins only): real checks of the account database, a query
through Cube, Metabase, the Claude API (listing models, no tokens), the email outbox, the
public address and the ticket-change channel, plus any 5xx answer in the last 15 minutes.
They run only while the page is open, and answers are kept 30 s or more. A problem shows in
the banner, the 🩺 Health tab and on its block; if the report itself can't be had, the page
says so. **Something new that can break gets a check in `buildChecks`.** The left side bar
minimizes with ◀ (remembered in this browser).

**Notifications** (`notifications.mjs`, the 🔔 in the header, checked every
minute). Each one is saved in the same transaction as the change it reports:

- Someone gets tickets (from their project manager or an admin): they're told
  which ones. Giving tickets to yourself, or unassigning, tells nobody.
- An admin moves a family to a team: that team's project manager is told. The
  tickets arrive unassigned.
- A member says they resolved or closed one of their tickets (a button on the
  ticket's record and on its row in the Team tab): their project manager is
  told, and the Team tab shows it under the ticket's state. This is only a
  message (`ticket_reports`): the ticket's data never changes. The Team tab's
  **Resolved or closed** (`GET /api/ticket-statuses`, `teams.ticketStatuses`)
  lists each ticket whose latest report is resolved or closed: every team's for
  admins, a project manager's own team's. They change it
  (`PUT /api/ticket-statuses/:number`, `teams.setTicketStatus`): resolved or
  closed adds a report in their name; open deletes the ticket's reports.

Each one can be cleared off the person's list ("Clear" on it, or "Clear all"
up to the newest shown; `POST /api/notifications/clear`,
`notifications.clearNotifications`). Clearing sets `cleared_at` and keeps the
row, so the email outbox is unaffected; only the person's own can be cleared.

**🚩 Problem reports** (`issues.mjs`, the 🚩 in the header, `POST /api/issues`; the dialog is in
`public/notifications.js`): anyone signed in can report a problem (5 per person per 10 minutes).
The report (`issue_reports`) and a kind `issue` notification for every other admin are saved in one
transaction. The email only says who reported what kind of problem; what they wrote shows under
the admins' 🔔 and on 🧊 Architecture (the banner and 📣 Reports, `GET` and `PUT
/api/architecture/issues`), where an admin marks it resolved or reopens it. **Never send a test
report on the live server: it emails the real admins.**

**Each notification is also emailed** (`mail.mjs`, through Brevo's API, from
`notifications@onetouch.fyi`): an outbox on the `notifications` table, sent after the
change commits, retried up to 5 times, never older than an hour. Only to people with
`users.email` set (an admin sets it: `npm run users -- email|emails`; never in
`db/accounts.json`) who haven't unticked "Email me these too" in the 🔔 panel; never test
or service accounts; only `MAIL_ONLY_TO` while that's set. An email holds who did what
and the ticket numbers, never summaries or notes. No `BREVO_API_KEY` in `.env`: off.

**Families decide teams.** Tickets linked to each other form one family: a
parent incident and its children, a bundle request and its child requests, a
request and its catalog tasks, an order (REQ), everything linked to one
problem, and a change with the incident it fixes and the incidents it caused.
A ticket can be in several of these, so everything linked together is one
group (`ticket_families`), and the whole group belongs to one team. No family
is ever split between two teams. Moving a ticket to another team moves its
whole group, and those tickets become unassigned until the new team's project
manager hands them out.

**New tickets from ServiceNow** (`servicenow-sync/`, its own process; not
connected to ServiceNow yet). ServiceNow's async Business Rules post
`{ table, record }` to `POST /api/v1/servicenow-webhook` (`X-Webhook-Token`).
The record goes into the export's own table (analytics_db: `incident`,
`change_request`, `sc_req_item`, `sc_task`, `change_approvals`,
`ritm_approvals`) under its column names, upserted by the table's key; the
columns and keys are read from the database at start, never listed in the
code. Older updates (by `updated`) never replace newer ones. A task before
its request, or an approval before its ticket, waits in `servicenow_pending`
and is saved as soon as that arrives. Each ticket is then placed by
`teams.placeTicket`, with the same `LINKS` as the first start, followed both
ways: linked tickets' family (and team), or a family of its own on the real
team with the fewest tickets; it arrives unassigned. A ticket linking two
families merges them into the biggest (it keeps its id and team; ties: the
lower id); tickets changing team become unassigned and that team's project
manager is told ('family' notification, `detail.source: 'servicenow'`).
Families never split. `placeTicket` signals `onetouch_tickets_changed` in
onetouch_auth; `server.mjs` listens, re-reads scopes at once and, 15 s later
(Cube's cache), KPIs, the ticket index, family links and chart results.
The ServiceNow side is in `servicenow-sync/servicenow-blueprint.md`.

**What people see is enforced on the server.** `restrictQuery` adds "ticket
number is one of theirs" to every Cube query made for anyone who isn't an
admin. That covers the AI assistant, ticket search, records, families, charts
and their own dashboards. Approval records follow the ticket they approve.
Never add a route that calls `runCubeQuery` directly with input from a person:
use `req.runQuery`. The only direct calls are the first-start seeding,
summaries for numbers that were already checked, and `teams.findsHiddenTickets`,
which counts an AI answer's validated query over tickets that aren't the
person's and only ever returns true or false (never a count or a row).

**The AI assistant and permissions** (`answerQuestion` in `server.mjs`). A
question naming only tickets the person can't see is refused before Claude
(`intent: 'denied'`); one whose generated query filters only on such tickets is
refused before anything runs. Otherwise the answer shows only their tickets, and
`restricted` ("You can't see the full report…") says when matching tickets that
aren't theirs were left out (`findsHiddenTickets`, per query). A query that is
empty only because of permissions gets no Claude explanation; one where nothing
anywhere matches is explained as "the data has none". A full ticket number someone
can't open but that is in the data comes back in `noAccess` (ticket search,
Families page find, starred list; `noAccessTo` in `server.mjs`, `inTheData` in
`tickets.mjs`, from the ticket index): the page says "You don't have permission
to see …". Only the number is sent, never anything in the ticket; admins never
get one.

**Two kinds of "assigned".** `assigned_to` and `assignment_group` in the
ServiceNow export are who worked a ticket in ServiceNow. They have nothing to
do with OneTouch's assignments (`ticket_assignments.assignee_id`), which decide
who sees a ticket here.

**First start.** When the `teams` table is empty, the server builds the teams
from Cube. Families are dealt out biggest first to whichever team has the fewest
tickets, so each team gets about 9,850 of the 59,125. Each ticket then goes to
a random member of its team. "Random" is a hash of the ticket number, so every
OneTouch server seeds identically. To seed again from scratch, run
`TRUNCATE teams, team_members, ticket_families, ticket_assignments` in
`onetouch_auth` and restart the app. **This throws away every assignment and
membership change people made.**

## Which role should work which tickets (proposal)

The goal: project team members do the hands-on work, the project manager
coordinates the tickets that are urgent, risky or blocked, and process
excellence works on why tickets keep coming back, not on fixing each one.

### Incidents (INC)

| Kind of incident | Role | Why |
| --- | --- | --- |
| P3 / P4, no parent, no problem | Project team member | Routine restore-service work |
| Child incidents of a parent | Whoever has the parent | One person works the whole fault; the children close with it |
| Parent (master) incidents | Project team member, watched by the PM | Many users are affected; the PM keeps an eye on progress and updates |
| P1 / P2, or `was_p1` | Project manager (coordinates), with a project team member doing the fix | Major incidents need one person running communications and escalation |
| Linked to a problem (`problem` set) | Process excellence | Part of a root-cause investigation |
| Reopened (`reopen_count` > 0) or passed around (`reassignment_count` ≥ 3) | Process excellence reviews; a project team member fixes | These are signs the process failed, not just the fix |
| Caused by a change (`caused_by_change` set) | Process excellence, with whoever has the change | Feeds the review of that change |

### Changes (CHG)

| Kind of change | Role | Why |
| --- | --- | --- |
| Standard or low-risk normal changes | Project team member | They build and carry out the work |
| High risk, production, or with a planned outage | Project manager owns scheduling and approval; a project team member does the work | Needs CAB, communications and a back-out plan |
| Emergency changes | Project manager | Approved and run under time pressure |
| Unsuccessful (`close_code` Unsuccessful) or failure code "Caused Incident" | Process excellence | Post-implementation review: why it failed and how to prevent it |
| Raised to fix an incident (`incident` set) | Whoever has that incident | Keeps the fix with the person who knows the fault |

### Requests (RITM), orders (REQ) and catalog tasks (SCTASK)

| Kind of ticket | Role | Why |
| --- | --- | --- |
| Single catalog requests and their tasks | One project team member for the request and all its tasks | One owner from order to fulfilment |
| Bundle requests and orders with many items | Project manager splits the work, project team members fulfil it | Many people may be involved |
| Waiting on approval (`ritm_approvals` / `change_approvals` still open) | Project manager | Chasing approvers is coordination work |
| Tasks breaching SLA (`sla_flag`) | Project manager re-prioritises; the assignee keeps it | Visible to the PM before it's late |
| High-volume catalog items | Process excellence | Candidates for automation or a simpler form |

### Problems (the problem families)

Process excellence leads the root-cause work. The project team members who had
the linked incidents and changes help as subject experts. The project manager
makes sure the fix is scheduled (usually as a change).

## Suggested next steps

1. **Assign by family, not by ticket.** Replace the per-ticket random pick in
   `seedTeams` so a family goes to one person (the parent's or request's
   owner). Today a parent incident and its children can belong to different
   people on the same team.
2. **Route by the tables above.** Pick the role from fields already in the
   export (priority, `was_p1`, `problem`, `reopen_count`, change `risk` /
   `outage` / `close_code`, `sla_flag`). Within that role, give the ticket to
   whoever has the fewest open tickets.
3. **Let process excellence see the whole team (read-only).** Their work is
   spotting patterns, which is hard when they only see their own tickets.
4. **Decide what admins and project managers want to approve.** For example,
   whether a project manager may take tickets from another team's family, or
   only an admin.
5. **New tickets.** Built, waiting for ServiceNow access: see "New tickets
   from ServiceNow" above.
