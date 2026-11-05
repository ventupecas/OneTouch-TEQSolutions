// =====================================================================
// NOTIFICATIONS: what someone should hear about, shown under the 🔔 in the
// header, kept with the accounts in the onetouch_auth database. teams.mjs
// makes them:
//
//   assigned   someone gave you tickets
//   family     a family was moved to the team you're the project manager of
//   report     someone on your team says they resolved or closed a ticket
//   issue      someone reported a problem with OneTouch (to admins; issues.mjs)
//
// Each one keeps who did it, the tickets (up to MAX_NUMBERS of them) and a
// few details; the page words them. Each is also emailed (mail.mjs): its
// email_state starts 'pending', and the sender marks it 'sent', 'skipped'
// (with why) or 'failed'. Those made before email existed are 'before'.
// Someone can clear one, or all of them, off their list: cleared_at is set
// and the row stays, so an email still on its way goes out all the same.
// =====================================================================

import { pool } from './auth.mjs';

export const KINDS = ['assigned', 'family', 'report', 'issue'];
const MAX_NUMBERS = 100;
// The newest this many are listed (the unread count covers them all)
const LIST_LIMIT = 50;

// Safe to run every start (after auth.ensureSchema, which creates users)
export async function ensureNotificationsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          serial PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        text NOT NULL CHECK (kind IN (${KINDS.map(k => `'${k}'`).join(', ')})),
      actor_id    integer REFERENCES users(id) ON DELETE SET NULL,
      numbers     text[] NOT NULL DEFAULT '{}',
      detail      jsonb NOT NULL DEFAULT '{}',
      created_at  timestamptz NOT NULL DEFAULT now(),
      read_at     timestamptz
    );
    CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, id DESC);

    -- A table from before the newest kind only allows the older ones
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (${KINDS.map(k => `'${k}'`).join(', ')}));

    -- Email (mail.mjs). The notifications already here when this column arrives
    -- are 'before', so they're never emailed; every later one starts 'pending'.
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_state text NOT NULL DEFAULT 'before';
    ALTER TABLE notifications ALTER COLUMN email_state SET DEFAULT 'pending';
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_tries integer NOT NULL DEFAULT 0;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_next_at timestamptz;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_note text;
    CREATE INDEX IF NOT EXISTS notifications_email_idx ON notifications (id) WHERE email_state = 'pending';

    -- Cleared off the person's list (clearNotifications)
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
  `);
}

// The same notification for each of userIds. db: the pool, or a client in
// the middle of a transaction, so the notification goes in with the change
export async function notify(db, userIds, { kind, actorId = null, numbers = [], detail = {} }) {
  if (!userIds.length) return;
  await db.query(
    `INSERT INTO notifications (user_id, kind, actor_id, numbers, detail)
     SELECT unnest($1::int[]), $2, $3, $4::text[], $5::jsonb`,
    [userIds, kind, actorId, numbers.slice(0, MAX_NUMBERS), JSON.stringify(detail)]);
}

// -> { unread, notifications: newest first }
export async function listNotifications(userId) {
  const { rows } = await pool.query(
    `SELECT n.id, n.kind, n.numbers, n.detail, n.created_at, n.read_at, coalesce(u.display_name, u.username) AS actor
       FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = $1 AND n.cleared_at IS NULL ORDER BY n.id DESC LIMIT ${LIST_LIMIT}`,
    [userId]);
  const { rows: [{ unread }] } = await pool.query(
    'SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL AND cleared_at IS NULL', [userId]);
  return {
    unread,
    notifications: rows.map(r => ({
      id: r.id, kind: r.kind, actor: r.actor, numbers: r.numbers, detail: r.detail,
      at: r.created_at, read: Boolean(r.read_at),
    })),
  };
}

// Some of this person's notifications (ids), or all of them, as read -> how many
export async function markRead(userId, ids = null) {
  const wanted = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger).slice(0, LIST_LIMIT) : null;
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_at = now()
      WHERE user_id = $1 AND read_at IS NULL AND ($2::int[] IS NULL OR id = ANY($2::int[]))`,
    [userId, wanted]);
  return rowCount;
}

// Clears some of this person's notifications (ids) off their list, or all of
// them up to and including upTo: the newest their list showed, so one that
// arrived since isn't cleared before they've seen it -> how many
export async function clearNotifications(userId, { ids = null, upTo = null } = {}) {
  const wanted = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger).slice(0, LIST_LIMIT) : null;
  if (wanted ? !wanted.length : !Number.isInteger(upTo)) return 0;
  const { rowCount } = await pool.query(
    `UPDATE notifications SET cleared_at = now(), read_at = coalesce(read_at, now())
      WHERE user_id = $1 AND cleared_at IS NULL AND ($2::int[] IS NULL OR id = ANY($2::int[])) AND ($3::int IS NULL OR id <= $3)`,
    [userId, wanted, wanted ? null : upTo]);
  return rowCount;
}
