// =====================================================================
// Builds the static OneTouch demo for the portfolio site (GitHub Pages).
//
//   node demo/build-portfolio-demo.mjs [output folder]
//
// Default output: ../Portfolio-Site/onetouch. It copies the front end in
// public/, takes out every client name and real ticket detail, and adds
// demo/static/mock-api.js, which answers the page's /api calls in the
// browser with generated data. It stops with an error if anything that
// names the client is still in the output.
//
// This script stays in this repo: its scrub list names the client, so it
// must never be copied to the public portfolio.
// =====================================================================

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { architectureMap } from '../architecture.mjs';
import { buildRisks, EXAMPLE, EXAMPLE_CLIMB_MS, EXAMPLE_FROM, EXAMPLE_LASTS_MS } from '../risks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const OUT = resolve(process.argv[2] || join(ROOT, '..', 'Portfolio-Site', 'onetouch'));

// Never copied: the client's logo, and the 4 MB sign-in photo (the app background stands in)
const SKIP = new Set(['molsoncoorslogo.png', 'login-background.jpg', 'site.webmanifest']);
const TEXT = new Set(['.js', '.css', '.html', '.json', '.webmanifest', '.svg', '.txt', '.md']);

// Client names, their team codes and sites, and the real ticket numbers in examples
const SCRUBS = [
  [/@molsoncoors\.com/gi, '@demo.example'],
  [/molson\s*coors/gi, 'Demo Co.'],
  [/molsoncoors/gi, 'democo'],
  [/\b(TCS|ACN|MCBC|MC)-[A-Za-z0-9/()_-]+/g, 'INFRA-Cloud-Linux'],
  [/\bMCBC\b/g, 'DEMO'],
  [/Breweries/g, 'Plants'], [/breweries/g, 'plants'], [/BREWERIES/g, 'PLANTS'],
  [/Brewery/g, 'Plant'], [/brewery/g, 'plant'], [/BREWERY/g, 'PLANT'],
  [/Brewers/g, 'Testers'], [/brewers/g, 'testers'],
  [/\bSAP\b/g, 'ERP'],
  [/onetouch\.fyi/gi, 'onetouch.example'],
  [/\bMilwaukee\b/gi, 'Riverside'], [/\bBurton\b/gi, 'Hillcrest'], [/\bLongueuil\b/gi, 'Bayview'],
  [/\b(vperez|lvang|lbell)\b/g, 'admin'],
  [/Individual \d+/g, 'A. Person'],
  [/\bINC\d{7}\b/g, 'INC2400123'], [/\bCHG\d{7}\b/g, 'CHG3100456'], [/\bRITM\d{7}\b/g, 'RITM0612345'],
  [/\bSCTASK\d{7}\b/g, 'SCTASK0801234'], [/\bREQ\d{7}\b/g, 'REQ0590123'], [/\bPRB\d{7}\b/g, 'PRB0001234'],
];
// Anything still matching one of these fails the build
const FORBIDDEN = /molson|coors|mcbc|brewer|\bTCS\b|\bACN\b|onetouch\.fyi|milwaukee|burton|longueuil|\bvperez\b|\blvang\b|\blbell\b|Individual \d|TEQ ?Solutions/i;

// Windows line endings become \n, so the patches below match
const scrub = text => SCRUBS.reduce((t, [re, to]) => t.replace(re, to), text.replace(/\r\n/g, '\n'));

function patch(text, from, to, file) {
  if (!text.includes(from)) throw new Error(`${file}: the text to patch was not found: ${from.slice(0, 80)}`);
  return text.replace(from, to);
}

// ---------------------------------------------------------------
// Copy and scrub
// ---------------------------------------------------------------
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const name of readdirSync(PUBLIC)) {
  if (SKIP.has(name)) continue;
  cpSync(join(PUBLIC, name), join(OUT, name), { recursive: true });
}
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
for (const file of walk(OUT)) {
  if (!TEXT.has(extname(file)) || file.includes(`${join('vendor', '')}`)) continue;
  writeFileSync(file, scrub(readFileSync(file, 'utf8')));
}

