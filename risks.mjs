// =====================================================================
// RISKS TO WATCH: the ⚠️ Risk monitor on the 🧊 Architecture page (admins
// only, sent with GET /api/architecture/health). A risk hasn't gone wrong
// yet, but could. Each one is really measured, and once its reading passes
// its limit it "comes true": it is reported with the health checks
// (asProblems), so the 🩺 Health tab lists it and its block turns red on
// the 2D and 3D map.
//
// Measured only while an admin has the page open, and kept 30 s, like the
// health checks.
//
// One example risk is for demos (EXAMPLE): an admin starts it from the Risk
// monitor, its made-up reading climbs until it comes true, and it ends by
// itself after 10 minutes. Nothing is really wrong, and it says so wherever
// it shows. It lives in this server's memory, so a restart ends it too.
// =====================================================================

const KEEP_MS = 30 * 1000;
const MEASURE_TIMEOUT_MS = 15 * 1000;
// Exported so the portfolio demo (demo/build-portfolio-demo.mjs) climbs the same way
export const EXAMPLE_CLIMB_MS = 4500; // quick, so a demo doesn't wait long
export const EXAMPLE_LASTS_MS = 10 * 60 * 1000;
export const EXAMPLE_FROM = 52;

const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const gb = bytes => `${(bytes / 1e9).toFixed(1)} GB`;
const mb = bytes => `${Math.round(bytes / 1e6).toLocaleString('en-US')} MB`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// 'watching', 'close' (past its warning) or 'happened' (past its limit)
export const stateOf = (risk, value) => (value >= risk.failAt ? 'happened' : value >= risk.warnAt ? 'close' : 'watching');

