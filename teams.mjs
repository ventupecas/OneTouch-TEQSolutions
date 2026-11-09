// =====================================================================
// TEAMS, ROLES, AND WHO SEES WHICH TICKETS, kept with the accounts in the
// onetouch_auth database
//
//   admin               sees every ticket; moves families between teams,
//                       puts people on teams, and assigns any ticket
//   project manager     sees every ticket of their team, assigns them to
//                       the team's members, and sees who has what
//   process excellence  sees the tickets assigned to them
//   project team member sees the tickets assigned to them
//
// Tickets go to teams by family. A ticket can be in several families (a
// parent incident, a problem, a change it caused...), so everything linked
// together forms one group, a row in ticket_families, and the whole group
// belongs to one team. That way no family is ever split between two teams:
// moving one ticket to another team moves its whole group.
//
// Every Cube query made for someone who isn't an admin goes through
// restrictQuery, which adds "the ticket is one of theirs". So the AI
// assistant, search, records, charts and families only ever see those.
//
// People hear about changes through notifications.mjs: tickets given to
// them, a family moved to the team they're the project manager of, and
// (for a project manager) a member saying they resolved or closed a ticket.
// =====================================================================

import { createHash } from 'node:crypto';
import { pool } from './auth.mjs';
import { notify } from './notifications.mjs';
import { sortRows } from './tickets.mjs';

// They see absolutely everything
export const ADMIN_USERNAMES = ['vperez', 'lvang', 'lbell'];
// Neutral names, so no product brand appears on a team
export const TEAM_NAMES = ['Example Team 1', 'Example Team 2', 'Example Team 3', 'Example Team 4', 'Example Team 5', 'Example Team 6'];
export const ROLES = {
  project_manager: 'Project manager',
  process_excellence: 'Process excellence',
  project_team: 'Project team member',
};
// Accounts that aren't people (scripts/warmup.mjs) never join a team
const SERVICE_ACCOUNTS = ['warmup'];
// The warm-up sees every ticket, as an admin does, so it can ask every question
// (one naming a ticket is refused before Claude for anyone who can't see it) and
// fill the dashboards' "all" view. It gets none of an admin's powers.
const SEES_EVERY_TICKET = ['warmup'];
// Test accounts (tester1, tester2, ..., and test.<name>, like the Milwaukee
// Brewers' players) only ever join a test team, never a real one. A Postgres
// pattern, also used as a RegExp.
const TEST_ACCOUNT = '^(tester[0-9]*|test\\.[a-z0-9._-]+)$';
const isTestAccount = username => new RegExp(TEST_ACCOUNT).test(username);
// Not a person's account (mail.mjs never emails these)
export const isTestOrServiceAccount = username => isTestAccount(username) || SERVICE_ACCOUNTS.includes(username);
// What a member can tell their project manager about one of their tickets
export const REPORT_STATUSES = { resolved: 'resolved', closed: 'closed' };
const MAX_NOTE = 500;

const PREFIXES = ['INC', 'CHG', 'RITM', 'SCTASK'];
const TICKET = /^(INC|CHG|RITM|SCTASK)\d{7}$/;
// The column that holds each cube's ticket number (an approval: the ticket it approves)
const SCOPED_CUBES = {
  incident: ['INC', 'number'],
  change_request: ['CHG', 'number'],
  sc_req_item: ['RITM', 'number'],
  sc_task: ['SCTASK', 'number'],
  change_approvals: ['CHG', 'parent'],
  ritm_approvals: ['RITM', 'parent'],
};
// The link columns that join tickets into families (the same ones as
// relations.mjs). A problem record isn't a ticket, so it's marked PRB:.
// servicenow-sync/ links each new ticket by these too (placeTicket).
export const LINKS = {
  incident: ['parent_incident', 'problem', 'caused_by_change'],
  change_request: ['incident', 'problem'],
  sc_req_item: ['request', 'parent'],
  sc_task: ['request_item'],
};
// Matches no ticket: someone with no tickets of a type still gets a count of 0
const NO_TICKET = 'NONE';
const MAX_ASSIGN = 500;

export class AccessError extends Error {}

const kindOf = number => number.match(/^[A-Z]+/)[0];
// The same "random" everywhere: every OneTouch server seeds identical teams
const hash = (salt, text) => createHash('sha256').update(`${salt}:${text}`).digest().readUInt32BE(0);

