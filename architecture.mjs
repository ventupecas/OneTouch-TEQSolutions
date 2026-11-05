// =====================================================================
// THE ARCHITECTURE MAP (admins only): everything the 🧊 Architecture page
// says about how OneTouch is built, served by GET /api/architecture. It
// lives here, not in public/, because public/ can be read without signing
// in: public/architecture.js only holds the drawing code.
//
// It's a hand-written description, so checks/architecture.mjs (npm test)
// holds it to the repo: every file it names must exist, every link must
// join two real blocks, every step of a flow must follow a link, and every
// container in docker-compose.yml must be on it. Versions aren't written
// here at all: they're read from package-lock.json and docker-compose.yml.
//
// Names of settings only, never their values. Nothing here reads a secret.
//
// pos is [x, y, z] in the 3D scene: y is the floor, x runs left to right.
// =====================================================================

import { readFileSync } from 'node:fs';

// Which floor of the stack, top to bottom. color: a --series-* in style.css
export const LAYERS = [
  { id: 'people', name: 'People', color: 'series-1', y: 22.5, plate: [7, 4.5],
    hint: 'Where people use it: a web page, with nothing to install.' },
  { id: 'edge', name: 'Edge', color: 'series-7', y: 18, plate: [7, 4.5],
    hint: 'How the page reaches the server from the internet.' },
  { id: 'app', name: 'Application', color: 'series-3', y: 12, plate: [9, 6],
    hint: 'The Node server and what it is made of. Every permission is decided here.' },
  { id: 'semantic', name: 'Semantic layer and dashboards', color: 'series-2', y: 6, plate: [9, 6],
    hint: 'Cube turns queries into SQL. Metabase draws the dashboards.' },
  { id: 'data', name: 'Data', color: 'series-4', y: 0, plate: [9, 6],
    hint: 'One Postgres server with two separate databases.' },
  { id: 'outside', name: 'Outside services', color: 'series-5', y: null,
    hint: 'Services run by someone else, reached over HTTPS.' },
  { id: 'push', name: 'ServiceNow live push', color: 'warn', y: null,
    hint: 'Built, and waiting on ServiceNow authentication.' },
];

