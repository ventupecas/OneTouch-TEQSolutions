// =====================================================================
// EVAL: does a cheaper setting still translate questions the same way?
//
// Asks the warmup questions (scripts/warmup-questions.txt) and a few
// follow-up conversations with several model / effort settings, exactly as
// translateToQuery in server.mjs does (same system prompt, schema, validator,
// conversation and "[Result of your previous answer …]" notes). Each answer
// is compared with today's setting: the same query, or the same rows when
// both queries are run in Cube, or different (listed for a person to judge).
// Today's setting runs twice, so the normal run-to-run variation is known.
//
// It calls the Claude API (real money: about $5-8 for every setting), so it
// only runs with --yes:
//   docker exec analytics_node_app node scripts/eval-translation.mjs --yes
// Options: --only=sonnet-low,haiku-medium  --limit=10  --max-cost=15
// Results: eval-results/translation-<time>.json and .md (not in git).
// Runs as an admin would (every ticket), and never touches onetouch_auth.
// =====================================================================

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, buildUserMessage, normalizeAndValidate, OUTPUT_SCHEMA } from '../business_logic.mjs';
import { diagnoseEmpty, explainEmpty, isEmptyResult } from '../empty_results.mjs';
import { costUsd } from '../usage.mjs';

dotenv.config();

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
if (!args.yes) {
  console.log('This asks Claude about 300 questions (about $5-8 per setting). Run again with --yes to go ahead.');
  process.exit(1);
}

const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';
// effort undefined = what server.mjs sends today (Sonnet 5.5's default, high)
const ALL_SETTINGS = [
  { name: 'today', model: SONNET, effort: undefined, note: 'Sonnet 5.5, no effort set (high)' },
  { name: 'today-again', model: SONNET, effort: undefined, note: 'the same, a second time: normal variation' },
  { name: 'sonnet-medium', model: SONNET, effort: 'medium' },
  { name: 'sonnet-low', model: SONNET, effort: 'low' },
  { name: 'haiku-medium', model: HAIKU, effort: 'medium' },
];
const BASELINE = 'today';
const only = args.only ? String(args.only).split(',') : null;
const SETTINGS = ALL_SETTINGS.filter(s => !only || only.includes(s.name) || s.name === BASELINE);
const MAX_COST = Number(args['max-cost'] || 15);

// ---------------------------------------------------------------------
// Questions: each warmup question on its own, plus follow-up conversations
// ---------------------------------------------------------------------
const warmup = readFileSync(new URL('./warmup-questions.txt', import.meta.url), 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const FOLLOW_UPS = [
  ['How many open incidents are there by priority?', 'Only the P1s and P2s', 'Same but for changes, by risk'],
  ['List the emergency changes', 'Which of those caused incidents?'],
  ['What are the top 5 most requested catalog items?', 'How many of the first one are still open?'],
  ['Which assignment groups have the most open incidents?', 'List the P2s for the top one', 'How many of them breached SLA?'],
];
let chains = [...warmup.map(q => [q]), ...FOLLOW_UPS];
if (args.limit) chains = chains.slice(0, Number(args.limit));
const steps = chains.flatMap((chain, c) => chain.map((question, t) => ({ id: `${c}.${t}`, chain: c, turn: t, question })));

// ---------------------------------------------------------------------
// Claude and Cube, as server.mjs uses them
// ---------------------------------------------------------------------
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
  maxRetries: 6,
});
const SYSTEM_PROMPT = buildSystemPrompt();
const pinned = (process.env.ASSUME_TODAY || '').trim();
const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(pinned) ? new Date(`${pinned}T12:00:00Z`) : new Date();

let spent = 0;
function charge(model, usage) {
  const c = costUsd(model, usage) ?? 0;
  spent += c;
  if (spent > MAX_COST) {
    console.error(`💸 Stopped: over the $${MAX_COST} limit ($${spent.toFixed(2)}).`);
    process.exit(2);
  }
  return c;
}

async function translate(setting, conversation, question) {
  const note = conversation.pendingNote ? `[Result of your previous answer: ${conversation.pendingNote}]\n\n` : '';
  const userTurn = { role: 'user', content: note + buildUserMessage(question, TODAY) };
  const started = Date.now();
  const message = await anthropic.messages.stream({
    model: setting.model,
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    cache_control: { type: 'ephemeral' },
    messages: [...conversation.messages, userTurn],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA }, ...(setting.effort ? { effort: setting.effort } : {}) },
  }).finalMessage();
  const ms = Date.now() - started;
  const cost = charge(setting.model, message.usage);
  if (message.stop_reason !== 'end_turn') return { error: `stopped: ${message.stop_reason}`, usage: message.usage, cost, ms };
  const parsed = JSON.parse(message.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  conversation.messages.push(userTurn, { role: 'assistant', content: message.content });
  conversation.pendingNote = null;
  return { parsed, usage: message.usage, cost, ms };
}

