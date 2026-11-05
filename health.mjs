// =====================================================================
// IS EVERYTHING WORKING? What the 🧊 Architecture page reports (admins only,
// GET /api/architecture/health). Each check really tries the thing: a small
// query through Cube to the ticket data, a read of the account database, a
// call to Metabase, Claude and the public address. Nothing here costs Claude
// tokens: Claude's check only lists models.
//
// Checks only run while an admin has the page open, and their answers are
// kept for a while, so any number of open pages adds almost no load.
//
// A check's state: 'ok', 'problem', or 'off' (not set up here, which is a
// choice rather than a fault, such as email with no key).
// =====================================================================

const KEEP_MS = 30 * 1000;
const KEEP_OUTSIDE_MS = 5 * 60 * 1000; // what's paid for or far away is asked less often
const CHECK_TIMEOUT_MS = 20 * 1000;
const ERROR_WINDOW_MS = 15 * 60 * 1000;
const MAX_ERRORS = 500;

// ---- Requests the server answered with an error: this catches what no check names ----

const failures = [];

// Called for every response. Only the start of the path: no ids or ticket numbers.
export function noteResponse(path, status, now = Date.now()) {
  if (status < 500) return;
  failures.push({ at: now, where: String(path).split('/').slice(0, 3).join('/') || '/' });
  if (failures.length > MAX_ERRORS) failures.shift();
}

export function recentFailures(now = Date.now()) {
  while (failures.length && now - failures[0].at > ERROR_WINDOW_MS) failures.shift();
  const counts = new Map();
  for (const f of failures) counts.set(f.where, (counts.get(f.where) || 0) + 1);
  return [...counts].map(([where, count]) => ({ where, count })).sort((a, b) => b.count - a.count);
}

// ---- The checks ----

const fail = (text, detail) => {
  const problem = new Error(text);
  problem.detail = detail;
  problem.isOurs = true;
  return problem;
};

