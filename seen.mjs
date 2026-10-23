// =====================================================================
// SHOWN TICKETS: every ticket each person has been shown (in the AI
// assistant's answers, or opened as a record), kept with their account in
// the onetouch_auth database, so Home's "Ticket results" survives a refresh,
// signing out, and another computer
// =====================================================================

import { pool } from './auth.mjs';

// The most recent ones are kept; older ones drop off
export const MAX_SEEN = 2000;

// Safe to run every start (after auth.ensureSchema, which creates users)
export async function ensureSeenSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seen_tickets (
      user_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number         text NOT NULL,
      last_shown_at  timestamptz NOT NULL DEFAULT now(),
      question       text,
      PRIMARY KEY (user_id, number)
    );
    CREATE INDEX IF NOT EXISTS seen_tickets_recent_idx ON seen_tickets (user_id, last_shown_at DESC);
  `);
}

// Records that these tickets were just shown, with the question that showed
// them (null: opened directly). Shown again, a ticket moves back to the top.
export async function recordSeen(userId, numbers, question = null) {
  if (!numbers.length) return;
  await pool.query(
    `INSERT INTO seen_tickets (user_id, number, question)
     SELECT $1, n, $3 FROM unnest($2::text[]) AS n
     ON CONFLICT (user_id, number) DO UPDATE SET last_shown_at = now(), question = EXCLUDED.question`,
    [userId, numbers, question]);
  await pool.query(
    `DELETE FROM seen_tickets WHERE user_id = $1 AND number NOT IN (
       SELECT number FROM seen_tickets WHERE user_id = $1 ORDER BY last_shown_at DESC, number LIMIT $2)`,
    [userId, MAX_SEEN]);
}

// "Clear ticket results": the person's whole list (their stars are separate). -> how many
export async function clearSeen(userId) {
  const { rowCount } = await pool.query('DELETE FROM seen_tickets WHERE user_id = $1', [userId]);
  return rowCount;
}

// The tickets someone ticked and removed from their list. -> how many went
export async function removeSeen(userId, numbers) {
  const { rowCount } = await pool.query('DELETE FROM seen_tickets WHERE user_id = $1 AND number = ANY($2::text[])', [userId, numbers]);
  return rowCount;
}

// Newest first
export async function listSeen(userId) {
  const { rows } = await pool.query(
    `SELECT number, last_shown_at, question FROM seen_tickets
      WHERE user_id = $1 ORDER BY last_shown_at DESC, number`,
    [userId]);
  return rows.map(r => ({ number: r.number, shownAt: r.last_shown_at.toISOString(), question: r.question }));
}
