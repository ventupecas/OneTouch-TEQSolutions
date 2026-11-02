// =====================================================================
// SERVICENOW SYNC: an Express listener that ServiceNow's outbound REST
// message calls on every insert or update (servicenow-blueprint.md). Each
// record is saved in the table the export was loaded into (analytics_db),
// and each new ticket is put in a family, and so on a team, by OneTouch's
// own rules (../../teams.mjs placeTicket); OneTouch hears about it and
// reads its data again (server.mjs).
//
//   POST /api/v1/servicenow-webhook   the webhook (routes/webhook.js)
//   GET  /health                       200 when both databases answer
//
// Settings come from the environment (.env.example). Start: npm start
// =====================================================================

import express from 'express';
import { analytics, checkDatabase } from './config/db.js';
import { loadSchema } from './config/schema.js';
import { ensurePendingTable } from './db/pending.js';
import { retryWaitingSoon } from './processRecord.js';
import { webhookRouter, pending } from './routes/webhook.js';
import { pool as onetouch } from '../../auth.mjs';

const PORT = Number(process.env.PORT) || 8090;
const SECRET = process.env.WEBHOOK_SECRET;
if (!SECRET) {
  console.error('WEBHOOK_SECRET is not set: refusing to start without it (see .env.example).');
  process.exit(1);
}

// Nothing that slips past the handlers below takes the listener down
process.on('unhandledRejection', error => console.error('💥 Unhandled rejection:', error));

// The tables' columns and keys first: calls are only checked against them
for (let attempt = 1; ; attempt++) {
  try {
    const schema = await loadSchema();
    console.log(`🐘 Ticket tables ready: ${[...schema.keys()].join(', ')}`);
    break;
  } catch (error) {
    const wait = Math.min(attempt * 5, 60);
    console.error(`🐘 Could not read the ticket tables yet (${error.message}); retrying in ${wait}s`);
    await new Promise(r => setTimeout(r, wait * 1000));
  }
}
await ensurePendingTable().catch(error => console.error(`⏳ Could not make servicenow_pending (${error.message}); run db/schema.sql`));

const app = express();
app.disable('x-powered-by');

app.use('/api/v1', webhookRouter({ secret: SECRET }));

app.get('/health', async (req, res) => {
  try {
    await Promise.all([checkDatabase(), onetouch.query('SELECT 1')]);
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ ok: false, error: 'A database is not answering.' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Bad JSON, a body over the limit, or anything else thrown in a route:
// answered, logged, and the process carries on
app.use((error, req, res, next) => {
  const status = error.status || error.statusCode || 500;
  if (status >= 500) console.error('💥 Request failed:', error);
  if (res.headersSent) return next(error);
  res.status(status).json({ error: status < 500 ? error.message : 'Internal error' });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 ServiceNow webhook listening on port ${PORT}`);
  retryWaitingSoon();
});
// Records waiting for what they belong to: tried again every minute too
setInterval(retryWaitingSoon, 60 * 1000).unref();

// Stop taking calls, finish the work already acknowledged, then close the pools
async function shutdown(signal) {
  console.log(`${signal}: finishing ${pending.size} record(s), then stopping`);
  server.close();
  await Promise.allSettled([...pending]);
  await Promise.allSettled([analytics.end(), onetouch.end()]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
