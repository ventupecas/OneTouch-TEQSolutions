// =====================================================================
// AUTH: user accounts and sign-in sessions, stored in Postgres
// =====================================================================
//
// Accounts live in their own database (onetouch_auth), reached through
// their own database user (onetouch_app), so nothing on the analytics side
// (Cube, Metabase, Claude's queries against analytics_db) can read them.
//
// Passwords are never stored: only a salted scrypt hash. Session tokens are
// never stored either: only their SHA-256, so a copy of the sessions table
// can't be used to sign in.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const scrypt = promisify(scryptCb);

// Created on first use, so .env has been loaded by then (imports run before dotenv.config())
let poolInstance = null;
export const pool = {
  query: (...args) => getPool().query(...args),
  // One connection, for a transaction (release it when done)
  connect: () => getPool().connect(),
  end: () => (poolInstance ? poolInstance.end() : Promise.resolve()),
};

function getPool() {
  if (!poolInstance) {
    poolInstance = new pg.Pool({
      host: process.env.AUTH_DB_HOST || 'localhost',
      port: Number(process.env.AUTH_DB_PORT || 5432),
      database: process.env.AUTH_DB_NAME || 'onetouch_auth',
      user: process.env.AUTH_DB_USER || 'onetouch_app',
      password: process.env.AUTH_DB_PASSWORD,
      max: 5,
    });
    // An idle connection dropping (e.g. Postgres restarting) must not crash the server
    poolInstance.on('error', err => console.error('🔐 Auth database connection error:', err.message));
  }
  return poolInstance;
}

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Five wrong passwords lock that account for 15 minutes
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------
// Schema (created on first start; safe to run every start)
// ---------------------------------------------------------------------

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              serial PRIMARY KEY,
      username        text UNIQUE NOT NULL CHECK (username = lower(username)),
      password_hash   text NOT NULL,
      display_name    text,
      is_active       boolean NOT NULL DEFAULT true,
      failed_attempts integer NOT NULL DEFAULT 0,
      locked_until    timestamptz,
      created_at      timestamptz NOT NULL DEFAULT now(),
      last_login_at   timestamptz
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  text PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT now(),
      expires_at  timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

    -- When the password, name or active flag last changed (millisecond precision,
    -- so it round-trips exactly through the accounts file; see syncAccounts)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS
      updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now());
  `);
}

// ---------------------------------------------------------------------
// Passwords: "scrypt$N$r$p$salt$hash" (base64), so cost can be raised later
// ---------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, saltB64, hashB64] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

// Checked against when the username doesn't exist, so a wrong username takes
// as long as a wrong password and doesn't reveal which accounts exist
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

// The sign-in form shows "@molsoncoors.com" after the box, so accept it typed out too
export function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase().replace(/@molsoncoors\.com$/, '');
}

export function validatePassword(password) {
  // No minimum length; only an empty password is refused (it would let anyone in with just the username)
  if (typeof password !== 'string' || password.length === 0) return 'The password cannot be empty.';
  if (password.length > 200) return 'Passwords must be at most 200 characters.';
  return null;
}

// ---------------------------------------------------------------------
// Sign in / sessions
// ---------------------------------------------------------------------

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// -> { ok: true, user, token } | { ok: false, reason: 'invalid' | 'locked' }
export async function signIn(username, password) {
  const name = normalizeUsername(username);
  const { rows } = await pool.query(
    'SELECT id, username, display_name, password_hash, is_active, locked_until FROM users WHERE username = $1',
    [name]);
  const user = rows[0];

  const passwordOk = await verifyPassword(password || '', user ? user.password_hash : DUMMY_HASH);
  if (!user || !user.is_active) return { ok: false, reason: 'invalid' };

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return { ok: false, reason: 'locked' };
  }

  if (!passwordOk) {
    // Count the miss; the fifth one in a row locks the account for a while
    await pool.query(
      `UPDATE users
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE WHEN failed_attempts + 1 >= $2
                                  THEN now() + ($3 || ' milliseconds')::interval END
        WHERE id = $1`,
      [user.id, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MS)]);
    return { ok: false, reason: 'invalid' };
  }

  const token = randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)",
    [hashToken(token), user.id, String(SESSION_TTL_MS)]);
  await pool.query(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
    [user.id]);

  return { ok: true, token, user: { id: user.id, username: user.username, displayName: user.display_name } };
}

// The signed-in user for a token, or null if it is unknown, expired, or the account was deactivated
export async function getSessionUser(token) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
    [hashToken(token)]);
  return rows[0] ? { id: rows[0].id, username: rows[0].username, displayName: rows[0].display_name } : null;
}

export async function signOut(token) {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function deleteExpiredSessions() {
  const { rowCount } = await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
  return rowCount;
}

// ---------------------------------------------------------------------
// Account management (used by scripts/users.mjs)
// ---------------------------------------------------------------------

export async function addUser(username, password, displayName = null) {
  const name = normalizeUsername(username);
  if (!/^[a-z0-9._-]{2,64}$/.test(name)) throw new Error('Usernames may only use letters, numbers, dots, dashes and underscores.');
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash, display_name) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING RETURNING id',
    [name, await hashPassword(password), displayName]);
  if (!rows.length) throw new Error(`User "${name}" already exists. Use reset-password to change their password.`);
  return name;
}

export async function resetPassword(username, password) {
  const name = normalizeUsername(username);
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL,
                      updated_at = date_trunc('milliseconds', now())
      WHERE username = $1 RETURNING id`,
    [name, await hashPassword(password)]);
  if (!rows.length) throw new Error(`No user named "${name}".`);
  // Anyone signed in with the old password is signed out
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
  return name;
}

