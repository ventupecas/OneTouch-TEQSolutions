// Gets OneTouch ready for a crowd (e.g. a presentation): asks every question in
// scripts/warmup-questions.txt once, so each is answered instantly for everyone
// afterwards, and opens every dashboard once, so Metabase has every chart's
// result ready. It also works as a check that everything still works: anything
// that fails is listed at the end.
//
//   npm run warmup                         this computer's OneTouch (localhost)
//   npm run warmup -- https://onetouch.fyi  another OneTouch server
//   ... -- --user jsmith                    sign in as someone else (asks for the password)
//   ... -- --user jsmith --password-stdin   password from stdin instead of a prompt
//
// It signs in as the "warmup" account, with WARMUP_PASSWORD from .env (or asks
// for the password), so the demo tickets its answers list land in that
// account's Ticket results rather than a real person's. Run it on the day
// itself, and don't restart OneTouch afterwards: a restart forgets the
// remembered questions, and they are tied to the date.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
dotenv.config({ quiet: true });

const base = (process.argv.slice(2).find(a => /^https?:\/\//.test(a)) || `http://localhost:${process.env.APP_PORT || 8000}`).replace(/\/+$/, '');
const QUESTIONS_FILE = 'scripts/warmup-questions.txt';
// The account the warm-up signs in as (create it with: users.mjs add warmup "Warmup")
const WARMUP_USER = 'warmup';
const secs = ms => `${(ms / 1000).toFixed(1)} s`;

function stop(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

// Reads a line from the terminal without echoing what is typed
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('No terminal to type a password into.'));
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = ch => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          stdout.write('\n');
          return resolve(value);
        }
        if (c === '\u0003') { stdout.write('\n'); process.exit(130); } // Ctrl+C
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, '');
}

// The "warmup" account (password: WARMUP_PASSWORD in .env, or asked for);
// --user <name> signs in as someone else, --password-stdin reads the password from stdin
async function signIn() {
  const args = process.argv.slice(2);
  const username = args.includes('--user') ? args[args.indexOf('--user') + 1] : WARMUP_USER;
  let password;
  if (args.includes('--password-stdin')) password = await readStdin();
  else if (username === WARMUP_USER && process.env.WARMUP_PASSWORD) password = process.env.WARMUP_PASSWORD;
  else password = await promptHidden(`Password for ${username}: `);
  console.log(`Signing in as ${username}.`);
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const data = await r.json().catch(() => ({}));
  if (!data.token) stop(data.error || `Sign-in failed (${r.status}).`);
  return data.token;
}

// A one-line summary of an answer: rows found, or what went wrong
function describe(data) {
  if (data.error) return { ok: false, text: data.error };
  if (data.intent !== 'query') return { ok: true, text: `Claude asked for more detail (${data.intent})` };
  const rows = data.combined ? data.combined.rows.length : (data.sections || []).reduce((n, s) => n + s.rows.length, 0);
  return { ok: true, text: data.allEmpty ? 'nothing found (explanation ready)' : `${rows.toLocaleString()} ${rows === 1 ? 'row' : 'rows'}` };
}

// Opens a dashboard the way a browser does: its layout, then every chart's data
async function openDashboard(dashboardPath) {
  const uuid = dashboardPath.split('/').pop();
  const dash = await (await fetch(`${base}/api/public/dashboard/${uuid}`)).json();
  const cards = (dash.dashcards || []).filter(dc => dc.card_id);
  const results = await Promise.all(cards.map(async dc => {
    const r = await fetch(`${base}/api/public/dashboard/${uuid}/dashcard/${dc.id}/card/${dc.card_id}?parameters=[]`);
    const body = await r.json().catch(() => ({}));
    return r.ok && body.status !== 'failed';
  }));
  return { charts: cards.length, failed: results.filter(ok => !ok).length };
}

// ---------------------------------------------------------------------

try {
  await fetch(base, { signal: AbortSignal.timeout(10000) });
} catch {
  stop(`OneTouch is not answering at ${base}. Start it first (npm run share, or docker compose up -d).`);
}

const questions = readFileSync(QUESTIONS_FILE, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
console.log(`Warming up ${base}: ${questions.length} questions from ${QUESTIONS_FILE}, then every dashboard.\n`);
const token = await signIn();
const auth = { Authorization: `Bearer ${token}` };
const started = performance.now();
const problems = [];

console.log('\nQuestions (⚡ = was already ready):');
for (const question of questions) {
  // A fresh conversation each time: only a conversation's first question is remembered for everyone
  await fetch(`${base}/api/conversation/reset`, { method: 'POST', headers: auth });
  const t0 = performance.now();
  let data;
  try {
    const r = await fetch(`${base}/api/query`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ userPrompt: question }) });
    data = await r.json();
  } catch (err) {
    data = { error: err.message };
  }
  const d = describe(data);
  if (!d.ok) problems.push(`"${question}": ${d.text}`);
  console.log(`  ${!d.ok ? '✗' : data.fromCache ? '⚡' : '✓'} ${question}  (${d.text}, ${secs(performance.now() - t0)})`);
}
await fetch(`${base}/api/conversation/reset`, { method: 'POST', headers: auth });

console.log('\nDashboards:');
const list = await (await fetch(`${base}/api/dashboards`, { headers: auth })).json();
if (!list.dashboards?.length) problems.push('No dashboards found (has scripts/metabase-setup.mjs been run?)');
for (const d of list.dashboards || []) {
  const t0 = performance.now();
  try {
    const r = await openDashboard(d.path);
    if (r.failed) problems.push(`Dashboard "${d.name}": ${r.failed} of ${r.charts} charts failed`);
    console.log(`  ${r.failed ? '✗' : '✓'} ${d.name}  (${r.charts} charts${r.failed ? `, ${r.failed} failed` : ''}, ${secs(performance.now() - t0)})`);
  } catch (err) {
    problems.push(`Dashboard "${d.name}": ${err.message}`);
    console.log(`  ✗ ${d.name}  (${err.message})`);
  }
}

// 👪 Ticket families (built into OneTouch): its lists are worked out once, then kept
{
  const t0 = performance.now();
  const r = await fetch(`${base}/api/families`, { headers: auth });
  const data = await r.json().catch(() => ({}));
  if (r.ok) {
    const kinds = Object.keys(data.kinds || {});
    await Promise.all(kinds.map(kind => fetch(`${base}/api/families/${kind}`, { headers: auth })));
    console.log(`  ✓ Ticket families  (${kinds.length} kinds of family, ${secs(performance.now() - t0)})`);
  } else {
    problems.push(`Ticket families: ${data.error || `the server answered ${r.status}`}`);
    console.log(`  ✗ Ticket families  (${data.error || r.status})`);
  }
}

await fetch(`${base}/api/logout`, { method: 'POST', headers: auth });

console.log('\n' + '='.repeat(64));
console.log(`Done in ${secs(performance.now() - started)}.`);
if (problems.length) {
  console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} to look at before people arrive:`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log('Everything worked. These questions now answer instantly for everyone when asked with');
  console.log(`the same words (see ${QUESTIONS_FILE}), and every dashboard opens from Metabase's cache.`);
}
console.log("Don't restart OneTouch before the presentation: a restart forgets the remembered questions.");
console.log('='.repeat(64) + '\n');