export const NODES = [
  // ---- People ----
  {
    id: 'browser', name: 'OneTouch page', layer: 'people', shape: 'screen', pos: [0, 22.5, 0], big: true,
    tech: 'Plain JavaScript, no build step',
    what: 'The whole interface: Home, Dashboards, Team, the AI assistant and this map. One page, written in plain JavaScript and CSS with no framework, so a change only needs a browser refresh.',
    facts: [
      ['Runs in', 'Each person\'s browser'],
      ['Charts', 'Hand-drawn SVG (public/charts.js)'],
      ['Remembers', 'The session token for this tab, and colors and accessibility settings for this browser'],
      ['Other way in', 'Remote mode (remote.mjs) serves this page from a clone and forwards /api to the server'],
    ],
    secure: 'Holds no permissions of its own: anything it hides is also refused by the server. Scripts can only load from OneTouch itself (the Content-Security-Policy in server.mjs).',
    files: ['public/index.html', 'public/app.js', 'public/charts.js', 'public/customize.js', 'public/families.js', 'public/teams.js', 'public/notifications.js', 'public/accessibility.js', 'public/architecture.js', 'public/style.css', 'remote.mjs'],
  },

  // ---- Edge ----
  {
    id: 'tunnel', name: 'Cloudflare Tunnel', layer: 'edge', shape: 'ring', pos: [0, 18, 0], big: true,
    tech: 'cloudflared', image: 'cloudflare/cloudflared',
    what: 'The only way in from the internet. cloudflared makes an outgoing connection to Cloudflare, so no port on this computer is open to the network. Cloudflare provides the https address.',
    facts: [
      ['Public address', 'https://onetouch.fyi (named tunnel), or a random trycloudflare.com link (quick tunnel)'],
      ['Sends to', 'http://app:8000, inside Docker\'s network'],
      ['Started by', 'Its own Docker Compose profile, or npm run share'],
      ['Worth knowing', 'Cloudflare keeps .js and .css for 4 hours, so the server versions their addresses by content'],
    ],
    secure: 'Every container publishes its port on 127.0.0.1 only, so the tunnel is the one door in. The token is TUNNEL_TOKEN in .env.',
    files: ['docker-compose.yml', 'scripts/share.mjs'],
  },

  // ---- Application ----
  {
    id: 'express', name: 'Node server', layer: 'app', shape: 'server', pos: [0, 12, 0], big: true,
    tech: 'Node.js and Express', npm: 'express', runtime: true,
    what: 'The center of OneTouch. It serves the page and the API, checks who is signed in, and works out which tickets each person may see before anything else runs.',
    facts: [
      ['Container', 'analytics_node_app, port 8000 on 127.0.0.1'],
      ['Start of every request', 'requireLogin finds the person and their scope of tickets'],
      ['Queries', 'Any query from a person goes through req.runQuery, never straight to Cube'],
      ['Listens for', 'Postgres channel onetouch_tickets_changed (what the ServiceNow push announces on)'],
    ],
    secure: 'A session token is required on every OneTouch API route except sign-in. This page\'s data has one more check: admins only.',
    files: ['server.mjs', 'Dockerfile', 'architecture.mjs'],
  },
  {
    id: 'auth', name: 'Sign-in', layer: 'app', shape: 'module', pos: [-3.3, 12, -4.2],
    tech: 'Node crypto: scrypt and SHA-256',
    what: 'Accounts and sessions. Passwords are kept only as salted scrypt hashes, and session tokens only as their SHA-256.',
    facts: [
      ['Session length', '12 hours'],
      ['Wrong passwords', 'Five lock the account for 15 minutes'],
      ['Accounts', 'npm run users; hashes are shared between clones through db/accounts.json'],
    ],
    secure: 'A copy of the sessions table can\'t be used to sign in.',
    files: ['auth.mjs', 'scripts/users.mjs', 'db/accounts.json'],
  },
  {
    id: 'teams', name: 'Teams and permissions', layer: 'app', shape: 'module', pos: [5.4, 12, -4.2],
    tech: 'teams.mjs',
    what: 'Decides what each person sees. Teams, roles, ticket families and assignments live here, and restrictQuery adds "ticket number is one of theirs" to every Cube query for anyone who isn\'t an admin.',
    facts: [
      ['Admins', 'See every ticket'],
      ['Project managers', 'See every ticket of their team'],
      ['Everyone else on a team', 'See only the tickets assigned to them'],
      ['Families', 'Tickets linked to each other stay on one team and are never split'],
    ],
    secure: 'Enforced on the server: the AI assistant, search, records, families, charts and dashboards all go through it.',
    files: ['teams.mjs'],
  },
  {
    id: 'ai', name: 'AI translator', layer: 'app', shape: 'module', pos: [-6.6, 12, -2],
    tech: 'Anthropic SDK', npm: '@anthropic-ai/sdk',
    what: 'Turns a plain-English question into a Cube query with Claude, then checks that query field by field. When a query comes back empty, it works out why.',
    facts: [
      ['Validator', 'normalizeAndValidate: every query from Claude passes through it before Cube'],
      ['Repeated questions', 'Answered from a cache without calling Claude, and validated again each time'],
      ['Refused early', 'A question naming only tickets the person can\'t see never reaches Claude'],
    ],
    secure: 'Claude returns a query, and has no connection to the database. The query then runs with the person\'s own limits added.',
    files: ['business_logic.mjs', 'empty_results.mjs', 'BUSINESS_LOGIC.md'],
  },
  {
    id: 'notify', name: 'Notifications and email', layer: 'app', shape: 'module', pos: [-6.6, 12, 2.2],
    tech: 'notifications.mjs and mail.mjs',
    what: 'The 🔔 in the header, the same notification by email, and the 🚩 problem reports people send the admins. Each is saved in the same transaction as the change it reports, and emails go out from that outbox after the change commits.',
    facts: [
      ['Outbox', 'Checked every 30 seconds, retried up to 5 times, never sent if older than an hour'],
      ['An email holds', 'Who did what and the ticket numbers, never summaries or notes'],
    ],
    secure: 'Test and service accounts are never emailed. MAIL_ONLY_TO limits who gets email while trying it out.',
    files: ['notifications.mjs', 'mail.mjs', 'issues.mjs', 'public/notifications.js'],
  },
  {
    id: 'tickets', name: 'Tickets, KPIs and charts', layer: 'app', shape: 'module', pos: [-1.9, 12, 4.3],
    tech: 'tickets, relations, kpis and charts modules',
    what: 'Ticket search and records, families, KPIs and the charts people build. Every ticket\'s summary and KPI fields are read from Cube once at start, and read again when tickets change.',
    facts: [
      ['Ticket index', 'Only orders and looks up tickets someone may already see; it never decides what they see'],
      ['KPI ages', 'Count to the end of the data, not today, because the export is frozen'],
    ],
    secure: 'Charts and searches build their own Cube queries and run them through the person\'s scope.',
    files: ['tickets.mjs', 'relations.mjs', 'kpis.mjs', 'charts.mjs'],
  },
  {
    id: 'export', name: 'Downloads', layer: 'app', shape: 'module', pos: [3, 12, 4.3],
    tech: 'pdfmake, docx, exceljs and 7-Zip',
    what: 'Turns result tables into PDF, Word, Excel, CSV, text and RTF files, and bundles them as .zip or .7z.',
    facts: [
      ['Input', 'Tables the person already has on screen, sent back up to the server'],
      ['Size limit', '25 MB per request'],
    ],
    secure: 'Needs a session like every other route.',
    files: ['export.mjs'],
  },
  {
    id: 'prefs', name: 'Personal settings', layer: 'app', shape: 'module', pos: [6.8, 12, 0],
    tech: 'prefs, stars, seen, shares and chats modules',
    what: 'What belongs to one person: colors, Home layout and dashboards, starred tickets, ticket results, shared dashboards and saved chats.',
    facts: [
      ['Saved in', 'The account database, so they follow the person to any computer'],
    ],
    secure: 'Only ever read and written for the signed-in person. Shared dashboards are reached by a random token, and still need a sign-in.',
    files: ['prefs.mjs', 'stars.mjs', 'seen.mjs', 'shares.mjs', 'chats.mjs'],
  },

  // ---- Semantic layer and dashboards ----
  {
    id: 'cube', name: 'Cube', layer: 'semantic', shape: 'cube', pos: [-4.4, 6, 0], big: true,
    tech: 'Semantic layer', image: 'cubejs/cube',
    what: 'The data model. It knows what an incident, a change and a request are, and turns a query from the app into SQL, so neither Claude nor the page ever writes SQL.',
    facts: [
      ['Container', 'analytics_cube, port 4000 on 127.0.0.1'],
      ['Model', 'One YAML file per ticket table in model/cubes/'],
      ['Cache', 'In its own memory'],
    ],
    secure: 'Every request needs a token signed with CUBEJS_API_SECRET, and the playground is off. It connects as cube_reader, which can only read.',
    files: ['model/cubes/incident.yml', 'model/cubes/change_request.yml', 'model/cubes/sc_req_item.yml', 'model/cubes/sc_task.yml', 'model/cubes/change_approvals.yml', 'model/cubes/ritm_approvals.yml'],
  },
  {
    id: 'metabase', name: 'Metabase', layer: 'semantic', shape: 'bars', pos: [4.4, 6, 0], big: true,
    tech: 'Dashboards', image: 'metabase/metabase',
    what: 'Draws the dashboards in the Dashboards tab. It only listens on this computer, so its embedded pages reach people through the Node server.',
    facts: [
      ['Container', 'analytics_metabase, port 3000 on 127.0.0.1'],
      ['Its own data', 'An H2 file on the mbdata volume'],
      ['Built by', 'scripts/metabase-setup.mjs, through Metabase\'s API'],
      ['Public links', 'Off'],
    ],
    secure: 'Each person opens links signed for them, with a viewer filter they can\'t change. Every chart reads through reporting.visible_tickets(viewer). It connects as metabase_reader.',
    files: ['scripts/metabase-setup.mjs', 'db/reporting-views.sql'],
  },

  // ---- Data ----
  {
    id: 'analytics_db', name: 'analytics_db', layer: 'data', shape: 'db', pos: [-5, 0, 0.6], big: true,
    tech: 'PostgreSQL', image: 'postgres',
    what: 'The tickets: the six tables the ServiceNow export was loaded into, and the typed reporting views the dashboards read.',
    facts: [
      ['Tables', 'incident, change_request, sc_req_item, sc_task, change_approvals, ritm_approvals'],
      ['Views', 'reporting.incidents, changes, requests, catalog_tasks, approvals and more'],
      ['New rows', 'Only through the ServiceNow push, once it is authenticated. Until then this is the frozen export'],
      ['Container', 'analytics_postgres, port 5432 on 127.0.0.1, on the pgdata volume'],
    ],
    secure: 'Each reader has its own read-only role, and onetouch_app can\'t open this database at all.',
    files: ['load_csv.sql', 'db/init-reporting.sh', 'db/reporting-views.sql'],
  },
  {
    id: 'onetouch_auth', name: 'onetouch_auth', layer: 'data', shape: 'db', pos: [5, 0, 0.6], big: true,
    tech: 'PostgreSQL', image: 'postgres',
    what: 'OneTouch\'s own data, kept apart from the tickets: accounts and sessions, teams and families, who has each ticket, notifications, and each person\'s settings.',
    facts: [
      ['Tables', 'users, sessions, teams, team_members, ticket_families, ticket_assignments, ticket_reports, notifications, user_preferences, starred_tickets, seen_tickets, shared_dashboards, saved_chats'],
      ['Role', 'onetouch_app, its own password (AUTH_DB_PASSWORD)'],
      ['Created by', 'The app on start (auth.mjs ensureSchema and each module\'s own tables)'],
    ],
    secure: 'access_reader can read only the ticket_access view (number, team id, assignee id), and can\'t log in from outside the Postgres container.',
    files: ['db/init-auth.sh', 'auth.mjs', 'teams.mjs'],
  },
  {
    id: 'csv', name: 'ServiceNow export', layer: 'data', shape: 'sheets', pos: [-7, 0, -3.9],
    tech: 'CSV files',
    what: 'Where the first tickets came from: a one-time export of ServiceNow, loaded on the database\'s first start. Until the ServiceNow push is authenticated, the data stays as it was exported.',
    facts: [
      ['Folder', 'csv_data/, never committed'],
      ['Loaded', 'Once, when the Postgres volume is brand new'],
    ],
    secure: 'Ticket data stays out of git and out of the app\'s image (.gitignore, .dockerignore).',
    files: ['load_csv.sql', '.gitignore', '.dockerignore'],
  },
  {
    id: 'db_setup', name: 'Database setup', layer: 'data', shape: 'module', pos: [0, 0, -4.2],
    tech: 'Runs and exits', image: 'postgres',
    what: 'A container that runs on every docker compose up and then exits. It creates what\'s missing, keeps passwords in step with .env, and updates the reporting views and read-only roles.',
    facts: [
      ['Why it exists', 'Postgres only runs its own setup scripts on a brand-new volume'],
      ['Safe to repeat', 'Yes, every statement can run again'],
    ],
    secure: 'This is where cube_reader, metabase_reader and access_reader get their limits.',
    files: ['db/init-auth.sh', 'db/init-reporting.sh', 'docker-compose.yml'],
  },

  // ---- Outside services ----
  {
    id: 'claude', name: 'Claude API', layer: 'outside', shape: 'orb', pos: [-14.5, 15.5, -3], big: true,
    tech: 'Anthropic',
    what: 'Reads a question with the system prompt (what the data holds) and answers with a structured query. It also explains why a query came back empty.',
    facts: [
      ['Key', 'ANTHROPIC_API_KEY in .env'],
      ['Model setting', 'CLAUDE_MODEL in .env, or the default below'],
    ],
    secure: 'Called only by the server, over HTTPS. Never connected to the database.',
    files: ['business_logic.mjs', 'empty_results.mjs', 'server.mjs'],
  },
  {
    id: 'brevo', name: 'Brevo', layer: 'outside', shape: 'orb', pos: [-14.5, 9.5, 3], big: true,
    tech: 'Transactional email',
    what: 'Sends the notification emails, from notifications@onetouch.fyi, through Brevo\'s API.',
    facts: [
      ['Key', 'BREVO_API_KEY in .env. Without one, email is off and notifications only show under the 🔔'],
      ['Addresses', 'Set by an admin (npm run users), never in db/accounts.json'],
    ],
    secure: 'Called only by the server, over HTTPS. Emails hold ticket numbers, not ticket contents.',
    files: ['mail.mjs', 'scripts/mail-test.mjs'],
  },
  {
    id: 'ci', name: 'GitHub Actions', layer: 'outside', shape: 'orb', pos: [-14.5, 22.5, -0.5],
    tech: 'Checks on every push',
    what: 'Runs the checks on every push: the syntax and README checks, npm test and a dependency audit, then fetches the public address to confirm the site is up.',
    facts: [
      ['Build job', 'npm run build, npm test, npm audit'],
      ['Smoke job', 'Fetches https://onetouch.fyi and looks for the sign-in page'],
    ],
    secure: 'Holds no secrets of the app. It doesn\'t deploy anything.',
    files: ['.github/workflows/ci.yml', 'scripts/check.mjs', 'checks/ticket-order.mjs', 'checks/architecture.mjs'],
  },

  // ---- The ServiceNow live push ----
  {
    id: 'servicenow', name: 'ServiceNow', layer: 'push', shape: 'orb', pos: [20.8, 12, 4.4], big: true, pending: true,
    tech: 'Where the tickets really live',
    what: 'Once it\'s set up and authenticated, async Business Rules send every insert and update of an incident, change, requested item, catalog task and approval to OneTouch.',
    facts: [
      ['To set up there', 'A system property, one REST Message, one Script Include and five Business Rules'],
      ['Direction', 'ServiceNow calls OneTouch. OneTouch never signs in to ServiceNow'],
    ],
    secure: 'Needs an admin on the ServiceNow instance, and the shared secret on both sides. See the 🔌 ServiceNow tab.',
    files: ['servicenow-sync/servicenow-blueprint.md'],
  },
  {
    id: 'gate', name: 'Authentication gate', layer: 'push', shape: 'gate', pos: [16.6, 12, 3.2], big: true, pending: true, between: ['servicenow', 'listener'],
    tech: 'X-Webhook-Token',
    what: 'The check every call has to pass. The call must carry X-Webhook-Token equal to WEBHOOK_SECRET, compared in constant time. Without the right token the listener answers 401 and saves nothing.',
    facts: [
      ['Who can pass', 'Only a ServiceNow instance set up with the shared secret'],
      ['Without WEBHOOK_SECRET', 'The listener refuses to start'],
    ],
    secure: 'This is the authentication the push depends on. Without it, no data can arrive however complete the code is.',
    files: ['servicenow-sync/src/middleware/verifyToken.js'],
  },
  {
    id: 'listener', name: 'ServiceNow listener', layer: 'push', shape: 'listener', pos: [12.6, 12, 2], big: true, pending: true,
    tech: 'Express, its own process', pushNpm: 'express',
    what: 'A small server of its own that takes one record per call, saves it in the same tables the export filled, and puts each new ticket in its family by OneTouch\'s own rules.',
    facts: [
      ['Route', 'POST /api/v1/servicenow-webhook, port 8090'],
      ['Health check', 'GET /health'],
      ['Status', 'Built, in servicenow-sync/. Not in docker-compose.yml, so it\'s started on its own with npm start'],
      ['Answers', 'Straight away, then saves, so ServiceNow never waits'],
    ],
    secure: 'Needs its own .env. It uses a servicenow_sync database account for the ticket tables.',
    files: ['servicenow-sync/src/app.js', 'servicenow-sync/src/routes/webhook.js', 'servicenow-sync/src/processRecord.js', 'servicenow-sync/src/families.js', 'servicenow-sync/src/db/upsertRecord.js', 'servicenow-sync/src/db/pending.js', 'servicenow-sync/src/config/schema.js', 'servicenow-sync/db/schema.sql', 'servicenow-sync/.env.example'],
  },
];

