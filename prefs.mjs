// =====================================================================
// PREFERENCES: how each person has set up OneTouch - their color scheme,
// their Home page, and their own dashboards - kept with their account in
// the onetouch_auth database, so it survives a refresh, signing out and a
// server restart, and follows them to any computer
// =====================================================================

import { pool } from './auth.mjs';
import { sanitizeChart, sanitizeScope, newId } from './charts.mjs';

// Saved separately, so changing colors never overwrites a dashboard.
// tour: which tours have been seen (Home's, and the Dashboards page's).
export const PARTS = ['theme', 'home', 'dashboards', 'tour'];

export const MAX_BOARDS = 20;
export const MAX_BOARD_CHARTS = 30;
export const MAX_HOME_BLOCKS = 30;
// A whole account's settings; far more than 20 full dashboards need
const MAX_BYTES = 512 * 1024;

const MODES = ['light', 'dark', 'system'];
const HEADERS = ['dark', 'accent', 'light'];
// Home's own sections, besides charts
const HOME_SECTIONS = ['assistant', 'tickets', 'shortcuts'];
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const DASHBOARD_KEY = /^[a-z0-9-]{1,60}$/;

export class PreferenceError extends Error {}

// Safe to run every start (after auth.ensureSchema, which creates users)
export async function ensurePrefsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id     integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

// -> { theme?, home?, dashboards? }: only the parts this person has changed
export async function getPreferences(userId) {
  const { rows } = await pool.query('SELECT settings FROM user_preferences WHERE user_id = $1', [userId]);
  return rows[0]?.settings || {};
}

export async function savePreference(userId, part, value) {
  await pool.query(
    `INSERT INTO user_preferences (user_id, settings) VALUES ($1, jsonb_build_object($2::text, $3::jsonb))
     ON CONFLICT (user_id) DO UPDATE SET settings = user_preferences.settings || EXCLUDED.settings, updated_at = now()`,
    [userId, part, JSON.stringify(value)]);
}

// Back to the default for that part
export async function resetPreference(userId, part) {
  await pool.query('UPDATE user_preferences SET settings = settings - $2::text, updated_at = now() WHERE user_id = $1', [userId, part]);
}

// ---------------------------------------------------------------------
// Browser input -> exactly the shape the page expects. Unknown keys are
// dropped, text is trimmed and capped, and every chart goes through
// sanitizeChart, so a saved chart can always be drawn.
// ---------------------------------------------------------------------

function cleanTheme(t = {}) {
  return {
    mode: MODES.includes(t.mode) ? t.mode : 'light',
    accent: /^#[0-9a-f]{6}$/i.test(t.accent) ? t.accent.toLowerCase() : '#10a37f',
    header: HEADERS.includes(t.header) ? t.header : 'dark',
  };
}

function cleanCharts(list, max) {
  const charts = [];
  for (const c of (Array.isArray(list) ? list : []).slice(0, max)) {
    const chart = sanitizeChart(c);
    if (charts.some(other => other.id === chart.id)) chart.id = newId();
    charts.push(chart);
  }
  return charts;
}

function cleanHome(h = {}) {
  const blocks = [];
  for (const b of (Array.isArray(h.blocks) ? h.blocks : []).slice(0, MAX_HOME_BLOCKS)) {
    if (HOME_SECTIONS.includes(b?.type)) {
      if (!blocks.some(other => other.type === b.type)) blocks.push({ type: b.type });
    } else if (b?.type === 'chart') {
      const [chart] = cleanCharts([b.chart], 1);
      if (blocks.some(other => other.chart?.id === chart.id)) chart.id = newId();
      blocks.push({ type: 'chart', chart });
    }
  }
  return { blocks };
}

// One dashboard: its name, its charts, and its filter row (scope: dates, teams)
export function cleanBoard(b, takenIds = []) {
  return {
    id: typeof b.id === 'string' && ID.test(b.id) && !takenIds.includes(b.id) ? b.id : newId(),
    name: String(b.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'My dashboard',
    charts: cleanCharts(b.charts, MAX_BOARD_CHARTS),
    scope: sanitizeScope(b.scope),
  };
}

function cleanDashboards(d = {}) {
  const boards = [];
  for (const b of (Array.isArray(d.boards) ? d.boards : []).slice(0, MAX_BOARDS)) {
    if (!b || typeof b !== 'object') continue;
    boards.push(cleanBoard(b, boards.map(other => other.id)));
  }
  // Team dashboards this person hid from their list, and the one they had open last
  const hidden = [...new Set((Array.isArray(d.hidden) ? d.hidden : []).filter(k => typeof k === 'string' && DASHBOARD_KEY.test(k)))].slice(0, 200);
  const last = typeof d.last === 'string' && (DASHBOARD_KEY.test(d.last) || /^my:[A-Za-z0-9_-]{1,40}$/.test(d.last)) ? d.last : '';
  return { boards, hidden, last };
}

// done: Home's tour has been seen; dashboards: the Dashboards page's
const cleanTour = (t = {}) => ({ done: t.done === true, dashboards: t.dashboards === true });

const CLEANERS = { theme: cleanTheme, home: cleanHome, dashboards: cleanDashboards, tour: cleanTour };

export function cleanPreference(part, value) {
  if (!PARTS.includes(part)) throw new PreferenceError('Unknown setting.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PreferenceError('The setting must be an object.');
  const clean = CLEANERS[part](value);
  if (JSON.stringify(clean).length > MAX_BYTES) throw new PreferenceError('That is more than OneTouch can save for one account. Remove some charts first.');
  return clean;
}
