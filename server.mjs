import dns from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
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
import { findTickets, ticketRecord, ticketSummaries, ticketNumbersIn, STARRABLE } from './tickets.mjs';
import { relatedFamilies, describeFamilies } from './relations.mjs';
import * as prefs from './prefs.mjs';
import { chartData, chartValues, chartCatalog, chartTickets, chartFromQuery, teamValues, ChartError } from './charts.mjs';
import * as shares from './shares.mjs';
import { diagnoseEmpty, explainEmpty, isEmptyResult } from './empty_results.mjs';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// Content-Disposition is exposed so the browser can read the download's file name
app.use(cors({ origin: '*', exposedHeaders: ['Content-Disposition'] }));

// =====================================================================
// METABASE DASHBOARDS: Metabase only listens on this computer, so its
// public-dashboard pages (and the scripts and data they load) are passed
// through this server. That way the Dashboards tab works wherever OneTouch
// does: localhost, the network address, the tunnel and remote mode.
// =====================================================================

const METABASE_URL = (process.env.METABASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const METABASE_DASHBOARDS_FILE = 'metabase-dashboards.json';
// What a public dashboard page needs from Metabase, and nothing else
// (no admin pages, no signed-in API)
const METABASE_PATHS = /^\/(public\/|app\/|api\/public\/|api\/session\/properties$|api\/geojson)/;
// Headers passed back to the browser; fetch already undid any compression
const METABASE_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified',
  'content-security-policy', 'x-frame-options', 'location'];

