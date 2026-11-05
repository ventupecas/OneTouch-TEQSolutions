// =====================================================================
// PROBLEM REPORTS: anyone signed in can tell the admins something's wrong
// (the 🚩 in the header, POST /api/issues). Each report is saved here, in
// onetouch_auth, in the same transaction as a notification for every admin,
// which also goes out by email through the usual outbox (mail.mjs). Admins
// read them and mark them resolved on the 🧊 Architecture page
// (GET and PUT /api/architecture/issues).
//
// As with every OneTouch email, what someone wrote stays behind the sign-in:
// it may name tickets or people, so the email only says who reported what
// kind of problem. It does show under the admins' 🔔.
//
// Someone's words are data: the page escapes them wherever they're shown.
// =====================================================================

import { pool } from './auth.mjs';
import { notify } from './notifications.mjs';
import { ADMIN_USERNAMES } from './teams.mjs';

export const CATEGORIES = {
  broken: 'Something isn\'t working',
  data: 'The data looks wrong',
  access: 'I can\'t see or do something I should',
  slow: 'It\'s very slow',
  other: 'Something else',
};
const PAGES = { home: 'Home', dashboard: 'Dashboards', teams: 'Team', architecture: 'Architecture', chat: 'AI assistant' };

export const MAX_MESSAGE = 2000;
const MIN_MESSAGE = 5;
const NOTE_LENGTH = 280; // how much of it shows under the 🔔
const LIMIT = 5;         // reports one person can send...
const LIMIT_MINUTES = 10; // ...in this long, so a stuck key can't flood every admin's inbox
const OPEN_LISTED = 200;
const RESOLVED_LISTED = 30;

// What the person is told, with the status to answer with
export class IssueError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Safe to run every start (after the notifications table)
export async function ensureIssuesSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_reports (
      id          serial PRIMARY KEY,
      reporter_id integer REFERENCES users(id) ON DELETE SET NULL,
      category    text NOT NULL,
      message     text NOT NULL,
      page        text,
      browser     text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz,
      resolved_by integer REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS issue_reports_recent_idx ON issue_reports (reporter_id, created_at);
  `);
}

const noControls = text => String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();

// What someone sent -> what's saved, or an IssueError saying what to fix
export function cleanReport(body) {
  const category = Object.hasOwn(CATEGORIES, body?.category) ? body.category : null;
  if (!category) throw new IssueError('Please pick what kind of problem it is.');
  const message = noControls(body?.message);
  if (message.length < MIN_MESSAGE) throw new IssueError('Please say what happened, so the admins can look into it.');
  if (message.length > MAX_MESSAGE) throw new IssueError(`Please keep it under ${MAX_MESSAGE.toLocaleString('en-US')} characters.`);
  const page = Object.hasOwn(PAGES, body?.page) ? PAGES[body.page] : null;
  return { category, message, page };
}

// user: who's reporting -> { id, told }: how many admins were told
export async function reportIssue(user, body, browser = '') {
  const { category, message, page } = cleanReport(body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [{ recent }] } = await client.query(
      `SELECT count(*)::int AS recent FROM issue_reports
        WHERE reporter_id = $1 AND created_at > now() - make_interval(mins => $2)`, [user.id, LIMIT_MINUTES]);
    if (recent >= LIMIT) throw new IssueError(`You've sent ${LIMIT} reports in the last ${LIMIT_MINUTES} minutes. Please wait a little before sending another.`, 429);
    const { rows: [{ id }] } = await client.query(
      'INSERT INTO issue_reports (reporter_id, category, message, page, browser) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [user.id, category, message, page, noControls(browser).slice(0, 200) || null]);
    // Every other admin: someone reporting a problem already knows about it
    const { rows: admins } = await client.query(
      'SELECT id FROM users WHERE username = ANY($1::text[]) AND is_active AND id <> $2', [ADMIN_USERNAMES, user.id]);
    await notify(client, admins.map(a => a.id), {
      kind: 'issue',
      actorId: user.id,
      detail: {
        issue: id, label: CATEGORIES[category], page,
        note: message.length > NOTE_LENGTH ? `${message.slice(0, NOTE_LENGTH)}…` : message,
      },
    });
    await client.query('COMMIT');
    return { id, told: admins.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const REPORT_COLUMNS = `i.id, i.category, i.message, i.page, i.browser, i.created_at, i.resolved_at,
  coalesce(r.display_name, r.username, 'A removed account') AS reporter, coalesce(a.display_name, a.username) AS resolver
  FROM issue_reports i LEFT JOIN users r ON r.id = i.reporter_id LEFT JOIN users a ON a.id = i.resolved_by`;

const toReport = r => ({
  id: r.id, label: CATEGORIES[r.category] || r.category, message: r.message, page: r.page, browser: r.browser,
  reporter: r.reporter, at: r.created_at, resolvedAt: r.resolved_at, resolver: r.resolver,
});

// For admins -> { openCount, open: newest first, resolved: the latest few }
export async function listIssues() {
  const { rows: open } = await pool.query(`SELECT ${REPORT_COLUMNS} WHERE i.resolved_at IS NULL ORDER BY i.id DESC LIMIT ${OPEN_LISTED}`);
  const { rows: resolved } = await pool.query(`SELECT ${REPORT_COLUMNS} WHERE i.resolved_at IS NOT NULL ORDER BY i.resolved_at DESC LIMIT ${RESOLVED_LISTED}`);
  const { rows: [{ count }] } = await pool.query('SELECT count(*)::int AS count FROM issue_reports WHERE resolved_at IS NULL');
  return { openCount: count, open: open.map(toReport), resolved: resolved.map(toReport) };
}

// status: 'resolved' or 'open' (back on the list). userId: the admin doing it
export async function setIssueStatus(id, status, userId) {
  if (!/^\d{1,9}$/.test(String(id))) throw new IssueError('There\'s no such report.', 404);
  if (status !== 'resolved' && status !== 'open') throw new IssueError('A report is either resolved or open.');
  const resolved = status === 'resolved';
  const { rowCount } = await pool.query(
    'UPDATE issue_reports SET resolved_at = CASE WHEN $2 THEN now() END, resolved_by = CASE WHEN $2 THEN $3::int END WHERE id = $1',
    [Number(id), resolved, userId]);
  if (!rowCount) throw new IssueError('There\'s no such report.', 404);
  return { id: Number(id), status };
}
