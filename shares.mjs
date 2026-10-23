// =====================================================================
// SHARED DASHBOARDS: a link to a copy of someone's own dashboard. Anyone
// signed in to OneTouch who opens the link sees it and can add a copy to
// their own dashboards. Each dashboard has one link, and the owner's later
// changes to the dashboard update what the link shows; copies people
// already added are theirs and don't change.
// =====================================================================

import { randomBytes } from 'node:crypto';
import { pool } from './auth.mjs';
import { cleanBoard } from './prefs.mjs';

// A link per dashboard, and each person can have at most 20 of their own
export const MAX_SHARES = 20;
export const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export class ShareError extends Error {}

// Safe to run every start (after auth.ensureSchema, which creates users)
export async function ensureSharesSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_dashboards (
      token       text PRIMARY KEY,
      owner_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      board_id    text NOT NULL,
      board       jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (owner_id, board_id)
    );
  `);
}

// Shares (or updates the shared copy of) one of this person's dashboards -> its token
export async function shareBoard(userId, input) {
  if (!input || typeof input !== 'object') throw new ShareError('Nothing to share.');
  const board = cleanBoard(input);
  if (!board.charts.length) throw new ShareError('Add a chart to this dashboard before sharing it.');
  const { rows: [{ count }] } = await pool.query(
    'SELECT count(*)::int AS count FROM shared_dashboards WHERE owner_id = $1 AND board_id <> $2', [userId, board.id]);
  if (count >= MAX_SHARES) throw new ShareError(`You can share up to ${MAX_SHARES} dashboards. Stop sharing one first.`);
  const { rows } = await pool.query(
    `INSERT INTO shared_dashboards (token, owner_id, board_id, board) VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_id, board_id) DO UPDATE SET board = EXCLUDED.board, updated_at = now()
     RETURNING token`,
    [randomBytes(16).toString('base64url'), userId, board.id, JSON.stringify(board)]);
  return rows[0].token;
}

// This person's shared dashboards: [{ boardId, token }]
export async function listShares(userId) {
  const { rows } = await pool.query('SELECT board_id, token FROM shared_dashboards WHERE owner_id = $1', [userId]);
  return rows.map(r => ({ boardId: r.board_id, token: r.token }));
}

// What a link shows -> { name, charts, scope, owner, updatedAt, mine } or null
export async function getShare(token, userId) {
  if (!TOKEN.test(token)) return null;
  const { rows } = await pool.query(
    `SELECT s.board, s.updated_at, s.owner_id, coalesce(nullif(u.display_name, ''), u.username) AS owner
       FROM shared_dashboards s JOIN users u ON u.id = s.owner_id WHERE s.token = $1`, [token]);
  if (!rows.length) return null;
  const { board, updated_at, owner_id, owner } = rows[0];
  return { name: board.name, charts: board.charts, scope: board.scope, owner, updatedAt: updated_at.toISOString(), mine: owner_id === userId };
}

// Stops sharing: the link stops working (copies people added stay theirs)
export async function unshare(userId, token) {
  const { rowCount } = await pool.query('DELETE FROM shared_dashboards WHERE token = $1 AND owner_id = $2', [token, userId]);
  return rowCount > 0;
}