app.use(async (req, res, next) => {
  if (!METABASE_PATHS.test(req.path) || !['GET', 'HEAD'].includes(req.method)) return next();
  try {
    const upstream = await fetch(METABASE_URL + req.originalUrl, {
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
// Exports carry whole result tables back up, so that route gets a bigger limit
app.use('/api/export', express.json({ limit: '25mb' }));
// A whole set of dashboards is saved (or a dashboard shared) at once
app.use(['/api/preferences', '/api/shares'], express.json({ limit: '1mb' }));
app.use(express.json());
app.use(express.static('public'));

// =====================================================================
// SIGN IN: accounts and sessions live in Postgres (see auth.mjs);
// /api/query, /api/export and /api/conversation need a session
// =====================================================================

// Conversation memory per session token: { conversation, queue }. Kept in
// RAM, so a server restart keeps people signed in but Claude forgets.
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
    state = { conversation: newConversation(), queue: Promise.resolve(), lastUsed: Date.now() };
    conversations.set(token, state);
  }
  state.lastUsed = Date.now();
  return state;
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
  req.user = user;
  req.session = conversationState(token);
  next();
}

app.use(['/api/query', '/api/export', '/api/conversation', '/api/me', '/api/dashboards', '/api/tickets', '/api/stars', '/api/seen-tickets', '/api/preferences', '/api/charts', '/api/shares'], requireLogin);

// Who is signed in (the page shows their display name)
app.get('/api/me', (req, res) => {
  res.json({ username: req.user.username, displayName: req.user.displayName });
});

// The dashboards built by scripts/metabase-setup.mjs, for the Dashboards tab
app.get('/api/dashboards', (_req, res) => {
  try {
    const { dashboards, details = [] } = JSON.parse(readFileSync(METABASE_DASHBOARDS_FILE, 'utf8'));
    res.json({
      // `group` is the drawer heading; files from before groups existed get one heading
      dashboards: dashboards.map(d => ({
        key: d.key, group: d.group || 'Dashboards', name: d.name, description: d.description, path: `/public/dashboard/${d.uuid}`,
      })),
      // The pages a click on a chart opens (not in the drawer); their filters name the page
      details: details.map(d => ({ key: d.key, name: d.name, path: `/public/dashboard/${d.uuid}`, params: d.params })),
    });
  } catch {
    res.json({ dashboards: [], details: [] });
  }
});

// "New chat": Claude forgets this session's conversation
app.post('/api/conversation/reset', (req, res) => {
  // Queued behind any question still running, so its answer can't land in the new conversation
  req.session.queue = req.session.queue.then(() => {
    req.session.conversation = newConversation();
  });
  req.session.queue.then(() => res.json({ ok: true }));
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

// Step 2: validated Cube query -> rows
async function runCubeQuery(cubeQuery) {
  const cubeResponse = await fetchWithRetry(
    process.env.CUBE_API_URL || 'http://localhost:4000/cubejs-api/v1/load',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.CUBE_API_TOKEN || 'super_secret_key_change_me_later',
      },
      body: JSON.stringify({ query: cubeQuery }),
    }
  );

  const contentType = cubeResponse.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('Cube.dev is still initializing its internal model registry. Try again in a few seconds.');
  }
  const data = await cubeResponse.json();
  if (data.error) throw new Error(`Cube Engine Error: ${data.error}`);
  return data.data || [];
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
  const run = session.queue.then(() => answerQuestion(session.conversation, userPrompt, reply, req.user));
  session.queue = run.catch(() => {});
  await run;
});

async function answerQuestion(conversation, userPrompt, reply, user) {
  const started = Date.now();
  // Set once Claude's answer is in the conversation; from then on, whatever
  // happens to the query is reported to Claude with the next question
  let remembered = false;
  const cacheKey = answerCacheKey(conversation, userPrompt);
  const cached = cachedAnswer(cacheKey);

  try {
    console.log(`\n💬 Processing prompt: "${userPrompt}" (turn ${conversation.turns + 1})`);

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

    // One Cube query per ticket type, run side by side
    reply.progress('querying');
    for (const q of verdict.queries) console.log(`🤖 Cube query [${q.entity}]:`, JSON.stringify(q.cubeQuery));
    const sections = await Promise.all(verdict.queries.map(async q => ({
      entity: q.entity,
      rows: await runCubeQuery(q.cubeQuery),
    })));
    // Nothing found: work out why (which filter emptied it, what dates the data
    // covers) and have Claude say so plainly, instead of a bare "no records".
    // A repeated question reuses the explanation it got the first time.
    const emptyQueries = verdict.queries.filter((_, i) => isEmptyResult(sections[i].rows));
    let explanation = cached?.explanation ?? null;
    if (emptyQueries.length && !explanation) {
      reply.progress('explaining');
      try {
        const facts = (await Promise.all(emptyQueries.map(q => diagnoseEmpty(q.entity, q.cubeQuery, runCubeQuery)))).flat();
        console.log('🔎 Empty result facts:\n   ' + facts.join('\n   '));
        explanation = await explainEmpty({ anthropic, model: CLAUDE_MODEL, question: userPrompt, searchedFor: verdict.message, facts });
        console.log(`🔎 Explained: ${explanation}`);
        if (cached) cached.explanation = explanation;
      } catch (error) {
        console.error('🔎 Could not diagnose the empty result:', error.message);
      }
    }
    if (!emptyQueries.length) explanation = null;
    conversation.pendingNote = describeResults(sections) + (explanation ? ` What the user was told about the empty result: ${explanation}` : '');

    // Counts across several ticket types become one table with a total column
    const combined = verdict.merge ? combineResults(verdict.merge, verdict.queries, sections) : null;

    // Only an answer that ran all the way through is worth reusing
    if (fresh && cacheKey) rememberAnswer(cacheKey, { ...fresh, explanation });

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
      ...timing(),
    });

  } catch (error) {
    if (remembered) conversation.pendingNote = `it failed when run: ${error.message}`;
    if (error instanceof Anthropic.APIError) {
      console.error(`📋 Claude API error ${error.status}:`, error.message);
      return reply.send(502, { error: `Claude API error (${error.status}): ${error.message}` });
    }
    console.error('📋 Execution Failure Context:', error);
    reply.send(500, { error: `Server pipeline failed: ${error.message}` });
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
    const result = await findTickets(text, runCubeQuery);
    if (record && result.found.length === 1) {
      // Without the full record the page still shows the ticket's summary row
      result.record = await ticketRecord(result.found[0].number, runCubeQuery, {
        cubeUrl: process.env.CUBE_API_URL || 'http://localhost:4000/cubejs-api/v1/load',
        token: process.env.CUBE_API_TOKEN || 'super_secret_key_change_me_later',
      }).catch(error => {
        console.error(`🔎 Could not load the full record of ${result.found[0].number}:`, error.message);
        return null;
      });
    }
    console.log(`🔎 ${req.user.username} searched ${result.found.length} found, ${result.notFound.length} not found`);
    res.json(result);
  } catch (error) {
    console.error('🔎 Ticket search failed:', error.message);
    res.status(502).json({ error: `Could not search the tickets right now: ${error.message}` });
  }
});