export async function setActive(username, active) {
  const name = normalizeUsername(username);
  const { rows } = await pool.query(
    `UPDATE users SET is_active = $2, failed_attempts = 0, locked_until = NULL,
                      updated_at = date_trunc('milliseconds', now())
      WHERE username = $1 RETURNING id`,
    [name, active]);
  if (!rows.length) throw new Error(`No user named "${name}".`);
  if (!active) await pool.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
  return name;
}

export async function listUsers() {
  const { rows } = await pool.query(
    `SELECT username, display_name, is_active, locked_until > now() AS locked, created_at, last_login_at
       FROM users ORDER BY username`);
  return rows;
}

// ---------------------------------------------------------------------
// Accounts file (db/accounts.json): shares accounts with clones of the repo.
// Holds usernames, display names and password *hashes*, never passwords.
// Written by `users export`; loaded automatically when the server starts.
// ---------------------------------------------------------------------

export const ACCOUNTS_FILE_VERSION = 1;

export async function exportAccounts() {
  const { rows } = await pool.query(
    'SELECT username, display_name, password_hash, is_active, updated_at FROM users ORDER BY username');
  return {
    version: ACCOUNTS_FILE_VERSION,
    note: 'OneTouch sign-in accounts. Password hashes only. Regenerate with: node scripts/users.mjs export',
    accounts: rows.map(r => ({
      username: r.username,
      displayName: r.display_name,
      passwordHash: r.password_hash,
      active: r.is_active,
      updatedAt: r.updated_at.toISOString(),
    })),
  };
}

// Brings the database up to date with an accounts file. Accounts missing
// from the database are added; an existing account is only overwritten when
// the file's copy changed more recently, so an old file can never undo a
// newer password reset or deactivation. Accounts not in the file are left alone.
// -> { added, updated, unchanged, invalid: [messages] }
export async function syncAccounts(file) {
  if (!file || file.version !== ACCOUNTS_FILE_VERSION || !Array.isArray(file.accounts)) {
    throw new Error(`Not a OneTouch accounts file (expected version ${ACCOUNTS_FILE_VERSION} with an "accounts" list).`);
  }
  const result = { added: [], updated: [], unchanged: 0, invalid: [] };

  for (const [i, a] of file.accounts.entries()) {
    const name = normalizeUsername(a?.username);
    const updatedAt = new Date(a?.updatedAt);
    if (!/^[a-z0-9._-]{2,64}$/.test(name) || !String(a?.passwordHash).startsWith('scrypt$')
        || typeof a?.active !== 'boolean' || Number.isNaN(updatedAt.getTime())) {
      result.invalid.push(`entry ${i + 1} (${a?.username ?? 'no username'}) is malformed`);
      continue;
    }

    const inserted = await pool.query(
      `INSERT INTO users (username, password_hash, display_name, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING RETURNING id`,
      [name, a.passwordHash, a.displayName || null, a.active, updatedAt]);
    if (inserted.rows.length) { result.added.push(name); continue; }

    const changed = await pool.query(
      `UPDATE users SET password_hash = $2, display_name = $3, is_active = $4, updated_at = $5,
                        failed_attempts = 0, locked_until = NULL
        WHERE username = $1 AND updated_at < $5 RETURNING id`,
      [name, a.passwordHash, a.displayName || null, a.active, updatedAt]);
    if (changed.rows.length) {
      // New password or deactivated: sessions from before the change end
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [changed.rows[0].id]);
      result.updated.push(name);
    } else {
      result.unchanged += 1;
    }
  }
  return result;
}

// Where the accounts file lives, relative to the project folder
export const DEFAULT_ACCOUNTS_FILE = 'db/accounts.json';
