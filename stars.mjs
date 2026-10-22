// =====================================================================
// STARRED TICKETS: each person's starred tickets, kept with their account
// in the onetouch_auth database, so they follow them to any computer
// =====================================================================

import { pool } from './auth.mjs';

// Plenty for a watch list; stops one account filling the table
export const MAX_STARS = 2000;

// Safe to run every start (after auth.ensureSchema, which creates users)
export async function ensureStarsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS starred_tickets (
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number      text NOT NULL,
      starred_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, number)
    );
  `);
}

// Newest first
export async function listStars(userId) {
  const { rows } = await pool.query(
    'SELECT number, starred_at FROM starred_tickets WHERE user_id = $1 ORDER BY starred_at DESC, number',
    [userId]);
  return rows.map(r => ({ number: r.number, starredAt: r.starred_at.toISOString() }));
}

// -> true if starred (or already was), false if the list is full
export async function addStar(userId, number) {
  const { rows } = await pool.query(
    `INSERT INTO starred_tickets (user_id, number)
     SELECT $1, $2 WHERE (SELECT count(*) FROM starred_tickets WHERE user_id = $1) < $3
     ON CONFLICT DO NOTHING RETURNING number`,
    [userId, number, MAX_STARS]);
  if (rows.length) return true;
  const existing = await pool.query('SELECT 1 FROM starred_tickets WHERE user_id = $1 AND number = $2', [userId, number]);
  return existing.rows.length > 0;
}

export async function removeStar(userId, number) {
  await pool.query('DELETE FROM starred_tickets WHERE user_id = $1 AND number = $2', [userId, number]);
}
