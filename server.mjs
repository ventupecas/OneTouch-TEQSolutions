import dns from 'node:dns/promises';
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import express from 'express';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  buildUserMessage,
  normalizeAndValidate,
  combineResults,
  OUTPUT_SCHEMA,
} from './business_logic.mjs';
import { buildExport, validateExport, ExportUnavailableError } from './export.mjs';
import * as auth from './auth.mjs';
import * as stars from './stars.mjs';
import * as seen from './seen.mjs';
import { findTickets, ticketRecord, ticketSummaries, ticketNumbersIn, ticketsByPriority, isOpen, priorityRank, STARRABLE, loadTicketIndex, reloadTicketIndex, TICKET_SORTS, sortRows, parseLookup, lookupMatches, openedText, blankText, inTheData, parseTicketNumbers } from './tickets.mjs';
import { relatedFamilies, describeFamilies, ticketLinks, FAMILY_KINDS, LINK_KIND, familyList, familySummary, familyOf, familyRow, FAMILY_CHILD_NOUNS, forgetLinks } from './relations.mjs';
import * as prefs from './prefs.mjs';
import { chartData, chartValues, chartCatalog, chartTickets, chartFromQuery, teamValues, ChartError, forgetResults } from './charts.mjs';
import * as shares from './shares.mjs';
import * as chats from './chats.mjs';
import * as teams from './teams.mjs';
import * as notifications from './notifications.mjs';
import { startMail, mailEnabled } from './mail.mjs';
import * as kpis from './kpis.mjs';
import { diagnoseEmpty, explainEmpty, isEmptyResult } from './empty_results.mjs';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// No CORS headers: only OneTouch's own page calls its API (remote mode
// passes requests through its own server, not the browser)
app.disable('x-powered-by');

// =====================================================================
// METABASE DASHBOARDS: Metabase only listens on this computer, so its
// embedded-dashboard pages (and the scripts and data they load) are passed
// through this server. That way the Dashboards tab works wherever OneTouch
// does: localhost, the network address, the tunnel and remote mode.
// Each person opens them through links signed for them (/api/dashboards),
// which show only the tickets they may see.
// =====================================================================

const METABASE_URL = (process.env.METABASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const METABASE_DASHBOARDS_FILE = 'metabase-dashboards.json';
// What a signed dashboard page needs from Metabase, and nothing else (no
// admin pages, no signed-in API, no public links). Each of its requests
// carries the signed link, which Metabase checks.
const METABASE_PATHS = /^\/(embed\/|app\/|api\/embed\/|api\/session\/properties$|api\/geojson)/;
// How long a signed link works: a sign-in's length, after which the page asks again
const EMBED_TTL_S = 12 * 60 * 60;
// Headers passed back to the browser; fetch already undid any compression
const METABASE_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified',
  'content-security-policy', 'x-frame-options', 'location'];

// The address passed to Metabase, or null. Checked after "../" (and its
// %2e%2e spelling) is resolved, since fetch resolves it too: "/embed/../api/…"
// would otherwise reach any of Metabase's API.
function metabaseTarget(req) {
  if (!['GET', 'HEAD'].includes(req.method) || !METABASE_PATHS.test(req.path)) return null;
  if (/\.\.|%2e|\\|%5c/i.test(req.originalUrl.split('?')[0])) return null;
  const target = new URL(req.originalUrl, METABASE_URL);
  return target.origin === new URL(METABASE_URL).origin && METABASE_PATHS.test(target.pathname) ? target : null;
}

app.use(async (req, res, next) => {
  const target = metabaseTarget(req);
  if (!target) return next();
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { accept: req.get('accept') || '*/*', 'accept-language': req.get('accept-language') || 'en' },
      redirect: 'manual',
      signal: AbortSignal.timeout(120 * 1000),
    });
    res.status(upstream.status);
    for (const h of METABASE_RESPONSE_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error(`📊 Metabase unreachable for ${req.path}: ${error.message}`);
    res.status(502).send('Metabase is not reachable right now.');
  }
});
// Security headers on everything OneTouch serves itself (Metabase's pages
// above keep Metabase's own). Nothing loads from, or sends to, another site;
// the page can only be framed by itself. Scripts still allow inline code,
// because index.html and the page scripts use onclick="…" handlers.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=31536000',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  next();
});

// A click inside a dashboard that opens another page lands here
// (/onetouch/dashboard/<page>?filters): the link can't hold each person's
// signed address, so the page around the frame swaps it in (app.js,
// followDashboardFrame). Until then, a blank page.
app.get('/onetouch/dashboard/:key', (req, res) => {
  res.set('Cache-Control', 'no-store').type('html')
    .send('<!doctype html><meta charset="utf-8"><title>Opening…</title><body style="margin:0;background:transparent"></body>');
});

// Exports carry whole result tables back up, so that route gets a bigger limit
app.use('/api/export', express.json({ limit: '25mb' }));
// A whole set of dashboards is saved (or a dashboard shared) at once
app.use(['/api/preferences', '/api/shares'], express.json({ limit: '1mb' }));
app.use(express.json());

// The page names its scripts and stylesheet with a version made from their
// contents (app.js?v=1a2b3c4d5e). Cloudflare tells browsers to keep those
// files for hours, so a changed file needs a new address to reach people
// straight away. The page itself is never kept, so it always names the latest.
const VERSIONED_ASSET = /(<script src="|<link rel="stylesheet" href=")([\w-]+\.(?:js|css))(")/g;
const assetVersions = new Map(); // file -> { mtimeMs, version }
function assetVersion(file) {
  const full = `public/${file}`;
  const { mtimeMs } = statSync(full);
  const known = assetVersions.get(file);
  if (known?.mtimeMs === mtimeMs) return known.version;
  const version = createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 10);
  assetVersions.set(file, { mtimeMs, version });
  return version;
}
app.get(['/', '/index.html'], (req, res, next) => {
  try {
    const html = readFileSync('public/index.html', 'utf8')
      .replace(VERSIONED_ASSET, (match, before, file, after) => `${before}${file}?v=${assetVersion(file)}${after}`);
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  } catch (error) {
    console.error(`📄 Could not version the page's files: ${error.message}`);
    next(); // the plain page, from express.static
  }
});
app.use(express.static('public'));

// =====================================================================
// SIGN IN: accounts and sessions live in Postgres (see auth.mjs);
// /api/query, /api/export and /api/conversation need a session
// =====================================================================

// Conversation memory per session token: { conversation, queue, chatId,
// transcript }. Kept in RAM while in use; each chat is also saved to the
// person's account after every answer (chats.mjs), so it can be reopened.
const conversations = new Map();

// What Claude remembers for one signed-in session (see translateToQuery)
function newConversation() {
  return {
    messages: [],     // Anthropic.MessageParam[]: user turns + Claude's full replies, append-only
    turns: 0,         // completed question/answer pairs
    pendingNote: null // what the last answer's query returned, told to Claude with the next question
  };
}

function conversationState(token) {
  let state = conversations.get(token);
  if (!state) {
    // queue: questions in one session run one at a time
    // chatId: this chat's saved row (null until its first answer is saved);
    // transcript: what the page showed for each question, to draw it again
    state = { conversation: newConversation(), queue: Promise.resolve(), lastUsed: Date.now(), chatId: null, transcript: [] };
    conversations.set(token, state);
  }
  state.lastUsed = Date.now();
  return state;
}

// Runs after everything already queued for this session (questions run one
// at a time), so a chat can't change under an answer that's still coming
function queued(session, work) {
  const run = session.queue.then(work);
  session.queue = run.catch(() => {});
  return run;
}

// Saves the session's chat as it is now; a failure only costs the history
async function saveSessionChat(session, user) {
  if (!session.transcript.length) return;
  try {
    session.chatId = await chats.saveChat(user.id, session.chatId, { conversation: session.conversation, transcript: session.transcript });
  } catch (error) {
    console.error('💬 Could not save the chat:', error.message);
  }
}

// A fresh, unsaved chat (the one before it stays in the history)
function startNewChat(session) {
  session.conversation = newConversation();
  session.chatId = null;
  session.transcript = [];
}

// Per-address brake on wrong passwords, on top of the per-account lockout in
// auth.mjs (which can't cover guesses spread across many usernames)
const MAX_FAILURES_PER_IP = 20;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failuresByIp = new Map(); // ip -> { count, resetAt }

// Through the Cloudflare tunnel every request arrives from the tunnel
// container, so the visitor's real address comes from Cloudflare's
// CF-Connecting-IP header. That header is only believed from the tunnel
// containers themselves; anyone else could simply make it up.
const TUNNEL_HOSTS = ['tunnel', 'tunnel-named']; // service names in docker-compose.yml
let tunnelAddresses = new Set();

async function refreshTunnelAddresses() {
  const found = new Set();
  for (const host of TUNNEL_HOSTS) {
    try {
      for (const { address } of await dns.lookup(host, { all: true })) found.add(address);
    } catch { /* that tunnel isn't running */ }
  }
  tunnelAddresses = found;
}
refreshTunnelAddresses();
setInterval(refreshTunnelAddresses, 30 * 1000).unref();

function clientIp(req) {
  const direct = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const forwarded = req.get('CF-Connecting-IP');
  return tunnelAddresses.has(direct) && forwarded ? forwarded.trim() : direct;
}

function tooManyFailures(ip) {
  const entry = failuresByIp.get(ip);
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES_PER_IP);
}