// kind: 'main' (a connection that's in use), 'inner' (inside the Node server)
// or 'pending' (built, waiting on ServiceNow). bend: pushes the curve sideways.
export const LINKS = [
  { from: 'browser', to: 'tunnel', kind: 'main', label: 'HTTPS, with the session token' },
  { from: 'tunnel', to: 'express', kind: 'main', label: 'Plain HTTP inside Docker\'s network' },
  { from: 'ci', to: 'tunnel', kind: 'main', label: 'Smoke test of the public address' },

  { from: 'express', to: 'auth', kind: 'inner', label: 'Who is this?' },
  { from: 'express', to: 'teams', kind: 'inner', label: 'What may they see?' },
  { from: 'express', to: 'ai', kind: 'inner', label: 'Questions' },
  { from: 'express', to: 'notify', kind: 'inner', label: 'The 🔔 list' },
  { from: 'express', to: 'tickets', kind: 'inner', label: 'Search, records, KPIs and charts' },
  { from: 'express', to: 'export', kind: 'inner', label: 'Result tables, made into files' },
  { from: 'express', to: 'prefs', kind: 'inner', label: 'Each person\'s settings' },

  { from: 'ai', to: 'claude', kind: 'main', label: 'Question to query, over HTTPS with an API key' },
  { from: 'notify', to: 'brevo', kind: 'main', label: 'Emails, over HTTPS with an API key' },
  { from: 'ai', to: 'cube', kind: 'main', label: 'The validated query, with the person\'s limits added' },
  { from: 'tickets', to: 'cube', kind: 'main', label: 'Search, KPI and chart queries, with a signed token' },
  { from: 'express', to: 'metabase', kind: 'main', label: 'Passes through signed dashboard pages only', bend: 1.6 },

  { from: 'auth', to: 'onetouch_auth', kind: 'main', label: 'Accounts and sessions', bend: 4 },
  { from: 'teams', to: 'onetouch_auth', kind: 'main', label: 'Teams, families and assignments', bend: 2 },
  { from: 'notify', to: 'onetouch_auth', kind: 'main', label: 'Notifications and the email outbox', bend: 4 },
  { from: 'prefs', to: 'onetouch_auth', kind: 'main', label: 'Preferences, stars, results, shares and chats', bend: 2 },
  { from: 'cube', to: 'analytics_db', kind: 'main', label: 'SQL as cube_reader (read-only)' },
  { from: 'metabase', to: 'analytics_db', kind: 'main', label: 'SQL as metabase_reader, through the reporting views' },
  { from: 'analytics_db', to: 'onetouch_auth', kind: 'main', label: 'postgres_fdw as access_reader: ticket_access only' },
  { from: 'csv', to: 'analytics_db', kind: 'main', label: 'load_csv.sql, on the first start' },
  { from: 'db_setup', to: 'analytics_db', kind: 'main', label: 'Reporting views and read-only roles' },
  { from: 'db_setup', to: 'onetouch_auth', kind: 'main', label: 'The database and its role' },

  { from: 'servicenow', to: 'gate', kind: 'pending', label: 'POST { table, record }, carrying X-Webhook-Token' },
  { from: 'gate', to: 'listener', kind: 'pending', label: 'Only calls with the right token get through' },
  { from: 'listener', to: 'analytics_db', kind: 'pending', label: 'Saves the record in the export\'s own table', bend: 1.5 },
  { from: 'listener', to: 'onetouch_auth', kind: 'pending', label: 'teams.placeTicket: family, team, then a signal', bend: 2 },
  { from: 'onetouch_auth', to: 'express', kind: 'pending', label: 'onetouch_tickets_changed: read the data again', bend: -2.5 },
];