const CUBE_URL = process.env.CUBE_API_URL || 'http://localhost:4000/cubejs-api/v1/load';
function cubeToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat: now, exp: now + 3600 })}`;
  return `${body}.${createHmac('sha256', process.env.CUBEJS_API_SECRET).update(body).digest('base64url')}`;
}
const cubeCache = new Map();
async function runCube(query) {
  const key = JSON.stringify(query);
  if (!cubeCache.has(key)) {
    cubeCache.set(key, (async () => {
      const giveUpAt = Date.now() + 120_000;
      for (;;) {
        const res = await fetch(CUBE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: cubeToken() }, body: JSON.stringify({ query }) });
        const data = await res.json();
        if (data.error === 'Continue wait' && Date.now() < giveUpAt) { await new Promise(r => setTimeout(r, 500)); continue; }
        if (data.error) throw new Error(data.error);
        return data.data || [];
      }
    })());
  }
  return cubeCache.get(key);
}

// ---------------------------------------------------------------------
// One setting through every question
// ---------------------------------------------------------------------
async function runSetting(setting) {
  const out = {};
  for (const chain of chains.map((_, c) => steps.filter(s => s.chain === c))) {
    const conversation = { messages: [], pendingNote: null };
    for (const step of chain) {
      const r = { question: step.question };
      try {
        const t = await translate(setting, conversation, step.question);
        Object.assign(r, { usage: t.usage, cost: t.cost, ms: t.ms });
        if (t.error) { r.outcome = 'error'; r.error = t.error; out[step.id] = r; break; }
        const verdict = normalizeAndValidate(t.parsed);
        r.parsed = t.parsed;
        if (!verdict.ok) {
          r.outcome = 'rejected'; r.error = verdict.error;
          conversation.pendingNote = `it was rejected before running: ${verdict.error}`;
        } else {
          r.intent = verdict.intent; r.message = verdict.message;
          if (verdict.intent === 'query') {
            r.queries = verdict.queries;
            r.rows = await Promise.all(verdict.queries.map(q => runCube(q.cubeQuery)));
            r.outcome = 'ran';
            conversation.pendingNote = verdict.queries.map((q, i) => `${q.entity} query returned ${r.rows[i].length} ${r.rows[i].length === 1 ? 'row' : 'rows'}`).join('; ') + '.';
          } else {
            r.outcome = verdict.intent;
          }
        }
      } catch (error) {
        r.outcome = 'error'; r.error = error.message;
        out[step.id] = r;
        break; // the rest of this conversation can't be compared
      }
      out[step.id] = r;
      process.stdout.write(`${setting.name} ${step.id} ${r.outcome} $${(r.cost ?? 0).toFixed(4)} ${r.ms ?? '-'}ms\n`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Comparing with today's setting
// ---------------------------------------------------------------------
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v);
// Rows compared by their values only (a measure's name may differ), in any order
const rowsKey = rows => rows.map(set => set.map(row => Object.values(row).map(String).sort().join('|')).sort().join('\n')).join('\n---\n');

function compare(base, other) {
  if (!base || !other) return 'missing';
  if (base.outcome === 'error' || other.outcome === 'error') return other.outcome === 'error' ? 'error' : 'baseline-error';
  if (other.outcome === 'rejected') return 'rejected';
  if (base.outcome === 'rejected') return 'baseline-rejected';
  if (base.intent !== other.intent) return 'different';
  if (base.intent !== 'query') return 'same';
  if (canon(base.queries) === canon(other.queries)) return 'same';
  if (rowsKey(base.rows) === rowsKey(other.rows)) return 'same-rows';
  return 'different';
}

// ---------------------------------------------------------------------
// Empty results: today's explanation (Sonnet) next to Haiku's
// ---------------------------------------------------------------------
async function compareExplanations(baseline) {
  const out = [];
  for (const [id, r] of Object.entries(baseline)) {
    if (r.outcome !== 'ran') continue;
    const empty = r.queries.filter((_, i) => isEmptyResult(r.rows[i]));
    if (!empty.length) continue;
    const facts = (await Promise.all(empty.map(q => diagnoseEmpty(q.entity, q.cubeQuery, runCube)))).flat();
    const texts = {};
    for (const model of [SONNET, HAIKU]) {
      texts[model] = await explainEmpty({
        anthropic, model, question: r.question, searchedFor: r.message, facts,
        onUsage: usage => charge(model, usage),
      });
    }
    out.push({ id, question: r.question, facts, texts });
  }
  return out;
}

// ---------------------------------------------------------------------
const startedAt = new Date();
console.log(`Asking ${steps.length} questions (${chains.length} conversations) with ${SETTINGS.map(s => s.name).join(', ')}; limit $${MAX_COST}`);
const results = Object.fromEntries(await Promise.all(SETTINGS.map(async s => [s.name, await runSetting(s)])));
const explanations = await compareExplanations(results[BASELINE]);

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const summary = SETTINGS.map(s => {
  const rs = Object.values(results[s.name]);
  const verdicts = steps.map(st => s.name === BASELINE ? 'baseline' : compare(results[BASELINE][st.id], results[s.name][st.id]));
  const count = v => verdicts.filter(x => x === v).length;
  // Cost per question with the business-logic prompt already cached (as in steady use)
  const warm = rs.map(r => r.usage ? costUsd(s.model, { ...r.usage, cache_read_input_tokens: (r.usage.cache_read_input_tokens || 0) + (r.usage.cache_creation_input_tokens || 0), cache_creation_input_tokens: 0, cache_creation: undefined }) : 0);
  return {
    setting: s.name, model: s.model, effort: s.effort ?? '(default: high)', note: s.note || '',
    same: count('same'), sameRows: count('same-rows'), different: count('different'),
    rejected: rs.filter(r => r.outcome === 'rejected').length, errors: rs.filter(r => r.outcome === 'error').length,
    answered: rs.length,
    medianOutputTokens: median(rs.filter(r => r.usage).map(r => r.usage.output_tokens)),
    avgWarmCost: warm.reduce((a, b) => a + b, 0) / (warm.length || 1),
    medianMs: median(rs.filter(r => r.ms).map(r => r.ms)),
    spent: rs.reduce((a, r) => a + (r.cost || 0), 0),
  };
});

mkdirSync('eval-results', { recursive: true });
const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = `eval-results/translation-${stamp}`;
writeFileSync(`${base}.json`, JSON.stringify({ startedAt, today: TODAY, settings: SETTINGS, steps, summary, results, explanations }, null, 2));

// Markdown: the table, then every question some setting answered differently
const md = [];
md.push(`# Translation eval ${startedAt.toISOString()}`, '', `${steps.length} questions, ${chains.length} conversations. Compared with **${BASELINE}**. Spent $${spent.toFixed(2)}.`, '');
md.push('| Setting | Same query | Same rows | Different | Rejected | Errors | Median output tokens | Avg cost / question (warm cache) | Median time |');
md.push('|---|---|---|---|---|---|---|---|---|');
for (const s of summary) md.push(`| ${s.setting} ${s.note ? `(${s.note})` : ''} | ${s.setting === BASELINE ? '-' : s.same} | ${s.setting === BASELINE ? '-' : s.sameRows} | ${s.setting === BASELINE ? '-' : s.different} | ${s.rejected} | ${s.errors} | ${s.medianOutputTokens} | $${s.avgWarmCost.toFixed(4)} | ${(s.medianMs / 1000).toFixed(1)} s |`);
md.push('', '## Questions answered differently', '');
for (const st of steps) {
  const diff = SETTINGS.filter(s => s.name !== BASELINE && !['same', 'same-rows'].includes(compare(results[BASELINE][st.id], results[s.name][st.id])));
  if (!diff.length) continue;
  md.push(`### ${st.id} ${st.question}`, '');
  for (const s of [SETTINGS.find(x => x.name === BASELINE), ...diff]) {
    const r = results[s.name][st.id];
    if (!r) { md.push(`- **${s.name}**: (not asked: an earlier turn failed)`); continue; }
    const rows = r.rows ? ` → ${r.rows.map(x => x.length).join(' + ')} rows` : '';
    md.push(`- **${s.name}** [${r.outcome}${s.name === BASELINE ? '' : `, ${compare(results[BASELINE][st.id], r)}`}]: ${r.message || r.error || ''}${rows}`);
    if (r.queries) md.push(`  \`${JSON.stringify(r.queries.map(q => q.cubeQuery))}\``);
  }
  md.push('');
}
md.push('## Empty-result explanations: Sonnet vs Haiku', '');
for (const e of explanations) md.push(`### ${e.id} ${e.question}`, '', `- **Sonnet**: ${e.texts[SONNET]}`, `- **Haiku**: ${e.texts[HAIKU]}`, '');
writeFileSync(`${base}.md`, md.join('\n'));

console.table(summary.map(({ note, ...s }) => ({ ...s, avgWarmCost: s.avgWarmCost.toFixed(4), spent: s.spent.toFixed(2) })));
console.log(`Spent $${spent.toFixed(2)}. Written: ${base}.md and .json`);