function recordFailure(ip) {
  const entry = failuresByIp.get(ip);
  if (!entry || entry.resetAt <= Date.now()) failuresByIp.set(ip, { count: 1, resetAt: Date.now() + FAILURE_WINDOW_MS });
  else entry.count += 1;
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const ip = clientIp(req);
  if (tooManyFailures(ip)) {
    return res.status(429).json({ error: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.' });
  }

  try {
    const result = await auth.signIn(username, password);
    if (!result.ok) {
      recordFailure(ip);
      return res.status(401).json({
        error: result.reason === 'locked'
          ? 'This account is locked for 15 minutes after too many wrong passwords.'
          : 'Incorrect email or password.',
      });
    }
    console.log(`🔐 ${result.user.username} signed in from ${ip}`);
    res.json({ token: result.token, username: result.user.username, displayName: result.user.displayName });
  } catch (error) {
    console.error('🔐 Sign-in failed:', error.message);
    res.status(503).json({ error: 'Sign-in is unavailable right now (the account database could not be reached).' });
  }
});

function sessionToken(req) {
  const m = (req.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  return m ? m[1] : null;
}

app.post('/api/logout', async (req, res) => {
  const token = sessionToken(req);
  if (token) {
    conversations.delete(token);
    await auth.signOut(token).catch(err => console.error('🔐 Sign-out failed:', err.message));
  }
  res.json({ ok: true });
});

async function requireLogin(req, res, next) {
  const token = sessionToken(req);
  let user = null;
  try {
    user = token ? await auth.getSessionUser(token) : null;
  } catch (error) {
    console.error('🔐 Session check failed:', error.message);
    return res.status(503).json({ error: 'The account database could not be reached. Please try again shortly.' });
  }
  if (!user) {
    if (token) conversations.delete(token);
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  // Which tickets this person may see (teams.mjs): every Cube query their
  // request makes goes through req.runQuery, which only ever sees those
  try {
    req.scope = await teams.scopeFor(user);
  } catch (error) {
    console.error('👥 Access check failed:', error.message);
    return res.status(503).json({ error: 'The account database could not be reached. Please try again shortly.' });
  }
  req.user = user;
  req.session = conversationState(token);
  req.runQuery = scopedRunner(req.scope);
  next();
}

// runCubeQuery limited to one person's tickets. scopeKey names that set of
// tickets in the caches of charts.mjs and relations.mjs.
function scopedRunner(scope) {
  const run = query => runCubeQuery(teams.restrictQuery(query, scope));
  run.scopeKey = scope.key;
  return run;
}

app.use(['/api/query', '/api/export', '/api/conversation', '/api/me', '/api/dashboards', '/api/tickets', '/api/stars', '/api/seen-tickets', '/api/preferences', '/api/charts', '/api/shares', '/api/families', '/api/chats', '/api/teams', '/api/assignments', '/api/ticket-families', '/api/notifications', '/api/my-tickets', '/api/kpis', '/api/ticket-statuses', '/api/demo-tickets'], requireLogin);

// Who is signed in (the page shows their display name), and what they may do
app.get('/api/me', async (req, res) => {
  const { admin, role, team } = req.scope.access;
  // Their own email address and whether their notifications are emailed (mail.mjs)
  const email = await auth.emailSettings(req.user.id).catch(() => ({ address: null, on: false }));
  res.json({
    username: req.user.username, displayName: req.user.displayName,
    access: { admin, role, roleName: teams.ROLES[role] || null, team, tickets: req.scope.count, note: teams.scopeNote(req.scope) },
    email: { ...email, enabled: mailEnabled() },
  });
});

// { on } -> their notifications are emailed to them, or not (the 🔔 panel's switch)
app.put('/api/me/email', async (req, res) => {
  if (typeof req.body?.on !== 'boolean') return res.status(400).json({ error: 'Say whether to email you: { "on": true } or { "on": false }.' });
  try {
    const email = await auth.setEmailNotifications(req.user.id, req.body.on);
    console.log(`✉️  ${req.user.username} turned email ${req.body.on ? 'on' : 'off'}`);
    res.json({ email: { ...email, enabled: mailEnabled() } });
  } catch (error) {
    console.error('✉️  Saving the email setting failed:', error.message);
    res.status(503).json({ error: 'That could not be saved right now.' });
  }
});

// A Metabase signed-embedding link to one dashboard, its "viewer" filter
// locked to this person (teams.dashboardViewer): Metabase checks the
// signature and shows only the tickets that viewer may see
const base64url = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
function signedDashboardPath(dashboardId, viewer) {
  const body = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({
    resource: { dashboard: dashboardId },
    params: { viewer },
    exp: Math.floor(Date.now() / 1000) + EMBED_TTL_S,
  })}`;
  const signature = createHmac('sha256', process.env.METABASE_EMBEDDING_SECRET).update(body).digest('base64url');
  return `/embed/dashboard/${body}.${signature}`;
}

// The dashboards built by scripts/metabase-setup.mjs, for the Dashboards tab,
// each as a link signed for this person: everyone gets them, and each sees
// only their own tickets in them
app.get('/api/dashboards', (req, res) => {
  try {
    const { dashboards, details = [] } = JSON.parse(readFileSync(METABASE_DASHBOARDS_FILE, 'utf8'));
    // A file from before signed links (public links only), or no secret to sign with
    if (!/^[0-9a-f]{64}$/.test(process.env.METABASE_EMBEDDING_SECRET || '') || dashboards.some(d => !d.id)) {
      console.error('📊 The dashboards need METABASE_EMBEDDING_SECRET and a run of scripts/metabase-setup.mjs');
      return res.json({ dashboards: [], details: [] });
    }
    const viewer = teams.dashboardViewer(req.scope);
    res.json({
      // `group` is the drawer heading; files from before groups existed get one heading
      dashboards: dashboards.map(d => ({
        key: d.key, group: d.group || 'Dashboards', name: d.name, description: d.description, path: signedDashboardPath(d.id, viewer),
      })),
      // The pages a click on a chart opens (not in the drawer); their filters name the page
      details: details.map(d => ({ key: d.key, name: d.name, path: signedDashboardPath(d.id, viewer), params: d.params })),
    });
  } catch {
    res.json({ dashboards: [], details: [] });
  }
});

// "New chat": a fresh conversation; the old one stays in the history.
// { delete: true } ("Delete chat") also removes the old one from the history.
app.post('/api/conversation/reset', async (req, res) => {
  const session = req.session;
  // Queued behind any question still running, so its answer can't land in the new conversation
  await queued(session, async () => {
    if (req.body?.delete && session.chatId) {
      await chats.deleteChat(req.user.id, session.chatId)
        .catch(error => console.error('💬 Could not delete the chat:', error.message));
    }
    startNewChat(session);
  });
  res.json({ ok: true });
});

// =====================================================================
// CHAT HISTORY: each person's saved chats (see chats.mjs)
// =====================================================================

const chatId = value => (/^\d{1,9}$/.test(String(value)) ? Number(value) : null);

// Newest first; `current` marks the one this session is on
app.get('/api/chats', async (req, res) => {
  const session = req.session;
  try {
    const list = await queued(session, () => chats.listChats(req.user.id));
    res.json({ chats: list.map(c => ({ ...c, current: c.id === session.chatId })) });
  } catch (error) {
    console.error('💬 Could not list the chats:', error.message);
    res.status(503).json({ error: 'Could not load your chat history right now.' });
  }
});

// Carries on a saved chat: Claude gets its memory back, and the page gets
// each question with the answer it showed, to draw them again
app.post('/api/chats/:id/open', async (req, res) => {
  const id = chatId(req.params.id);
  if (!id) return res.status(400).json({ error: 'No such chat.' });
  const session = req.session;
  try {
    const chat = await queued(session, async () => {
      const found = await chats.getChat(req.user.id, id);
      if (found) {
        session.conversation = { ...newConversation(), ...found.conversation };
        session.chatId = found.id;
        session.transcript = found.transcript;
      }
      return found;
    });
    if (!chat) return res.status(404).json({ error: 'That chat was deleted.' });
    console.log(`💬 ${req.user.username} reopened chat ${id} (${chat.transcript.length} questions)`);
    res.json({ id: chat.id, title: chat.title, transcript: chat.transcript });
  } catch (error) {
    console.error('💬 Could not open the chat:', error.message);
    res.status(503).json({ error: 'Could not open that chat right now.' });
  }
});

// Removes a saved chat; if it's the one open, the session starts a fresh one
app.delete('/api/chats/:id', async (req, res) => {
  const id = chatId(req.params.id);
  if (!id) return res.status(400).json({ error: 'No such chat.' });
  const session = req.session;
  try {
    const current = await queued(session, async () => {
      await chats.deleteChat(req.user.id, id);
      if (session.chatId !== id) return false;
      startNewChat(session);
      return true;
    });
    res.json({ ok: true, current });
  } catch (error) {
    console.error('💬 Could not delete the chat:', error.message);
    res.status(503).json({ error: 'Could not delete that chat right now.' });
  }
});

// Hourly housekeeping: expired sessions, idle conversations, old failure counts
setInterval(async () => {
  const idleCutoff = Date.now() - auth.SESSION_TTL_MS;
  for (const [token, state] of conversations) if (state.lastUsed < idleCutoff) conversations.delete(token);
  for (const [ip, entry] of failuresByIp) if (entry.resetAt <= Date.now()) failuresByIp.delete(ip);
  try {
    const removed = await auth.deleteExpiredSessions();
    if (removed) console.log(`🔐 Removed ${removed} expired sessions`);
  } catch (error) {
    console.error('🔐 Session cleanup failed:', error.message);
  }
}, 60 * 60 * 1000).unref();

const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
if (!anthropicKey || anthropicKey.startsWith('REPLACE_WITH')) {
  console.error('❌ ANTHROPIC_API_KEY is missing or still the placeholder. Set a real key in .env, then run: docker compose up -d --force-recreate app');
}

const anthropicWorkspaceId = (process.env.ANTHROPIC_WORKSPACE_ID || '').trim();

const anthropic = new Anthropic({
  apiKey: anthropicKey,
  defaultHeaders: anthropicWorkspaceId ? { 'anthropic-workspace-id': anthropicWorkspaceId } : undefined,
});

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

// The CSV export is a frozen snapshot (roughly 2026-06-01 to 2026-09-01).
// Relative phrases like "last month" are computed from TODAY, which drifts
// past the data over time. Set ASSUME_TODAY=YYYY-MM-DD in .env to pin the
// reference date (e.g. 2026-09-02) so relative dates land inside the export.
function referenceToday() {
  const pinned = (process.env.ASSUME_TODAY || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(pinned)) {
    const d = new Date(`${pinned}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

// The business logic (entity catalog, vocabulary, worked examples) lives in
// business_logic.mjs. It is built once and sent as a cached system block;
// only the user turn (which carries today's date) changes per request.
const SYSTEM_PROMPT = buildSystemPrompt();

// 🛡️ RESILIENT NETWORK RETRY LOOP HANDSHAKE
async function fetchWithRetry(url, options, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`⚠️ Cube is busy or compiling. Retrying in ${delay / 1000}s... (Attempt ${i + 1}/${retries})`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

// A session's conversation starts over after this many questions, so one
// very long session can't grow every request without limit
const MAX_CONVERSATION_TURNS = 40;

// Step 1: plain English -> structured JSON (schema-enforced by the API).
// Claude sees the session's earlier questions and its own earlier answers,
// so follow-ups like "same but for changes" or "only the P1s" work.
async function translateToQuery(conversation, userPrompt) {
  let memoryReset = false;
  if (conversation.turns >= MAX_CONVERSATION_TURNS) {
    Object.assign(conversation, newConversation());
    memoryReset = true;
  }

  // Tell Claude what its previous answer produced, inside the new user turn
  // (history is append-only: earlier turns are never edited after the fact)
  const note = conversation.pendingNote ? `[Result of your previous answer: ${conversation.pendingNote}]\n\n` : '';
  const userTurn = { role: 'user', content: note + buildUserMessage(userPrompt, referenceToday()) };

  const stream = anthropic.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    // Caches the conversation so far, so each follow-up only pays full price for the new turn
    cache_control: { type: 'ephemeral' },
    messages: [...conversation.messages, userTurn],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  });
  const message = await stream.finalMessage();

  // A failed call leaves the conversation as it was, so the user can just ask again
  if (message.stop_reason === 'refusal') {
    throw new Error('The assistant declined to translate that request.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('The translation was cut off; try a shorter question.');
  }

  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = JSON.parse(text);

  // Remember the turn. Claude's reply goes back exactly as returned (thinking
  // blocks included); Sonnet 5.5 rejects or drops altered earlier turns.
  conversation.messages.push(userTurn, { role: 'assistant', content: message.content });
  conversation.turns += 1;
  conversation.pendingNote = null;

  return { parsed, usage: message.usage, memoryReset, userTurn, content: message.content };
}

// =====================================================================
// REPEATED QUESTIONS: the data never changes, so a question that opens a
// conversation and has been asked before (by anyone) reuses Claude's
// translation from then: it answers in a fraction of a second instead of
// a few. Follow-ups depend on the conversation, so they always go to Claude.
// A reused translation still goes through normalizeAndValidate every time.
// =====================================================================

const ANSWER_CACHE_SIZE = 500;
// key -> { userTurn, content, parsed, explanation }; Map order = least recently used first
const answerCache = new Map();

// Same question = same words, ignoring capitals, spacing and the closing "?",
// asked on the same "today" (the turn Claude saw carries the date) of the same model
function answerCacheKey(conversation, userPrompt) {
  if (conversation.messages.length || conversation.pendingNote) return null;
  const question = userPrompt.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s?.!]+$/, '');
  if (!question) return null;
  return JSON.stringify([CLAUDE_MODEL, referenceToday().toISOString().slice(0, 10), question]);
}

function cachedAnswer(key) {
  const entry = key && answerCache.get(key);
  if (entry) { answerCache.delete(key); answerCache.set(key, entry); } // now the most recently used
  return entry || null;
}

function rememberAnswer(key, entry) {
  answerCache.set(key, entry);
  if (answerCache.size > ANSWER_CACHE_SIZE) answerCache.delete(answerCache.keys().next().value);
}

// =====================================================================
// PROGRESS: a page that asks for text/event-stream gets each step as it
// happens ("understanding", "querying", ...) and then the answer, so the
// chat can show what's going on. Anything else gets the plain JSON answer.
// =====================================================================

function queryReply(req, res) {
  const streaming = (req.get('Accept') || '').includes('text/event-stream');
  if (streaming) {
    // no-transform / X-Accel-Buffering: proxies (Cloudflare included) pass each step on at once
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
  }
  const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  return {
    progress(stage) {
      if (streaming) event('progress', { stage });
    },
    send(status, body) {
      if (!streaming) return res.status(status).json(body);
      event('result', { status, ...body });
      res.end();
    },
  };
}

// One line for Claude about what the last answer's queries returned
function describeResults(sections) {
  return sections
    .map(s => `${s.entity} query returned ${s.rows.length} ${s.rows.length === 1 ? 'row' : 'rows'}`)
    .join('; ') + '.';
}

// Cube checks a token signed with CUBEJS_API_SECRET on every request; this
// server signs its own, good for an hour, and makes a new one before then
const CUBE_URL = process.env.CUBE_API_URL || 'http://localhost:4000/cubejs-api/v1/load';
const CUBE_TOKEN_TTL_S = 60 * 60;
let cubeTokenCache = { token: null, renewAt: 0 };
function cubeToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cubeTokenCache.token && now < cubeTokenCache.renewAt) return cubeTokenCache.token;
  if (!process.env.CUBEJS_API_SECRET) throw new Error('CUBEJS_API_SECRET is not set, so Cube cannot be asked anything');
  const body = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ iat: now, exp: now + CUBE_TOKEN_TTL_S })}`;
  const token = `${body}.${createHmac('sha256', process.env.CUBEJS_API_SECRET).update(body).digest('base64url')}`;
  cubeTokenCache = { token, renewAt: now + CUBE_TOKEN_TTL_S - 10 * 60 };
  return token;
}

// A query Cube is still running answers "Continue wait": the same request is
// sent again (as Cube's own clients do) until it's done, for up to 2 minutes
const CUBE_CONTINUE_WAIT_MS = 2 * 60 * 1000;

// Step 2: validated Cube query -> rows
async function runCubeQuery(cubeQuery) {
  const giveUpAt = Date.now() + CUBE_CONTINUE_WAIT_MS;
  for (;;) {
    const cubeResponse = await fetchWithRetry(
      CUBE_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': cubeToken(),
        },
        body: JSON.stringify({ query: cubeQuery }),
      }
    );

    const contentType = cubeResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error('Cube.dev is still initializing its internal model registry. Try again in a few seconds.');
    }
    const data = await cubeResponse.json();
    if (data.error === 'Continue wait' && Date.now() < giveUpAt) {
      await new Promise(res => setTimeout(res, 500));
      continue;
    }
    if (data.error) throw new Error(`Cube Engine Error: ${data.error}`);
    return data.data || [];
  }
}

app.post('/api/query', async (req, res) => {
  const { userPrompt } = req.body;
  if (!userPrompt || typeof userPrompt !== 'string') {
    return res.status(400).json({ error: 'userPrompt parameter is required.' });
  }

  // Questions from one session run in order, so the conversation history
  // can't interleave if the user sends a second one before the first returns
  const session = req.session;
  const reply = queryReply(req, res);
  // What the page was sent, kept so the saved chat can show it again
  let sent = null;
  const recorded = { progress: reply.progress, send: (status, body) => { sent = body; return reply.send(status, body); } };
  await queued(session, async () => {
    await answerQuestion(session.conversation, userPrompt, recorded, req.user, req.scope, req.runQuery);
    if (!sent) return;
    session.transcript.push({ question: userPrompt, reply: sent, askedAt: new Date().toISOString() });
    await saveSessionChat(session, req.user);
  });
});

// scope / runQuery: the tickets this person may see, and Cube limited to them
// (teams.mjs). The translation is the same for everyone; what it finds isn't.
async function answerQuestion(conversation, userPrompt, reply, user, scope, runQuery) {
  const started = Date.now();
  // Set once Claude's answer is in the conversation; from then on, whatever
  // happens to the query is reported to Claude with the next question
  let remembered = false;
  const cacheKey = answerCacheKey(conversation, userPrompt);
  const cached = cachedAnswer(cacheKey);

  try {
    console.log(`\n💬 Processing prompt: "${userPrompt}" (turn ${conversation.turns + 1})`);

    // A question naming only tickets they don't have permission to see isn't
    // answered, and isn't sent to Claude
    const asked = await namedTickets(scope, ticketsNamedIn(userPrompt));
    if (asked.forbidden.length && !asked.theirs.length) {
      console.log(`🔒 Not answered: ${user.username} may not see ${asked.forbidden.join(', ')}`);
      return reply.send(200, {
        intent: 'denied', message: permissionDenied(asked.forbidden), assumptions: [], sections: [], results: [],
        elapsedMs: Date.now() - started, fromCache: false,
      });
    }

    let parsed, memoryReset = false, fresh = null;
    if (cached) {
      // The conversation gets the original question and Claude's original reply,
      // so follow-ups build on exactly the history Claude produced
      reply.progress('cached');
      conversation.messages.push(cached.userTurn, { role: 'assistant', content: cached.content });
      conversation.turns += 1;
      parsed = cached.parsed;
      console.log('⚡ Asked before: reusing the earlier translation (no Claude call)');
    } else {
      reply.progress('understanding');
      const t = await translateToQuery(conversation, userPrompt);
      ({ parsed, memoryReset } = t);
      fresh = { userTurn: t.userTurn, content: t.content, parsed };
      console.log(`🧠 tokens in=${t.usage.input_tokens} cached=${t.usage.cache_read_input_tokens ?? 0} out=${t.usage.output_tokens}`);
    }
    remembered = true;
    // Timing and whether Claude was skipped, for the page's "Answered in …" line
    const timing = () => ({ elapsedMs: Date.now() - started, fromCache: Boolean(cached) });

    const verdict = normalizeAndValidate(parsed);
    if (!verdict.ok) {
      console.warn('⚠️ Rejected by validator:', verdict.error, JSON.stringify(parsed));
      conversation.pendingNote = `it was rejected before running: ${verdict.error}`;
      return reply.send(400, {
        error: `I couldn't map that question onto the data: ${verdict.error}`,
        aiInterpretation: parsed,
      });
    }

    if (verdict.intent !== 'query') {
      // clarify / unsupported: nothing to run, hand the explanation back
      console.log(`🙋 ${verdict.intent}: ${verdict.message}`);
      if (fresh && cacheKey) rememberAnswer(cacheKey, fresh);
      return reply.send(200, {
        intent: verdict.intent,
        message: verdict.message,
        assumptions: verdict.assumptions,
        memoryReset,
        sections: [],
        results: [],
        ...timing(),
      });
    }

    // The tickets the question names, or its queries look for by number (a
    // follow-up's "its parent"): none theirs and some in the data -> not answered
    const named = await namedTickets(scope, [...asked.theirs, ...asked.forbidden, ...ticketsFilteredOn(verdict.queries)]);
    if (named.forbidden.length && !named.theirs.length) {
      console.log(`🔒 Not run: ${user.username} may not see ${named.forbidden.join(', ')}`);
      conversation.pendingNote = `nothing was run: the user doesn't have permission to see ${listOf(named.forbidden)}, and was told so`;
      if (fresh && cacheKey) rememberAnswer(cacheKey, fresh);
      return reply.send(200, { intent: 'denied', message: permissionDenied(named.forbidden), assumptions: [], memoryReset, sections: [], results: [], ...timing() });
    }

    // One Cube query per ticket type, run side by side. Meanwhile: would they
    // also find tickets the person can't see? (Named ones they can't are left out anyway.)
    reply.progress('querying');
    for (const q of verdict.queries) console.log(`🤖 Cube query [${q.entity}]:`, JSON.stringify(q.cubeQuery));
    const [sections, hiddenEach] = await Promise.all([
      Promise.all(verdict.queries.map(async q => ({ entity: q.entity, rows: await runQuery(q.cubeQuery) }))),
      named.forbidden.length ? verdict.queries.map(() => true) : hiddenTicketsMatch(verdict.queries, scope),
    ]);
    // true / false, or null when it couldn't be checked
    const hidden = hiddenEach && hiddenEach.some(Boolean);
    // Nothing found: work out why (which filter emptied it, what dates the data
    // covers) and have Claude say so plainly, instead of a bare "no records".
    // A repeated question reuses the explanation it got the first time, for
    // the same set of visible tickets only (the reasons differ between people).
    // A query that only found nothing because what matches isn't theirs needs no
    // explaining: the permission notice says so (permissionNote).
    const emptyQueries = verdict.queries.filter((_, i) => isEmptyResult(sections[i].rows));
    const toExplain = emptyQueries.filter(q => hiddenEach?.[verdict.queries.indexOf(q)] !== true);
    let explanation = cached?.explanations?.[scope.key] ?? null;
    if (toExplain.length && !explanation && !scope.all && !scope.count) {
      // No tickets at all: nothing to diagnose, and no reason to ask Claude
      explanation = teams.scopeNote(scope);
    } else if (toExplain.length && !explanation) {
      reply.progress('explaining');
      try {
        const facts = (await Promise.all(toExplain.map(q => diagnoseEmpty(q.entity, q.cubeQuery, runQuery)))).flat();
        // Checked: no ticket anywhere matches, so it isn't about permissions.
        // Not checked: all that's known is that they only see some tickets.
        if (!scope.all && hiddenEach) facts.push('No ticket in the whole data matches either, not even one this person cannot see: say plainly that the data has none, without mentioning permissions.');
        else if (!scope.all) facts.push(`This person only sees some tickets: ${teams.scopeNote(scope)}`);
        console.log('🔎 Empty result facts:\n   ' + facts.join('\n   '));
        explanation = await explainEmpty({ anthropic, model: CLAUDE_MODEL, question: userPrompt, searchedFor: verdict.message, facts });
        console.log(`🔎 Explained: ${explanation}`);
        if (cached) cached.explanations = { ...cached.explanations, [scope.key]: explanation };
      } catch (error) {
        console.error('🔎 Could not diagnose the empty result:', error.message);
      }
    }
    if (!toExplain.length) explanation = null;
    // Not the full report: matching tickets that aren't theirs were left out
    const restricted = permissionNote({ forbidden: named.forbidden, hidden, empty: emptyQueries.length === verdict.queries.length, scope });
    conversation.pendingNote = describeResults(sections) + (explanation ? ` What the user was told about the empty result: ${explanation}` : '') +
      (restricted ? ` The user was also told: ${restricted}` : '');

    // Counts across several ticket types become one table with a total column
    const combined = verdict.merge ? combineResults(verdict.merge, verdict.queries, sections) : null;

    // Only an answer that ran all the way through is worth reusing
    if (fresh && cacheKey) rememberAnswer(cacheKey, { ...fresh, explanations: explanation ? { [scope.key]: explanation } : {} });

    // The tickets in this answer join the person's "Ticket results" on Home.
    // Saved before the answer goes out, so the page can show the list at once;
    // a failure here only costs the list, never the answer.
    const shownTickets = ticketNumbersIn(sections.flatMap(s => s.rows));
    if (shownTickets.length) {
      await seen.recordSeen(user.id, shownTickets, userPrompt)
        .catch(error => console.error('🎫 Could not remember the shown tickets:', error.message));
    }

    // A count of one ticket type by one field can be shown as a chart, and saved as one
    const chartable = verdict.queries.length === 1 ? chartFromQuery(verdict.queries[0].entity, verdict.queries[0].cubeQuery) : null;

    reply.send(200, {
      intent: 'query',
      // `entity` / `results` describe the single-type case; `sections` and
      // `combined` describe questions that spanned several ticket types
      entity: sections.length === 1 ? sections[0].entity : 'multiple',
      message: verdict.message,
      assumptions: verdict.assumptions,
      memoryReset,
      aiInterpretation: verdict.queries,
      results: sections.length === 1 ? sections[0].rows : [],
      sections,
      combined,
      // Why nothing (or part of it) was found; allEmpty means there's no table to show
      explanation,
      allEmpty: emptyQueries.length === verdict.queries.length,
      // Ticket numbers in this answer (now in the person's Ticket results)
      shownTickets,
      // { chart, dropped }: the answer as a saveable chart (charts.mjs), or null
      chartable,
      // Not the full report: tickets they don't have permission to see match too
      restricted,
      // Which tickets it covered, for anyone who isn't an admin (teams.mjs),
      // unless the notice above says it, or nothing that isn't theirs matched
      visibility: restricted || hidden === false ? null : teams.scopeNote(scope),
      ...timing(),
    });

  } catch (error) {
    if (remembered) conversation.pendingNote = `it failed when run: ${error.message}`;
    if (error instanceof Anthropic.APIError) {
      console.error(`📋 Claude API error ${error.status}:`, error.message);
      return reply.send(502, { error: `Claude API error (${error.status}). Please try again.` });
    }
    console.error('📋 Execution Failure Context:', error);
    reply.send(500, { error: 'Something went wrong answering that. Please try again.' });
  }
}