// "What happens when…": each step moves along path (blocks joined by links).
// phase, on the ServiceNow flow only: 'needs' (needs setting up in ServiceNow),
// 'stop' (where it stops today) or 'after' (built, runs once authenticated).
export const FLOWS = [
  {
    id: 'signin', icon: '🔑', name: 'Someone signs in',
    steps: [
      { path: ['browser', 'tunnel', 'express'], title: 'The page sends the email and password',
        text: 'POST /api/login, over HTTPS as far as Cloudflare, then through the tunnel to the Node server.' },
      { path: ['express', 'auth'], title: 'The password is checked',
        text: 'auth.mjs compares it with the salted scrypt hash. Five wrong passwords lock the account for 15 minutes.' },
      { path: ['auth', 'onetouch_auth'], title: 'A session is saved',
        text: 'Only the SHA-256 of the token is stored, so a copy of the table can\'t be used to sign in. It lasts 12 hours.' },
      { path: ['onetouch_auth', 'auth', 'express', 'tunnel', 'browser'], title: 'The token goes back to the page',
        text: 'Every later call carries it as a bearer token, and the server works out that person\'s tickets on each request.' },
    ],
  },
  {
    id: 'ask', icon: '💬', name: 'Someone asks Claude',
    steps: [
      { path: ['browser', 'tunnel', 'express'], title: 'The question reaches the server',
        text: 'POST /api/query. requireLogin finds the person and which tickets they may see. A question naming only tickets they can\'t see is refused here.' },
      { path: ['express', 'ai', 'claude'], title: 'Claude writes a query',
        text: 'The server sends the question with a system prompt describing the data. Claude answers with a structured query, and has no connection to the database.' },
      { path: ['claude', 'ai'], title: 'The query is checked',
        text: 'normalizeAndValidate checks every field. A query from Claude never reaches Cube without passing through it.' },
      { path: ['ai', 'cube'], title: 'The person\'s limits are added',
        text: 'teams.restrictQuery adds "ticket number is one of theirs" for anyone who isn\'t an admin, and the query goes to Cube with a signed token.' },
      { path: ['cube', 'analytics_db'], title: 'Cube runs the SQL',
        text: 'Cube turns the query into SQL and runs it as cube_reader, which can only read.' },
      { path: ['analytics_db', 'cube', 'ai', 'express', 'tunnel', 'browser'], title: 'The answer comes back',
        text: 'If matching tickets that aren\'t theirs were left out, the answer says "You can\'t see the full report". If nothing anywhere matches, Claude explains why.' },
    ],
  },
  {
    id: 'dashboard', icon: '📈', name: 'Someone opens a dashboard',
    steps: [
      { path: ['browser', 'tunnel', 'express'], title: 'The server signs a link for this person',
        text: 'GET /api/dashboards returns one link per dashboard, signed with METABASE_EMBEDDING_SECRET, with the viewer filter locked to them. It lasts 12 hours.' },
      { path: ['express', 'metabase'], title: 'The frame loads through the server',
        text: 'Metabase only listens on this computer, so the server passes through what its embedded pages need, and nothing else of Metabase. Metabase checks the signature.' },
      { path: ['metabase', 'analytics_db'], title: 'Each chart reads the reporting views',
        text: 'As metabase_reader. Every chart\'s SQL keeps only reporting.visible_tickets(viewer).' },
      { path: ['analytics_db', 'onetouch_auth'], title: 'Live assignments decide what shows',
        text: 'That function reads onetouch_auth through postgres_fdw as access_reader, which can read only the ticket_access view.' },
      { path: ['onetouch_auth', 'analytics_db', 'metabase', 'express', 'tunnel', 'browser'], title: 'The dashboard appears',
        text: 'The same dashboard for everyone, each person seeing only their own tickets in it.' },
    ],
  },
  {
    id: 'assign', icon: '🔔', name: 'A ticket is assigned',
    steps: [
      { path: ['browser', 'tunnel', 'express'], title: 'A project manager picks a name',
        text: 'They type part of a team member\'s name. Only the people on that family\'s team can be picked.' },
      { path: ['express', 'teams', 'onetouch_auth'], title: 'The assignment and notification are saved together',
        text: 'One transaction, so nobody is told about a change that didn\'t happen.' },
      { path: ['onetouch_auth', 'notify', 'brevo'], title: 'The email goes out afterwards',
        text: 'mail.mjs reads the outbox every 30 seconds. An email holds who did what and the ticket numbers, never summaries or notes.' },
      { path: ['onetouch_auth', 'notify', 'express', 'tunnel', 'browser'], title: 'The 🔔 lights up',
        text: 'The page checks for notifications every minute, and the new assignee sees the ticket in Assigned to me.' },
    ],
  },
  {
    id: 'issue', icon: '🚩', name: 'Someone reports a problem',
    steps: [
      { path: ['browser', 'tunnel', 'express'], title: 'The report reaches the server',
        text: 'Anyone signed in can send one with the 🚩 in the header: POST /api/issues, with the kind of problem and what happened. One person can send 5 in 10 minutes.' },
      { path: ['express', 'notify', 'onetouch_auth'], title: 'The report and the notifications are saved together',
        text: 'One transaction: the report, and a notification for every other admin, so nobody is told about a report that wasn\'t saved.' },
      { path: ['onetouch_auth', 'notify', 'brevo'], title: 'The admins are emailed',
        text: 'Through the usual outbox. The email says who reported what kind of problem. What they wrote stays behind the sign-in.' },
      { path: ['onetouch_auth', 'notify', 'express', 'tunnel', 'browser'], title: 'It shows up here',
        text: 'Under the admins\' 🔔, and in the banner and the 📣 Reports tab of this page, where an admin marks it resolved.' },
    ],
  },
  {
    id: 'servicenow', icon: '🔌', name: 'ServiceNow live push', pending: true,
    steps: [
      { path: ['servicenow'], phase: 'needs', title: 'A ticket is saved in ServiceNow',
        text: 'An async Business Rule runs after the save, so nobody saving a ticket waits. The rules, the Script Include and the REST Message are written out in the blueprint, and still have to be created in ServiceNow.' },
      { path: ['servicenow', 'gate'], phase: 'needs', title: 'ServiceNow calls OneTouch',
        text: 'One record per call: POST { table, record }, with the shared secret in the X-Webhook-Token header.' },
      // around: the blocks to show with it, the one the call comes from last
      { path: ['gate'], around: ['listener', 'servicenow'], phase: 'stop', stop: true, title: 'It stops here today',
        text: 'ServiceNow has to be set up and given the shared secret before any call can pass. Without the right token the listener answers 401 and saves nothing. Everything after this point is built, and is waiting for this step.',
        // What this step says once records really arrive (architectureMap)
        open: { title: 'The token is checked', text: 'Calls with the right token get through. Without it the listener answers 401 and saves nothing.' } },
      { path: ['gate', 'listener'], phase: 'after', title: 'The call is checked and answered',
        text: 'The table, columns and key are checked against the database (400 if they\'re wrong), and the listener answers 200 straight away, so ServiceNow never waits.' },
      { path: ['listener', 'analytics_db'], phase: 'after', title: 'The record is saved',
        text: 'In the same table the export filled. Older updates never replace newer ones. A task that arrives before its request waits in servicenow_pending and is saved when the request arrives.' },
      { path: ['listener', 'onetouch_auth'], phase: 'after', title: 'The ticket finds its family and team',
        text: 'teams.placeTicket joins it to the family it\'s linked to, or starts one on the real team with the fewest tickets. It arrives unassigned, and families are never split.' },
      { path: ['onetouch_auth', 'express'], phase: 'after', title: 'OneTouch hears about it',
        text: 'A signal on the onetouch_tickets_changed channel. The server reads who may see what again at once.' },
      { path: ['express', 'tickets', 'cube'], phase: 'after', title: 'Everything catches up',
        text: 'About 15 seconds later, once Cube\'s cache has the new rows, KPIs, sorting, families and charts are read again. The project manager finds the ticket in Not assigned yet.' },
    ],
  },
];