// Safe to run every start (after auth.ensureSchema, which creates users)
export async function ensureTeamsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id          serial PRIMARY KEY,
      name        text UNIQUE NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS team_members (
      user_id    integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      team_id    integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      role       text NOT NULL CHECK (role IN ('project_manager', 'process_excellence', 'project_team')),
      joined_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ticket_families (
      id       text PRIMARY KEY,
      team_id  integer REFERENCES teams(id) ON DELETE SET NULL,
      size     integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ticket_families_team_idx ON ticket_families (team_id);
    CREATE TABLE IF NOT EXISTS ticket_assignments (
      number       text PRIMARY KEY,
      family_id    text NOT NULL REFERENCES ticket_families(id) ON DELETE CASCADE,
      assignee_id  integer REFERENCES users(id) ON DELETE SET NULL,
      assigned_at  timestamptz,
      assigned_by  integer REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS ticket_assignments_family_idx ON ticket_assignments (family_id);
    CREATE INDEX IF NOT EXISTS ticket_assignments_assignee_idx ON ticket_assignments (assignee_id);
    -- "I resolved / closed this", told to the project manager. Only a
    -- message: the ticket itself never changes.
    CREATE TABLE IF NOT EXISTS ticket_reports (
      id          serial PRIMARY KEY,
      number      text NOT NULL,
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id     integer REFERENCES teams(id) ON DELETE SET NULL,
      status      text NOT NULL CHECK (status IN ('resolved', 'closed')),
      note        text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ticket_reports_number_idx ON ticket_reports (number, created_at DESC);
    -- A team for trying things out (the Milwaukee Brewers): test accounts
    -- may join it, and they may join no other
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
    -- What the Metabase dashboards may show each person: every ticket's team
    -- and who has it, and nothing else. analytics_db reads it through
    -- postgres_fdw as access_reader (db/init-reporting.sh), which can read
    -- this view and no other table here.
    CREATE OR REPLACE VIEW ticket_access AS
      SELECT a.number, f.team_id, a.assignee_id
        FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id;
    DO $$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'access_reader') THEN
        GRANT SELECT ON ticket_access TO access_reader;
      END IF;
    END $$;
    -- Switches the permanent admins flip on the Team tab: 'everyone_admin', 'email_everyone'
    CREATE TABLE IF NOT EXISTS app_settings (
      key         text PRIMARY KEY,
      value       jsonb NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now(),
      updated_by  integer REFERENCES users(id) ON DELETE SET NULL
    );
  `);
  const { rows } = await pool.query('SELECT key, value FROM app_settings');
  const saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
  everyoneAdmin = saved.everyone_admin === true;
  emailEveryone = saved.email_everyone === true;
  if (everyoneAdmin) console.log('👑 Everyone is an admin (the Team tab\'s "After the presentation" switches it back)');
  if (emailEveryone) console.log('✉️  Demo day: everyone with an address is emailed, whatever MAIL_ONLY_TO says (the Team tab switches it back)');
}

// One of the switches above, saved in the name of whoever flipped it
async function saveSetting(key, value, userId) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), userId]);
}

// ---------------------------------------------------------------------
// EVERYONE AN ADMIN, after a presentation, so stakeholders can try every
// feature: every account but the service accounts gets an admin's scope
// (every ticket, every admin page and change). Only the permanent admins
// (ADMIN_USERNAMES) may switch it, and 🚩 problem reports still go only to
// them (issues.mjs). Saved in app_settings, so it survives a restart.
// ---------------------------------------------------------------------

let everyoneAdmin = false;
const isPermanentAdmin = user => ADMIN_USERNAMES.includes(user.username);

// { on } -> { on, people }: how many accounts it makes admins
export async function setEveryoneAdmin(scope, on) {
  if (!scope.access.permanentAdmin) throw new AccessError('Only the permanent admins can switch that.');
  if (typeof on !== 'boolean') throw new AccessError('Say whether everyone is an admin: { "on": true } or { "on": false }.');
  await saveSetting('everyone_admin', on, scope.access.userId);
  everyoneAdmin = on;
  changed();
  return { on, people: await everyoneAdminCount() };
}

// The accounts the switch makes admins (not the permanent admins, who are already)
async function everyoneAdminCount() {
  const { rows: [r] } = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE is_active AND username <> ALL($1::text[])', [[...ADMIN_USERNAMES, ...SERVICE_ACCOUNTS]]);
  return r.n;
}

// ---------------------------------------------------------------------
// EMAIL EVERYONE, on demo day: while MAIL_ONLY_TO in .env limits the emails
// to a few addresses (for trying things out), this switch lets every person
// with an address be emailed again (mail.mjs skipReason reads emailsEveryone).
// Only the permanent admins may switch it. Saved in app_settings.
// ---------------------------------------------------------------------

let emailEveryone = false;
export const emailsEveryone = () => emailEveryone;

// { on } -> { on, people }: how many people would be emailed with it on
export async function setEmailEveryone(scope, on) {
  if (!scope.access.permanentAdmin) throw new AccessError('Only the permanent admins can switch that.');
  if (typeof on !== 'boolean') throw new AccessError('Say whether everyone is emailed: { "on": true } or { "on": false }.');
  await saveSetting('email_everyone', on, scope.access.userId);
  emailEveryone = on;
  return { on, people: await emailablePeople() };
}

// People with an address who haven't turned email off (test and service accounts never are)
export async function emailablePeople() {
  const { rows: [r] } = await pool.query(
    `SELECT count(*)::int AS n FROM users
      WHERE is_active AND email IS NOT NULL AND email_notifications AND username <> ALL($1::text[]) AND username !~ $2`,
    [SERVICE_ACCOUNTS, TEST_ACCOUNT]);
  return r.n;
}

// Who someone is to the Metabase dashboards (a locked filter in their signed
// link, see server.mjs): everyone ("all"), a team's tickets, or their own.
// Ends with the scope's key, so Metabase keeps cached results apart for each
// set of tickets and a change in someone's tickets isn't answered from an old
// cache. reporting.visible_tickets in analytics_db reads it.
export function dashboardViewer(scope) {
  if (scope.all) return 'all';
  const { access } = scope;
  return access.role === 'project_manager'
    ? `team:${access.team.id}:${scope.key}`
    : `person:${access.userId}:${scope.key}`;
}

// Test accounts used to be dealt onto teams with everyone else. Takes any
// that are on a real team off it; their tickets stay with the team,
// unassigned, for its project manager to hand out. Safe to run every start.
// -> null, or { people: [usernames], tickets }
export async function takeTestAccountsOffTeams() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT m.user_id, u.username FROM team_members m JOIN users u ON u.id = m.user_id JOIN teams t ON t.id = m.team_id
        WHERE u.username ~ $1 AND NOT t.is_test FOR UPDATE OF m`, [TEST_ACCOUNT]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const ids = rows.map(r => r.user_id);
    const { rowCount } = await client.query(
      'UPDATE ticket_assignments SET assignee_id = NULL, assigned_at = NULL, assigned_by = NULL WHERE assignee_id = ANY($1::int[])', [ids]);
    await client.query('DELETE FROM team_members WHERE user_id = ANY($1::int[])', [ids]);
    await client.query('COMMIT');
    changed();
    return { people: rows.map(r => r.username), tickets: rowCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// FIRST START: the teams, who's on them, and every ticket's family, team
// and person. Families are dealt out biggest first, each to the team with
// the fewest tickets so far, so the teams come out about even; each ticket
// then goes to one of its team's members at random.
// ---------------------------------------------------------------------

// Every ticket, grouped with everything it's linked to -> [{ id, numbers }],
// biggest first; a group is named after its lowest ticket number
async function linkedGroups(runQuery) {
  const parent = new Map();
  const find = x => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(x) !== root) { const next = parent.get(x); parent.set(x, root); x = next; }
    return root;
  };
  const add = x => { if (!parent.has(x)) parent.set(x, x); };
  const join = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const tickets = new Set();
  for (const [cube, links] of Object.entries(LINKS)) {
    const rows = await runQuery({ dimensions: [`${cube}.number`, ...links.map(l => `${cube}.${l}`)], limit: 50000 });
    if (rows.length >= 50000) throw new Error(`${cube} has 50,000 tickets or more; teams.mjs reads at most that many`);
    for (const row of rows) {
      const number = String(row[`${cube}.number`] ?? '').trim();
      if (!TICKET.test(number)) continue;
      tickets.add(number);
      add(number);
      for (const link of links) {
        // "zzz" is the export's placeholder for "none"
        const value = String(row[`${cube}.${link}`] ?? '').trim();
        if (value && value !== 'zzz') join(number, link === 'problem' ? `PRB:${value}` : value);
      }
    }
  }
  const groups = new Map();
  for (const number of tickets) {
    const root = find(number);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(number);
  }
  return [...groups.values()]
    .map(numbers => { numbers.sort(); return { id: numbers[0], numbers }; })
    .sort((a, b) => (b.numbers.length - a.numbers.length) || a.id.localeCompare(b.id));
}

// Many rows in one statement per 5,000
async function insertRows(client, table, columns, types, rows) {
  for (let i = 0; i < rows.length; i += 5000) {
    const batch = rows.slice(i, i + 5000);
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) SELECT * FROM unnest(${types.map((t, c) => `$${c + 1}::${t}[]`).join(', ')})`,
      types.map((_, c) => batch.map(r => r[c])));
  }
}

// Does nothing once any team exists. -> null, or what was set up
export async function seedTeams(runQuery) {
  const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM teams');
  if (n) return null;
  const groups = await linkedGroups(runQuery);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE teams IN EXCLUSIVE MODE');
    if ((await client.query('SELECT 1 FROM teams LIMIT 1')).rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const teamIds = [];
    for (const name of TEAM_NAMES) {
      teamIds.push((await client.query('INSERT INTO teams (name) VALUES ($1) RETURNING id', [name])).rows[0].id);
    }

    // One project manager and one process excellence member per team, then
    // everyone else to whichever team is smallest
    const { rows: people } = await client.query(
      'SELECT id, username FROM users WHERE is_active AND username <> ALL($1::text[]) AND username !~ $2',
      [[...ADMIN_USERNAMES, ...SERVICE_ACCOUNTS], TEST_ACCOUNT]);
    people.sort((a, b) => (hash('person', a.username) - hash('person', b.username)) || a.username.localeCompare(b.username));
    const members = teamIds.map(() => []);
    const placed = new Set();
    const place = (person, team, role) => { members[team].push({ id: person.id, role }); placed.add(person.id); };
    people.slice(0, teamIds.length).forEach((p, t) => place(p, t, 'project_manager'));
    people.slice(teamIds.length, teamIds.length * 2).forEach((p, t) => place(p, t, 'process_excellence'));
    for (const p of people.filter(p => !placed.has(p.id))) {
      const smallest = members.reduce((best, list, t) => (list.length < members[best].length ? t : best), 0);
      place(p, smallest, 'project_team');
    }
    await insertRows(client, 'team_members', ['user_id', 'team_id', 'role'], ['int', 'int', 'text'],
      members.flatMap((list, t) => list.map(m => [m.id, teamIds[t], m.role])));

    const load = teamIds.map(() => 0);
    const families = [];
    const tickets = [];
    for (const group of groups) {
      const t = load.indexOf(Math.min(...load));
      load[t] += group.numbers.length;
      const ids = members[t].map(m => m.id).sort((a, b) => a - b);
      families.push([group.id, teamIds[t], group.numbers.length]);
      for (const number of group.numbers) tickets.push([number, group.id, ids.length ? ids[hash('ticket', number) % ids.length] : null]);
    }
    await insertRows(client, 'ticket_families', ['id', 'team_id', 'size'], ['text', 'int', 'int'], families);
    await insertRows(client, 'ticket_assignments', ['number', 'family_id', 'assignee_id'], ['text', 'text', 'int'], tickets);
    await client.query('UPDATE ticket_assignments SET assigned_at = now() WHERE assignee_id IS NOT NULL');
    await client.query('COMMIT');
    changed();
    return { teams: teamIds.length, people: placed.size, families: families.length, tickets: tickets.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// WHAT SOMEONE MAY SEE. A scope is { all: true } for an admin (and the
// warmup account, without an admin's powers), otherwise
// their ticket numbers by type. Kept for a minute, and dropped as soon as
// anything here changes. key names the scope in the caches of charts.mjs
// and relations.mjs, so two people never share a cached answer they
// shouldn't; it's made from the tickets themselves, so the same tickets
// keep the same key.
// ---------------------------------------------------------------------

let version = 0;
const changed = () => { version += 1; };
const SCOPE_TTL_MS = 60 * 1000;
const scopes = new Map(); // user id -> scope

export async function scopeFor(user) {
  const hit = scopes.get(user.id);
  if (hit && hit.version === version && hit.at > Date.now() - SCOPE_TTL_MS) return hit;

  const { rows: [m] } = await pool.query(
    'SELECT m.role, t.id, t.name FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1', [user.id]);
  const access = {
    userId: user.id,
    admin: isPermanentAdmin(user) || (everyoneAdmin && !SERVICE_ACCOUNTS.includes(user.username)),
    permanentAdmin: isPermanentAdmin(user),
    role: m?.role || null,
    team: m ? { id: m.id, name: m.name } : null,
  };
  let scope;
  if (access.admin || SEES_EVERY_TICKET.includes(user.username)) {
    scope = { all: true, key: 'all', count: null };
  } else {
    const { rows } = access.role === 'project_manager'
      ? await pool.query(
        'SELECT a.number FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id WHERE f.team_id = $1 ORDER BY a.number', [access.team.id])
      : await pool.query('SELECT number FROM ticket_assignments WHERE assignee_id = $1 ORDER BY number', [user.id]);
    const byKind = Object.fromEntries(PREFIXES.map(p => [p, []]));
    for (const { number } of rows) byKind[kindOf(number)]?.push(number);
    const key = createHash('sha256').update(rows.map(r => r.number).join(',')).digest('hex').slice(0, 16);
    scope = { all: false, key, byKind, count: rows.length };
  }
  Object.assign(scope, { access, version, at: Date.now() });
  scopes.set(user.id, scope);
  return scope;
}

// One line under an answer saying what it covered (null for an admin)
export function scopeNote(scope) {
  if (scope.all) return null;
  const n = scope.count.toLocaleString('en-US');
  if (scope.access.role === 'project_manager') return `Only ${scope.access.team.name}'s ${n} tickets are included.`;
  return scope.count
    ? `Only the ${n} tickets assigned to you are included.`
    : 'No tickets are assigned to you yet, so there is nothing to show. Your project manager or an admin can assign you some.';
}

// The tables (cubes) a Cube query reads
function cubesOf(query) {
  const cubes = new Set();
  const note = member => { if (typeof member === 'string' && member.includes('.')) cubes.add(member.split('.')[0]); };
  const walk = f => {
    if (!f || typeof f !== 'object') return;
    if (Array.isArray(f.and)) f.and.forEach(walk);
    else if (Array.isArray(f.or)) f.or.forEach(walk);
    else note(f.member ?? f.dimension);
  };
  (query.measures || []).forEach(note);
  (query.dimensions || []).forEach(note);
  (query.segments || []).forEach(note);
  (query.timeDimensions || []).forEach(t => note(t?.dimension));
  (query.filters || []).forEach(walk);
  if (Array.isArray(query.order)) query.order.forEach(o => note(Array.isArray(o) ? o[0] : o?.id));
  else if (query.order && typeof query.order === 'object') Object.keys(query.order).forEach(note);
  if (!cubes.size) throw new AccessError('That query names no ticket type.');
  return cubes;
}

// A Cube query -> the same query limited to the scope's tickets. A cube with
// no rule here is refused rather than run unfiltered.
export function restrictQuery(query, scope) {
  if (scope.all) return query;
  const cubes = cubesOf(query);
  const filters = [...(query.filters || [])];
  for (const cube of cubes) {
    const rule = SCOPED_CUBES[cube];
    if (!rule) throw new AccessError(`${cube} has no access rule, so it can't be shown.`);
    const values = scope.byKind[rule[0]];
    filters.push({ member: `${cube}.${rule[1]}`, operator: 'equals', values: values.length ? values : [NO_TICKET] });
  }
  return { ...query, filters };
}

// Would this query (an AI answer's, already validated) also find tickets the
// person can't see? Its filters plus "not one of theirs", counted over every
// ticket by runUnscoped (runCubeQuery). This is the one place a person's query
// runs on tickets that aren't theirs, so only true or false ever leaves here,
// never a count or a row: it lets the chat say "this isn't the full report".
// Filters on the count itself ("more than 5") are left out, since the
// question is only whether other people's tickets match.
export async function findsHiddenTickets(query, scope, runUnscoped) {
  if (scope.all) return false;
  for (const cube of cubesOf(query)) {
    const rule = SCOPED_CUBES[cube];
    if (!rule) throw new AccessError(`${cube} has no access rule, so it can't be shown.`);
    const theirs = scope.byKind[rule[0]];
    const filters = (query.filters || []).filter(f => !String(f.member).endsWith('.count'));
    if (theirs.length) filters.push({ member: `${cube}.${rule[1]}`, operator: 'notEquals', values: theirs });
    const rows = await runUnscoped({ measures: [`${cube}.count`], filters });
    if (Number(rows[0]?.[`${cube}.count`]) > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// THE TEAMS PAGE: teams and their people, a team's tickets, and the
// changes admins and project managers make
// ---------------------------------------------------------------------

// An admin, or the project manager of this team
export const canManage = (scope, teamId) =>
  scope.access.admin || (scope.access.role === 'project_manager' && scope.access.team?.id === teamId);

function requireAdmin(scope) {
  if (!scope.access.admin) throw new AccessError('Only an admin can do that.');
}

const emptyLoad = () => ({ INC: 0, CHG: 0, RITM: 0, SCTASK: 0, total: 0 });
const personName = r => r.display_name || r.username;

// Admins get every team and the people on none; anyone else, their own team.
// Workloads (who has how many of what) are there for the teams someone
// manages, and everyone sees their own.
export async function listTeams(scope) {
  const { access } = scope;
  const { rows: teams } = await pool.query(
    `SELECT t.id, t.name, t.is_test AS test, count(f.id)::int AS families, coalesce(sum(f.size), 0)::int AS tickets
       FROM teams t LEFT JOIN ticket_families f ON f.team_id = t.id
      ${access.admin ? '' : 'WHERE t.id = $1'}
      GROUP BY t.id ORDER BY t.id`,
    access.admin ? [] : [access.team?.id ?? -1]);
  const ids = teams.map(t => t.id);
  const { rows: members } = await pool.query(
    `SELECT m.team_id, m.role, u.id, u.username, u.display_name
       FROM team_members m JOIN users u ON u.id = m.user_id
      WHERE m.team_id = ANY($1::int[])
      ORDER BY array_position(ARRAY['project_manager', 'process_excellence', 'project_team'], m.role), lower(coalesce(u.display_name, u.username))`,
    [ids]);
  const { rows: loads } = await pool.query(
    `SELECT f.team_id, a.assignee_id, substring(a.number from '^[A-Z]+') AS kind, count(*)::int AS n
       FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id
      WHERE f.team_id = ANY($1::int[])
      GROUP BY 1, 2, 3`,
    [ids]);

  const loadOf = (teamId, userId) => {
    const load = emptyLoad();
    for (const r of loads) {
      if (r.team_id !== teamId || r.assignee_id !== userId) continue;
      load[r.kind] = r.n;
      load.total += r.n;
    }
    return load;
  };
  const result = {
    roles: ROLES,
    teams: teams.map(t => {
      const manages = canManage(scope, t.id);
      return {
        ...t,
        canManage: manages,
        unassigned: manages ? loadOf(t.id, null) : null,
        members: members.filter(m => m.team_id === t.id).map(m => ({
          id: m.id, username: m.username, name: personName(m), role: m.role, test: isTestAccount(m.username),
          load: manages || m.id === access.userId ? loadOf(t.id, m.id) : null,
        })),
      };
    }),
  };
  if (access.admin) {
    // Test accounts only while there's a test team for them to join
    const { rows } = await pool.query(
      `SELECT id, username, display_name, username ~ $2 AS test FROM users
        WHERE is_active AND id NOT IN (SELECT user_id FROM team_members) AND username <> ALL($1::text[])
          AND (username !~ $2 OR EXISTS (SELECT 1 FROM teams WHERE is_test))
        ORDER BY username ~ $2, lower(coalesce(display_name, username))`,
      [[...ADMIN_USERNAMES, ...SERVICE_ACCOUNTS], TEST_ACCOUNT]);
    result.people = rows.map(r => ({ id: r.id, username: r.username, name: personName(r), test: r.test }));
    // Every ticket nobody has yet, on a team or on none (the Team tab's "Not assigned yet")
    const { rows: [u] } = await pool.query(
      `SELECT count(*)::int AS tickets, count(DISTINCT a.family_id)::int AS families,
              count(*) FILTER (WHERE f.team_id IS NULL)::int AS no_team_tickets,
              count(DISTINCT a.family_id) FILTER (WHERE f.team_id IS NULL)::int AS no_team_families
         FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id
        WHERE a.assignee_id IS NULL`);
    result.unassigned = {
      tickets: u.tickets, families: u.families,
      noTeam: { tickets: u.no_team_tickets, families: u.no_team_families },
    };
    // For the "Before a presentation" card: the demo tickets, and how many tickets have a status
    const { rows: [d] } = await pool.query(
      `SELECT count(*)::int AS tickets, count(*) FILTER (WHERE a.assignee_id IS NOT NULL)::int AS assigned,
              count(*) FILTER (WHERE f.team_id IS NOT NULL)::int AS on_team
         FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id WHERE a.number ~ $1`, [DEMO_TICKET]);
    const { rows: [s] } = await pool.query('SELECT count(DISTINCT number)::int AS tickets FROM ticket_reports');
    result.presentation = {
      demo: { tickets: d.tickets, assigned: d.assigned, onTeam: d.on_team }, statuses: s.tickets,
      everyoneAdmin: { on: everyoneAdmin, people: await everyoneAdminCount(), canSwitch: access.permanentAdmin },
    };
  }
  return result;
}

// May this person see this ticket (and so its KPIs)? Admins any, a project
// manager their team's, anyone else the ones assigned to them
const scopeSets = new WeakMap(); // scope -> Set of its ticket numbers
export function canSeeTicket(scope, number) {
  if (scope.all) return true;
  if (!scopeSets.has(scope)) scopeSets.set(scope, new Set(Object.values(scope.byKind).flat()));
  return scopeSets.get(scope).has(number);
}

// A team's families with their tickets and who has each, for its project
// manager or an admin -> Map(id -> { id, size, members: [{ number, assigneeId }] })
export async function teamFamilies(scope, teamId) {
  if (!canManage(scope, teamId)) throw new AccessError('Only an admin or this team\'s project manager can see its families.');
  const { rows } = await pool.query(
    `SELECT f.id, f.size, a.number, a.assignee_id
       FROM ticket_families f JOIN ticket_assignments a ON a.family_id = f.id
      WHERE f.team_id = $1 ORDER BY f.id, a.number`, [teamId]);
  const families = new Map();
  for (const r of rows) {
    if (!families.has(r.id)) families.set(r.id, { id: r.id, size: r.size, members: [] });
    families.get(r.id).members.push({ number: r.number, assigneeId: r.assignee_id });
  }
  return families;
}

// One family's tickets and who has each, for its team's project manager or
// an admin -> { id, size, team: { id, name }, members: [{ number, assigneeId, assignee }] }
export async function familyMembers(scope, familyId) {
  const { rows: [f] } = await pool.query(
    'SELECT f.id, f.size, f.team_id, t.name FROM ticket_families f LEFT JOIN teams t ON t.id = f.team_id WHERE f.id = $1', [String(familyId || '')]);
  if (!f) throw new AccessError('There is no such family.');
  if (!f.team_id || !canManage(scope, f.team_id)) throw new AccessError('Only an admin or this family\'s project manager can see it.');
  const { rows } = await pool.query(
    `SELECT a.number, a.assignee_id, u.username, u.display_name
       FROM ticket_assignments a LEFT JOIN users u ON u.id = a.assignee_id
      WHERE a.family_id = $1 ORDER BY a.number`, [f.id]);
  return {
    id: f.id, size: f.size, team: { id: f.team_id, name: f.name },
    members: rows.map(r => ({ number: r.number, assigneeId: r.assignee_id, assignee: r.assignee_id ? personName(r) : null })),
  };
}

// The tickets assigned to someone in OneTouch (Home's "Assigned to me")
export async function assignedNumbers(userId) {
  const { rows } = await pool.query('SELECT number FROM ticket_assignments WHERE assignee_id = $1 ORDER BY number', [userId]);
  return rows.map(r => r.number);
}

// Of these numbers, the ones nobody has in OneTouch. -> Set of numbers
export async function unassignedAmong(numbers) {
  const { rows } = await pool.query('SELECT number FROM ticket_assignments WHERE number = ANY($1::text[]) AND assignee_id IS NULL', [numbers]);
  return new Set(rows.map(r => r.number));
}

// Every ticket someone has said they resolved or closed (setting one back to
// open deletes its reports). -> Set of numbers
export async function reportedNumbers() {
  const { rows } = await pool.query('SELECT DISTINCT number FROM ticket_reports');
  return new Set(rows.map(r => r.number));
}

// flagged(number, hasPerson) -> [flag] (server.mjs attentionCheck): does this row need attention?
const needsAttention = flagged => r => flagged(r.number, Boolean(r.assignee_id)).length > 0;

// One page of a team's tickets, grouped by family (biggest first), each with
// the latest "I resolved / closed it" someone told the project manager.
// assignee: a user id, 'none' (unassigned) or null (everyone). Someone who
// doesn't manage the team only ever gets their own.
// sort: { by, dir: 'asc' | 'desc', valueOf } orders every match before the
// page is cut: by 'family' (its size), 'assignee' (their name), or anything
// else through valueOf(number) (the ticket's summary, from server.mjs).
// matches({ number, familySize, assignee }): only the tickets it says yes to (a
// lookup typed over the list; assignee is a name or null). flagged: as
// needsAttention; attentionOnly: only the tickets that need attention.
// -> { total, before (the total before that lookup), attention (how many of
// them need attention), tickets: one page }
export async function teamTickets(scope, teamId, { assignee = null, kind = null, matches = null, offset = 0, limit = 50, sort = null, flagged = () => [], attentionOnly = false } = {}) {
  if (!canManage(scope, teamId)) {
    if (scope.access.team?.id !== teamId) throw new AccessError('That is not your team.');
    assignee = scope.access.userId;
  }
  const params = [teamId];
  const where = ['f.team_id = $1'];
  if (assignee === 'none') where.push('a.assignee_id IS NULL');
  else if (assignee) { params.push(Number(assignee)); where.push(`a.assignee_id = $${params.length}`); }
  if (PREFIXES.includes(kind)) { params.push(`${kind}%`); where.push(`a.number LIKE $${params.length}`); }

  // Every match (a team has about 10,000 tickets at most), so a sort covers them all
  const { rows: all } = await pool.query(
    `SELECT a.number, a.family_id, f.size, a.assignee_id, u.username, u.display_name
       FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id
       LEFT JOIN users u ON u.id = a.assignee_id
      WHERE ${where.join(' AND ')}
      ORDER BY f.size DESC, a.family_id, a.number`,
    params);
  const flaggedRows = all.filter(needsAttention(flagged));
  const candidates = attentionOnly ? flaggedRows : all;
  let list = matches
    ? candidates.filter(r => matches({ number: r.number, familySize: r.size, assignee: r.assignee_id ? personName(r) : null }))
    : candidates;
  if (sort) {
    const valueOf = sort.by === 'family' ? r => r.size
      : sort.by === 'assignee' ? r => (r.assignee_id ? personName(r) : null)
        : r => sort.valueOf(r.number);
    list = sortRows(list, valueOf, sort.dir);
  }
  const start = Math.max(Number(offset) || 0, 0);
  const rows = list.slice(start, start + Math.min(Math.max(Number(limit) || 50, 1), 200));
  const { rows: reports } = await pool.query(
    `SELECT DISTINCT ON (r.number) r.number, r.status, r.note, r.created_at, r.user_id, coalesce(u.display_name, u.username) AS by
       FROM ticket_reports r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.number = ANY($1::text[])
      ORDER BY r.number, r.created_at DESC`,
    [rows.map(r => r.number)]);
  const latest = new Map(reports.map(r => [r.number, r]));
  return {
    total: list.length,
    before: candidates.length,
    attention: flaggedRows.length,
    tickets: rows.map(r => {
      const report = latest.get(r.number);
      return {
        number: r.number, family: { id: r.family_id, size: r.size },
        assignee: r.assignee_id ? { id: r.assignee_id, name: personName(r) } : null,
        report: report ? {
          status: report.status, note: report.note, at: report.created_at,
          by: report.by, mine: report.user_id === scope.access.userId,
        } : null,
      };
    }),
  };
}

// Admins: one page of every ticket nobody has yet, on any team or on none,
// family by family (families on no team first, then each team's, biggest
// first). team: a team id, 'none' (on no team) or null (any). kind, matches,
// offset, limit and sort as for teamTickets, except that sort.by may be 'team'
// (its name) and not 'assignee', and matches gets { number, familyId,
// familySize, team } (team: a name or null). flagged and attentionOnly as for
// teamTickets. -> { total, before, attention, tickets: one page, families:
// { id -> { id, size, kinds, unassigned, team } } for the families on that page }
export async function unassignedTickets(scope, { team = null, kind = null, matches = null, offset = 0, limit = 50, sort = null, flagged = () => [], attentionOnly = false } = {}) {
  requireAdmin(scope);
  const params = [];
  const where = ['a.assignee_id IS NULL'];
  if (team === 'none') where.push('f.team_id IS NULL');
  else if (team) {
    const teamId = Number(team);
    if (!Number.isInteger(teamId)) throw new AccessError('There is no such team.');
    params.push(teamId);
    where.push(`f.team_id = $${params.length}`);
  }
  if (PREFIXES.includes(kind)) { params.push(`${kind}%`); where.push(`a.number LIKE $${params.length}`); }

  const { rows: all } = await pool.query(
    `SELECT a.number, a.family_id, f.size, f.team_id, t.name AS team
       FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id LEFT JOIN teams t ON t.id = f.team_id
      WHERE ${where.join(' AND ')}
      ORDER BY f.team_id NULLS FIRST, f.size DESC, a.family_id, a.number`,
    params);
  const flaggedRows = all.filter(needsAttention(flagged));
  const candidates = attentionOnly ? flaggedRows : all;
  let list = matches
    ? candidates.filter(r => matches({ number: r.number, familyId: r.family_id, familySize: r.size, team: r.team }))
    : candidates;
  if (sort) {
    const valueOf = sort.by === 'family' ? r => r.size
      : sort.by === 'team' ? r => r.team
        : r => sort.valueOf(r.number);
    list = sortRows(list, valueOf, sort.dir);
  }
  const start = Math.max(Number(offset) || 0, 0);
  const rows = list.slice(start, start + Math.min(Math.max(Number(limit) || 50, 1), 200));

  // The page's families: how many of each type they hold, and how many nobody has
  const families = {};
  for (const r of rows) {
    families[r.family_id] ??= {
      id: r.family_id, size: r.size, kinds: {}, unassigned: 0,
      team: r.team_id ? { id: r.team_id, name: r.team } : null,
    };
  }
  const { rows: kinds } = await pool.query(
    `SELECT family_id, substring(number from '^[A-Z]+') AS kind, count(*)::int AS n,
            count(*) FILTER (WHERE assignee_id IS NULL)::int AS unassigned
       FROM ticket_assignments WHERE family_id = ANY($1::text[]) GROUP BY 1, 2`,
    [Object.keys(families)]);
  for (const k of kinds) {
    families[k.family_id].kinds[k.kind] = k.n;
    families[k.family_id].unassigned += k.unassigned;
  }
  return {
    total: list.length,
    before: candidates.length,
    attention: flaggedRows.length,
    tickets: rows.map(r => ({
      number: r.number, family: { id: r.family_id, size: r.size },
      team: r.team_id ? { id: r.team_id, name: r.team } : null,
    })),
    families,
  };
}

// Gives tickets of one team to one of its members (null: nobody). Admins can
// for any team, a project manager for their own. The person they go to gets
// a notification (unless they gave them to themselves). -> how many changed
export async function assignTickets(scope, numbers, assigneeId) {
  const wanted = [...new Set((Array.isArray(numbers) ? numbers : []).map(n => String(n).toUpperCase()))].filter(n => TICKET.test(n));
  if (!wanted.length) throw new AccessError('No tickets to assign.');
  if (wanted.length > MAX_ASSIGN) throw new AccessError(`Assign at most ${MAX_ASSIGN} tickets at a time.`);
  const { rows } = await pool.query(
    'SELECT a.number, f.team_id FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id WHERE a.number = ANY($1::text[])', [wanted]);
  if (rows.length !== wanted.length) throw new AccessError('Some of those tickets aren\'t on any team.');
  if (rows.some(r => r.team_id === null)) throw new AccessError('Those tickets\' family isn\'t on a team yet. Move it to one first.');
  const teamIds = new Set(rows.map(r => r.team_id));
  if (teamIds.size !== 1) throw new AccessError('Assign one team\'s tickets at a time.');
  return giveTickets(scope, rows[0].team_id, wanted, assigneeId);
}

// Gives a whole family (every ticket in it) to one member of its team (null:
// nobody), for its team's project manager or an admin -> how many changed
export async function assignFamily(scope, familyId, assigneeId) {
  const { rows: [f] } = await pool.query('SELECT id, team_id FROM ticket_families WHERE id = $1', [String(familyId || '')]);
  if (!f || f.team_id === null) throw new AccessError('There is no such family on a team.');
  const { rows } = await pool.query('SELECT number FROM ticket_assignments WHERE family_id = $1 ORDER BY number', [f.id]);
  return giveTickets(scope, f.team_id, rows.map(r => r.number), assigneeId, f.id);
}

// The tickets (all of them one team's) to one of the team's members, or to
// nobody. Whoever gets them is told (unless they gave them to themselves).
// family: the family's id when it's a whole family. -> how many changed
async function giveTickets(scope, teamId, numbers, assigneeId, family = null) {
  if (!canManage(scope, teamId)) throw new AccessError('Only an admin or this team\'s project manager can assign its tickets.');
  const person = assigneeId === null ? null : Number(assigneeId);
  if (person !== null) {
    const { rows: on } = await pool.query('SELECT 1 FROM team_members WHERE user_id = $1 AND team_id = $2', [person, teamId]);
    if (!on.length) throw new AccessError('That person isn\'t on this team.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: given } = await client.query(
      `UPDATE ticket_assignments
          SET assignee_id = $2, assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END, assigned_by = $3
        WHERE number = ANY($1::text[]) AND assignee_id IS DISTINCT FROM $2::int
        RETURNING number`,
      [numbers, person, scope.access.userId]);
    if (given.length && person !== null && person !== scope.access.userId) {
      const { rows: [team] } = await client.query('SELECT name FROM teams WHERE id = $1', [teamId]);
      await notify(client, [person], {
        kind: 'assigned', actorId: scope.access.userId,
        numbers: given.map(r => r.number).sort(),
        detail: { count: given.length, team: team.name, ...(family ? { family, size: numbers.length } : {}) },
      });
    }
    await client.query('COMMIT');
    if (given.length) changed();
    return given.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// A ticket's family: its size, how many of each type, and its team (admins only)
export async function familyOfTicket(scope, number) {
  requireAdmin(scope);
  const n = String(number || '').toUpperCase().trim();
  if (!TICKET.test(n)) throw new AccessError('Type a ticket number, like INC1813970 or RITM0440458.');
  const { rows: [f] } = await pool.query(
    `SELECT f.id, f.size, f.team_id, t.name AS team
       FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id LEFT JOIN teams t ON t.id = f.team_id
      WHERE a.number = $1`, [n]);
  if (!f) return null;
  const { rows: kinds } = await pool.query(
    `SELECT substring(number from '^[A-Z]+') AS kind, count(*)::int AS n FROM ticket_assignments WHERE family_id = $1 GROUP BY 1`, [f.id]);
  const { rows: sample } = await pool.query(
    'SELECT number FROM ticket_assignments WHERE family_id = $1 ORDER BY number LIMIT 12', [f.id]);
  return {
    id: f.id, size: f.size, number: n,
    team: f.team_id ? { id: f.team_id, name: f.team } : null,
    kinds: Object.fromEntries(kinds.map(k => [k.kind, k.n])),
    sample: sample.map(s => s.number),
  };
}

// Moves a whole family to another team (admins only). Its tickets were the
// old team's people's, so they become unassigned for the new team's project
// manager to hand out, who gets a notification. -> how many tickets moved
export async function moveFamily(scope, familyId, teamId) {
  requireAdmin(scope);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [team] } = await client.query('SELECT id, name FROM teams WHERE id = $1', [teamId]);
    if (!team) throw new AccessError('There is no such team.');
    const { rows: [family] } = await client.query('SELECT size, team_id FROM ticket_families WHERE id = $1 FOR UPDATE', [familyId]);
    if (!family) throw new AccessError('There is no such family.');
    if (family.team_id === team.id) {
      await client.query('ROLLBACK');
      return 0;
    }
    await client.query('UPDATE ticket_families SET team_id = $2 WHERE id = $1', [familyId, team.id]);
    await client.query(
      `UPDATE ticket_assignments SET assignee_id = NULL, assigned_at = NULL, assigned_by = $2
        WHERE family_id = $1 AND assignee_id IS NOT NULL`, [familyId, scope.access.userId]);
    const { rows: managers } = await client.query(
      `SELECT user_id FROM team_members WHERE team_id = $1 AND role = 'project_manager' AND user_id <> $2`,
      [team.id, scope.access.userId]);
    if (managers.length) {
      const { rows: tickets } = await client.query(
        'SELECT number FROM ticket_assignments WHERE family_id = $1 ORDER BY number', [familyId]);
      await notify(client, managers.map(m => m.user_id), {
        kind: 'family', actorId: scope.access.userId,
        numbers: tickets.map(t => t.number), detail: { count: family.size, team: team.name, family: familyId },
      });
    }
    await client.query('COMMIT');
    changed();
    return family.size;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// NEW TICKETS FROM SERVICENOW (servicenow-sync/, after it saves the ticket
// in the data). The first start's rules, one ticket at a time: a ticket
// linked to others joins their family, and so their team; one linked to
// nothing gets a family of its own on the real team with the fewest
// tickets. It arrives unassigned, for the project manager to hand out. A
// ticket that links two families merges them into the bigger one, keeping
// its id and team (no family is ever split between teams); tickets that
// change team that way become unassigned, and that team's project manager
// is told, as when an admin moves a family. Families only grow: a link that
// goes away never splits one.
// ---------------------------------------------------------------------

// Postgres channel (onetouch_auth): a ticket arrived or changed, so OneTouch
// reads again what it read at start (server.mjs)
export const TICKETS_CHANGED = 'onetouch_tickets_changed';

export async function announceTicketsChanged(note = '', db = pool) {
  await db.query('SELECT pg_notify($1, $2)', [TICKETS_CHANGED, String(note).slice(0, 200)]);
}

// number: the ticket that arrived; linked: the tickets it's linked to, either
// way (servicenow-sync works them out from the data, by LINKS)
// -> { family, team, action: 'new' | 'joined' | 'merged' | 'kept', moved }
export async function placeTicket(number, linked = []) {
  const n = String(number || '').toUpperCase().trim();
  if (!TICKET.test(n)) throw new Error(`${number} isn't a ticket number`);
  const numbers = [...new Set([n, ...linked.map(x => String(x).toUpperCase().trim()).filter(x => TICKET.test(x))])];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One placement at a time, so two linked tickets arriving together end up in one family
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['onetouch:placeTicket']);
    const { rows: [mine] } = await client.query('SELECT family_id FROM ticket_assignments WHERE number = $1', [n]);
    // Every family it touches (its own, if it has one), biggest first
    const { rows: families } = await client.query(
      `SELECT DISTINCT f.id, f.team_id, f.size FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id
        WHERE a.number = ANY($1::text[])`, [numbers]);
    families.sort((a, b) => (b.size - a.size) || a.id.localeCompare(b.id));

    let family, team, action, moved = [];
    if (!families.length) {
      // Linked to nothing: a family of its own, on the real team with the fewest tickets
      const { rows: [smallest] } = await client.query(
        `SELECT t.id FROM teams t LEFT JOIN ticket_families f ON f.team_id = t.id
          WHERE NOT t.is_test GROUP BY t.id ORDER BY coalesce(sum(f.size), 0), t.id LIMIT 1`);
      family = n;
      team = smallest?.id ?? null;
      action = 'new';
      await client.query('INSERT INTO ticket_families (id, team_id, size) VALUES ($1, $2, 0)', [family, team]);
    } else {
      ({ id: family, team_id: team } = families[0]);
      const others = families.slice(1).map(f => f.id);
      if (others.length) {
        // Merged into the biggest: tickets changing team become nobody's
        const { rows } = await client.query(
          `UPDATE ticket_assignments a SET family_id = $1,
                  assignee_id = CASE WHEN f.team_id IS NOT DISTINCT FROM $2::int THEN a.assignee_id END,
                  assigned_at = CASE WHEN f.team_id IS NOT DISTINCT FROM $2::int THEN a.assigned_at END,
                  assigned_by = CASE WHEN f.team_id IS NOT DISTINCT FROM $2::int THEN a.assigned_by END
             FROM ticket_families f
            WHERE f.id = a.family_id AND a.family_id = ANY($3::text[])
        RETURNING a.number, f.team_id IS DISTINCT FROM $2::int AS changed_team`, [family, team, others]);
        moved = rows.filter(r => r.changed_team).map(r => r.number).sort();
        await client.query('DELETE FROM ticket_families WHERE id = ANY($1::text[])', [others]);
        action = 'merged';
      } else {
        action = mine ? 'kept' : 'joined';
      }
    }
    if (!mine) await client.query('INSERT INTO ticket_assignments (number, family_id) VALUES ($1, $2)', [n, family]);
    await client.query('UPDATE ticket_families SET size = (SELECT count(*) FROM ticket_assignments WHERE family_id = $1) WHERE id = $1', [family]);

    if (moved.length && team !== null) {
      const { rows: managers } = await client.query(
        `SELECT m.user_id, t.name FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.team_id = $1 AND m.role = 'project_manager'`, [team]);
      if (managers.length) {
        await notify(client, managers.map(m => m.user_id), {
          kind: 'family', numbers: moved,
          detail: { count: moved.length, team: managers[0].name, family, source: 'servicenow' },
        });
      }
    }
    await announceTicketsChanged(n, client);
    await client.query('COMMIT');
    changed();
    return { family, team, action, moved: moved.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Someone's access, sorting and the like, read again (server.mjs, when tickets change)
export const dataChanged = () => changed();

// Puts someone on a team with a role, changes their role, or (teamId null)
// takes them off their team, and with it their role (admins only). Leaving a
// team hands their tickets back to it, unassigned. -> { unassigned }: how many
export async function setMembership(scope, userId, teamId, role) {
  requireAdmin(scope);
  if (teamId !== null && !ROLES[role]) throw new AccessError('Choose a role.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [user] } = await client.query('SELECT id, username FROM users WHERE id = $1 AND is_active', [userId]);
    if (!user) throw new AccessError('There is no such account.');
    if (teamId !== null) {
      const { rows: [team] } = await client.query('SELECT is_test FROM teams WHERE id = $1', [teamId]);
      if (!team) throw new AccessError('There is no such team.');
      if (SERVICE_ACCOUNTS.includes(user.username)) throw new AccessError(`${user.username} is a service account and can't join a team.`);
      if (isTestAccount(user.username) && !team.is_test) throw new AccessError(`${user.username} is a test account, so it can only join a test team.`);
    }
    const { rows: [now] } = await client.query('SELECT team_id FROM team_members WHERE user_id = $1 FOR UPDATE', [userId]);
    let unassigned = 0;
    if (now && now.team_id !== teamId) {
      ({ rowCount: unassigned } = await client.query(
        'UPDATE ticket_assignments SET assignee_id = NULL, assigned_at = NULL, assigned_by = $2 WHERE assignee_id = $1',
        [userId, scope.access.userId]));
    }
    if (teamId === null) {
      await client.query('DELETE FROM team_members WHERE user_id = $1', [userId]);
    } else {
      await client.query(
        `INSERT INTO team_members (user_id, team_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET team_id = EXCLUDED.team_id, role = EXCLUDED.role,
           joined_at = CASE WHEN team_members.team_id = EXCLUDED.team_id THEN team_members.joined_at ELSE now() END`,
        [userId, teamId, role]);
    }
    await client.query('COMMIT');
    changed();
    return { unassigned };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// TELLING THE PROJECT MANAGER: someone on a team says they resolved or
// closed one of their tickets. Their team's project manager gets a
// notification, and the Team tab shows it next to the ticket. Nothing in
// the ticket data changes: the export is a frozen snapshot.
// ---------------------------------------------------------------------

// -> { told: [project managers' names] }
export async function reportTicket(scope, number, status, note) {
  const { access } = scope;
  const n = String(number || '').toUpperCase().trim();
  if (!TICKET.test(n)) throw new AccessError('That isn\'t a ticket number.');
  if (!REPORT_STATUSES[status]) throw new AccessError('Say whether you resolved or closed it.');
  const text = String(note ?? '').trim().slice(0, MAX_NOTE) || null;
  if (!access.team) throw new AccessError('You\'re not on a team, so there\'s no project manager to tell.');
  const { rows: [mine] } = await pool.query(
    `SELECT 1 FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id
      WHERE a.number = $1 AND a.assignee_id = $2 AND f.team_id = $3`, [n, access.userId, access.team.id]);
  if (!mine) throw new AccessError(`${n} isn't assigned to you.`);
  const { rows: managers } = await pool.query(
    `SELECT u.id, u.username, u.display_name FROM team_members m JOIN users u ON u.id = m.user_id
      WHERE m.team_id = $1 AND m.role = 'project_manager' AND m.user_id <> $2 ORDER BY u.id`,
    [access.team.id, access.userId]);
  if (!managers.length) {
    throw new AccessError(access.role === 'project_manager'
      ? 'You\'re your team\'s project manager, so there\'s nobody else to tell.'
      : `${access.team.name} has no project manager to tell yet. An admin can add one.`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO ticket_reports (number, user_id, team_id, status, note) VALUES ($1, $2, $3, $4, $5)',
      [n, access.userId, access.team.id, status, text]);
    await notify(client, managers.map(m => m.id), {
      kind: 'report', actorId: access.userId, numbers: [n], detail: { status, note: text, team: access.team.name },
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { told: managers.map(personName) };
}

// ---------------------------------------------------------------------
// RESOLVED OR CLOSED: the tickets whose latest report says resolved or
// closed, for admins (every team) and project managers (their team's
// tickets). They can change that status, or set the ticket open again,
// which takes its reports away. Only OneTouch's record changes: the
// ticket's data never does. Admins can also undo every status at once, and
// put the demo tickets back as they were made, before a presentation.
// ---------------------------------------------------------------------

// db/demo-tickets.sql's made-up tickets
const DEMO_TICKET = '^(INC|CHG|RITM|SCTASK)99000[0-9]{2}$';
export const STATUS_CHOICES = ['resolved', 'closed', 'open'];

function requireManager(scope) {
  if (!scope.access.admin && scope.access.role !== 'project_manager') throw new AccessError('Only an admin or a project manager can see those.');
}

// -> [{ number, status, note, at, by, family, team, assignee }], newest first
export async function ticketStatuses(scope) {
  requireManager(scope);
  const { rows } = await pool.query(
    `SELECT r.number, r.status, r.note, r.created_at, r.by, a.family_id, f.size, f.team_id, t.name AS team,
            a.assignee_id, p.username, p.display_name
       FROM (SELECT DISTINCT ON (r.number) r.number, r.status, r.note, r.created_at, coalesce(u.display_name, u.username) AS by
               FROM ticket_reports r LEFT JOIN users u ON u.id = r.user_id
              ORDER BY r.number, r.created_at DESC, r.id DESC) r
       JOIN ticket_assignments a ON a.number = r.number
       JOIN ticket_families f ON f.id = a.family_id
       LEFT JOIN teams t ON t.id = f.team_id
       LEFT JOIN users p ON p.id = a.assignee_id
      WHERE r.status IN ('resolved', 'closed') AND ($1::int IS NULL OR f.team_id = $1)
      ORDER BY r.created_at DESC, r.number`,
    [scope.access.admin ? null : scope.access.team.id]);
  return rows.map(r => ({
    number: r.number, status: r.status, note: r.note, at: r.created_at, by: r.by,
    family: { id: r.family_id, size: r.size },
    team: r.team_id ? { id: r.team_id, name: r.team } : null,
    assignee: r.assignee_id ? { id: r.assignee_id, name: personName(r) } : null,
  }));
}

// One ticket's status, set by an admin or its team's project manager: resolved
// or closed (a report in their name), or open again (its reports go, as if
// nobody had said so) -> { number, status }
export async function setTicketStatus(scope, number, status) {
  const n = String(number || '').toUpperCase().trim();
  if (!TICKET.test(n)) throw new AccessError('That isn\'t a ticket number.');
  if (!STATUS_CHOICES.includes(status)) throw new AccessError('Pick resolved, closed or open.');
  const { rows: [t] } = await pool.query(
    'SELECT f.team_id FROM ticket_assignments a JOIN ticket_families f ON f.id = a.family_id WHERE a.number = $1', [n]);
  if (!t || !canManage(scope, t.team_id)) throw new AccessError(`Only an admin or ${n}'s team's project manager can change its status.`);
  if (status === 'open') await pool.query('DELETE FROM ticket_reports WHERE number = $1', [n]);
  else {
    await pool.query('INSERT INTO ticket_reports (number, user_id, team_id, status) VALUES ($1, $2, $3, $4)',
      [n, scope.access.userId, t.team_id, status]);
  }
  return { number: n, status };
}

// Every status anyone set, undone (admins): the reports go, and so do the 🔔
// notifications that told project managers about them -> { tickets, notifications }
export async function undoAllStatuses(scope) {
  requireAdmin(scope);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('DELETE FROM ticket_reports RETURNING number');
    const { rowCount } = await client.query('DELETE FROM notifications WHERE kind = \'report\'');
    await client.query('COMMIT');
    return { tickets: new Set(rows.map(r => r.number)).size, notifications: rowCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// The demo tickets as db/demo-tickets.sql made them (admins): their families
// on no team, nobody assigned, and nothing OneTouch kept about them since
// (statuses, notifications, stars, ticket results) -> { tickets, families }
export async function resetDemoTickets(scope) {
  requireAdmin(scope);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE ticket_assignments SET assignee_id = NULL, assigned_at = NULL, assigned_by = NULL WHERE number ~ $1 RETURNING family_id', [DEMO_TICKET]);
    const families = [...new Set(rows.map(r => r.family_id))];
    // Only families of nothing but demo tickets (as the script makes them)
    await client.query(
      `UPDATE ticket_families f SET team_id = NULL WHERE f.id = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM ticket_assignments a WHERE a.family_id = f.id AND a.number !~ $2)`, [families, DEMO_TICKET]);
    await client.query('DELETE FROM notifications WHERE EXISTS (SELECT 1 FROM unnest(numbers) n WHERE n ~ $1)', [DEMO_TICKET]);
    for (const table of ['ticket_reports', 'starred_tickets', 'seen_tickets']) await client.query(`DELETE FROM ${table} WHERE number ~ $1`, [DEMO_TICKET]);
    await client.query('COMMIT');
    changed();
    return { tickets: rows.length, families: families.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