// tools: { db(sql) -> rows, diskAt() -> { total, free } in bytes, heap() -> { used, limit } in bytes,
//          mailEnabled, claudeBudgetUsd, emailDailyLimit }
// Each measure() returns { value, text }, or { off: sentence } when it doesn't apply here, or throws.
export function buildRisks(tools) {
  return [
    {
      id: 'disk', node: 'analytics_db', name: 'The computer\'s disk fills up',
      risk: 'Docker\'s disk (both databases), the saved answers and the logs all live on this computer\'s drive, and they only grow.',
      watch: 'How full the drive that holds OneTouch\'s folder and Docker\'s disk is.',
      effect: 'Postgres can\'t save anything: sign-ins, assignments and notifications fail, and the databases may not start again.',
      action: 'Free space on the drive (docker system prune, old downloads), or move Docker\'s disk to a bigger one.',
      unit: '%', warnAt: 85, failAt: 95, max: 100,
      async measure() {
        const { total, free } = await tools.diskAt();
        const used = percent(total - free, total);
        return { value: used, text: `${used}% full: ${gb(free)} free of ${gb(total)}.` };
      },
    },
    {
      id: 'connections', node: 'onetouch_auth', name: 'Postgres runs out of connections',
      risk: 'The Node server, Cube and Metabase each keep connections open to the one Postgres server, and a stuck query holds one.',
      watch: 'Connections in use, against Postgres\'s max_connections.',
      effect: 'New connections are refused: sign-in, ticket data and dashboards fail for everyone at once.',
      action: 'See what holds them (pg_stat_activity) and restart it, or raise max_connections.',
      unit: '%', warnAt: 75, failAt: 95, max: 100,
      async measure() {
        const [{ used, max }] = await tools.db(
          "SELECT (SELECT count(*) FROM pg_stat_activity)::int AS used, current_setting('max_connections')::int AS max");
        return { value: percent(used, max), text: `${used} of ${max} connections in use.` };
      },
    },
    {
      id: 'claude-spend', node: 'claude', name: 'AI spending passes its daily budget',
      risk: 'Every new question costs a little. A busy day, a big warm-up run or something asking in a loop adds up quickly.',
      watch: `What Claude cost in the last 24 hours (claude_usage), against a budget of $${tools.claudeBudgetUsd} a day (CLAUDE_DAILY_BUDGET_USD).`,
      effect: 'More is being spent than planned. If the Anthropic workspace\'s spend limit is reached, new questions stop being answered.',
      action: 'npm run usage shows who and what is asking. Raise the budget here, or the spend limit in Anthropic\'s console.',
      unit: '%', warnAt: 75, failAt: 100, max: 100,
      async measure() {
        const [{ spent }] = await tools.db(
          "SELECT coalesce(sum(cost_usd), 0)::float AS spent FROM claude_usage WHERE at > now() - interval '24 hours'");
        return { value: percent(spent, tools.claudeBudgetUsd), text: `$${spent.toFixed(2)} of the $${tools.claudeBudgetUsd} budget in the last 24 hours.` };
      },
    },
    {
      id: 'email-limit', node: 'brevo', name: 'Brevo\'s daily sending limit is reached',
      risk: 'Brevo sends only so many emails a day on this plan. Email everyone on demo day, or a family of hundreds handed out, uses it fast.',
      watch: `Emails sent in the last 24 hours, against ${tools.emailDailyLimit} a day (BREVO_DAILY_LIMIT).`,
      effect: 'Brevo refuses the rest of the day\'s emails. The 🔔 in the header still works.',
      action: 'Switch Email everyone off, or move to a Brevo plan that sends more and raise BREVO_DAILY_LIMIT.',
      unit: '%', warnAt: 80, failAt: 100, max: 100,
      async measure() {
        if (!tools.mailEnabled) return { off: 'Email is off here, so nothing is sent.' };
        const [{ sent }] = await tools.db(
          "SELECT count(*)::int AS sent FROM notifications WHERE emailed_at > now() - interval '24 hours'");
        return { value: percent(sent, tools.emailDailyLimit), text: `${plural(sent, 'email')} of ${tools.emailDailyLimit} in the last 24 hours.` };
      },
    },
    {
      id: 'memory', node: 'express', name: 'The Node server runs out of memory',
      risk: 'The ticket index, KPIs, chart results and saved answers are kept in memory. More tickets, or something that never lets go, makes them grow.',
      watch: 'How much of its memory limit the Node server is using.',
      effect: 'The server stops and restarts: everyone loses what they were doing, and the site is down for a few seconds.',
      action: 'Restart the app, and look for what grew. If the data really grew, give Node more memory (--max-old-space-size).',
      unit: '%', warnAt: 75, failAt: 90, max: 100,
      async measure() {
        const { used, limit } = await tools.heap();
        return { value: percent(used, limit), text: `${mb(used)} of ${mb(limit)} in use.` };
      },
    },
    {
      id: 'lockouts', node: 'auth', name: 'Someone is guessing passwords',
      risk: 'Five wrong passwords lock an account for 15 minutes. One locked account is someone who forgot; several at once looks like guessing.',
      watch: 'How many accounts are locked right now.',
      effect: 'Those people can\'t sign in for 15 minutes, and someone may be trying to get in.',
      action: 'See whose (npm run users -- list), and check who is reaching the site in Cloudflare.',
      unit: 'accounts', warnAt: 2, failAt: 4, max: 6,
      async measure() {
        const [{ locked }] = await tools.db('SELECT count(*) FILTER (WHERE locked_until > now())::int AS locked FROM users');
        return { value: locked, text: `${plural(locked, 'account')} locked right now.` };
      },
    },
  ];
}

// The demo's risk: on the Cube block, so it shows in the middle of the map
export const EXAMPLE = {
  id: 'example', node: 'cube', name: 'Example: Cube runs out of memory', example: true,
  risk: 'For demos only. Cube keeps recent query results in memory; if it filled up, Cube would stop answering.',
  watch: `A made-up reading. Once someone presses Run, it climbs from ${EXAMPLE_FROM}% to 100% in ${EXAMPLE_CLIMB_MS / 1000} seconds.`,
  effect: 'If this were real: search, charts, KPIs and the AI assistant\'s answers would stop.',
  action: 'Nothing: it isn\'t real. Press Stop, or it ends by itself after 10 minutes.',
  unit: '%', warnAt: 80, failAt: 95, max: 100,
};