// =====================================================================
// HOME PAGE: ticket search (see tickets.mjs) and each person's starred
// tickets (see stars.mjs)
// =====================================================================

// { text, record } -> the tickets the text names; with record: true and a
// single ticket found, also its full record
app.post('/api/tickets/search', async (req, res) => {
  const { text, record } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Type a ticket number to search for.' });
  if (text.length > 20000) return res.status(400).json({ error: 'That is too much text to search; paste at most a few hundred ticket numbers.' });

  try {
    const result = await findTickets(text, req.runQuery);
    result.noAccess = await noAccessTo(req.scope, result.notFound);
    if (record && result.found.length === 1) {
      // Without the full record the page still shows the ticket's summary row
      result.record = await ticketRecord(result.found[0].number, req.runQuery, {
        cubeUrl: CUBE_URL,
        token: cubeToken(),
      }).catch(error => {
        console.error(`🔎 Could not load the full record of ${result.found[0].number}:`, error.message);
        return null;
      });
    }
    console.log(`🔎 ${req.user.username} searched ${result.found.length} found, ${result.notFound.length} not found`);
    res.json(result);
  } catch (error) {
    console.error('🔎 Ticket search failed:', error.message);
    res.status(502).json({ error: `Could not search the tickets right now. Please try again.` });
  }
});

