import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// Content-Disposition is exposed so the browser can read the download's file name
app.use(cors({ origin: '*', exposedHeaders: ['Content-Disposition'] }));
// Exports carry whole result tables back up, so that route gets a bigger limit
app.use('/api/export', express.json({ limit: '25mb' }));
app.use(express.json());
app.use(express.static('public'));

// =====================================================================
// SIGN IN: one allowed account; /api/query and /api/export need a session
// =====================================================================

const LOGIN_USERNAME = 'vperez';
const LOGIN_PASSWORD = 'vperez24';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// token -> { expires, conversation, queue }. Kept in memory, so a server
// restart signs everyone out and forgets every conversation.
const sessions = new Map();

// What Claude remembers for one signed-in session (see translateToQuery)
function newConversation() {
  return {
    messages: [],     // Anthropic.MessageParam[]: user turns + Claude's full replies, append-only
    turns: 0,         // completed question/answer pairs
    pendingNote: null // what the last answer's query returned, told to Claude with the next question
  };
}

// Compares hashes so the check takes the same time however close a guess is
function sameText(a, b) {
  const hash = s => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(hash(a), hash(b));
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  // The sign-in form shows "@molsoncoors.com" after the box, so accept it typed out too
  const user = String(username || '').trim().replace(/@molsoncoors\.com$/i, '');
  if (!sameText(user, LOGIN_USERNAME) || !sameText(password || '', LOGIN_PASSWORD)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  const token = randomBytes(32).toString('hex');
  sessions.set(token, {
    expires: Date.now() + SESSION_TTL_MS,
    conversation: newConversation(),
    queue: Promise.resolve(), // questions in one session run one at a time
  });
  console.log(`🔐 ${user} signed in`);
  res.json({ token, username: user });
});

function sessionToken(req) {
  const m = (req.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  return m ? m[1] : null;
}

app.post('/api/logout', (req, res) => {
  const token = sessionToken(req);
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

function requireLogin(req, res, next) {
  const token = sessionToken(req);
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  req.session = session;
  next();
}

app.use(['/api/query', '/api/export', '/api/conversation'], requireLogin);

// "New chat": Claude forgets this session's conversation
app.post('/api/conversation/reset', (req, res) => {
  // Queued behind any question still running, so its answer can't land in the new conversation
  req.session.queue = req.session.queue.then(() => {
    req.session.conversation = newConversation();
  });
  req.session.queue.then(() => res.json({ ok: true }));
});

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

  return { parsed, usage: message.usage, memoryReset };
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
  const run = session.queue.then(() => answerQuestion(session.conversation, userPrompt, res));
  session.queue = run.catch(() => {});
  await run;
});

async function answerQuestion(conversation, userPrompt, res) {
  // Set once Claude's answer is in the conversation; from then on, whatever
  // happens to the query is reported to Claude with the next question
  let remembered = false;

  try {
    console.log(`\n💬 Processing prompt: "${userPrompt}" (turn ${conversation.turns + 1})`);

    const { parsed, usage, memoryReset } = await translateToQuery(conversation, userPrompt);
    remembered = true;
    console.log(`🧠 tokens in=${usage.input_tokens} cached=${usage.cache_read_input_tokens ?? 0} out=${usage.output_tokens}`);

    const verdict = normalizeAndValidate(parsed);
    if (!verdict.ok) {
      console.warn('⚠️ Rejected by validator:', verdict.error, JSON.stringify(parsed));
      conversation.pendingNote = `it was rejected before running: ${verdict.error}`;
      return res.status(400).json({
        error: `I couldn't map that question onto the data: ${verdict.error}`,
        aiInterpretation: parsed,
      });
    }

    if (verdict.intent !== 'query') {
      // clarify / unsupported: nothing to run, hand the explanation back
      console.log(`🙋 ${verdict.intent}: ${verdict.message}`);
      return res.json({
        intent: verdict.intent,
        message: verdict.message,
        assumptions: verdict.assumptions,
        memoryReset,
        sections: [],
        results: [],
      });
    }

    // One Cube query per ticket type, run side by side
    for (const q of verdict.queries) console.log(`🤖 Cube query [${q.entity}]:`, JSON.stringify(q.cubeQuery));
    const sections = await Promise.all(verdict.queries.map(async q => ({
      entity: q.entity,
      rows: await runCubeQuery(q.cubeQuery),
    })));
    conversation.pendingNote = describeResults(sections);

    // Counts across several ticket types become one table with a total column
    const combined = verdict.merge ? combineResults(verdict.merge, verdict.queries, sections) : null;

    res.json({
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
    });

  } catch (error) {
    if (remembered) conversation.pendingNote = `it failed when run: ${error.message}`;
    if (error instanceof Anthropic.APIError) {
      console.error(`📋 Claude API error ${error.status}:`, error.message);
      return res.status(502).json({ error: `Claude API error (${error.status}): ${error.message}` });
    }
    console.error('📋 Execution Failure Context:', error);
    res.status(500).json({ error: `Server pipeline failed: ${error.message}` });
  }
}

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