// Keeps each risk's last reading, when it came true, and the example
export function makeRisks(tools, now = () => Date.now()) {
  const risks = buildRisks(tools).map(risk => ({ ...risk, reading: null, at: 0, running: null, since: null }));
  let example = null; // { startedAt, by }

  async function measureOne(risk) {
    let reading;
    try {
      const answer = await Promise.race([
        risk.measure(),
        new Promise((_, reject) => { setTimeout(() => reject(new Error('No answer in time.')), MEASURE_TIMEOUT_MS).unref?.(); }),
      ]);
      reading = answer?.off ? { state: 'off', value: null, text: answer.off }
        : { state: stateOf(risk, answer.value), value: answer.value, text: answer.text };
    } catch (error) {
      // Not knowing isn't the risk coming true: the health checks say what's down
      reading = { state: 'unknown', value: null, text: 'It couldn\'t be measured just now.', detail: String(error?.message || '').slice(0, 200) };
    }
    risk.since = reading.state === 'happened' ? risk.since || now() : null;
    risk.reading = reading;
    risk.at = now();
  }

  function exampleNow() {
    if (example && now() - example.startedAt > EXAMPLE_LASTS_MS) example = null;
    const shown = { ...EXAMPLE, running: Boolean(example), checkedAt: new Date(now()).toISOString() };
    if (!example) return { ...shown, state: 'idle', value: null, text: 'Not running.', since: null };
    const share = Math.min(1, (now() - example.startedAt) / EXAMPLE_CLIMB_MS);
    const value = Math.round(EXAMPLE_FROM + (100 - EXAMPLE_FROM) * share);
    const state = stateOf(EXAMPLE, value);
    const cameTrue = example.startedAt + ((EXAMPLE.failAt - EXAMPLE_FROM) / (100 - EXAMPLE_FROM)) * EXAMPLE_CLIMB_MS;
    return {
      ...shown, state, value,
      text: state === 'happened' ? `Made-up reading: Cube is at ${value}% of its memory and has stopped answering.` : `Made-up reading: Cube is at ${value}% of its memory.`,
      since: state === 'happened' ? new Date(cameTrue).toISOString() : null,
      startedBy: example.by, startedAt: new Date(example.startedAt).toISOString(),
      endsAt: new Date(example.startedAt + EXAMPLE_LASTS_MS).toISOString(),
    };
  }

  async function report() {
    await Promise.all(risks.map(risk => {
      if (risk.running) return risk.running;
      if (risk.reading && now() - risk.at < KEEP_MS) return null;
      risk.running = measureOne(risk).finally(() => { risk.running = null; });
      return risk.running;
    }));
    const real = risks.map(({ measure, reading, at, running, since, ...risk }) => ({
      ...risk, ...reading, checkedAt: new Date(at).toISOString(), since: since ? new Date(since).toISOString() : null,
    }));
    return [...real, exampleNow()];
  }

  // Started or stopped by an admin; the name is who, for the others watching
  function setExample(run, by) {
    example = run ? { startedAt: now(), by: String(by || 'An admin').slice(0, 80) } : null;
    return exampleNow();
  }

  return { report, setExample };
}

// The risks that came true, as health checks: the Health tab lists them, the
// banner counts them, and the map turns their blocks red
export function asProblems(risks) {
  return risks.filter(r => r.state === 'happened').map(r => ({
    id: `risk-${r.id}`, node: r.node, name: r.name, state: 'problem', risk: r.id, example: Boolean(r.example),
    text: r.text, effect: r.effect, checkedAt: r.checkedAt, since: r.since,
  }));
}
