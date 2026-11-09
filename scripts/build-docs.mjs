// Rebuilds the generated part of README.md: the appendix with every
// source file's full contents, and the table of package versions. The
// hand-written guide above it is left alone.
//
//   npm run docs              rewrite README.md
//   node scripts/build-docs.mjs --check   fail if it is out of date (npm run check does this)
//
// Every tracked file must be either in FILES (copied in full) or in SKIPPED
// (with the reason the guide gives). A new file that is in neither fails the
// check, so the guide can't silently fall behind the repo.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const DOC = 'README.md';
const BEGIN = '<!-- BEGIN GENERATED: do not edit below; run `npm run docs` -->';
const END = '<!-- END GENERATED -->';

// In the order the guide builds them. Each is copied into the appendix verbatim.
const FILES = [
  '.gitignore', '.gitattributes', 'package.json', '.env.example',
  'load_csv.sql', 'db/init-auth.sh', 'db/init-reporting.sh', 'db/reporting-views.sql',
  'model/cubes/incident.yml', 'model/cubes/change_request.yml', 'model/cubes/sc_req_item.yml',
  'model/cubes/sc_task.yml', 'model/cubes/change_approvals.yml', 'model/cubes/ritm_approvals.yml',
  'model/views/example_view.yml',
  'Dockerfile', 'docker-compose.yml',
  'business_logic.mjs', 'BUSINESS_LOGIC.md', 'empty_results.mjs', 'export.mjs',
  'auth.mjs', 'scripts/users.mjs', 'server.mjs',
  'public/index.html', 'public/style.css', 'public/app.js', 'public/site.webmanifest',
  'onetouchsso.html', 'styles2.css',
  'scripts/metabase-setup.mjs', 'remote.mjs',
  '.claude/agents/onetouch-developer.md', '.claude/agents/onetouch-reviewer.md',
  'scripts/check.mjs', 'scripts/build-docs.mjs',
  // Added later; at the end so the guide's links to B.1-B.36 keep their numbers
  'tickets.mjs', 'stars.mjs', 'scripts/share.mjs', 'scripts/warmup.mjs', 'scripts/warmup-questions.txt',
  'seen.mjs', 'relations.mjs',
  'prefs.mjs', 'charts.mjs', 'public/charts.js', 'public/customize.js', 'shares.mjs', 'public/families.js',
  'scripts/signin-links.mjs', 'chats.mjs', 'teams.mjs', 'public/teams.js', 'CLAUDE.md',
  'notifications.mjs', 'public/notifications.js', 'kpis.mjs', 'public/sorting.js', 'public/picker.js',
  'public/lookup.js', 'mail.mjs', 'scripts/mail-test.mjs', 'db/demo-tickets.sql', 'db/demo-tickets-remove.sql',
  'servicenow-sync/package.json', 'servicenow-sync/.env.example', 'servicenow-sync/db/schema.sql',
  'servicenow-sync/src/app.js', 'servicenow-sync/src/config/db.js', 'servicenow-sync/src/config/schema.js',
  'servicenow-sync/src/middleware/verifyToken.js', 'servicenow-sync/src/routes/webhook.js',
  'servicenow-sync/src/processRecord.js', 'servicenow-sync/src/db/upsertRecord.js',
  'servicenow-sync/src/db/pending.js', 'servicenow-sync/src/families.js',
  'servicenow-sync/servicenow-blueprint.md',
  'checks/ticket-order.mjs', '.github/workflows/ci.yml', '.dockerignore', 'public/accessibility.js',
  'architecture.mjs', 'public/architecture.js', 'checks/architecture.mjs', 'health.mjs', 'issues.mjs', 'checks/issues.mjs', 'checks/attention.mjs',
  'usage.mjs', 'scripts/usage.mjs', 'scripts/eval-translation.mjs', 'checks/usage.mjs',
];

// Not copied in, and why (shown in the appendix)
const SKIPPED = {
  'README.md': 'this file',
  'package-lock.json': 'written by `npm install`; the versions it pins are in the table above',
  'servicenow-sync/package-lock.json': 'written by `npm install` in `servicenow-sync/`',
  'db/accounts.json': "everyone's usernames and password hashes; make your own accounts instead (step 16)",
  'public/vendor/three-0.186.1/three.module.js': 'three.js, unchanged: `build/three.module.js` from `npm pack three@0.186.1`',
  'public/vendor/three-0.186.1/three.core.js': 'three.js, unchanged: `build/three.core.js` from `npm pack three@0.186.1`',
  'public/vendor/three-0.186.1/LICENSE': 'three.js\'s MIT license, from the same package',
};

