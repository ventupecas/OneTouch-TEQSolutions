# OneTouch: teams, roles, and who works which tickets

This file records how OneTouch's teams work today and which role **should**
work which kinds of tickets. It's a working draft: today every ticket is
assigned at random within its team, and the routing below is the proposal for
replacing that.

## How it works today (teams.mjs)

- **Admins** (`ADMIN_USERNAMES` in `teams.mjs`: vperez, lvang, lbell) see every
  ticket. They put people on teams, set roles, move families between teams,
  and assign any ticket. They're the only ones who see the Metabase
  dashboards, because those show every ticket and can't be filtered per person.
- **Project manager**: sees every ticket of their team, assigns them to the
  team's members, and sees each member's workload (Team tab).
- **Process excellence** and **project team member**: see only the tickets
  assigned to them.
- People on no team, and the `warmup` service account, see no tickets.
- There are six teams, named after Molson Coors beers: Coors Light, Miller Lite,
  Coors Banquet, Blue Moon, Molson Canadian and Miller High Life. Each has one
  project manager, one process excellence member, and 3–4 project team members
  (the first members were placed at random).

**Families decide teams.** Tickets linked to each other form one family: a
parent incident and its children, a bundle request and its child requests, a
request and its catalog tasks, an order (REQ), everything linked to one
problem, and a change with the incident it fixes and the incidents it caused.
A ticket can be in several of these, so everything linked together is one
group (`ticket_families`), and the whole group belongs to one team. No family
is ever split between two teams. Moving a ticket to another team moves its
whole group, and those tickets become unassigned until the new team's project
manager hands them out.

**What people see is enforced on the server.** `restrictQuery` adds "ticket
number is one of theirs" to every Cube query made for anyone who isn't an
admin. That covers the AI assistant, ticket search, records, families, charts
and their own dashboards. Approval records follow the ticket they approve.
Never add a route that calls `runCubeQuery` directly with input from a person:
use `req.runQuery`. The only direct calls are the first-start seeding and
summaries for numbers that were already checked.

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
5. **New tickets.** The export is a frozen snapshot, so seeding once is enough.
   If live data ever arrives, new tickets need adding to an existing family
   (and so a team) when they're linked, or to the smallest team when they
   aren't.
