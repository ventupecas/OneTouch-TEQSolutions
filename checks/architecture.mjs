// The 🧊 Architecture map, held to the repo (no Cube, no database, no API key).
// It's a hand-written description, so this is what stops it falling behind:
// every file it names exists, every link joins two real blocks, every step of
// a flow follows a link, every container in docker-compose.yml is on it, and
// the page anyone can download holds none of it.
//
//   npm test        (CI runs it on every push)
//
// Exits non-zero, listing everything wrong.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { architectureMap, composeImages, FLOWS, LAYERS, LINKS, NODES, PLAN, SERVICENOW } from '../architecture.mjs';
import { buildChecks, makeHealth, noteResponse } from '../health.mjs';
import { asProblems, buildRisks, EXAMPLE, makeRisks } from '../risks.mjs';

const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

const ids = new Set(NODES.map(n => n.id));
const layers = new Set(LAYERS.map(l => l.id));
check(ids.size === NODES.length, 'Two blocks share an id');

for (const node of NODES) {
  check(layers.has(node.layer), `${node.id}: no layer "${node.layer}"`);
  for (const file of node.files) check(existsSync(file), `${node.id}: names ${file}, which doesn't exist`);
}

const linked = (a, b) => LINKS.some(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
for (const link of LINKS) {
  check(ids.has(link.from), `A link starts at "${link.from}", which isn't a block`);
  check(ids.has(link.to), `A link ends at "${link.to}", which isn't a block`);
}
for (const flow of FLOWS) {
  flow.steps.forEach(({ path }, i) => {
    path.forEach((id, j) => {
      check(ids.has(id), `${flow.id} step ${i + 1}: "${id}" isn't a block`);
      if (j) check(linked(path[j - 1], id), `${flow.id} step ${i + 1}: no link from ${path[j - 1]} to ${id}`);
    });
  });
}

const stepped = FLOWS.flatMap(f => f.steps).filter(s => s.around);
for (const step of stepped) {
  for (const id of step.around) check(linked(id, step.path[0]), `A step shows ${id} around ${step.path[0]}, and they aren't linked`);
}
SERVICENOW.arrives.forEach((id, i, path) => {
  check(ids.has(id), `A record arrives through "${id}", which isn't a block`);
  if (i) check(linked(path[i - 1], id), `A record arrives from ${path[i - 1]} to ${id}, and they aren't linked`);
});

// The 2D view is the same map: every block is on the sheet with a sentence
// saying what it does, in its own layer's band and on the same side of the
// Docker Compose frame as in 3D; no two blocks overlap, and each line starts and
// ends on its own blocks, in straight runs that go through no other block.
const inside = ([x, y, w, h], [bx, by, bw, bh]) => x >= bx && y >= by && x + w <= bx + bw && y + h <= by + bh;
const onSheet = rect => inside(rect, [0, 0, PLAN.w, PLAN.h]);
const onEdge = ([px, py], [x, y, w, h]) => ((px === x || px === x + w) && py >= y && py <= y + h)
  || ((py === y || py === y + h) && px >= x && px <= x + w);
const compose = architectureMap().compose;
for (const node of NODES) {
  check(typeof node.doing === 'string' && node.doing.length > 0 && node.doing.length <= 120, `${node.id}: its sentence for the 2D view must be 1-120 characters`);
  check(node.plan?.length === 4 && onSheet(node.plan), `${node.id}: its place in the 2D view is off the sheet`);
  const layer = LAYERS.find(l => l.id === node.layer);
  check(layer?.band && inside(node.plan, layer.band), `${node.id}: outside the ${node.layer} band in the 2D view`);
  const in3d = node.pos[0] >= compose.min[0] && node.pos[0] <= compose.max[0] && node.pos[1] >= compose.min[1] && node.pos[1] <= compose.max[1];
  check(in3d === inside(node.plan, compose.band), `${node.id}: on different sides of the Docker Compose frame in 2D and 3D`);
}
for (const layer of LAYERS) check(layer.band?.length === 4 && onSheet(layer.band) && layer.bandLabel?.length === 3, `${layer.id}: no band for the 2D view`);
NODES.forEach((a, i) => {
  for (const b of NODES.slice(i + 1)) {
    const clear = a.plan[0] + a.plan[2] <= b.plan[0] || b.plan[0] + b.plan[2] <= a.plan[0]
      || a.plan[1] + a.plan[3] <= b.plan[1] || b.plan[1] + b.plan[3] <= a.plan[1];
    check(clear, `${a.id} and ${b.id} overlap in the 2D view`);
  }
});
for (const link of LINKS) {
  const name = `${link.from} to ${link.to}`;
  const route = link.route || [];
  const a = NODES.find(n => n.id === link.from);
  const b = NODES.find(n => n.id === link.to);
  check(route.length >= 2, `${name}: no line in the 2D view`);
  check(link.labelAt?.length === 3 && onSheet([link.labelAt[0], link.labelAt[1], 0, 0]), `${name}: its label in the 2D view is off the sheet`);
  if (route.length < 2 || !a || !b) continue;
  check(onEdge(route[0], a.plan), `${name}: the 2D line doesn't start on the edge of ${a.id}`);
  check(onEdge(route[route.length - 1], b.plan), `${name}: the 2D line doesn't end on the edge of ${b.id}`);
  route.slice(1).forEach(([x2, y2], i) => {
    const [x1, y1] = route[i];
    check((x1 === x2) !== (y1 === y2), `${name}: the 2D line isn't a straight run at point ${i + 1}`);
    for (const node of NODES) {
      const [x, y, w, h] = node.plan;
      const through = Math.max(x1, x2) > x && Math.min(x1, x2) < x + w && Math.max(y1, y2) > y && Math.min(y1, y2) < y + h;
      check(!through, `${name}: the 2D line goes through ${node.id}`);
    }
  });
}

// Every container on the map, with the version docker-compose.yml gives it
const onMap = new Set(NODES.map(n => n.image).filter(Boolean));
for (const image of Object.keys(composeImages())) check(onMap.has(image), `docker-compose.yml runs ${image}, and the map doesn't show it`);
for (const image of onMap) check(composeImages()[image], `The map shows ${image}, and docker-compose.yml doesn't run it`);

const map = architectureMap({ model: 'test-model' });
for (const group of map.stack) {
  for (const item of group.items) check(item.version, `Tech stack: no version for ${item.name}`);
}

// The push says it needs authentication, until a record has really arrived
assert.equal(map.push.state, 'needs-auth');
assert.ok(map.flows.find(f => f.id === 'servicenow').steps.some(s => s.stop), 'The push\'s flow must stop at the gate');
assert.match(map.servicenow.headline, /needs authentication from ServiceNow/);
const open = architectureMap({ push: { heard: 1, lastAt: '2026-11-04T00:00:00.000Z', last: 'INC1900001' } });
assert.equal(open.push.state, 'receiving');
assert.ok(!open.flows.find(f => f.id === 'servicenow').steps.some(s => s.stop || s.phase), 'Once records arrive, nothing says it stops at the gate');
assert.ok(!/can't receive/.test(open.servicenow.summary), 'Once records arrive, the summary moves on');
assert.ok(!/waiting/i.test(open.layers.find(l => l.id === 'push').hint), 'Once records arrive, the push\'s layer stops saying it\'s waiting');
assert.ok(map.layers.every(l => !('openHint' in l)), 'The words for later stay on the server until then');

// No setting's value ever reaches the map, only names
const SECRET = 'not-a-real-secret-3f9a';
for (const name of ['WEBHOOK_SECRET', 'ANTHROPIC_API_KEY', 'BREVO_API_KEY', 'AUTH_DB_PASSWORD', 'METABASE_EMBEDDING_SECRET', 'CUBEJS_API_SECRET', 'TUNNEL_TOKEN']) {
  process.env[name] = SECRET;
}
assert.ok(!JSON.stringify(architectureMap()).includes(SECRET), 'A secret reached the map');

// public/ can be read without signing in, so the map's content must not be there
const page = readFileSync('public/architecture.js', 'utf8') + readFileSync('public/index.html', 'utf8');
for (const fact of ['cube_reader', 'x_onetouch.webhook_secret', 'onetouch_tickets_changed', 'analytics_node_app', 'ticket_access']) {
  check(!page.includes(fact), `public/ holds "${fact}": the map's content belongs in architecture.mjs, behind the admin check`);
}

// The health report: every check points at a real block; a failure, a choice to
// leave something off, and a hang are each told apart; secrets stay out of it
const healthy = {
  db: async sql => (sql.includes('notifications') ? [{ failed: 0, stuck: 0 }] : [{ teams: 6 }]),
  cubeQuery: async () => [{ 'incident.count': '5' }],
  fetch: async () => ({ ok: true, status: 200 }),
  listClaudeModels: async () => ({}),
  hasClaudeKey: true, mailEnabled: true, publicUrl: 'https://example.test', metabaseUrl: 'http://metabase.test',
  dashboardsReady: () => true, listening: () => true,
};
for (const c of buildChecks(healthy)) check(ids.has(c.node), `Health check ${c.id} points at "${c.node}", which isn't a block`);
const stateOf = async (tools, id) => (await makeHealth({ ...healthy, ...tools })()).checks.find(c => c.id === id);
assert.ok((await makeHealth(healthy)()).checks.every(c => c.state === 'ok'), 'All well: nothing reported');
assert.equal((await stateOf({ cubeQuery: async () => { throw new Error('fetch failed'); } }, 'tickets')).state, 'problem');
assert.equal((await stateOf({ db: async () => { throw new Error('connection refused'); } }, 'accounts')).state, 'problem');
assert.equal((await stateOf({ fetch: async () => ({ ok: false, status: 502 }) }, 'dashboards')).state, 'problem');
assert.equal((await stateOf({ listClaudeModels: async () => { throw new Error('401'); } }, 'claude')).state, 'problem');
assert.equal((await stateOf({ listening: () => false }, 'changes')).state, 'problem');
assert.match((await stateOf({ cubeQuery: async () => { throw new Error('fetch failed'); } }, 'tickets')).text, /Cube/, 'A failure says what failed');
assert.equal((await stateOf({ mailEnabled: false }, 'email')).state, 'off', 'No key is a choice, not a fault');
assert.equal((await stateOf({ db: async () => [{ failed: 2, stuck: 0 }] }, 'email')).state, 'problem');
assert.equal((await stateOf({}, 'errors')).state, 'ok');
noteResponse('/api/teams/7/tickets', 500);
noteResponse('/api/teams', 404);
const errors = await stateOf({}, 'errors');
assert.equal(errors.state, 'problem');
assert.match(errors.text, /1 request/);
assert.equal(errors.detail, '/api/teams: 1', 'Only the start of the path, and only server errors');

// ⚠️ The risks: each points at a real block; a reading past its limit comes
// true and is reported as a problem on that block; one that can't be measured
// isn't; and the example climbs until it comes true, then ends by itself
const calm = {
  db: async sql => (sql.includes('pg_stat_activity') ? [{ used: 10, max: 100 }] : sql.includes('claude_usage') ? [{ spent: 0.5 }]
    : sql.includes('notifications') ? [{ sent: 12 }] : [{ locked: 0 }]),
  diskAt: async () => ({ total: 100e9, free: 60e9 }),
  heap: async () => ({ used: 100e6, limit: 2000e6 }),
  mailEnabled: true, claudeBudgetUsd: 5, emailDailyLimit: 300,
};
for (const r of [...buildRisks(calm), EXAMPLE]) {
  check(ids.has(r.node), `Risk ${r.id} points at "${r.node}", which isn't a block`);
  check(r.warnAt < r.failAt && r.failAt <= r.max, `Risk ${r.id}: its warning must come before its limit, within its scale`);
  for (const field of ['name', 'risk', 'watch', 'effect', 'action']) check(r[field], `Risk ${r.id} says nothing for "${field}"`);
}
let clock = Date.parse('2026-11-16T15:00:00Z');
const risksAt = tools => makeRisks({ ...calm, ...tools }, () => clock);
const calmReport = await risksAt({}).report();
assert.ok(calmReport.filter(r => !r.example).every(r => r.state === 'watching'), 'All low: every risk is just watched');
assert.deepEqual(asProblems(calmReport), [], 'Nothing came true: no problems');
const full = await risksAt({ diskAt: async () => ({ total: 100e9, free: 2e9 }) }).report();
assert.equal(full.find(r => r.id === 'disk').state, 'happened');
assert.deepEqual(asProblems(full).map(p => [p.node, p.state]), [['analytics_db', 'problem']], 'A risk that came true is a problem on its block');
assert.equal((await risksAt({ heap: async () => ({ used: 1600e6, limit: 2000e6 }) }).report()).find(r => r.id === 'memory').state, 'close');
assert.equal((await risksAt({ mailEnabled: false }).report()).find(r => r.id === 'email-limit').state, 'off');
const blind = await risksAt({ db: async () => { throw new Error('connection refused'); } }).report();
assert.equal(blind.find(r => r.id === 'connections').state, 'unknown');
assert.deepEqual(asProblems(blind), [], 'Not being able to measure a risk isn\'t the risk coming true');
const demo = risksAt({});
assert.equal((await demo.report()).find(r => r.example).state, 'idle', 'The example waits until someone runs it');
demo.setExample(true, 'Test Admin');
assert.equal((await demo.report()).find(r => r.example).state, 'watching');
clock += 5 * 1000;
const cameTrue = await demo.report();
assert.equal(cameTrue.find(r => r.example).state, 'happened', 'The example comes true within 5 seconds');
assert.deepEqual(asProblems(cameTrue).map(p => [p.node, p.example]), [['cube', true]], 'It shows on Cube, marked as an example');
assert.match(asProblems(cameTrue)[0].text, /Made-up/, 'It says it\'s made up');
clock += 10 * 60 * 1000;
assert.equal((await demo.report()).find(r => r.example).state, 'idle', 'It ends by itself after 10 minutes');
demo.setExample(true, 'Test Admin');
demo.setExample(false);
assert.equal((await demo.report()).find(r => r.example).state, 'idle', 'Stop ends it at once');

if (problems.length) {
  console.error(`The architecture map is out of step with the repo:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Architecture map: ${NODES.length} blocks, ${LINKS.length} links and ${FLOWS.length} flows all match the repo.`);