// The 🔌 ServiceNow tab. What's built, and what it can't do without ServiceNow.
export const SERVICENOW = {
  headline: 'ServiceNow live push is built, but it needs authentication from ServiceNow to work.',
  summary: 'The code that takes new and changed tickets from ServiceNow is finished and in this repo. It can\'t receive anything yet, because ServiceNow hasn\'t been set up to call it or been given the secret that proves the call is genuine. Until then OneTouch keeps showing the frozen export.',
  openSummary: 'Records with the right token are reaching this server. Each one is saved in the same tables the export filled, and each new ticket joins its family and team.',
  built: [
    'A listener of its own (servicenow-sync/): POST /api/v1/servicenow-webhook',
    'The token check: X-Webhook-Token, compared in constant time, 401 if wrong',
    'Every call\'s table, columns and key checked against the database, 400 if wrong',
    'An immediate answer, so a slow database never makes ServiceNow wait',
    'Saving into the same six tables, with older updates never replacing newer ones',
    'A waiting room (servicenow_pending) for a task that arrives before its request',
    'Family and team placement by OneTouch\'s own rules (teams.placeTicket)',
    'OneTouch re-reading its data when told, within about 15 seconds',
    'The ServiceNow side written out, step by step, in the blueprint',
  ],
  needs: [
    { title: 'Access to the ServiceNow instance',
      text: 'Someone with admin rights there creates the system property, the REST Message, the Script Include and five Business Rules.' },
    { title: 'The shared secret on both sides',
      text: 'The same long random value in ServiceNow\'s x_onetouch.webhook_secret property and in the listener\'s WEBHOOK_SECRET. ServiceNow sends it as X-Webhook-Token on every call.' },
    { title: 'An address ServiceNow can reach',
      text: 'ServiceNow\'s cloud can\'t reach localhost. The listener needs a public HTTPS address, and it isn\'t in docker-compose.yml today, so it also has to be started and hosted.' },
    { title: 'A database account for the listener',
      text: 'SELECT, INSERT and UPDATE on the six ticket tables, with its own .env filled in on the server.' },
    { title: 'The instance\'s own field names',
      text: 'The fields marked "check" in the blueprint have no standard ServiceNow field, or were custom in the export.' },
    { title: 'One real ticket to prove it',
      text: 'One ticket saved in ServiceNow and seen in OneTouch, in the right family.' },
  ],
  direction: 'OneTouch never signs in to ServiceNow: ServiceNow calls OneTouch and proves itself with the token. If the ServiceNow team requires OAuth or mutual TLS instead of a shared token, servicenow-sync/src/middleware/verifyToken.js is the check to change.',
  evidence: 'How this page knows: it counts the signals the listener sends this server. It can\'t see ServiceNow itself, and a test call with curl and the right secret counts too.',
  blueprint: 'servicenow-sync/servicenow-blueprint.md',
  // The way a real record goes once it has passed the gate: one dot, when one arrives
  arrives: ['listener', 'onetouch_auth', 'express'],
};

