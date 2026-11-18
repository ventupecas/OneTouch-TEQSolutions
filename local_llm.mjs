// =====================================================================
// THE OFFLINE VERSION'S AI: a free, open model run on this computer by
// Ollama (docker-compose.local-ai.yml), instead of the Claude API.
//
// Chosen with AI_PROVIDER=local (server.mjs). It gets the same system prompt,
// the same question wrapper and the same output schema as Claude (Ollama
// holds the model to the schema), and its answer goes through the same
// validator, so nothing past the translation changes. It costs nothing per
// question; what it costs is a computer able to run it (README "Two versions
// of the AI assistant").
//
// The model's licence must allow business use: the default, Qwen3 4B, is
// Apache 2.0. Change it with LOCAL_LLM_MODEL (then: npm run local-ai -- pull).
// =====================================================================

import http from 'node:http';
import https from 'node:https';

export const LOCAL_LLM_URL = (process.env.LOCAL_LLM_URL || 'http://ollama:11434').replace(/\/+$/, '');
export const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen3:4b';
// The system prompt alone is ~22k tokens, so the model must read at least that
// much; more costs memory (the KV cache), not money
export const LOCAL_LLM_CONTEXT = Number(process.env.LOCAL_LLM_CONTEXT) || 28 * 1024;
// On a laptop's processor the first question reads the whole system prompt
// (minutes); later ones reuse it and take tens of seconds. A GPU: seconds.
export const LOCAL_LLM_TIMEOUT_MS = Number(process.env.LOCAL_LLM_TIMEOUT_MS) || 10 * 60 * 1000;
// How many earlier questions the local model sees: each one adds ~600 tokens
// to every request, and a small model's window is far smaller than Claude's
export const LOCAL_LLM_TURNS = Number(process.env.LOCAL_LLM_TURNS) || 4;

// The name the answer cache and claude_usage keep, so local answers are
// never reused as Claude's (or the other way round)
export const LOCAL_MODEL_NAME = `local:${LOCAL_LLM_MODEL}`;

// One request to Ollama's own chat API. messages: [{ role, content: string }].
// Returns { text, usage, ms, stop } with usage in the Claude API's shape, so
// usage.mjs saves it the same way (it costs $0).
export async function localChat({ system, messages, schema, maxTokens = 4000, timeoutMs = LOCAL_LLM_TIMEOUT_MS }) {
  const started = Date.now();
  const response = await postJson(`${LOCAL_LLM_URL}/api/chat`, timeoutMs, {
      model: LOCAL_LLM_MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      ...(schema ? { format: schema } : {}),
      stream: false,
      // A thinking model would spend minutes thinking on a processor
      think: false,
      // Kept loaded for good (-1): unloading it would mean reading the system
      // prompt again, which takes minutes without a graphics card
      keep_alive: process.env.LOCAL_LLM_KEEP_ALIVE || -1,
      options: { num_ctx: LOCAL_LLM_CONTEXT, num_predict: maxTokens, temperature: 0 },
  });
  if (response.status !== 200) {
    throw new Error(`The local model (Ollama) answered ${response.status}: ${response.text.slice(0, 300)}`);
  }
  const data = JSON.parse(response.text);
  return {
    text: data.message?.content || '',
    stop: data.done_reason === 'length' ? 'max_tokens' : 'end_turn',
    ms: Date.now() - started,
    usage: { input_tokens: data.prompt_eval_count || 0, output_tokens: data.eval_count || 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

// Node's fetch gives up when a response's headers take over 5 minutes, and
// Ollama sends none until the answer is done (on a processor, the first one
// takes longer than that). node:http has no such limit: timeoutMs is the only one.
function postJson(url, timeoutMs, body) {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = client.request(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { clearTimeout(timer); resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }); });
      response.on('error', fail);
    });
    const timer = setTimeout(() => request.destroy(new Error(`The local model didn't answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    function fail(error) { clearTimeout(timer); reject(error); }
    request.on('error', fail);
    request.end(payload);
  });
}

// For 🩺 Health: Ollama answers and has the model (listing them costs nothing)
export async function checkLocalModel() {
  const response = await fetch(`${LOCAL_LLM_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
  const { models = [] } = await response.json();
  const name = LOCAL_LLM_MODEL.includes(':') ? LOCAL_LLM_MODEL : `${LOCAL_LLM_MODEL}:latest`;
  if (!models.some(m => m.name === name || m.model === name)) {
    throw new Error(`Ollama doesn't have ${LOCAL_LLM_MODEL} yet: docker exec analytics_node_app npm run local-ai -- pull`);
  }
  return `${LOCAL_LLM_MODEL} is loaded in Ollama (free, on this computer).`;
}

// Downloads the model into Ollama's volume (once; ~2.5 GB for qwen3:4b)
export async function pullLocalModel(onProgress = () => {}) {
  const response = await fetch(`${LOCAL_LLM_URL}/api/pull`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LOCAL_LLM_MODEL, stream: true }),
  });
  if (!response.ok || !response.body) throw new Error(`Ollama answered ${response.status}`);
  const decoder = new TextDecoder();
  let rest = '';
  for await (const chunk of response.body) {
    rest += decoder.decode(chunk, { stream: true });
    const lines = rest.split('\n');
    rest = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.error) throw new Error(event.error);
      onProgress(event);
    }
  }
}

// Reads the system prompt once at start, so the first person to ask doesn't
// wait for it: Ollama keeps what it has read, and every question starts with
// the same system prompt. Without a graphics card this alone takes well over
// 10 minutes, so it may take an hour. Never throws.
export async function warmLocalModel(system) {
  console.log(`🦙 ${LOCAL_LLM_MODEL} is reading the system prompt (minutes without a graphics card)…`);
  try {
    const t = await localChat({ system, messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 1, timeoutMs: 60 * 60 * 1000 });
    console.log(`🦙 ${LOCAL_LLM_MODEL} read the system prompt (${t.usage.input_tokens} tokens) in ${(t.ms / 1000).toFixed(0)} s`);
  } catch (error) {
    console.error(`🦙 Could not warm ${LOCAL_LLM_MODEL} up:`, error.message);
  }
}