// Images can't be pasted as text; the guide says how to make each one (step 14)
const IMAGES = {
  'public/favicon.ico': 'browser tab icon (16, 32 and 48 px inside one .ico)',
  'public/favicon-16x16.png': 'tab icon, 16×16',
  'public/favicon-32x32.png': 'tab icon, 32×32; also shown on the sign-in box',
  'public/apple-touch-icon.png': 'iPhone/iPad home-screen icon, 180×180',
  'public/android-chrome-192x192.png': 'app icon, 192×192; also the logo in the page header',
  'public/android-chrome-512x512.png': 'app icon, 512×512',
  'public/molsoncoorslogo.png': 'Molson Coors logo above the sign-in box, 320×143',
  'public/microsoftlogo.png': 'Microsoft logo on the "Microsoft Entra ID" button, 447×447',
  'public/login-background.jpg': 'wheat-field photo filling the sign-in page behind the box',
  'molsoncoorslogo.png': 'unused copy of public/molsoncoorslogo.png',
  'microsoftlogo.png': 'unused copy of the Microsoft logo, 447×447',
  'microsoftlogo (1).png': 'unused copy of public/microsoftlogo.png',
};

function tracked() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

// A fence longer than any run of backticks inside the file
function fence(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map(s => s.length));
  return '`'.repeat(longest + 1);
}

const LANG = { mjs: 'js', js: 'js', json: 'json', sql: 'sql', sh: 'sh', yml: 'yaml', md: 'markdown',
  html: 'html', css: 'css', webmanifest: 'json', Dockerfile: 'dockerfile' };

function lang(file) {
  const base = file.split('/').pop();
  return LANG[base] || LANG[base.split('.').pop()] || '';
}

function versionsTable() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const rows = Object.entries(pkg.dependencies).map(([name, range]) =>
    `| \`${name}\` | \`${range}\` | ${lock.packages[`node_modules/${name}`]?.version ?? '?'} |`);
  return ['| Package | package.json asks for | Installed (package-lock.json) |', '|---|---|---|', ...rows].join('\n');
}

function generate() {
  const files = new Set(tracked());
  const problems = [];
  for (const f of files) {
    if (!FILES.includes(f) && !(f in SKIPPED) && !(f in IMAGES)) {
      problems.push(`${f} is not in the guide: add it to FILES, SKIPPED or IMAGES in scripts/build-docs.mjs`);
    }
  }
  for (const f of [...FILES, ...Object.keys(IMAGES)]) {
    if (!files.has(f)) problems.push(`${f} is listed in scripts/build-docs.mjs but is not in the repo`);
  }
  if (problems.length) return { problems };

  const out = [BEGIN, '', '## Appendix A: package versions', '',
    'What `npm install` gave when this guide was generated. If something behaves differently, ' +
    'install these exact versions (`npm install <package>@<version>`).', '', versionsTable(), '',
    '## Appendix B: every file, in full', '',
    'Create each file at the path shown, with exactly this content. Files are in the order the guide builds them.', ''];

  FILES.forEach((f, i) => out.push(`- [B.${i + 1} \`${f}\`](#b${i + 1})`));
  out.push('');

  FILES.forEach((f, i) => {
    // Windows checkouts may have CRLF line endings; the guide always uses LF
    const text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const body = text.endsWith('\n') ? text : text + '\n';
    const f3 = fence(text);
    out.push(`<a id="b${i + 1}"></a>`, `### B.${i + 1} \`${f}\``, '', `${f3}${lang(f)}`, body + f3, '');
  });

  out.push('## Appendix C: images', '',
    'Make or download an image with the same name and size (step 14). The SHA-256 lets you check a copy against the original.', '',
    '| File | What it is | Bytes | SHA-256 |', '|---|---|---|---|');
  for (const [f, what] of Object.entries(IMAGES)) {
    const data = readFileSync(f);
    out.push(`| \`${f}\` | ${what} | ${data.length.toLocaleString('en-US')} | \`${createHash('sha256').update(data).digest('hex').slice(0, 16)}…\` |`);
  }
  out.push('', '## Appendix D: files not copied here', '', '| File | Why |', '|---|---|');
  for (const [f, why] of Object.entries(SKIPPED)) out.push(`| \`${f}\` | ${why} |`);
  out.push('', END, '');
  return { text: out.join('\n') };
}

const current = readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
const start = current.indexOf(BEGIN);
if (start === -1) {
  console.error(`${DOC} has no "${BEGIN}" line; put it where the appendix should start.`);
  process.exit(1);
}

const { text, problems } = generate();
if (problems) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const updated = current.slice(0, start) + text;
if (process.argv.includes('--check')) {
  if (updated !== current) {
    console.error(`${DOC} is out of date with the code: run npm run docs and commit it.`);
    process.exit(1);
  }
  console.log(`${DOC}: up to date (${FILES.length} files)`);
} else {
  writeFileSync(DOC, updated);
  console.log(`${DOC}: rewrote the appendix (${FILES.length} files, ${Object.keys(IMAGES).length} images)`);
}