// ---------------------------------------------------------------
// The page: a demo sign-in, the stand-in API, example questions
// ---------------------------------------------------------------
const indexFile = join(OUT, 'index.html');
let html = readFileSync(indexFile, 'utf8');
html = patch(html, '<title>OneTouch</title>', `<title>OneTouch Demo</title>
    <meta name="description" content="OneTouch: one place to ask questions about IT tickets, build dashboards and run a team's ticket work. A portfolio demo with generated data.">
    <meta name="robots" content="noindex">`, 'index.html');
html = patch(html, '<link rel="manifest" href="site.webmanifest">\n', '', 'index.html');
html = html.replace(/<img src="democologo\.png"[^>]*>|<img src="[^"]*logo\.png" alt="Demo Co\." class="login-brand">/, '');
html = patch(html, '<main class="box">', `<p class="demo-note">Portfolio demo · every ticket, team and person here is generated</p>
        <main class="box">`, 'index.html');
html = patch(html, '<p class="sub">Enter your Demo Co. Email</p>', '<p class="sub">This demo signs you in as a project manager. Any name and password work.</p>', 'index.html');
html = patch(html, '<label for="login-email">Demo Co. Email</label>', '<label for="login-email">Email</label>', 'index.html');
html = patch(html, 'placeholder="your-email"', 'placeholder="your-email" value="jordan.avery"', 'index.html');
html = patch(html, 'placeholder="your-password"', 'placeholder="your-password" value="demo"', 'index.html');
html = patch(html, '>Continue with SSO</button>', '>Open the demo</button>', 'index.html');
html = patch(html, '<p class="foot">Forgot your email or password? <a href="#">Contact Support</a></p>',
  '<p class="foot"><a href="../">← Back to the portfolio</a></p>', 'index.html');
// The sign-in page's brand line, and a way back from inside the app
html = patch(html, '<body class="signed-out">', `<body class="signed-out">
    <style>
        .demo-note { margin: 28px auto 0; padding: 6px 14px; border-radius: 999px; background: rgba(0,0,0,.55); color: #fff; font-size: 13px; text-align: center; max-width: 100%; }
        .demo-pill { position: fixed; left: 12px; bottom: 12px; z-index: 50; padding: 5px 12px; border-radius: 999px; background: rgba(20,20,20,.78); color: #fff; font: 12px/1.4 system-ui, sans-serif; text-decoration: none; }
        .demo-pill:hover, .demo-pill:focus-visible { background: #000; }
        body.signed-out .demo-pill { display: none; }
        /* While the architecture map is open, sit above its "✕ Close the map" button */
        body:has(#architecture-view.active .arch:not(.arch-map-closed)) .demo-pill { bottom: 70px; }
        #drawer-customize { display: none; }
        .demo-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .demo-examples button { font: inherit; font-size: 12.5px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border, #ccc); background: var(--bg-secondary, #fff); color: inherit; cursor: pointer; text-align: left; }
        .demo-examples button:hover { border-color: var(--accent, #a06b1c); }
    </style>
    <a class="demo-pill" href="../" title="Back to the portfolio">← Portfolio · demo with generated data</a>`, 'index.html');
html = patch(html, '<div class="msg system-msg" id="welcome-msg">Hello!</div>', `<div class="msg system-msg" id="welcome-msg">Hello!</div>
                    <div class="msg system-msg demo-help">In this demo a scripted stand-in plays the part of Claude, so it understands the kinds of question below best. Try one:
                        <div class="demo-examples" id="demo-examples"></div>
                    </div>`, 'index.html');
html = patch(html, '<script src="sorting.js"></script>', `<script src="demo/mock-api.js"></script>
    <script>
        // Example questions for the assistant, some naming tickets that exist in this demo's data
        (function () {
            var ex = (window.ONETOUCH_DEMO || {}).examples || {};
            var questions = [
                'How many open incidents are there by priority?',
                'Which teams have the most open incidents?',
                'How many incidents were opened each week?',
                'How many tickets of each type are open right now?',
                'What are the top 5 most requested catalog items?',
                'List the emergency changes',
                'Show open catalog tasks that breached SLA',
                ex.parent ? 'Show me the child incidents of ' + ex.parent : null,
                ex.request ? 'Show me the catalog tasks for ' + ex.request : null,
            ].filter(Boolean);
            var box = document.getElementById('demo-examples');
            box.innerHTML = questions.map(function (q) {
                return '<button type="button" data-demo-question="' + q.replace(/"/g, '&quot;') + '">' + q + '</button>';
            }).join('');
            document.addEventListener('click', function (e) {
                var b = e.target.closest && e.target.closest('[data-demo-question]');
                if (!b) return;
                document.getElementById('user-prompt').value = b.getAttribute('data-demo-question');
                sendPrompt();
            });
        })();
    </script>
    <script src="sorting.js"></script>`, 'index.html');
