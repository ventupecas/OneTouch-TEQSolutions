// What the Claude API cost, per day (see usage.mjs):
//   docker exec analytics_node_app npm run usage          (last 30 days)
//   docker exec analytics_node_app npm run usage -- 7     (last 7 days)

import dotenv from 'dotenv';
dotenv.config();
const { usageReport } = await import('../usage.mjs');
const { pool } = await import('../auth.mjs');

const days = Math.max(1, Math.min(365, Number(process.argv[2]) || 30));
const rows = await usageReport(days);
if (!rows.length) {
  console.log(`No Claude API calls in the last ${days} days.`);
} else {
  console.table(rows);
  const total = rows.reduce((a, r) => a + (r.cost || 0), 0);
  const calls = rows.reduce((a, r) => a + r.calls, 0);
  const hits = rows.reduce((a, r) => a + r.cache_hits, 0);
  console.log(`Last ${days} days: ${calls} calls, $${total.toFixed(2)} in all, $${(total / calls).toFixed(4)} a call; the business-logic prompt came from the cache on ${Math.round(100 * hits / calls)}% of calls.`);
}
await pool.end?.();
