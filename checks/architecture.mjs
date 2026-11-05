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
import { architectureMap, composeImages, FLOWS, LAYERS, LINKS, NODES, SERVICENOW } from '../architecture.mjs';

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

if (problems.length) {
  console.error(`The architecture map is out of step with the repo:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Architecture map: ${NODES.length} blocks, ${LINKS.length} links and ${FLOWS.length} flows all match the repo.`);
