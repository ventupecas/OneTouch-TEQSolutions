// =====================================================================
// REMOTE MODE: use OneTouch on your own localhost:8000 without running
// the whole stack. The page is served from this clone; sign-in, questions
// and downloads are forwarded to the shared OneTouch server, where the
// accounts, the data and the Anthropic key live.
//
// Needs only Node.js 18+ and `npm install`. No Docker, .env, CSVs or API key.
//
//   npm run remote -- https://<the-tunnel-link>     (from anywhere)
//   npm run remote -- http://192.168.5.106:8000      (same network as the server)
//
// The server address can also go in .env as ONETOUCH_SERVER=...
// =====================================================================

import express from 'express';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const target = (process.argv[2] || process.env.ONETOUCH_SERVER || '').trim().replace(/\/+$/, '');
const port = Number(process.env.REMOTE_PORT || 8000);

if (!/^https?:\/\/[^/]+$/.test(target)) {
  console.error(`Give the OneTouch server's address, e.g.:
  npm run remote -- https://example.trycloudflare.com
  npm run remote -- http://192.168.5.106:8000
(or set ONETOUCH_SERVER in .env). Ask whoever runs OneTouch for the current address.`);
  process.exit(1);
}

const app = express();

// Request headers worth passing on; everything else (cookies, host, ...) stays here
const FORWARD_REQUEST = ['authorization', 'content-type', 'accept'];
// Response headers the page needs back (downloads read Content-Disposition)
// (and what Metabase's dashboard pages need: caching and framing rules)
const FORWARD_RESPONSE = ['content-type', 'content-disposition', 'cache-control', 'etag', 'last-modified',
  'content-security-policy', 'x-frame-options', 'location'];

// /api is OneTouch itself; /public and /app are the Metabase dashboards the
// server passes through for the Dashboards tab.
// Bodies are passed through untouched; the same 25 MB cap as the server's export route
app.use(['/api', '/public', '/app'], express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  const headers = {};
  for (const h of FORWARD_REQUEST) if (req.get(h)) headers[h] = req.get(h);

  try {
    const upstream = await fetch(target + req.originalUrl, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) || !req.body?.length ? undefined : req.body,
      redirect: 'manual',
      // Questions can take a while: Claude, then Cube
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    res.status(upstream.status);
    for (const h of FORWARD_RESPONSE) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error(`Could not reach ${target}: ${err.message}`);
    res.status(502).json({ error: `Could not reach the OneTouch server at ${target}. Is it running, and is the address current?` });
  }
});

app.use(express.static('public'));

app.listen(port, async () => {
  console.log(`OneTouch (remote mode) on http://localhost:${port}  ->  ${target}`);
  try {
    const r = await fetch(target + '/', { signal: AbortSignal.timeout(10000) });
    console.log(r.ok ? 'The OneTouch server is reachable. Open the address above and sign in.' : `Warning: the server answered ${r.status}.`);
  } catch (err) {
    console.warn(`Warning: can't reach ${target} yet (${err.message}). Check the address with whoever runs OneTouch.`);
  }
}).on('error', err => {
  console.error(err.code === 'EADDRINUSE'
    ? `Port ${port} is already in use (is the full OneTouch stack running here?). Stop it, or set REMOTE_PORT to another port.`
    : err.message);
  process.exit(1);
});