// Of the numbers someone couldn't open, the ones in the data all the same: other
// people's or other teams' tickets. The page says they don't have permission to
// see those, and nothing else about them. An admin sees every ticket, so none.
const FULL_NUMBER = /^(INC|CHG|RITM|SCTASK|REQ)\d{7}$/;
async function noAccessTo(scope, numbers) {
  const full = numbers.filter(n => FULL_NUMBER.test(n));
  if (scope.all || !full.length) return [];
  try {
    return [...inTheData(await loadTicketIndex(runCubeQuery), full)];
  } catch (error) {
    console.error('🔒 Could not check which tickets are someone else\'s:', error.message);
    return []; // the page says "not in the data", as before
  }
}

// ---------------------------------------------------------------------
// THE AI ASSISTANT AND PERMISSIONS: its queries only ever see the person's
// tickets (req.runQuery). On top of that, a question about tickets they don't
// have permission to see isn't answered, and an answer that leaves out
// matching tickets that aren't theirs says so.
// ---------------------------------------------------------------------

// "A", "A and B", "A, B and C"
const listOf = items => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// The full ticket numbers a question names ("INC1814467", "inc 1814467"; bare
// digits are left to Claude) and that its queries filter on
const ticketsNamedIn = text => parseTicketNumbers(text).wanted.filter(w => w.candidates.length === 1).map(w => w.input);
const ticketsFilteredOn = queries => queries.flatMap(q => (q.cubeQuery.filters || [])
  .flatMap(f => (f.values || []).flatMap(v => String(v).toUpperCase().match(/\b(INC|CHG|RITM|SCTASK|REQ)\d{7}\b/g) || [])));

// Ticket numbers someone asked about -> { theirs, forbidden }: the ones they
// may see (an order: one of its requests), and the ones in the data they don't
// have permission to see. A number in neither isn't in the data.
async function namedTickets(scope, numbers) {
  const unique = [...new Set(numbers)];
  if (scope.all || !unique.length) return { theirs: unique, forbidden: [] };
  const theirs = unique.filter(n => teams.canSeeTicket(scope, n));
  try {
    const index = await loadTicketIndex(runCubeQuery);
    const orders = unique.filter(n => n.startsWith('REQ'));
    for (const t of orders.length ? index.values() : []) {
      if (t.kind === 'RITM' && orders.includes(t.parent) && !theirs.includes(t.parent) && teams.canSeeTicket(scope, t.number)) theirs.push(t.parent);
    }
    return { theirs, forbidden: [...inTheData(index, unique.filter(n => !theirs.includes(n)))] };
  } catch (error) {
    // Can't tell: the question goes ahead, and its queries still only see their tickets
    console.error('🔒 Could not check the tickets a question names:', error.message);
    return { theirs, forbidden: [] };
  }
}

// What the person is told when a question is only about tickets they can't see
function permissionDenied(numbers) {
  const one = numbers.length === 1;
  return `You don't have permission to see ${listOf(numbers)}, so I can't answer questions about ${one ? 'it' : 'them'}. ` +
    `Only whoever ${one ? 'it\'s' : 'they\'re'} assigned to, ${one ? 'its' : 'their'} team's project manager and admins can see ${one ? 'it' : 'them'}.`;
}

// Would each of these queries also find tickets the person can't see?
// -> [true / false per query], or null when it couldn't be checked (the
// answer then just says whose tickets it covers, as before)
async function hiddenTicketsMatch(queries, scope) {
  if (scope.all) return queries.map(() => false);
  try {
    return await Promise.all(queries.map(q => teams.findsHiddenTickets(q.cubeQuery, scope, runCubeQuery)));
  } catch (error) {
    console.error('🔒 Could not check for tickets left out of the answer:', error.message);
    return null;
  }
}

// The answer's notice when it isn't the full report, or null
function permissionNote({ forbidden, hidden, empty, scope }) {
  if (forbidden.length) {
    return `You can't see the full report: you don't have permission to see ${listOf(forbidden)}, so ${forbidden.length === 1 ? 'it is' : 'they are'} left out. Only tickets you can see are shown.`;
  }
  if (!hidden) return null;
  if (empty) return 'None of the tickets you can see match this question. Other tickets do, but you don\'t have permission to see them.' + (scope.count ? '' : ` ${teams.scopeNote(scope)}`);
  return `You can't see the full report: some of the tickets that match aren't yours, and you don't have permission to see them. ${teams.scopeNote(scope)}`;
}