// tools: { db(sql) -> rows, cubeQuery(query), fetch, listClaudeModels(), hasClaudeKey,
//          mailEnabled, publicUrl, metabaseUrl, dashboardsReady(), listening() }
// Each check returns a sentence when all is well, or { off: sentence }, or throws.
export function buildChecks(tools) {
  const answered = async (url, what) => {
    let response;
    try {
      response = await tools.fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS - 2000), redirect: 'manual' });
    } catch (error) {
      throw fail(`${what} isn't answering.`, error.message);
    }
    if (response.status >= 500) throw fail(`${what} answered with an error.`, `HTTP ${response.status}`);
    return response;
  };

  return [
    {
      id: 'accounts', node: 'onetouch_auth', name: 'Sign-in and teams', failText: 'The account database isn\'t answering.',
      effect: 'Nobody can sign in, and assignments and notifications stop.',
      async run() {
        const [{ teams }] = await tools.db('SELECT count(*)::int AS teams FROM teams');
        if (!teams) throw fail('No teams are set up, so nobody but admins sees tickets.', 'The first start builds them from Cube.');
        return `The account database answers, with ${teams} teams.`;
      },
    },
    {
      id: 'tickets', node: 'cube', name: 'Ticket data (Cube and analytics_db)', failText: 'Cube or the ticket data isn\'t answering.',
      effect: 'Search, charts, KPIs and the AI assistant\'s answers stop.',
      async run() {
        const result = await tools.cubeQuery({ measures: ['incident.count'], limit: 1 });
        const count = Number(result?.[0]?.['incident.count']);
        if (!count) throw fail('Cube answers, but finds no incidents in the data.');
        return `Cube reads the data: ${count.toLocaleString('en-US')} incidents.`;
      },
    },
    {
      id: 'dashboards', node: 'metabase', name: 'Dashboards (Metabase)',
      effect: 'The Dashboards tab stops showing its charts.',
      async run() {
        const response = await answered(`${tools.metabaseUrl}/api/health`, 'Metabase');
        if (!response.ok) throw fail('Metabase says it isn\'t healthy.', `HTTP ${response.status}`);
        if (!tools.dashboardsReady()) throw fail('Metabase is up, but the dashboards can\'t be signed.', 'Needs METABASE_EMBEDDING_SECRET and a run of scripts/metabase-setup.mjs.');
        return 'Metabase answers, and dashboard links can be signed.';
      },
    },
    {
      id: 'claude', node: 'claude', name: 'AI assistant (Claude API)', keepMs: KEEP_OUTSIDE_MS, failText: 'The Claude API refused this server\'s key or didn\'t answer.',
      effect: 'New questions can\'t be answered. Repeated ones still can.',
      async run() {
        if (!tools.hasClaudeKey) throw fail('No ANTHROPIC_API_KEY is set.');
        await tools.listClaudeModels();
        return 'The Claude API accepts this server\'s key.';
      },
    },
    {
      id: 'email', node: 'brevo', name: 'Notification emails (Brevo)', failText: 'The email outbox can\'t be read.',
      effect: 'People stop being emailed. The 🔔 still works.',
      async run() {
        if (!tools.mailEnabled) return { off: 'Email is off: there is no BREVO_API_KEY.' };
        const [{ failed, stuck }] = await tools.db(
          `SELECT count(*) FILTER (WHERE email_state = 'failed' AND created_at > now() - interval '24 hours')::int AS failed,
                  count(*) FILTER (WHERE email_state = 'pending' AND created_at < now() - interval '15 minutes')::int AS stuck
             FROM notifications`);
        if (failed) throw fail(`${failed} email${failed === 1 ? '' : 's'} could not be sent in the last 24 hours.`);
        if (stuck) throw fail(`${stuck} email${stuck === 1 ? ' is' : 's are'} still waiting after 15 minutes.`);
        return 'Emails are going out.';
      },
    },
    {
      id: 'public', node: 'tunnel', name: 'Public address (Cloudflare Tunnel)', keepMs: 60 * 1000,
      effect: 'People outside this computer can\'t reach OneTouch.',
      async run() {
        if (!tools.publicUrl) return { off: 'No public address is set for this server.' };
        await answered(tools.publicUrl, 'The public address');
        return `${tools.publicUrl} answers.`;
      },
    },
    {
      id: 'changes', node: 'express', name: 'Listening for new tickets',
      effect: 'New tickets from ServiceNow wouldn\'t reach the page until a restart.',
      async run() {
        if (!tools.listening()) throw fail('The server has lost its channel for ticket changes. It keeps trying again.');
        return 'The server is listening for ticket changes.';
      },
    },
    {
      id: 'errors', node: 'express', name: 'Errors people are getting',
      effect: 'Some pages or actions are failing for people right now.',
      async run() {
        const recent = recentFailures();
        if (!recent.length) return 'No errors in the last 15 minutes.';
        const total = recent.reduce((sum, r) => sum + r.count, 0);
        throw fail(`The server answered ${total} request${total === 1 ? '' : 's'} with an error in the last 15 minutes.`,
          recent.slice(0, 5).map(r => `${r.where}: ${r.count}`).join(', '));
      },
    },
  ];
}

// Keeps each check's answer, and when its problem began
export function makeHealth(tools, now = () => Date.now()) {
  const checks = buildChecks(tools).map(check => ({ ...check, result: null, at: 0, running: null, since: null }));

  async function runOne(check) {
    let result;
    try {
      const answer = await Promise.race([
        check.run(),
        new Promise((_, reject) => { setTimeout(() => reject(fail('This check got no answer in time.')), CHECK_TIMEOUT_MS).unref?.(); }),
      ]);
      result = answer?.off ? { state: 'off', text: answer.off } : { state: 'ok', text: answer };
    } catch (error) {
      result = { state: 'problem', text: error.isOurs ? error.message : check.failText || 'This check failed.', detail: String(error.detail ?? (error.isOurs ? '' : error.message)).slice(0, 200) };
    }
    check.since = result.state === 'problem' ? check.since || now() : null;
    check.result = result;
    check.at = now();
  }

  return async function health() {
    await Promise.all(checks.map(check => {
      if (check.running) return check.running;
      if (check.result && now() - check.at < (check.keepMs || KEEP_MS)) return null;
      check.running = runOne(check).finally(() => { check.running = null; });
      return check.running;
    }));
    return {
      checkedAt: new Date(now()).toISOString(),
      checks: checks.map(({ id, node, name, effect, result, at, since }) => ({
        id, node, name, ...result, effect: result.state === 'problem' ? effect : undefined,
        checkedAt: new Date(at).toISOString(), since: since ? new Date(since).toISOString() : null,
      })),
    };
  };
}