writeFileSync(indexFile, html);

// The sign-in page uses the app background (the sign-in photo isn't copied)
const cssFile = join(OUT, 'style.css');
writeFileSync(cssFile, readFileSync(cssFile, 'utf8').replace(/login-background\.jpg/g, 'app-background.jpg'));

// The demo account sees the Architecture tab too; Dashboards has no Metabase
const appFile = join(OUT, 'app.js');
let app = readFileSync(appFile, 'utf8');
app = patch(app, "document.getElementById('architecture-tab').hidden = !currentAccess.admin;",
  "document.getElementById('architecture-tab').hidden = !(currentAccess.admin || currentAccess.demo);", 'app.js');
app = patch(app, "message.textContent = 'No team dashboards yet. Whoever runs this OneTouch server can create them with: ' +\n                'docker exec analytics_node_app node scripts/metabase-setup.mjs. You can still build your own under ☰ Dashboards.';",
  "message.textContent = 'The live app also embeds Metabase dashboards here. This demo shows dashboards built in OneTouch itself: open ☰ Dashboards to pick one or build your own.';", 'app.js');
// With no Metabase dashboards, open the demo's own boards instead of a message
app = patch(app, '        if (!dashboards.length) {\n', '        if (!dashboards.length && !prefs.dashboards.boards.length) {\n', 'app.js');
writeFileSync(appFile, app);

// ---------------------------------------------------------------
// The stand-in API and the architecture map it serves
// ---------------------------------------------------------------
mkdirSync(join(OUT, 'demo'), { recursive: true });
cpSync(join(ROOT, 'demo', 'static', 'mock-api.js'), join(OUT, 'demo', 'mock-api.js'));
const map = architectureMap({ model: 'claude-sonnet', push: { listening: false, heard: 0, lastAt: null, last: null, since: new Date().toISOString() } });
writeFileSync(join(OUT, 'demo', 'architecture.json'), scrub(JSON.stringify(map)));

// ⚠️ Risk monitor: the risks' descriptions and the example's timing, from risks.mjs
// (with the server's default budget and email limit). mock-api.js gives the real
// risks demo readings and runs the example in the browser.
const riskList = buildRisks({ mailEnabled: false, claudeBudgetUsd: 5, emailDailyLimit: 300 }).map(({ measure, ...risk }) => risk);
writeFileSync(join(OUT, 'demo', 'risks.json'), scrub(JSON.stringify({
  risks: riskList, example: EXAMPLE, exampleFrom: EXAMPLE_FROM, exampleClimbMs: EXAMPLE_CLIMB_MS, exampleLastsMs: EXAMPLE_LASTS_MS,
})));

// ---------------------------------------------------------------
// Nothing that names the client may remain
// ---------------------------------------------------------------
const hits = [];
for (const file of walk(OUT)) {
  if (!TEXT.has(extname(file)) || file.includes(join('vendor', ''))) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const m = line.match(FORBIDDEN);
    if (m) hits.push(`${relative(OUT, file)}:${i + 1}: …${line.slice(Math.max(0, m.index - 40), m.index + 40).trim()}…`);
  });
}
if (hits.length) {
  console.error(`✋ ${hits.length} line(s) still name the client:\n${hits.slice(0, 40).join('\n')}`);
  process.exit(1);
}
const files = walk(OUT);
const size = files.reduce((s, f) => s + statSync(f).size, 0);
console.log(`✅ Built ${files.length} files (${(size / 1e6).toFixed(1)} MB) in ${OUT}; no client names found.`);