// { numbers, conversation } -> { families }: the parent/child, order, task,
// change and problem families those tickets belong to (relations.mjs), with
// what each family's members share and where they differ. conversation: true
// (an AI answer's tickets) also tells Claude about them with the next question.
app.post('/api/tickets/related', async (req, res) => {
  const numbers = Array.isArray(req.body?.numbers) ? req.body.numbers.slice(0, 500).map(String) : [];
  if (!numbers.length) return res.status(400).json({ error: 'No ticket numbers to look at.' });
  try {
    const families = await relatedFamilies(numbers, req.runQuery);
    if (req.body.conversation && families.length) {
      // Queued behind the answer that showed these tickets, and only for that
      // same conversation (not one started by "New chat" in the meantime)
      const session = req.session;
      const conversation = session.conversation;
      queued(session, async () => {
        if (session.conversation !== conversation) return;
        const note = `Related tickets OneTouch showed the user under that answer: ${describeFamilies(families)}`;
        conversation.pendingNote = conversation.pendingNote ? `${conversation.pendingNote} ${note}` : note;
        await saveSessionChat(session, req.user);
      });
    }
    res.json({ families });
  } catch (error) {
    console.error('🔗 Could not find related tickets:', error.message);
    res.status(502).json({ error: `Could not look for related tickets right now. Please try again.` });
  }
});

// =====================================================================
// THE TICKET FAMILIES PAGE (relations.mjs): every family of one kind,
// one family with all its members, and the families a ticket is in
// =====================================================================

// What each family's row shows (relations.mjs familyRow): its anchor ticket's own
// summary, state, priority, team and opening date when this person may see it,
// or else those of the family's tickets they may see. -> function(kind, family row)
async function familyRows(req) {
  const index = await loadTicketIndex(runCubeQuery);
  const canSee = number => teams.canSeeTicket(req.scope, number);
  const made = new Map();
  return (kind, f) => {
    const key = `${kind}|${f.anchor}`;
    if (!made.has(key)) made.set(key, familyRow(kind, f.anchor, index, canSee));
    return made.get(key);
  };
}

// The Families page's columns, as the page shows them, for looking a family up
const FAMILY_LOOKUP_COLUMNS = ['Parent', 'Summary', 'State', 'Priority / Risk', 'Team', 'Opened', 'Family'];
function familyLookupTexts(kind, f, row) {
  const [one, many] = FAMILY_CHILD_NOUNS[kind];
  return {
    Parent: f.anchor,
    Summary: row.summary || blankText('Summary', row),
    State: row.state || blankText('State', row),
    'Priority / Risk': row.level || blankText('Priority / Risk', row),
    Team: row.team || blankText('Team', row),
    Opened: row.opened ? openedText(row.opened) : blankText('Opened', row),
    Family: `${f.children.toLocaleString()} ${f.children === 1 ? one : many}`,
  };
}

function familiesFailed(res, error) {
  console.error('👪 Ticket families failed:', error.message);
  res.status(502).json({ error: `The ticket families could not be loaded right now. Please try again.` });
}

// -> { kinds: { kind: { families, tickets } } }
app.get('/api/families', async (req, res) => {
  try {
    res.json({ kinds: await familySummary(req.runQuery) });
  } catch (error) {
    familiesFailed(res, error);
  }
});

// ?number=INC1813970 -> the families that ticket is in, as list rows
app.get('/api/families/find', async (req, res) => {
  const number = String(req.query.number || '').trim().toUpperCase();
  if (!STARRABLE.test(number)) return res.status(400).json({ error: 'Type a ticket number, like INC1813970, CHG1100098, RITM0440458 or SCTASK0595823.' });
  try {
    const [links, found, rowOf] = await Promise.all([ticketLinks([number], req.runQuery), ticketSummaries([number], req.runQuery), familyRows(req)]);
    const rows = [];
    for (const f of links.get(number)?.families || []) {
      const kind = LINK_KIND[f.kind];
      const entry = (await familyList(kind, req.runQuery)).find(e => e.anchor === f.anchor);
      if (entry) rows.push({ kind, ...entry, row: rowOf(kind, entry) });
    }
    const known = found.has(number);
    res.json({ number, known, noAccess: known ? [] : await noAccessTo(req.scope, [number]), families: rows });
  } catch (error) {
    familiesFailed(res, error);
  }
});

