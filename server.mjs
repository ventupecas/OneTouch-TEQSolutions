import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  buildUserMessage,
  normalizeAndValidate,
  OUTPUT_SCHEMA,
} from './business_logic.mjs';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('public'));

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

// Step 1: plain English -> structured JSON (schema-enforced by the API)
async function translateToQuery(userPrompt) {
  const stream = anthropic.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: buildUserMessage(userPrompt, referenceToday()) }],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error('The assistant declined to translate that request.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('The translation was cut off; try a shorter question.');
  }

  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { parsed: JSON.parse(text), usage: message.usage };
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
  try {
    const { userPrompt } = req.body;
    if (!userPrompt || typeof userPrompt !== 'string') {
      return res.status(400).json({ error: 'userPrompt parameter is required.' });
    }

    console.log(`\n💬 Processing prompt: "${userPrompt}"`);

    const { parsed, usage } = await translateToQuery(userPrompt);
    console.log(`🧠 tokens in=${usage.input_tokens} cached=${usage.cache_read_input_tokens ?? 0} out=${usage.output_tokens}`);

    const verdict = normalizeAndValidate(parsed);
    if (!verdict.ok) {
      console.warn('⚠️ Rejected by validator:', verdict.error, JSON.stringify(parsed));
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
        entity: verdict.entity,
        message: verdict.message,
        assumptions: verdict.assumptions,
        results: [],
      });
    }

    console.log('🤖 Cube query:', JSON.stringify(verdict.cubeQuery));
    const results = await runCubeQuery(verdict.cubeQuery);

    res.json({
      intent: 'query',
      entity: verdict.entity,
      message: verdict.message,
      assumptions: verdict.assumptions,
      aiInterpretation: verdict.cubeQuery,
      results,
    });

  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`📋 Claude API error ${error.status}:`, error.message);
      return res.status(502).json({ error: `Claude API error (${error.status}): ${error.message}` });
    }
    console.error('📋 Execution Failure Context:', error);
    res.status(500).json({ error: `Server pipeline failed: ${error.message}` });
  }
});

app.listen(port, () => {
  console.log(`🚀 Node.js Orchestrator live on port ${port} (model: ${CLAUDE_MODEL})`);
});
