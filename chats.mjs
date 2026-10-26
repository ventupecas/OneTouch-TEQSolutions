// =====================================================================
// SAVED CHATS: each person's AI assistant conversations, kept with their
// account in the onetouch_auth database. A chat is saved after every
// answer, so "New chat", a refresh, signing out or a server restart never
// loses it; reopening one shows its answers again and gives Claude back
// its memory of it, so follow-ups carry on where they left off.
// =====================================================================

import { pool } from './auth.mjs';

// The most recently used are kept; older ones drop off
export const MAX_CHATS = 50;
// One chat's saved answers. Past this, the tables of its oldest answers are
// dropped (the answer's text stays, and the page says to ask again).
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const MAX_TITLE = 120;

// Safe to run every start (after auth.ensureSchema, which creates users)
export async function ensureChatsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_chats (
      id            serial PRIMARY KEY,
      user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title         text NOT NULL,
      conversation  jsonb NOT NULL,
      transcript    jsonb NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS saved_chats_recent_idx ON saved_chats (user_id, updated_at DESC);
  `);
}

// Newest first, without the contents
export async function listChats(userId) {
  const { rows } = await pool.query(
    `SELECT id, title, jsonb_array_length(transcript) AS questions, created_at, updated_at
       FROM saved_chats WHERE user_id = $1 ORDER BY updated_at DESC, id DESC`,
    [userId]);
  return rows.map(r => ({
    id: r.id, title: r.title, questions: r.questions,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  }));
}

// -> { id, title, conversation, transcript } or null if it isn't this person's
export async function getChat(userId, id) {
  const { rows } = await pool.query(
    'SELECT id, title, conversation, transcript FROM saved_chats WHERE user_id = $1 AND id = $2',
    [userId, id]);
  return rows[0] || null;
}

// Saves a chat as it is now. id null: a new chat. -> its id (a new one if
// the old row was deleted meanwhile, e.g. from another tab)
export async function saveChat(userId, id, { conversation, transcript }) {
  const title = chatTitle(transcript);
  const kept = JSON.stringify(fitTranscript(transcript));
  const saved = JSON.stringify(conversation);
  if (id) {
    const { rowCount } = await pool.query(
      `UPDATE saved_chats SET title = $3, conversation = $4, transcript = $5, updated_at = now()
        WHERE user_id = $1 AND id = $2`,
      [userId, id, title, saved, kept]);
    if (rowCount) return id;
  }
  const { rows: [row] } = await pool.query(
    'INSERT INTO saved_chats (user_id, title, conversation, transcript) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, title, saved, kept]);
  await pool.query(
    `DELETE FROM saved_chats WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM saved_chats WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2)`,
    [userId, MAX_CHATS]);
  return row.id;
}

export async function deleteChat(userId, id) {
  await pool.query('DELETE FROM saved_chats WHERE user_id = $1 AND id = $2', [userId, id]);
}

// The chat's first question names it in the list
function chatTitle(transcript) {
  const first = String(transcript[0]?.question || 'Chat').replace(/\s+/g, ' ').trim();
  return first.length > MAX_TITLE ? `${first.slice(0, MAX_TITLE - 1)}…` : first;
}

// Over the size cap, the oldest answers lose their tables first
function fitTranscript(transcript) {
  let size = JSON.stringify(transcript).length;
  if (size <= MAX_TRANSCRIPT_BYTES) return transcript;
  const fitted = transcript.map(entry => ({ ...entry }));
  for (const entry of fitted) {
    if (size <= MAX_TRANSCRIPT_BYTES) break;
    const r = entry.reply;
    if (!r || r.rowsDropped || !(r.results?.length || r.sections?.length || r.combined)) continue;
    const before = JSON.stringify(r).length;
    entry.reply = { ...r, results: [], sections: [], combined: null, chartable: null, rowsDropped: true };
    size -= before - JSON.stringify(entry.reply).length;
  }
  return fitted;
}
