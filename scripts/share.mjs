// Shares OneTouch over the internet through a Cloudflare Tunnel, in one command:
// starts OneTouch if it isn't running, starts the tunnel, checks the link works,
// and prints it (and copies it to the clipboard). Safe to run any time, e.g.
// after restarting the computer, when the free link has changed.
//
//   npm run share            start sharing, or show the current link
//   npm run share -- --new   get a fresh free link (restarts the tunnel)
//   npm run share -- --stop  stop sharing (OneTouch keeps running on this computer)
//
// With TUNNEL_TOKEN in .env it runs the permanent tunnel instead of the free
// one; put its address in .env as ONETOUCH_PUBLIC_URL to have it printed.

import { spawnSync } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Run from the project folder, wherever it was started from
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
dotenv.config({ quiet: true });

const args = process.argv.slice(2);
const token = (process.env.TUNNEL_TOKEN || '').trim();
const publicUrl = (process.env.ONETOUCH_PUBLIC_URL || '').trim();
const localUrl = `http://localhost:${process.env.APP_PORT || 8000}/`;
const QUICK = { profile: 'tunnel', service: 'tunnel', container: 'onetouch_tunnel' };
const NAMED = { profile: 'tunnel-named', service: 'tunnel-named', container: 'onetouch_tunnel_named' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Docker's own progress messages go straight to the screen
function docker(dockerArgs, { quiet = false } = {}) {
  const r = spawnSync('docker', dockerArgs, { encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
  if (r.error?.code === 'ENOENT') stop('Docker is not installed (the "docker" command was not found).');
  return r;
}

function stop(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

// Retries `test` every second or two until it returns something, or gives up after `seconds`
async function waitFor(test, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const result = await test();
    if (result) return result;
    await sleep(1500);
  }
  return null;
}

// What the tunnel container has logged since it last started
function logsSinceStart(container) {
  const started = docker(['inspect', '-f', '{{.State.StartedAt}}', container], { quiet: true }).stdout.trim();
  const r = docker(['logs', '--since', started, container], { quiet: true });
  return `${r.stdout}${r.stderr}`; // cloudflared logs to stderr
}

async function reachable(url) {
  try {
    return (await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })).status < 500;
  } catch {
    return false;
  }
}

// Checks the public link the way someone elsewhere reaches it: looked up through
// public DNS servers, because this computer's own DNS cache can keep saying
// "not found" for minutes after a new link has started working. If public DNS
// can't be reached at all (some networks block it), the normal lookup is used.
const publicDns = new Resolver({ timeout: 5000, tries: 1 });
publicDns.setServers(['1.1.1.1', '8.8.8.8']);

function reachableFromOutside(url) {
  return new Promise(resolve => {
    const lookup = (host, options, callback) => publicDns.resolve4(host).then(
      addresses => options.all ? callback(null, addresses.map(address => ({ address, family: 4 }))) : callback(null, addresses[0], 4),
      error => callback(error));
    const request = https.get(url, { lookup, timeout: 10000 }, response => {
      response.resume();
      resolve(response.statusCode < 500);
    });
    request.on('timeout', () => request.destroy(new Error('timed out')));
    request.on('error', error => {
      const dnsBlocked = ['ETIMEOUT', 'ECONNREFUSED'].includes(error.code) && error.syscall === 'queryA';
      if (dnsBlocked) reachable(url).then(resolve);
      else resolve(false);
    });
  });
}

function copyToClipboard(text) {
  const tool = process.platform === 'win32' ? 'clip' : process.platform === 'darwin' ? 'pbcopy' : null;
  return Boolean(tool) && spawnSync(tool, { input: text }).status === 0;
}

// ---------------------------------------------------------------------

if (docker(['info'], { quiet: true }).status !== 0) {
  stop('Docker is not running. Open Docker Desktop, wait until it says "Engine running", then run this again.');
}

if (args.includes('--stop')) {
  docker(['compose', '--profile', QUICK.profile, '--profile', NAMED.profile, 'stop', QUICK.service, NAMED.service]);
  console.log('\nStopped sharing. OneTouch still runs on this computer at ' + localUrl + '\n');
  process.exit(0);
}

console.log('Starting OneTouch (nothing changes if it is already running)…');
if (docker(['compose', 'up', '-d']).status !== 0) stop('OneTouch did not start; see the messages above.');
if (!await waitFor(() => reachable(localUrl), 180)) {
  stop(`OneTouch did not answer at ${localUrl}. Check it with: docker logs --tail 30 analytics_node_app`);
}

const tunnel = token ? NAMED : QUICK;
const other = token ? QUICK : NAMED;
// Only one tunnel at a time
docker(['compose', '--profile', other.profile, 'stop', other.service], { quiet: true });

console.log(`Starting the ${token ? 'permanent' : 'free'} Cloudflare tunnel…`);
const fresh = args.includes('--new') ? ['--force-recreate'] : [];
if (docker(['compose', '--profile', tunnel.profile, 'up', '-d', ...fresh, tunnel.service]).status !== 0) {
  stop('The tunnel did not start; see the messages above.');
}

let link;
if (token) {
  const connected = await waitFor(() => /Registered tunnel connection/.test(logsSinceStart(tunnel.container)), 60);
  if (!connected) stop(`The permanent tunnel did not connect. Check the token in .env, and see: docker logs --tail 30 ${tunnel.container}`);
  link = publicUrl || null;
} else {
  link = await waitFor(() => (logsSinceStart(tunnel.container).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g) || []).pop(), 60);
  if (!link) stop(`Cloudflare did not hand out a link. Try again with: npm run share -- --new   (details: docker logs --tail 30 ${tunnel.container})`);
}

if (link) console.log(`Checking ${link} works from the internet (a new link can take a minute or two)…`);
const works = link ? await waitFor(() => reachableFromOutside(link), 180) : true;
const copied = link && copyToClipboard(link);

console.log('\n' + '='.repeat(64));
if (link) {
  console.log(`OneTouch is shared at:\n\n    ${link}\n`);
  if (copied) console.log('(Copied to your clipboard.)');
  if (!works) console.log('It is not answering yet; give it a minute before sending it out.');
} else {
  console.log('The permanent tunnel is connected. Put its address in .env as');
  console.log('ONETOUCH_PUBLIC_URL=https://... to have it printed here.');
}
console.log('People sign in there with their own username and password.');
console.log(token
  ? 'This address never changes. It works whenever this computer is on with Docker running.'
  : 'The link stays the same until the tunnel restarts (this computer or Docker restarting).\nRun "npm run share" again after a restart to get the new link.');
console.log('='.repeat(64) + '\n');