// { numbers, conversation } -> { families }: the parent/child, order, task,
// change and problem families those tickets belong to (relations.mjs), with
// what each family's members share and where they differ. conversation: true
// (an AI answer's tickets) also tells Claude about them with the next question.
app.post('/api/tickets/related', async (req, res) => {
  const numbers = Array.isArray(req.body?.numbers) ? req.body.numbers.slice(0, 500).map(String) : [];
  if (!numbers.length) return res.status(400).json({ error: 'No ticket numbers to look at.' });
  try {
    const families = await relatedFamilies(numbers, runCubeQuery);
    if (req.body.conversation && families.length) {
      // Queued behind the answer that showed these tickets, and only for that
      // same conversation (not one started by "New chat" in the meantime)
      const session = req.session;
      const conversation = session.conversation;
      session.queue = session.queue.then(() => {
        if (session.conversation !== conversation) return;
        const note = `Related tickets OneTouch showed the user under that answer: ${describeFamilies(families)}`;
        conversation.pendingNote = conversation.pendingNote ? `${conversation.pendingNote} ${note}` : note;
      });
    }
    res.json({ families });
  } catch (error) {
    console.error('🔗 Could not find related tickets:', error.message);
    res.status(502).json({ error: `Could not look for related tickets right now: ${error.message}` });
  }
});

// Every ticket this person has been shown, newest first, with each one's
// summary, when it was shown, and the question that showed it
app.get('/api/seen-tickets', async (req, res) => {
  try {
    const list = await seen.listSeen(req.user.id);
    const summaries = await ticketSummaries(list.map(s => s.number), runCubeQuery);
    res.json({ tickets: list.filter(s => summaries.has(s.number)).map(s => ({ ...summaries.get(s.number), shownAt: s.shownAt, question: s.question })) });
  } catch (error) {
    console.error('🎫 Could not list the shown tickets:', error.message);
    res.status(503).json({ error: 'Your ticket results could not be loaded right now.' });
  }
});

// "Delete ticket results": empties this person's list (their stars stay)
app.delete('/api/seen-tickets', async (req, res) => {
  try {
    const deleted = await seen.clearSeen(req.user.id);
    console.log(`🎫 ${req.user.username} deleted their ticket results (${deleted})`);
    res.json({ ok: true, deleted });
  } catch (error) {
    console.error('🎫 Could not delete the ticket results:', error.message);
    res.status(503).json({ error: 'Your ticket results could not be deleted right now.' });
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

app.get('/api/stars', async (req, res) => {
  try {
    res.json({ stars: await stars.listStars(req.user.id) });
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
app.get('/api/charts/catalog', async (_req, res) => {
  try {
    res.json(await chartCatalog(runCubeQuery));
  } catch (error) {
    console.error('📊 Chart catalog failed:', error.message);
    res.status(502).json({ error: `The chart options could not be loaded right now: ${error.message}` });
  }
});

// { chart } -> its numbers
app.post('/api/charts/data', async (req, res) => {
  try {
    res.json(await chartData(req.body?.chart, runCubeQuery, req.body?.scope));
  } catch (error) {
    if (error instanceof ChartError) return res.status(400).json({ error: error.message });
    console.error('📊 Chart data failed:', error.message);
    res.status(502).json({ error: `This chart could not be loaded right now: ${error.message}` });
  }
});

// { chart, value, scope } -> the tickets behind one bar, slice or point
// (value null: "(Not set)"; a chart with no grouping: all of its tickets)
app.post('/api/charts/tickets', async (req, res) => {
  try {
    res.json(await chartTickets(req.body?.chart, req.body?.value ?? null, runCubeQuery, req.body?.scope));
  } catch (error) {
    if (error instanceof ChartError) return res.status(400).json({ error: error.message });
    console.error('📊 Chart tickets failed:', error.message);
    res.status(502).json({ error: `Those tickets could not be loaded right now: ${error.message}` });
  }
});

// Every team (for a dashboard's Team filter)
app.get('/api/charts/teams', async (_req, res) => {
  try {
    res.json({ values: await teamValues(runCubeQuery) });
  } catch (error) {
    console.error('📊 Team list failed:', error.message);
    res.status(502).json({ error: `The teams could not be loaded right now: ${error.message}` });
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
    res.json({ values: await chartValues(String(req.body?.source), String(req.body?.field), runCubeQuery) });
  } catch (error) {
    if (error instanceof ChartError) return res.status(400).json({ error: error.message });
    console.error('📊 Filter values failed:', error.message);
    res.status(502).json({ error: `The choices could not be loaded right now: ${error.message}` });
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
    res.status(500).json({ error: `Could not create the ${req.body.format.toUpperCase()} file: ${error.message}` });
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
  } catch (error) {
    const wait = Math.min(attempt * 2, 15);
    console.error(`🔐 Account database not reachable yet (${error.message}); retrying in ${wait}s`);
    setTimeout(() => prepareAccounts(attempt + 1), wait * 1000).unref();
    return;
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
}
prepareAccounts();
