// =====================================================================
// CLAUDE API USAGE: every call the server makes to Claude (translating a
// question, explaining an empty result) is saved with its token counts and
// what it cost, so the bill can be checked against real use:
//   docker exec analytics_node_app npm run usage            (last 30 days)
//   docker exec analytics_node_app npm run usage -- 7       (last 7 days)
// Rows older than KEEP_DAYS are deleted at start. A failure to save one never
// affects the answer.
// =====================================================================

// Loaded on first use, so costUsd works without the database (checks/usage.mjs)
const db = async () => (await import('./auth.mjs')).pool;

const KEEP_DAYS = 180;

// US dollars per million tokens (Anthropic's prices; Haiku's are for prompts under 100K tokens).
// A model missing here is saved without a cost.
const PRICES = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
};

// What one call cost, from the API's usage object; null for an unknown model
export function costUsd(model, usage) {
  // The offline version's model (local_llm.mjs) runs on this computer: no charge per call
  if (String(model).startsWith('local:') && usage) return 0;
  const p = PRICES[model];
  if (!p || !usage) return null;
  const written = usage.cache_creation_input_tokens || 0;
  // Newer responses split cache writes by how long they're kept
  const w1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = usage.cache_creation ? (usage.cache_creation.ephemeral_5m_input_tokens ?? 0) : written;
  return ((usage.input_tokens || 0) * p.input
    + (usage.output_tokens || 0) * p.output
    + (usage.cache_read_input_tokens || 0) * p.cacheRead
    + w5m * p.cacheWrite5m + w1h * p.cacheWrite1h) / 1e6;
}

export async function ensureUsageSchema() {
  await (await db()).query(`
    CREATE TABLE IF NOT EXISTS claude_usage (
      id           bigserial PRIMARY KEY,
      at           timestamptz NOT NULL DEFAULT now(),
      kind         text NOT NULL,              -- 'translate' | 'explain'
      model        text NOT NULL,
      effort       text,
      user_id      integer REFERENCES users(id) ON DELETE SET NULL,
      question     text,
      input        integer NOT NULL,
      cache_read   integer NOT NULL,
      cache_write  integer NOT NULL,
      output       integer NOT NULL,
      cost_usd     numeric(10, 6),
      ms           integer
    );
    CREATE INDEX IF NOT EXISTS claude_usage_at_idx ON claude_usage (at);
  `);
  await (await db()).query(`DELETE FROM claude_usage WHERE at < now() - make_interval(days => $1)`, [KEEP_DAYS]);
}

// Saves one call; never throws
export async function recordUsage({ kind, model, effort = null, userId = null, question = null, usage, ms = null }) {
  if (!usage) return;
  try {
    await (await db()).query(
      `INSERT INTO claude_usage (kind, model, effort, user_id, question, input, cache_read, cache_write, output, cost_usd, ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [kind, model, effort, userId, question ? question.slice(0, 2000) : null,
        usage.input_tokens || 0, usage.cache_read_input_tokens || 0, usage.cache_creation_input_tokens || 0,
        usage.output_tokens || 0, costUsd(model, usage), ms]);
  } catch (error) {
    console.error('🧾 Could not save the Claude usage:', error.message);
  }
}

// Per day and in all, for the last `days` days
export async function usageReport(days = 30) {
  const { rows } = await (await db()).query(`
    SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day, kind, model, coalesce(effort, '-') AS effort,
           count(*)::int AS calls,
           count(*) FILTER (WHERE cache_read > 0)::int AS cache_hits,
           count(*) FILTER (WHERE cache_write > 0)::int AS cache_writes,
           round(avg(output))::int AS avg_output,
           round(avg(ms))::int AS avg_ms,
           round(sum(cost_usd), 4)::float AS cost,
           round(avg(cost_usd), 4)::float AS avg_cost
      FROM claude_usage
     WHERE at >= now() - make_interval(days => $1)
     GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`, [days]);
  return rows;
}