// ?sort=parent|summary|state|level|team|opened|size&dir=asc|desc&offset&limit
// &q=<words>&col=<column>: only the families whose row shows those words
// -> { total, before (the total before that lookup), families: one page of rows,
// each with what it shows } (no sort: the biggest families first)
app.get('/api/families/:kind', async (req, res) => {
  const kind = req.params.kind;
  if (!FAMILY_KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown kind of family.' });
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const by = req.query.sort;
  const dir = req.query.dir === 'desc' ? 'desc' : 'asc';
  const lookup = parseLookup(req.query, FAMILY_LOOKUP_COLUMNS);
  try {
    const [all, rowOf] = await Promise.all([familyList(kind, req.runQuery), familyRows(req)]);
    let list = lookup ? all.filter(f => lookupMatches(familyLookupTexts(kind, f, rowOf(kind, f)), lookup)) : all;
    if (by === 'parent') list = sortRows(list, f => f.anchor, dir);
    else if (by === 'size') list = sortRows(list, f => f.children, dir);
    else if (by === 'level') list = sortRows(list, f => rowOf(kind, f).rank, dir);
    else if (['summary', 'state', 'team', 'opened'].includes(by)) list = sortRows(list, f => rowOf(kind, f)[by], dir);
    res.json({ kind, total: list.length, before: all.length, families: list.slice(offset, offset + limit).map(f => ({ ...f, row: rowOf(kind, f) })) });
  } catch (error) {
    familiesFailed(res, error);
  }
});

// -> { family }: every member, with what they share and where they differ
app.get('/api/families/:kind/:anchor', async (req, res) => {
  try {
    const family = await familyOf(req.params.kind, String(req.params.anchor).toUpperCase(), req.runQuery);
    if (!family) return res.status(404).json({ error: 'That family is not in the data.' });
    res.json({ family });
  } catch (error) {
    familiesFailed(res, error);
  }
});

// Every ticket this person has been shown, newest first, with each one's
// summary, when it was shown, and the question that showed it
app.get('/api/seen-tickets', async (req, res) => {
  try {
    const list = await seen.listSeen(req.user.id);
    const numbers = list.map(s => s.number);
    const [summaries, links] = await Promise.all([ticketSummaries(numbers, req.runQuery), linksOrNone(numbers, req.runQuery)]);
    res.json({ tickets: list.filter(s => summaries.has(s.number)).map(s => ({ ...summaries.get(s.number), ...links.get(s.number), shownAt: s.shownAt, question: s.question })) });
  } catch (error) {
    console.error('🎫 Could not list the shown tickets:', error.message);
    res.status(503).json({ error: 'Your ticket results could not be loaded right now.' });
  }
});

// "Clear ticket results": empties this person's list (their stars stay)
app.delete('/api/seen-tickets', async (req, res) => {
  try {
    const deleted = await seen.clearSeen(req.user.id);
    console.log(`🎫 ${req.user.username} cleared their ticket results (${deleted})`);
    res.json({ ok: true, deleted });
  } catch (error) {
    console.error('🎫 Could not clear the ticket results:', error.message);
    res.status(503).json({ error: 'Your ticket results could not be cleared right now.' });
  }
});

// Each ticket's parent and families (relations.mjs) for a list; if that fails, the
// list still shows, just without them
async function linksOrNone(numbers, runQuery) {
  try {
    return await ticketLinks(numbers, runQuery);
  } catch (error) {
    console.error('🔗 Could not look up parents and families:', error.message);
    return new Map();
  }
}

// { numbers } -> the ones someone ticked leave their Ticket results (the rest stay)
app.post('/api/seen-tickets/remove', async (req, res) => {
  const numbers = (Array.isArray(req.body?.numbers) ? req.body.numbers : []).map(n => String(n).toUpperCase()).filter(n => STARRABLE.test(n)).slice(0, seen.MAX_SEEN);
  if (!numbers.length) return res.status(400).json({ error: 'No tickets to remove.' });
  try {
    const removed = await seen.removeSeen(req.user.id, numbers);
    console.log(`🎫 ${req.user.username} removed ${removed} from their ticket results`);
    res.json({ ok: true, removed });
  } catch (error) {
    console.error('🎫 Could not remove from the ticket results:', error.message);
    res.status(503).json({ error: 'Those tickets could not be removed right now.' });
  }
});

// A ticket record someone opened (clicked a ticket number): it joins their Ticket results
app.post('/api/seen-tickets', async (req, res) => {
  const numbers = (Array.isArray(req.body?.numbers) ? req.body.numbers : []).map(n => String(n).toUpperCase()).filter(n => STARRABLE.test(n)).slice(0, 50);
  if (!numbers.length) return res.status(400).json({ error: 'No ticket numbers to remember.' });
  try {
    await seen.recordSeen(req.user.id, numbers, null);
    res.json({ ok: true });
  } catch (error) {
    console.error('🎫 Could not remember an opened ticket:', error.message);
    res.status(503).json({ error: 'That ticket could not be added to your ticket results right now.' });
  }
});

// Home's "Assigned to me": every ticket assigned to this person in OneTouch,
// most urgent first, then oldest (tickets.mjs ticketsByPriority), each marked
// open or not; the page shows open, closed or all of them
app.get('/api/my-tickets', async (req, res) => {
  try {
    const numbers = await teams.assignedNumbers(req.user.id);
    const tickets = numbers.length ? await ticketsByPriority(numbers, req.runQuery) : [];
    // How much each one's KPIs need attention, so the list sorts by them across every
    // page, and what they say, so it can be looked up by them (the page draws them itself)
    const found = await kpis.ticketKpis(tickets.map(t => t.number), runCubeQuery)
      .catch(error => { console.error('📏 Could not work out the KPIs for sorting:', error.message); return { kpis: {} }; });
    res.json({
      tickets: tickets.map(t => {
        const list = found.kpis[t.number];
        return { ...t, attention: list ? kpis.attention(list) : null, kpiText: list ? list.map(k => `${k.label} ${k.value}`).join(' · ') : '' };
      }),
    });
  } catch (error) {
    console.error('🎫 Could not load the tickets assigned to someone:', error.message);
    res.status(502).json({ error: 'Your tickets could not be loaded right now. Please try again.' });
  }
});

// =====================================================================
// KPIs (kpis.mjs): a ticket's for anyone who may see that ticket (so, for
// most people, only the tickets assigned to them); a family's only for its
// team's project manager or an admin. The KPIs come from every ticket read
// once with a fixed query, and only checked numbers are answered for.
// =====================================================================

// { numbers } (up to 200) -> { asOf, kpis: { number: [kpi] } }, leaving out any this person may not see
app.post('/api/kpis/tickets', async (req, res) => {
  const numbers = [...new Set((Array.isArray(req.body?.numbers) ? req.body.numbers : []).map(n => String(n).toUpperCase()))]
    .filter(n => STARRABLE.test(n) && teams.canSeeTicket(req.scope, n)).slice(0, 200);
  try {
    res.json(await kpis.ticketKpis(numbers, runCubeQuery));
  } catch (error) {
    console.error('📏 Ticket KPIs failed:', error.message);
    res.status(502).json({ error: 'The KPIs could not be worked out right now. Please try again.' });
  }
});

// The columns of Team families on Home, for looking a family up
const TEAM_FAMILY_LOOKUP_COLUMNS = ['Family', 'Tickets', 'KPIs'];

// ?team=<id> (admins; a project manager gets their own)&status=open|all&linked=0|1&offset&limit
// &sort=family|size|kpis&dir=asc|desc&q=<words>&col=<column> -> one page of the team's
// families, most in need of attention first (or in that sort), each with its KPIs
app.get('/api/kpis/families', async (req, res) => {
  try {
    const teamId = Number(req.query.team) || req.scope.access.team?.id;
    if (!teamId) return res.status(403).json({ error: 'You\'re not on a team, so there are no families to show.' });
    const families = await teams.teamFamilies(req.scope, teamId);
    const lookup = parseLookup(req.query, TEAM_FAMILY_LOOKUP_COLUMNS);
    // A family is named after its first ticket and that ticket's summary (the numbers were just checked)
    const index = lookup ? await loadTicketIndex(runCubeQuery) : null;
    const matches = lookup && (f => lookupMatches({
      Family: `${f.id} ${index.get(f.id)?.summary || ''}`,
      Tickets: `${f.size.toLocaleString()} ${f.size === 1 ? 'ticket' : 'tickets'} ${kpis.kindsText(f.kinds)}`,
      KPIs: f.kpis.map(k => `${k.label} ${k.value}`).join(' · '),
    }, lookup));
    const page = await kpis.teamFamilyKpis(families, {
      status: req.query.status === 'all' ? 'all' : 'open',
      linked: req.query.linked !== '0',
      offset: Math.max(Number(req.query.offset) || 0, 0),
      limit: Math.min(Math.max(Number(req.query.limit) || 25, 1), 100),
      sort: ['family', 'size', 'kpis'].includes(req.query.sort) ? req.query.sort : null,
      dir: req.query.dir === 'desc' ? 'desc' : 'asc',
      matches,
    }, runCubeQuery);
    // Each family is named after its first ticket (the numbers were just checked)
    const summaries = await ticketSummaries(page.families.map(f => f.id), runCubeQuery)
      .catch(error => { console.error('📏 Could not load family summaries:', error.message); return new Map(); });
    res.json({ ...page, teamId, families: page.families.map(f => ({ ...f, ticket: summaries.get(f.id) || null })) });
  } catch (error) {
    teamsFailed(res, error, 'Loading the families\' KPIs');
  }
});

// One family: its KPIs, and each of its tickets with who has it and its KPIs
app.get('/api/kpis/families/:id', async (req, res) => {
  try {
    const family = await teams.familyMembers(req.scope, String(req.params.id).toUpperCase());
    const numbers = family.members.map(m => m.number);
    const [found, summaries] = await Promise.all([
      kpis.oneFamilyKpis(family.members, runCubeQuery),
      ticketSummaries(numbers, runCubeQuery).catch(() => new Map()),
    ]);
    // Open ones first, then the most urgent, then the oldest (as Assigned to me)
    const tickets = family.members
      .map(m => {
        const t = { ...summaries.get(m.number), number: m.number, assignee: m.assignee, kpis: found.tickets[m.number] || [] };
        return { ...t, open: t.kind ? isOpen(t) : false, rank: t.kind ? priorityRank(t) : 5 };
      })
      .sort((a, b) => (b.open - a.open) || a.rank - b.rank || String(a.opened || '~').localeCompare(String(b.opened || '~')));
    res.json({ id: family.id, size: family.size, team: family.team, asOf: found.asOf, kpis: found.kpis, tickets });
  } catch (error) {
    teamsFailed(res, error, 'Loading that family\'s KPIs');
  }
});

// ?details=1: also each starred ticket's summary, parent and families (for the
// Starred tickets list), and the stars that can't be shown: not in the data, or
// (noAccess) no longer this person's to see
app.get('/api/stars', async (req, res) => {
  try {
    const list = await stars.listStars(req.user.id);
    if (!req.query.details) return res.json({ stars: list });
    const numbers = list.map(s => s.number);
    const [summaries, links] = await Promise.all([ticketSummaries(numbers, req.runQuery), linksOrNone(numbers, req.runQuery)]);
    const missing = numbers.filter(n => !summaries.has(n));
    const noAccess = await noAccessTo(req.scope, missing);
    res.json({
      stars: list,
      tickets: list.filter(s => summaries.has(s.number)).map(s => ({ ...summaries.get(s.number), ...links.get(s.number), starredAt: s.starredAt })),
      notFound: missing.filter(n => !noAccess.includes(n)),
      noAccess,
    });
  } catch (error) {
    console.error('⭐ Could not list stars:', error.message);
    res.status(503).json({ error: 'Your starred tickets could not be loaded right now.' });
  }
});

// "Star all": { numbers } -> { starred: the ones starred now, full: some didn't fit under the limit }
app.put('/api/stars', async (req, res) => {
  const requested = Array.isArray(req.body?.numbers) ? req.body.numbers : [];
  const numbers = [...new Set(requested.map(n => String(n).toUpperCase()))].filter(n => STARRABLE.test(n)).slice(0, stars.MAX_STARS);
  if (!numbers.length) return res.status(400).json({ error: 'Only incident, change, request and task numbers can be starred.' });
  try {
    const starred = await stars.addStars(req.user.id, numbers);
    res.json({ starred, full: starred.length < numbers.length });
  } catch (error) {
    console.error('⭐ Could not star all:', error.message);
    res.status(503).json({ error: 'Those tickets could not be starred right now.' });
  }
});

// { numbers } -> unstars them all at once (ticked ones, a whole family, or every star)
app.post('/api/stars/remove', async (req, res) => {
  const numbers = (Array.isArray(req.body?.numbers) ? req.body.numbers : []).map(n => String(n).toUpperCase()).filter(n => STARRABLE.test(n)).slice(0, stars.MAX_STARS);
  if (!numbers.length) return res.status(400).json({ error: 'No tickets to unstar.' });
  try {
    res.json({ ok: true, removed: await stars.removeStars(req.user.id, numbers) });
  } catch (error) {
    console.error('⭐ Could not unstar many:', error.message);
    res.status(503).json({ error: 'Those tickets could not be unstarred right now.' });
  }
});

app.put('/api/stars/:number', async (req, res) => {
  const number = String(req.params.number).toUpperCase();
  if (!STARRABLE.test(number)) return res.status(400).json({ error: 'Only incident, change, request and task numbers can be starred.' });
  try {
    if (!await stars.addStar(req.user.id, number)) {
      return res.status(409).json({ error: `You can star at most ${stars.MAX_STARS.toLocaleString()} tickets. Unstar some first.` });
    }
    res.json({ ok: true, number });
  } catch (error) {
    console.error('⭐ Could not star:', error.message);
    res.status(503).json({ error: 'That ticket could not be starred right now.' });
  }
});

app.delete('/api/stars/:number', async (req, res) => {
  const number = String(req.params.number).toUpperCase();
  try {
    await stars.removeStar(req.user.id, number);
    res.json({ ok: true, number });
  } catch (error) {
    console.error('⭐ Could not unstar:', error.message);
    res.status(503).json({ error: 'That ticket could not be unstarred right now.' });
  }
});

// =====================================================================
// PREFERENCES AND CHARTS: each person's colors, Home page and own
// dashboards (prefs.mjs), and the data their charts show (charts.mjs)
// =====================================================================

app.get('/api/preferences', async (req, res) => {
  try {
    res.json({ preferences: await prefs.getPreferences(req.user.id) });
  } catch (error) {
    console.error('🎨 Could not load preferences:', error.message);
    res.status(503).json({ error: 'Your saved layout and colors could not be loaded right now.' });
  }
});

// { value } -> the value as saved (checked and cleaned by prefs.cleanPreference)
app.put('/api/preferences/:part', async (req, res) => {
  let value;
  try {
    value = prefs.cleanPreference(req.params.part, req.body?.value);
  } catch (error) {
    const known = error instanceof prefs.PreferenceError || error instanceof ChartError;
    return res.status(400).json({ error: known ? error.message : 'That setting could not be read.' });
  }
  try {
    await prefs.savePreference(req.user.id, req.params.part, value);
    res.json({ value });
  } catch (error) {
    console.error('🎨 Could not save preferences:', error.message);
    res.status(503).json({ error: 'That change could not be saved right now.' });
  }
});

app.delete('/api/preferences/:part', async (req, res) => {
  if (!prefs.PARTS.includes(req.params.part)) return res.status(400).json({ error: 'Unknown setting.' });
  try {
    await prefs.resetPreference(req.user.id, req.params.part);
    res.json({ ok: true });
  } catch (error) {
    console.error('🎨 Could not reset preferences:', error.message);
    res.status(503).json({ error: 'That could not be reset right now.' });
  }
});

// What the chart builder can offer (ticket types, fields, the dates the data covers)
app.get('/api/charts/catalog', async (req, res) => {
  try {
    res.json(await chartCatalog(req.runQuery));
  } catch (error) {
    console.error('📊 Chart catalog failed:', error.message);
    res.status(502).json({ error: `The chart options could not be loaded right now. Please try again.` });
  }
});

// { chart } -> its numbers
app.post('/api/charts/data', async (req, res) => {
  try {
    res.json(await chartData(req.body?.chart, req.runQuery, req.body?.scope));
  } catch (error) {
    if (error instanceof ChartError) return res.status(400).json({ error: error.message });
    console.error('📊 Chart data failed:', error.message);
    res.status(502).json({ error: `This chart could not be loaded right now. Please try again.` });
  }
});

// { chart, value, scope } -> the tickets behind one bar, slice or point
// (value null: "(Not set)"; a chart with no grouping: all of its tickets)
app.post('/api/charts/tickets', async (req, res) => {
  try {
    res.json(await chartTickets(req.body?.chart, req.body?.value ?? null, req.runQuery, req.body?.scope));
  } catch (error) {
    if (error instanceof ChartError) return res.status(400).json({ error: error.message });
    console.error('📊 Chart tickets failed:', error.message);
    res.status(502).json({ error: `Those tickets could not be loaded right now. Please try again.` });
  }
});

// Every team (for a dashboard's Team filter)
app.get('/api/charts/teams', async (req, res) => {
  try {
    res.json({ values: await teamValues(req.runQuery) });
  } catch (error) {
    console.error('📊 Team list failed:', error.message);
    res.status(502).json({ error: `The teams could not be loaded right now. Please try again.` });
  }
});

// =====================================================================
// SHARED DASHBOARDS (shares.mjs): a link to a copy of someone's dashboard
// =====================================================================

app.get('/api/shares', async (req, res) => {
  try {
    res.json({ shares: await shares.listShares(req.user.id) });
  } catch (error) {
    console.error('🔗 Could not list shares:', error.message);
    res.status(503).json({ error: 'Your shared dashboards could not be loaded right now.' });
  }
});

// { board } -> { token }: shares it, or updates what its link shows
app.put('/api/shares', async (req, res) => {
  try {
    const token = await shares.shareBoard(req.user.id, req.body?.board);
    res.json({ token });
  } catch (error) {
    if (error instanceof shares.ShareError || error instanceof ChartError) return res.status(400).json({ error: error.message });
    console.error('🔗 Could not share:', error.message);
    res.status(503).json({ error: 'That dashboard could not be shared right now.' });
  }
});

app.get('/api/shares/:token', async (req, res) => {
  try {
    const share = await shares.getShare(String(req.params.token), req.user.id);
    if (!share) return res.status(404).json({ error: 'That shared dashboard no longer exists. Its owner may have stopped sharing it.' });
    res.json(share);
  } catch (error) {
    console.error('🔗 Could not open a share:', error.message);
    res.status(503).json({ error: 'That shared dashboard could not be loaded right now.' });
  }
});

app.delete('/api/shares/:token', async (req, res) => {
  try {
    if (!await shares.unshare(req.user.id, String(req.params.token))) return res.status(404).json({ error: 'That link is not one of yours.' });
    res.json({ ok: true });
  } catch (error) {
    console.error('🔗 Could not stop sharing:', error.message);
    res.status(503).json({ error: 'That could not be done right now.' });
  }
});

// { source, field } -> the values a filter can choose from
app.post('/api/charts/values', async (req, res) => {
  try {
    res.json({ values: await chartValues(String(req.body?.source), String(req.body?.field), req.runQuery) });
  } catch (error) {
    if (error instanceof ChartError) return res.status(400).json({ error: error.message });
    console.error('📊 Filter values failed:', error.message);
    res.status(502).json({ error: `The choices could not be loaded right now. Please try again.` });
  }
});

// =====================================================================
// TEAMS (teams.mjs): the teams and their people, each team's tickets and
// who has them, and the changes admins and project managers make
// =====================================================================

function teamsFailed(res, error, what) {
  if (error instanceof teams.AccessError) return res.status(403).json({ error: error.message });
  console.error(`👥 ${what} failed:`, error.message);
  res.status(503).json({ error: `${what} could not be done right now.` });
}

app.get('/api/teams', async (req, res) => {
  try {
    res.json(await teams.listTeams(req.scope));
  } catch (error) {
    teamsFailed(res, error, 'Loading the teams');
  }
});

// A Team tab list's ?sort=&dir= and ?q=&col=, over what each ticket's summary
// says (teams.mjs checks the numbers before it sorts or looks them up).
// sorts: the ?sort= values it takes (teams.mjs orders 'family', 'assignee'
// and 'team' itself). textsOf(row, summary): what each column shows.
// -> { sort, matches } for teams.teamTickets / teams.unassignedTickets
async function teamListOptions(query, columns, sorts, textsOf) {
  const lookup = parseLookup(query, columns);
  const index = lookup || ['type', 'summary', 'state'].includes(query.sort) ? await loadTicketIndex(runCubeQuery) : null;
  let sort = null;
  if (sorts.includes(query.sort)) {
    const by = query.sort;
    sort = {
      by, dir: query.dir === 'desc' ? 'desc' : 'asc',
      valueOf: number => (by === 'number' ? number : index.has(number) ? TICKET_SORTS[by](index.get(number)) : null),
    };
  }
  const matches = lookup && (r => lookupMatches(textsOf(r, index.get(r.number) || {}), lookup));
  return { sort, matches };
}

// The Team tab's ticket columns, for looking tickets up
const TEAM_TICKET_LOOKUP_COLUMNS = ['Ticket', 'Type', 'Summary', 'State', 'Family', 'Assigned to'];
const UNASSIGNED_LOOKUP_COLUMNS = ['Ticket', 'Type', 'Summary', 'State', 'Family', 'Team'];

// Admins: every ticket nobody has yet, on any team or on none, family by family
// (the Team tab's "Not assigned yet"). ?team=<team id>|none&kind=INC&q=&col=&offset&limit
// &sort=number|type|summary|state|family|team&dir=asc|desc -> { total, before, tickets,
// families }: one page of tickets with each one's summary and team, and the page's
// families, each with what its first ticket is about
const UNASSIGNED_SORTS = ['number', 'type', 'summary', 'state', 'family', 'team'];
app.get('/api/teams/unassigned/tickets', async (req, res) => {
  try {
    const { sort, matches } = await teamListOptions(req.query, UNASSIGNED_LOOKUP_COLUMNS, UNASSIGNED_SORTS, (r, t) => ({
      Ticket: r.number, Type: t.type, Summary: t.summary || blankText('Summary', t), State: t.state || blankText('State', t),
      Family: r.familySize > 1 ? `${r.familyId} · ${r.familySize.toLocaleString()} linked tickets` : 'On its own',
      Team: r.team || 'No team',
    }));
    const page = await teams.unassignedTickets(req.scope, {
      team: req.query.team || null, kind: req.query.kind || null, matches,
      offset: req.query.offset, limit: req.query.limit, sort,
    });
    // An admin's: every number may be seen, so the summaries come straight from Cube
    const families = Object.values(page.families);
    const summaries = await ticketSummaries([...page.tickets.map(t => t.number), ...families.map(f => f.id)], runCubeQuery)
      .catch(error => { console.error('👥 Could not load ticket summaries:', error.message); return new Map(); });
    res.json({
      total: page.total, before: page.before,
      tickets: page.tickets.map(t => ({ ...summaries.get(t.number), ...t })),
      families: families.map(f => ({ ...f, summary: summaries.get(f.id)?.summary || null })),
    });
  } catch (error) {
    teamsFailed(res, error, 'Loading the tickets nobody has');
  }
});

// ?assignee=<user id>|none&kind=INC&q=<words>&col=<column>&offset&limit -> { total, before, tickets }:
// one page of a team's tickets with who has each one, and each one's summary
// ...&sort=number|type|summary|state|family|assignee&dir=asc|desc: every match in that order, then the page
const TEAM_TICKET_SORTS = ['number', 'type', 'summary', 'state', 'family', 'assignee'];
app.get('/api/teams/:id/tickets', async (req, res) => {
  try {
    const { sort, matches } = await teamListOptions(req.query, TEAM_TICKET_LOOKUP_COLUMNS, TEAM_TICKET_SORTS, (r, t) => ({
      Ticket: r.number, Type: t.type, Summary: t.summary || blankText('Summary', t), State: t.state || blankText('State', t),
      Family: r.familySize > 1 ? `${r.familySize.toLocaleString()} linked tickets` : 'On its own',
      'Assigned to': r.assignee || 'Not assigned',
    }));
    const page = await teams.teamTickets(req.scope, Number(req.params.id), {
      assignee: req.query.assignee || null, kind: req.query.kind || null, matches,
      offset: req.query.offset, limit: req.query.limit, sort,
    });
    // The numbers are already this person's to see, so their summaries come straight from Cube
    const summaries = await ticketSummaries(page.tickets.map(t => t.number), runCubeQuery)
      .catch(error => { console.error('👥 Could not load ticket summaries:', error.message); return new Map(); });
    res.json({ total: page.total, before: page.before, tickets: page.tickets.map(t => ({ ...summaries.get(t.number), ...t })) });
  } catch (error) {
    teamsFailed(res, error, 'Loading the team\'s tickets');
  }
});

// { numbers, assigneeId } (null: nobody) -> { changed }
app.put('/api/assignments', async (req, res) => {
  try {
    const assigneeId = req.body?.assigneeId ?? null;
    const changed = await teams.assignTickets(req.scope, req.body?.numbers, assigneeId);
    console.log(`👥 ${req.user.username} assigned ${changed} tickets to user ${assigneeId ?? '(nobody)'}`);
    res.json({ changed });
  } catch (error) {
    teamsFailed(res, error, 'Assigning those tickets');
  }
});

// Admins: { teamId (null: off their team, and no role), role } for one person
// -> { unassigned }: how many of their tickets went back to the team
app.put('/api/teams/members/:userId', async (req, res) => {
  try {
    const teamId = req.body?.teamId == null ? null : Number(req.body.teamId);
    const { unassigned } = await teams.setMembership(req.scope, Number(req.params.userId), teamId, req.body?.role);
    console.log(teamId === null
      ? `👥 ${req.user.username} took user ${req.params.userId} off their team (${unassigned} tickets unassigned)`
      : `👥 ${req.user.username} put user ${req.params.userId} on team ${teamId} as ${req.body?.role}`);
    res.json({ ok: true, unassigned });
  } catch (error) {
    teamsFailed(res, error, 'Changing that person\'s team');
  }
});

// Admins: ?number=INC1813970 -> { family }: the linked group that ticket is in, and its team
app.get('/api/ticket-families', async (req, res) => {
  try {
    const family = await teams.familyOfTicket(req.scope, req.query.number);
    if (!family) return res.status(404).json({ error: 'That ticket isn\'t in the data.' });
    res.json({ family });
  } catch (error) {
    teamsFailed(res, error, 'Finding that family');
  }
});

// Admins: { teamId } -> the whole family moves to that team -> { moved }
// A project manager (their team's families) or an admin: { assigneeId } (null:
// nobody) gets every ticket in the family -> { changed }
app.put('/api/ticket-families/:id/assignee', async (req, res) => {
  try {
    const assigneeId = req.body?.assigneeId ?? null;
    const changed = await teams.assignFamily(req.scope, String(req.params.id).toUpperCase(), assigneeId);
    console.log(`👥 ${req.user.username} gave family ${req.params.id} (${changed} tickets changed) to user ${assigneeId ?? '(nobody)'}`);
    res.json({ changed });
  } catch (error) {
    teamsFailed(res, error, 'Assigning that family');
  }
});

app.put('/api/ticket-families/:id/team', async (req, res) => {
  try {
    const moved = await teams.moveFamily(req.scope, String(req.params.id).toUpperCase(), Number(req.body?.teamId));
    console.log(`👥 ${req.user.username} moved family ${req.params.id} (${moved} tickets) to team ${req.body?.teamId}`);
    res.json({ moved });
  } catch (error) {
    teamsFailed(res, error, 'Moving that family');
  }
});

// Anyone on a team: { number, status: resolved|closed, note } tells their
// project manager. Only a notification: the ticket itself doesn't change. -> { told }
app.post('/api/tickets/report', async (req, res) => {
  try {
    const { told } = await teams.reportTicket(req.scope, req.body?.number, req.body?.status, req.body?.note);
    console.log(`👥 ${req.user.username} told ${told.length} project manager(s) they ${req.body?.status} ${req.body?.number}`);
    res.json({ told });
  } catch (error) {
    teamsFailed(res, error, 'Telling your project manager');
  }
});

// Resolved or closed (teams.mjs): every team's for admins, a project manager's
// own team's -> { tickets: [{ number, status, by, at, note, team, assignee, type, summary, state }] }
app.get('/api/ticket-statuses', async (req, res) => {
  try {
    const list = await teams.ticketStatuses(req.scope);
    const summaries = await ticketSummaries(list.map(t => t.number), req.runQuery);
    res.json({
      tickets: list.map(t => {
        const s = summaries.get(t.number);
        return { ...t, type: s?.type ?? null, summary: s?.summary ?? null, state: s?.state ?? null };
      }),
    });
  } catch (error) {
    teamsFailed(res, error, 'Loading the resolved and closed tickets');
  }
});

// An admin or the ticket's team's project manager: { status: resolved|closed|open } -> { number, status }
app.put('/api/ticket-statuses/:number', async (req, res) => {
  try {
    const done = await teams.setTicketStatus(req.scope, req.params.number, req.body?.status);
    console.log(`✅ ${req.user.username} set ${done.number} to ${done.status}`);
    res.json(done);
  } catch (error) {
    teamsFailed(res, error, 'Changing the status');
  }
});

// Admins, before a presentation: every status undone -> { tickets, notifications }
app.post('/api/ticket-statuses/undo-all', async (req, res) => {
  try {
    const done = await teams.undoAllStatuses(req.scope);
    console.log(`✅ ${req.user.username} undid every status: ${done.tickets} tickets, ${done.notifications} notifications`);
    res.json(done);
  } catch (error) {
    teamsFailed(res, error, 'Undoing the statuses');
  }
});

// Admins, before a presentation: the demo tickets back on no team, nobody's -> { tickets, families }
app.post('/api/demo-tickets/reset', async (req, res) => {
  try {
    const done = await teams.resetDemoTickets(req.scope);
    console.log(`🎬 ${req.user.username} put the ${done.tickets} demo tickets back`);
    res.json(done);
  } catch (error) {
    teamsFailed(res, error, 'Putting the demo tickets back');
  }
});

// =====================================================================
// NOTIFICATIONS (notifications.mjs): the 🔔 in the header
// =====================================================================

// -> { unread, notifications: newest first }
app.get('/api/notifications', async (req, res) => {
  try {
    res.json(await notifications.listNotifications(req.user.id));
  } catch (error) {
    console.error('🔔 Loading notifications failed:', error.message);
    res.status(503).json({ error: 'Your notifications could not be loaded right now.' });
  }
});

// { ids } (none: all of them) -> { read }
app.post('/api/notifications/read', async (req, res) => {
  try {
    res.json({ read: await notifications.markRead(req.user.id, req.body?.ids ?? null) });
  } catch (error) {
    console.error('🔔 Marking notifications read failed:', error.message);
    res.status(503).json({ error: 'That could not be saved right now.' });
  }
});

// { ids } (some of them) or { upTo } (all of them up to that one) -> { cleared }
app.post('/api/notifications/clear', async (req, res) => {
  const { ids, upTo } = req.body || {};
  const some = Array.isArray(ids) && ids.length > 0;
  if (!some && !Number.isInteger(upTo)) return res.status(400).json({ error: 'Say which notifications to clear.' });
  try {
    res.json({ cleared: await notifications.clearNotifications(req.user.id, some ? { ids } : { upTo }) });
  } catch (error) {
    console.error('🔔 Clearing notifications failed:', error.message);
    res.status(503).json({ error: 'Your notifications could not be cleared right now.' });
  }
});

// The tables shown in the chat -> a downloadable file (see export.mjs)
app.post('/api/export', async (req, res) => {
  const problem = validateExport(req.body);
  if (problem) return res.status(400).json({ error: problem });

  try {
    const { buffer, fileName, contentType } = await buildExport(req.body);
    console.log(`📥 Export ${req.body.format}: ${fileName} (${buffer.length.toLocaleString()} bytes)`);
    res.attachment(fileName);
    res.type(contentType);
    res.send(buffer);
  } catch (error) {
    if (error instanceof ExportUnavailableError) {
      return res.status(501).json({ error: error.message });
    }
    console.error('📥 Export failed:', error);
    res.status(500).json({ error: `Could not create the ${req.body.format.toUpperCase()} file. Please try again.` });
  }
});

app.listen(port, () => {
  console.log(`🚀 Node.js Orchestrator live on port ${port} (model: ${CLAUDE_MODEL})`);
});

// Account setup: create the tables if this is a fresh database, then load the
// shared accounts file (db/accounts.json) so a fresh clone has everyone's
// sign-ins. Retries, because on first start Postgres is still initializing.
async function prepareAccounts(attempt = 1) {
  try {
    await auth.ensureSchema();
    await stars.ensureStarsSchema();
    await seen.ensureSeenSchema();
    await prefs.ensurePrefsSchema();
    await shares.ensureSharesSchema();
    await chats.ensureChatsSchema();
    await teams.ensureTeamsSchema();
    await notifications.ensureNotificationsSchema();
  } catch (error) {
    const wait = Math.min(attempt * 2, 15);
    console.error(`🔐 Account database not reachable yet (${error.message}); retrying in ${wait}s`);
    setTimeout(() => prepareAccounts(attempt + 1), wait * 1000).unref();
    return;
  }
  // Notifications go out by email too, once the tables are there (off without a Brevo key)
  startMail();
  try {
    const off = await teams.takeTestAccountsOffTeams();
    if (off) console.log(`👥 Took the test accounts off their teams (${off.people.join(', ')}); ${off.tickets.toLocaleString()} of their tickets are now unassigned`);
  } catch (error) {
    console.error('👥 Could not take the test accounts off their teams:', error.message);
  }

  const file = process.env.ACCOUNTS_FILE ?? auth.DEFAULT_ACCOUNTS_FILE;
  if (file && existsSync(file)) {
    try {
      const r = await auth.syncAccounts(JSON.parse(readFileSync(file, 'utf8')));
      if (r.added.length || r.updated.length) {
        console.log(`🔐 Loaded ${file}: ${r.added.length} accounts added, ${r.updated.length} updated`);
      }
      if (r.invalid.length) console.warn(`🔐 ${file}: skipped ${r.invalid.join('; ')}`);
    } catch (error) {
      console.error(`🔐 Could not load ${file}: ${error.message}`);
    }
  }

  const users = await auth.listUsers();
  console.log(users.length
    ? `🔐 Account database ready (${users.length} ${users.length === 1 ? 'account' : 'accounts'})`
    : '🔐 Account database ready, but it has no accounts yet. Add one with: docker exec -it analytics_node_app node scripts/users.mjs add <username>');
  seedTeamsWhenReady();
}
prepareAccounts();

// First start with teams: sets them up from every ticket in Cube (teams.mjs).
// Retries, because Cube may still be starting.
async function seedTeamsWhenReady(attempt = 1) {
  try {
    const seeded = await teams.seedTeams(runCubeQuery);
    if (seeded) console.log(`👥 Set up ${seeded.teams} teams: ${seeded.people} people, ${seeded.families.toLocaleString()} families, ${seeded.tickets.toLocaleString()} tickets`);
    // Cube answers: read every ticket's KPI fields now, so the first Home page doesn't wait
    const t0 = Date.now();
    kpis.load(runCubeQuery)
      .then(d => console.log(`📏 KPIs ready: ${d.tickets.size.toLocaleString()} tickets in ${((Date.now() - t0) / 1000).toFixed(1)}s`))
      .catch(error => console.error(`📏 Could not read the tickets for KPIs yet (${error.message}); the first page that needs them tries again`));
    // And their summaries, for sorting long lists by any column
    loadTicketIndex(runCubeQuery)
      .then(index => console.log(`↕️  Sorting ready: ${index.size.toLocaleString()} tickets in ${((Date.now() - t0) / 1000).toFixed(1)}s`))
      .catch(error => console.error(`↕️  Could not read the tickets for sorting yet (${error.message}); the first sorted list tries again`));
  } catch (error) {
    const wait = Math.min(attempt * 5, 60);
    console.error(`👥 Could not set up the teams yet (${error.message}); retrying in ${wait}s`);
    setTimeout(() => seedTeamsWhenReady(attempt + 1), wait * 1000).unref();
  }
}

// ---------------------------------------------------------------------
// NEW TICKETS FROM SERVICENOW: servicenow-sync/ saves each one in the data,
// puts it in a family (teams.placeTicket) and says so on a Postgres channel.
// Who sees what is read again at once; what was read once at start (KPIs,
// the sorting index, families, charts) a little later, once Cube's own
// cache (10 s) has the new rows. Many arrivals together refresh once.
// ---------------------------------------------------------------------

const REFRESH_AFTER_MS = 15 * 1000;
let refreshTimer = null;

function ticketsChanged() {
  teams.dataChanged();
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    const t0 = Date.now();
    forgetLinks();
    forgetResults();
    const done = await Promise.allSettled([kpis.reload(runCubeQuery), reloadTicketIndex(runCubeQuery)]);
    const failed = done.filter(d => d.status === 'rejected').map(d => d.reason.message);
    console.log(failed.length ? `🔄 Tickets changed; could not read them all again: ${failed.join('; ')}`
      : `🔄 Tickets changed: KPIs and sorting read again in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }, REFRESH_AFTER_MS);
}

async function listenForTicketChanges() {
  let client;
  try {
    client = await auth.pool.connect();
    client.on('notification', ticketsChanged);
    // A dropped connection: listen again
    client.on('error', error => {
      console.error('🔄 Lost the ticket-change channel:', error.message);
      client.release(true);
      setTimeout(listenForTicketChanges, 10 * 1000).unref();
    });
    await client.query(`LISTEN ${teams.TICKETS_CHANGED}`);
  } catch (error) {
    client?.release(true);
    console.error(`🔄 Could not listen for ticket changes yet (${error.message}); retrying in 10s`);
    setTimeout(listenForTicketChanges, 10 * 1000).unref();
  }
}
listenForTicketChanges();