const OVERVIEW = 'A person asks a question on the page. The Node server checks who they are and what they may see, Claude turns the question into a query, and Cube runs it against the ticket data in Postgres. Metabase draws the dashboards from the same data. Every container runs under Docker Compose on one computer, and Cloudflare Tunnel is the only way in from the internet.';

// The floor frame in the scene: what Docker Compose runs, and what it doesn't
const COMPOSE = {
  name: 'Docker Compose: one computer',
  note: 'Every container publishes its port on 127.0.0.1 only. The ServiceNow listener and the outside services are outside this frame.',
  min: [-10, -1.2, -7],
  max: [10, 20, 7],
};

// ---------------------------------------------------------------------
// Versions: read from the files that decide them, so they can't fall behind
// ---------------------------------------------------------------------

function readIfThere(file) {
  try {
    return readFileSync(new URL(file, import.meta.url), 'utf8');
  } catch {
    return null;
  }
}

// image -> tag, from docker-compose.yml
export function composeImages(text = readIfThere('./docker-compose.yml')) {
  const images = {};
  for (const m of String(text || '').matchAll(/^\s*image:\s*([^\s:#]+):([^\s#]+)/gm)) images[m[1]] = m[2];
  return images;
}

function lockVersions(file) {
  try {
    const { packages } = JSON.parse(readIfThere(file));
    return name => packages[`node_modules/${name}`]?.version || null;
  } catch {
    return () => null;
  }
}

function threeVersion() {
  const m = readIfThere('./public/architecture.js')?.match(/vendor\/three-([\d.]+)\//);
  return m ? m[1] : null;
}

function buildStack(model, open) {
  const images = composeImages();
  const npm = lockVersions('./package-lock.json');
  const three = threeVersion();
  return [
    { group: 'Containers (docker-compose.yml)', items: [
      { name: 'PostgreSQL', version: images.postgres, role: 'Tickets and accounts, in two databases' },
      { name: 'Cube', version: images['cubejs/cube'], role: 'Semantic layer' },
      { name: 'Metabase', version: images['metabase/metabase'], role: 'Dashboards' },
      { name: 'cloudflared', version: images['cloudflare/cloudflared'], role: 'The tunnel from the internet' },
    ] },
    { group: 'Server (package-lock.json)', items: [
      { name: 'Node.js', version: process.version.replace(/^v/, ''), role: 'What this server is running on' },
      { name: 'Express', version: npm('express'), role: 'Web server' },
      { name: 'pg', version: npm('pg'), role: 'Postgres client' },
      { name: 'Anthropic SDK', version: npm('@anthropic-ai/sdk'), role: 'Calls Claude' },
      { name: 'pdfmake', version: npm('pdfmake'), role: 'PDF downloads' },
      { name: 'docx', version: npm('docx'), role: 'Word downloads' },
      { name: 'ExcelJS', version: npm('exceljs'), role: 'Excel downloads' },
    ] },
    { group: 'The page (public/)', items: [
      { name: 'JavaScript and CSS', version: 'no build step', role: 'No framework or bundler' },
      { name: 'three.js', version: three, role: 'This 3D map only, loaded when an admin opens it' },
    ] },
    { group: 'Outside services', items: [
      { name: 'Claude', version: model || null, role: 'Turns questions into queries' },
      { name: 'Brevo', version: 'API v3', role: 'Notification emails' },
      { name: 'Cloudflare', version: 'Tunnel', role: 'The public https address' },
      { name: 'GitHub Actions', version: 'CI', role: 'Checks on every push' },
    ] },
    { group: 'ServiceNow live push (servicenow-sync/)', items: [
      { name: 'Listener', version: 'built', role: 'Express on port 8090, its own process' },
      { name: 'ServiceNow side', version: open ? 'records arriving' : 'needs authentication', role: 'REST Message, Script Include, Business Rules' },
    ] },
  ];
}

function nodeVersion(node, images, npm, pushNpm) {
  if (node.image) return images[node.image] || null;
  if (node.runtime) return `${npm(node.npm)}, Node ${process.version.replace(/^v/, '')}`;
  if (node.npm) return npm(node.npm);
  if (node.pushNpm) return pushNpm(node.pushNpm);
  return null;
}

// What the signals say about the push. It can only ever say what this server
// has heard, so "needs authentication" stays until a record really arrives.
export function pushState(push = {}) {
  return {
    state: push.heard > 0 ? 'receiving' : 'needs-auth',
    listening: Boolean(push.listening),
    heard: push.heard || 0,
    lastAt: push.lastAt || null,
    last: push.last || null,
    since: push.since || null,
  };
}

// Everything the page draws. model: the Claude model in use; push: what this
// server has heard from the listener (server.mjs)
export function architectureMap({ model = null, push = {} } = {}) {
  const images = composeImages();
  const npm = lockVersions('./package-lock.json');
  const pushNpm = lockVersions('./servicenow-sync/package-lock.json');
  const status = pushState(push);
  const open = status.state === 'receiving';
  // A step's own words for after the gate is open; the page never gets a phase then
  const flows = !open ? FLOWS : FLOWS.map(flow => (!flow.pending ? flow : {
    ...flow,
    steps: flow.steps.map(({ phase, stop, open: after, ...step }) => ({ ...step, ...after })),
  }));
  const { openSummary, ...servicenow } = SERVICENOW;
  return {
    overview: OVERVIEW,
    compose: COMPOSE,
    layers: LAYERS,
    nodes: NODES.map(({ image, npm: pkg, runtime, pushNpm: pushPkg, ...node }) => ({
      ...node,
      version: nodeVersion({ image, npm: pkg, runtime, pushNpm: pushPkg }, images, npm, pushNpm),
      facts: node.id === 'claude' ? [...node.facts, ['Model in use', model || 'not known']] : node.facts,
    })),
    links: LINKS,
    flows,
    stack: buildStack(model, open),
    servicenow: open ? { ...servicenow, summary: openSummary } : servicenow,
    push: status,
  };
}
