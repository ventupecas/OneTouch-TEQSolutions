# OneTouch: building it from scratch

This guide rebuilds OneTouch, step by step, as it is on `main` today, for someone who
**cannot clone the repository**. Every file the project needs is printed in full in
[Appendix B](#appendix-b-every-file-in-full). The steps below say which files to create
when, what each one does, and how to check that each stage works before you go on.

Keep it current: after any change to the code, run `npm run docs` and commit the updated
file. `npm run check` fails when this guide no longer matches the code.

**Contents**

- [What you are building](#what-you-are-building)
- Steps 1–22: [tools](#step-1-install-the-tools) · [data and API key](#step-2-get-the-data-and-an-anthropic-api-key) ·
  [project folder](#step-3-create-the-project-folder) · [packages](#step-4-the-node-package-list) ·
  [settings](#step-5-the-settings-file) · [tables](#step-6-the-database-tables-and-the-csv-files) ·
  [database scripts](#step-7-the-database-setup-scripts) · [Cube model](#step-8-the-cube-data-model) ·
  [Docker](#step-9-the-docker-files) · [first start](#step-10-start-the-database-and-cube-and-check-them) ·
  [translator](#step-11-the-translator-business-logic) · [empty results and downloads](#step-12-empty-result-explanations-and-downloads) ·
  [sign-in](#step-13-accounts-and-sign-in) · [server and page](#step-14-the-web-server-and-the-page) ·
  [full start](#step-15-start-everything) · [first account](#step-16-the-first-account-and-the-first-question) ·
  [dashboards](#step-17-metabase-dashboards) · [remote mode](#step-18-remote-mode) ·
  [sharing](#step-19-sharing-it-with-other-people) · [Claude Code helpers](#step-20-claude-code-helpers) ·
  [checks and this guide](#step-21-checks-and-this-guide) · [git and branches](#step-22-put-it-in-git-and-recreate-the-branches)
- [Where each branch is](#where-each-branch-is) · [History](#history-how-the-real-repository-got-here)
- Appendices: [A versions](#appendix-a-package-versions) · [B every file](#appendix-b-every-file-in-full) ·
  [C images](#appendix-c-images) · [D files not copied](#appendix-d-files-not-copied-here)

**Shortcut.** If you have this file as `documentation.md`, you can write every file in
Appendix B to disk at once instead of copying them by hand. Save this as `extract.mjs`
next to `documentation.md` and run `node extract.mjs` inside the empty project folder:

```js
// Writes every file printed in Appendix B of documentation.md into the current folder
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const doc = readFileSync(process.argv[2] || 'documentation.md', 'utf8').replace(/\r\n/g, '\n');
const re = /### B\.\d+ `([^`]+)`\n\n(`{3,})[a-z]*\n([\s\S]*?)\2\n/g;
let n = 0;
for (const [, path, , body] of doc.matchAll(re)) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  n++;
}
console.log(`Wrote ${n} files`);
```

You still need to do the steps that aren't files: installing tools, the data, `.env`,
the images, and starting things. Then go straight to step 10.

---

## What you are building

OneTouch lets IT staff ask questions in plain English about a frozen ServiceNow export
(incidents, changes, requests, catalog tasks and approvals) and get tables back, with
downloads and ITIL dashboards. Everything runs in Docker on one computer, the **server**.

```
browser ──► app (Node/Express, port 8000) ──► Claude API: question → Cube JSON query
                 │                         ──► Cube (port 4000) ──► Postgres analytics_db (the CSVs)
                 │                         ──► Postgres onetouch_auth (accounts, sessions)
                 └── /public/... passed through to Metabase (port 3000) ──► Postgres "reporting" views
```

| Container | Image | What it does |
|---|---|---|
| `analytics_postgres` | `postgres:16-alpine` | Holds the CSV data (`analytics_db`) and the accounts (`onetouch_auth`) |
| `db-setup` | `postgres:16-alpine` | Runs on every start, creates the accounts database, reporting views and read-only Metabase user, then exits |
| `analytics_cube` | `cubejs/cube:v0.35` | Turns JSON queries into SQL over the CSV tables |
| `analytics_metabase` | `metabase/metabase:v0.50.4` | Dashboards |
| `analytics_node_app` | built from `Dockerfile` (`node:20-alpine`) | The website, sign-in, the Claude calls, downloads |
| `onetouch_tunnel` (optional) | `cloudflare/cloudflared:2026.9.3` | A public https link for people outside the network |

---

## Step 1: Install the tools

1. **Docker Desktop** (Windows or Mac), or Docker Engine with the Compose plugin (Linux).
   Start it and check: `docker --version` and `docker compose version` both print a version.
2. **Node.js 20** (18 or newer works) from https://nodejs.org. Check: `node --version`.
   The containers bring their own Node; you need it locally for `npm install`, the
   checks, and remote mode.
3. **Git** from https://git-scm.com. Check: `git --version`.
4. A text editor that saves files as UTF-8 (VS Code works).

On Windows, run the commands in PowerShell. Where this guide uses `cp`, PowerShell's
`Copy-Item` (or `cp`, which PowerShell also accepts) does the same.

## Step 2: Get the data and an Anthropic API key

1. **The ServiceNow export.** Six CSV files, from the team that owns the export:
   `incident.csv`, `change_request.csv`, `sc_req_item.csv`, `sc_task.csv`,
   `change_approvals.csv`, `ritm_approvals.csv`. Each has a header row. The database
   loads them **by column position**, so their columns must be in the order the tables
   list in `load_csv.sql` ([B.5](#b5)). The two approval files have no `approval_id`
   column. Without the CSVs everything still starts and you can sign in, but every
   question comes back empty.
2. **An Anthropic API key** from https://console.anthropic.com (API keys). If your
   organisation uses Anthropic workspaces, also note the workspace ID.

## Step 3: Create the project folder

```
mkdir OneTouch-TEQSolutions
cd OneTouch-TEQSolutions
git init -b main
mkdir db model model/cubes model/views public scripts .claude .claude/agents csv_data
```

Create these two files first, so git never picks up secrets, data or line-ending damage:

- `.gitignore` ([B.1](#b1)): keeps `.env`, `node_modules/`, `csv_data/`, all `*.csv` and
  `*.sql` (except `load_csv.sql` and `db/*.sql`), Docker data folders and
  `metabase-dashboards.json` out of git.
- `.gitattributes` ([B.2](#b2)): forces LF line endings on `*.sh`. The shell scripts run
  inside Linux containers, and Windows line endings break them.

## Step 4: The Node package list

Create `package.json` ([B.3](#b3)), then run:

```
npm install
```

This creates `node_modules/` and `package-lock.json`. The packages the code itself uses:

| Package | Used for |
|---|---|
| `express`, `cors` | the web server |
| `dotenv` | reading `.env` |
| `@anthropic-ai/sdk` | calling Claude |
| `pg` | the accounts database |
| `exceljs`, `docx`, `pdfmake`, `7zip-bin` | Excel, Word, PDF and zip/7z downloads |

The rest of the list is their dependencies, written out by hand. The exact versions this
guide was made with are in [Appendix A](#appendix-a-package-versions).

The `scripts` in `package.json`: `npm start` runs the server, `npm run users` manages
accounts, `npm run remote` is remote mode, `npm run check` runs the quick checks,
`npm run docs` rebuilds this guide's appendix.

## Step 5: The settings file

Create `.env.example` ([B.4](#b4)), then copy it to `.env`, which holds the real values
and is never committed:

```
cp .env.example .env
```

Fill in `.env`:

| Setting | What to put |
|---|---|
| `ANTHROPIC_API_KEY` | your key from step 2 |
| `ANTHROPIC_WORKSPACE_ID` | your workspace ID, or leave the line empty |
| `POSTGRES_PASSWORD`, `CUBEJS_API_SECRET`, `CUBEJS_SQL_PASSWORD`, `AUTH_DB_PASSWORD`, `METABASE_DB_PASSWORD` | long random values (see below) |
| `CUBE_API_TOKEN` | any value; the app sends it to Cube |
| `METABASE_ADMIN_EMAIL`, `METABASE_ADMIN_PASSWORD` | the Metabase admin login to create (password at least 8 characters) |
| `ASSUME_TODAY` | optional, e.g. `2026-09-02`, so "last month" falls inside the export (roughly 2026-06-01 to 2026-09-01) |
| `CLAUDE_MODEL` | optional; empty means `claude-sonnet-5-5` |

A random value: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`

`docker compose` refuses to start while a required value is missing, and names the one it wants.

## Step 6: The database tables and the CSV files

1. Create `load_csv.sql` ([B.5](#b5)). On the database's **first** start, Postgres runs
   it: it creates the six tables (every column is `text`), loads each CSV that is present
   from `/tmp/my_csv_files/` (skipping a missing one with a notice), and adds the indexes
   and the task-to-request link.
2. Put the six CSVs from step 2 in `csv_data/`.

The CSVs are only read the first time the database starts. To load them later, see
"Reloading the data" in step 15.

## Step 7: The database setup scripts

Create in `db/`:

- `db/init-auth.sh` ([B.6](#b6)): creates the `onetouch_app` login and the `onetouch_auth`
  database only it can open, and keeps that login's password in step with `.env`. The
  app creates the tables inside it (step 13).
- `db/init-reporting.sh` ([B.7](#b7)): loads the reporting views, then creates the
  read-only `metabase_reader` login, which can see only those views.
- `db/reporting-views.sql` ([B.8](#b8)): the `reporting` schema. The raw tables store text;
  these views give Metabase real dates, numbers and yes/no values plus ready-made fields
  (`is_open`, `age_days`, `hours_to_resolve`, ...). "Now" is the newest date in the data
  (`reporting.data_as_of`), because the export is a frozen snapshot.

The `.sh` files must have LF line endings. Check in your editor's status bar (VS Code
shows `LF` or `CRLF`, and you can click it to change).

## Step 8: The Cube data model

Cube reads every `.yml` under `model/`. Create one file per table, each describing the
columns Cube may query, plus derived day / week / month columns for trend questions and a
`count` measure:

- `model/cubes/incident.yml` ([B.9](#b9))
- `model/cubes/change_request.yml` ([B.10](#b10))
- `model/cubes/sc_req_item.yml` ([B.11](#b11))
- `model/cubes/sc_task.yml` ([B.12](#b12))
- `model/cubes/change_approvals.yml` ([B.13](#b13))
- `model/cubes/ritm_approvals.yml` ([B.14](#b14))
- `model/views/example_view.yml` ([B.15](#b15)): Cube's commented-out example, kept as is.

The member names here are the ones `business_logic.mjs` lets Claude use (step 11). If you
add a column here, add it to the catalog there too.

## Step 9: The Docker files

- `Dockerfile` ([B.16](#b16)): the app image. Node 20 on Alpine, plus the system 7-Zip
  (the one bundled in npm's `7zip-bin` doesn't run on Alpine).
- `docker-compose.yml` ([B.17](#b17)): all the containers in the table at the top. Notes:
  - Postgres, Cube and Metabase listen on `127.0.0.1` only. Other computers reach the
    tool through port 8000 alone.
  - The project folder is mounted into the app container (`.:/app`), so code changes
    need only a restart, not a rebuild. `node_modules` lives in its own anonymous volume.
  - Cube Store's files go on a Docker volume, not the project folder, because a
    OneDrive-synced folder corrupts them.
  - The two tunnel services only start when asked for (`--profile`).

Check the file is valid: `docker compose config -q` prints nothing when all is well.

## Step 10: Start the database and Cube, and check them

```
docker compose up -d postgres db-setup cube
docker compose logs db-setup
```

The `db-setup` log should end with `init-auth: ... ready` and `init-reporting: reporting
views are up to date`. Then check the data loaded:

```
docker exec analytics_postgres psql -U admin -d analytics_db -c "SELECT count(*) FROM incident"
```

That prints the incident row count (23,334 with the export this guide was built from; 0 if
`csv_data/` was empty). Cube takes about half a minute to compile the model; check it with
`docker logs --tail 20 analytics_cube`, and open http://localhost:4000, which shows Cube's
developer playground.

If the counts are 0 but the CSVs are in place, the database was created before they were.
Run `docker compose down -v` (this deletes the database) and start again.

## Step 11: The translator (business logic)

- `business_logic.mjs` ([B.18](#b18)): everything Claude needs to turn a question into a
  Cube query, and the checks on what Claude sends back.
  1. `ENTITY_CATALOG`: per table, its ITIL meaning, row count, date range, the columns,
     and the exact values each coded column holds (states, priorities, categories, ...).
     These were taken from the real CSVs; if your export differs, update them.
  2. `OUTPUT_SCHEMA`: the JSON shape Claude must answer in (`intent` = `query`, `clarify`
     or `unsupported`; the queries; a message; the assumptions it made).
  3. `buildSystemPrompt()`: the instructions, vocabulary and worked examples, built from
     the catalog. `buildUserMessage()` adds today's date to each question.
  4. `normalizeAndValidate()`: only known columns and operators, one table per query,
     correct value spelling (e.g. "p1" → `P1 - Critical`), row limits.
  5. `combineResults()`: merges per-table counts into one table with a total.
- `BUSINESS_LOGIC.md` ([B.19](#b19)): the same rules explained for people.

Check: `node --check business_logic.mjs` prints nothing.

## Step 12: Empty-result explanations and downloads

- `empty_results.mjs` ([B.20](#b20)): when a query finds nothing, it re-runs it with each
  filter removed in turn and checks the dates the data covers, then asks Claude for one
  plain sentence on why, e.g. "without 'state is open' there are 3 P1 incidents, all Closed".
- `export.mjs` ([B.21](#b21)): turns the tables shown in the chat into PDF, Word, Excel,
  CSV, text or RTF files, or a zip / 7z of all six.

## Step 13: Accounts and sign-in

- `auth.mjs` ([B.22](#b22)): accounts and sessions in the `onetouch_auth` database.
  Passwords are stored only as salted scrypt hashes, and session tokens only as SHA-256.
  Five wrong passwords lock an account for 15 minutes, and sessions last 12 hours. Usernames
  are lower-case, and `@molsoncoors.com` typed after one is ignored. It creates its own
  tables on start (`ensureSchema`), and `syncAccounts` loads `db/accounts.json` without
  ever undoing a newer change.
- `scripts/users.mjs` ([B.23](#b23)): the account command line: `list`, `add`,
  `reset-password`, `deactivate`, `activate`, `import` (CSV), `export` (writes
  `db/accounts.json`), `sync`.

## Step 14: The web server and the page

- `server.mjs` ([B.24](#b24)): the Express server on port 8000.
  - `POST /api/login` and `/api/logout`. Wrong passwords are also limited to 20 per
    address per 15 minutes; through the tunnel the real address comes from Cloudflare.
  - Every data route (`/api/query`, `/api/export`, `/api/conversation/reset`, `/api/me`,
    `/api/dashboards`) needs a signed-in session.
  - `/api/query`: question → Claude (streaming, with prompt caching, conversation memory
    per session, up to 40 turns) → validator → Cube, one query per table in parallel →
    empty-result explanation → JSON for the page. Questions in one session run one at a time.
  - `/api/export` → `export.mjs`.
  - Passes Metabase's public dashboard pages through, so the Dashboards tab works wherever
    OneTouch does.
  - On start it creates the account tables, loads `db/accounts.json`, and retries until
    Postgres is ready.
- `public/index.html` ([B.25](#b25)): the sign-in page, the chat tab and the Dashboards
  tab with its drawer.
- `public/style.css` ([B.26](#b26)): the styling.
- `public/app.js` ([B.27](#b27)): sign-in, the chat (sending questions, turning the
  results into tables with English column names and readable values), "New chat", the
  download buttons, and the dashboard drawer with drill-down and **← Back**.
- `public/site.webmanifest` ([B.28](#b28)): the app name and icons.
- `onetouchsso.html` ([B.29](#b29)) and `styles2.css` ([B.30](#b30)): the design template
  the sign-in page was built from. Nothing loads them, but they are in the repository.

**The images** ([Appendix C](#appendix-c-images) lists names, sizes and checksums):

1. **Icons.** Make a square OneTouch logo (512×512 PNG), upload it to a favicon generator
   such as https://realfavicongenerator.net, and put its output in `public/`:
   `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180),
   `android-chrome-192x192.png`, `android-chrome-512x512.png`. Replace its
   `site.webmanifest` with B.28.
2. **Logos.** Save the Molson Coors logo as `public/molsoncoorslogo.png` (about 320×143)
   and the four-square Microsoft logo as `public/microsoftlogo.png` (square). The
   repository also has unused copies at the top level: `molsoncoorslogo.png`,
   `microsoftlogo.png` and `microsoftlogo (1).png`. They are optional.

The page works without the images; they only leave broken-image boxes.

## Step 15: Start everything

```
docker compose up -d --build
docker logs --tail 30 analytics_node_app
```

The log should show `🚀 Node.js Orchestrator live on port 8000` and `🔐 Account database
ready`. If it says `ANTHROPIC_API_KEY is missing`, fix `.env` and run
`docker compose up -d --force-recreate app`.

Day-to-day commands:

| To | Run |
|---|---|
| apply a change to a server `.mjs` file | `docker restart analytics_node_app` |
| apply a change in `public/` | refresh the browser |
| apply a new npm package | `docker compose up -d --build -V app` |
| read the app's log | `docker logs --tail 50 analytics_node_app` (🔐 sign-in, 🤖 Cube queries, 🔎 empty results) |
| stop everything | `docker compose down` |
| reload the data | `docker compose down -v` then `docker compose up -d` (deletes the database and its sessions; accounts come back from `db/accounts.json`) |

## Step 16: The first account and the first question

```
docker exec -it analytics_node_app node scripts/users.mjs add jsmith "Jane Smith"
```

It asks for the password without showing it. Open http://localhost:8000, sign in as
`jsmith`, and ask, for example, "How many P1 incidents were there last month?". You
should get a table, the assumptions Claude made, and download buttons.

Many accounts at once, from a CSV with the columns `Username, Display Name, Password`
(never commit that file):

```
Get-Content people.csv | docker exec -i analytics_node_app node scripts/users.mjs import -
```

To share accounts with other copies, write `db/accounts.json` (hashes only) and commit it.
Every copy loads it on start:

```
docker exec analytics_node_app node scripts/users.mjs export
```

## Step 17: Metabase dashboards

1. Create `scripts/metabase-setup.mjs` ([B.31](#b31)). Through Metabase's API, it creates
   the admin account on first run, connects to the reporting views as `metabase_reader`,
   and turns on public sharing. Then it rebuilds ten dashboards in the "OneTouch ITIL"
   collection from its `DASHBOARDS` list, plus the drill-down pages in `DETAILS`. Before
   changing anything it checks that every click target exists. Finally it writes their
   public links to `metabase-dashboards.json`, which the Dashboards tab reads.
2. Make sure `METABASE_DB_PASSWORD`, `METABASE_ADMIN_EMAIL` and `METABASE_ADMIN_PASSWORD`
   are set in `.env`, then run `docker compose up -d` (this creates `metabase_reader`).
3. Run, and re-run whenever you change a chart:
   ```
   docker exec analytics_node_app node scripts/metabase-setup.mjs
   ```
4. Check: the **Dashboards** tab's ☰ drawer lists the groups Overview, Incidents &
   Problems, Change and Requests. Clicking a bar or a blue value opens a detail page, and
   **← Back** returns. Metabase's own admin screens are at http://localhost:3000 on the
   server only.

## Step 18: Remote mode

`remote.mjs` ([B.32](#b32)) lets someone use OneTouch from their own `localhost:8000`
without Docker, data or an API key. It serves `public/` locally and forwards `/api`,
`/public` and `/app` to the real server.

```
npm install
npm run remote -- https://the-server-address
```

Or put `ONETOUCH_SERVER=...` in `.env` and run `npm run remote`. If port 8000 is busy,
use `REMOTE_PORT=8100`.

## Step 19: Sharing it with other people

- **Same network:** others open `http://<server IP>:8000` (find the IP with `ipconfig`).
  This isn't encrypted, so use it only on a trusted network.
- **Over the internet (get permission first; it puts company data behind a public link):**
  ```
  docker compose --profile tunnel up -d tunnel
  docker logs onetouch_tunnel          # shows the https://....trycloudflare.com link
  docker compose stop tunnel
  ```
  The link changes on every start. For a permanent one, create a tunnel in a Cloudflare
  account pointing at `http://app:8000`, put its token in `.env` as `TUNNEL_TOKEN`, and
  run `docker compose --profile tunnel-named up -d tunnel-named`.

## Step 20: Claude Code helpers

Two Claude Code subagents that know this project:

- `.claude/agents/onetouch-developer.md` ([B.33](#b33)): builds features. It knows the
  architecture, how to run and test it, and past pitfalls.
- `.claude/agents/onetouch-reviewer.md` ([B.34](#b34)): reviews a diff for this project's
  risks (sign-in, data exposure, secrets, Claude API use, setup that breaks on Windows).
  It is read-only.

In Claude Code, ask for them by name or list them with `/agents`.

## Step 21: Checks and this guide

- `scripts/check.mjs` ([B.35](#b35)): `npm run check`. It takes about a second and needs
  no data, API key or containers. It runs `node --check` on every JS file, checks the
  shell scripts' syntax and LF endings, and validates `docker-compose.yml` against
  `.env.example` (when Docker is installed). It also confirms this guide matches the code.
- `scripts/build-docs.mjs` ([B.36](#b36)): `npm run docs`. It rewrites this guide's
  appendices from the current files. A new file the script doesn't know about makes the
  check fail until it's added to its `FILES` list (or to `SKIPPED` or `IMAGES`, with a reason).
- `README.md` ([B.37](#b37)): the everyday instructions for users and admins.
- `documentation.md`: this file. Copy it in as it is; `npm run docs` regenerates everything
  from the "BEGIN GENERATED" line down.

Run `npm run check` now. Every line should pass.

## Step 22: Put it in git and recreate the branches

```
git add -A
git status            # .env, csv_data/ and node_modules/ must NOT be listed
git commit -m "OneTouch, rebuilt from documentation.md"
```

To publish it, create an empty repository on GitHub, then
`git remote add origin <its URL>` and `git push -u origin main`.

The real repository has a branch per person (`Ventura`, `Luke`, `Q`), and nobody commits
to `main` directly: changes go through pull requests from a personal branch. To set that up:

```
git branch Ventura && git branch Luke && git branch Q
git push -u origin Ventura Luke Q
```

That makes all three equal to `main`. In the real repository, `Ventura` equals `main`
too, but `Luke` and `Q` are older (see the next section). This guide gives only the
current files, not the older versions, so it can't rebuild those exact older states. To
update the real `Luke` or `Q`: `git checkout Luke && git merge origin/main`.

---

## Where each branch is

As of 2026-10-21, with `main` at PR #21:

| Branch | Compared with `main` | Missing |
|---|---|---|
| `main` | — | — |
| `Ventura` | same files (its last commit is what PR #20 merged) | PR #21 (checks and the first version of this file) |
| `Luke` | 0 ahead, behind | PRs #14–#21: Metabase charts, better answers, Claude Code agents, dashboard drawer, dashboard drill-down, checks and docs |
| `Q` | 0 ahead, behind | PR #13 (the `db-setup` service) and everything `Luke` is missing |

No branch has work that `main` lacks. To refresh this table:

```
git fetch --all
git rev-list --left-right --count origin/main...origin/<branch>   # "<main-only> <branch-only>"
git log --oneline origin/<branch>..origin/main                     # what the branch is missing
```

## History: how the real repository got here

| When | Commit / PR | What it added | Steps above |
|---|---|---|---|
| Oct 5 | `8faf290` | First version: questions → Claude → Cube | 3–11, 14 |
| Oct 6 | `fd08cbc` … `39c7dc3` | `package.json`, `Dockerfile`, compose and Cube model fixes until the stack ran | 4, 8–10 |
| Oct 8 | `e80a6d9` | README: everyone has their own branch | 22 |
| Oct 19 | PR #1, #3 | `business_logic.mjs`, `BUSINESS_LOGIC.md`, derived date columns in the Cube model | 8, 11 |
| Oct 19 | PR #2 | Answers shown as readable tables instead of JSON | 14 |
| Oct 19 | PR #4, #6 | OneTouch name | 14 |
| Oct 19 | PR #5, `4eecc63` | Favicons and icons | 14 |
| Oct 19 | PR #7 | Downloads (`export.mjs`) | 12 |
| Oct 19 | `6b49ff4`, `a857168` | Logo files at the top level | 14 |
| Oct 19 | PR #8 | Sign-in page, logos in `public/`, `onetouchsso.html`, `styles2.css` | 14 |
| Oct 19 | PR #9 | Conversation memory | 14 |
| Oct 19 | PR #10 | Real accounts: `auth.mjs`, `scripts/users.mjs`, `db/init-auth.sh` | 7, 13 |
| Oct 20 | PR #11 | Sign-in page fixes | 14 |
| Oct 20 | PR #12 | `db/accounts.json` shared with clones, `load_csv.sql` in git | 6, 16 |
| Oct 20 | PR #13 | `db-setup` service and Postgres health check, so databases created before sign-in existed get the accounts database | 7, 9 |
| Oct 20 | PR #14 | Metabase: reporting views, `db/init-reporting.sh`, `scripts/metabase-setup.mjs`, Dashboards tab | 7, 17 |
| Oct 20 | PR #15 | Better answers, including empty-result explanations | 12 |
| Oct 20 | PR #16 | Claude Code agents | 20 |
| Oct 20 | PR #17 | Dashboard drawer with groups (PR #18 and #19 only synced branches) | 14, 17 |
| Oct 20 | PR #20 | Better dashboards with drill-down pages | 17 |
| Oct 21 | PR #21 | `npm run check` and the first `documentation.md` | 21 |
| Oct 21 | this change | This from-scratch guide and `npm run docs` | 21 |

<!-- BEGIN GENERATED: do not edit below; run `npm run docs` -->

## Appendix A: package versions

What `npm install` gave when this guide was generated. If something behaves differently, install these exact versions (`npm install <package>@<version>`).

| Package | package.json asks for | Installed (package-lock.json) |
|---|---|---|
| `@anthropic-ai/sdk` | `^0.131.0` | 0.131.0 |
| `7zip-bin` | `^5.2.0` | 5.2.0 |
| `accepts` | `^2.0.0` | 2.0.0 |
| `body-parser` | `^2.3.0` | 2.3.0 |
| `bytes` | `^3.1.2` | 3.1.2 |
| `call-bind-apply-helpers` | `^1.0.2` | 1.0.2 |
| `call-bound` | `^1.0.4` | 1.0.4 |
| `content-disposition` | `^1.1.0` | 1.1.0 |
| `content-type` | `^1.0.5` | 1.0.5 |
| `cookie` | `^0.7.2` | 0.7.2 |
| `cookie-signature` | `^1.2.2` | 1.2.2 |
| `cors` | `^2.8.6` | 2.8.6 |
| `data-uri-to-buffer` | `^4.0.1` | 4.0.1 |
| `debug` | `^4.4.3` | 4.4.3 |
| `depd` | `^2.0.0` | 2.0.0 |
| `docx` | `^9.12.0` | 9.12.0 |
| `dotenv` | `^18.0.5` | 18.0.5 |
| `dunder-proto` | `^1.0.1` | 1.0.1 |
| `ee-first` | `^1.1.1` | 1.1.1 |
| `encodeurl` | `^2.0.0` | 2.0.0 |
| `es-define-property` | `^1.0.1` | 1.0.1 |
| `es-errors` | `^1.3.0` | 1.3.0 |
| `es-object-atoms` | `^1.1.2` | 1.1.2 |
| `escape-html` | `^1.0.3` | 1.0.3 |
| `etag` | `^1.8.1` | 1.8.1 |
| `exceljs` | `^4.4.0` | 4.4.0 |
| `express` | `^5.2.1` | 5.2.1 |
| `fast-sha256` | `^1.3.0` | 1.3.0 |
| `fetch-blob` | `^3.2.0` | 3.2.0 |
| `finalhandler` | `^2.1.1` | 2.1.1 |
| `formdata-polyfill` | `^4.0.10` | 4.0.10 |
| `forwarded` | `^0.2.0` | 0.2.0 |
| `fresh` | `^2.0.0` | 2.0.0 |
| `function-bind` | `^1.1.2` | 1.1.2 |
| `get-intrinsic` | `^1.3.0` | 1.3.0 |
| `get-proto` | `^1.0.1` | 1.0.1 |
| `gopd` | `^1.2.0` | 1.2.0 |
| `has-symbols` | `^1.1.0` | 1.1.0 |
| `hasown` | `^2.0.4` | 2.0.4 |
| `http-errors` | `^2.0.1` | 2.0.1 |
| `iconv-lite` | `^0.7.3` | 0.7.3 |
| `inherits` | `^2.0.4` | 2.0.4 |
| `ipaddr.js` | `^1.9.1` | 1.9.1 |
| `is-promise` | `^4.0.0` | 4.0.0 |
| `json-schema-to-ts` | `^3.1.1` | 3.1.1 |
| `math-intrinsics` | `^1.1.0` | 1.1.0 |
| `media-typer` | `^1.1.1` | 1.1.1 |
| `merge-descriptors` | `^2.0.0` | 2.0.0 |
| `mime-db` | `^1.54.0` | 1.54.0 |
| `mime-types` | `^3.0.2` | 3.0.2 |
| `ms` | `^2.1.3` | 2.1.3 |
| `negotiator` | `^1.1.0` | 1.1.0 |
| `node-domexception` | `^1.0.0` | 1.0.0 |
| `node-fetch` | `^3.3.2` | 3.3.2 |
| `object-assign` | `^4.1.1` | 4.1.1 |
| `object-inspect` | `^1.13.4` | 1.13.4 |
| `on-finished` | `^2.4.1` | 2.4.1 |
| `once` | `^1.4.0` | 1.4.0 |
| `parseurl` | `^1.3.3` | 1.3.3 |
| `path-to-regexp` | `^8.4.2` | 8.4.2 |
| `pdfmake` | `^0.2.23` | 0.2.23 |
| `pg` | `^8.23.1` | 8.23.1 |
| `proxy-addr` | `^2.0.8` | 2.0.8 |
| `qs` | `^6.16.0` | 6.16.0 |
| `range-parser` | `^1.3.0` | 1.3.0 |
| `raw-body` | `^3.0.2` | 3.0.2 |
| `router` | `^2.2.0` | 2.2.0 |
| `safer-buffer` | `^2.1.2` | 2.1.2 |
| `send` | `^1.2.1` | 1.2.1 |
| `serve-static` | `^2.2.1` | 2.2.1 |
| `setprototypeof` | `^1.2.0` | 1.2.0 |
| `side-channel` | `^1.1.1` | 1.1.1 |
| `side-channel-list` | `^1.0.1` | 1.0.1 |
| `side-channel-map` | `^1.0.1` | 1.0.1 |
| `side-channel-weakmap` | `^1.0.2` | 1.0.2 |
| `standardwebhooks` | `^1.1.1` | 1.1.1 |
| `statuses` | `^2.0.2` | 2.0.2 |
| `toidentifier` | `^1.0.1` | 1.0.1 |
| `ts-algebra` | `^2.0.0` | 2.0.0 |
| `type-is` | `^2.1.0` | 2.1.0 |
| `unpipe` | `^1.0.0` | 1.0.0 |
| `vary` | `^1.1.2` | 1.1.2 |
| `web-streams-polyfill` | `^3.3.3` | 3.3.3 |
| `wrappy` | `^1.0.2` | 1.0.2 |

## Appendix B: every file, in full

Create each file at the path shown, with exactly this content. Files are in the order the guide builds them.

- [B.1 `.gitignore`](#b1)
- [B.2 `.gitattributes`](#b2)
- [B.3 `package.json`](#b3)
- [B.4 `.env.example`](#b4)
- [B.5 `load_csv.sql`](#b5)
- [B.6 `db/init-auth.sh`](#b6)
- [B.7 `db/init-reporting.sh`](#b7)
- [B.8 `db/reporting-views.sql`](#b8)
- [B.9 `model/cubes/incident.yml`](#b9)
- [B.10 `model/cubes/change_request.yml`](#b10)
- [B.11 `model/cubes/sc_req_item.yml`](#b11)
- [B.12 `model/cubes/sc_task.yml`](#b12)
- [B.13 `model/cubes/change_approvals.yml`](#b13)
- [B.14 `model/cubes/ritm_approvals.yml`](#b14)
- [B.15 `model/views/example_view.yml`](#b15)
- [B.16 `Dockerfile`](#b16)
- [B.17 `docker-compose.yml`](#b17)
- [B.18 `business_logic.mjs`](#b18)
- [B.19 `BUSINESS_LOGIC.md`](#b19)
- [B.20 `empty_results.mjs`](#b20)
- [B.21 `export.mjs`](#b21)
- [B.22 `auth.mjs`](#b22)
- [B.23 `scripts/users.mjs`](#b23)
- [B.24 `server.mjs`](#b24)
- [B.25 `public/index.html`](#b25)
- [B.26 `public/style.css`](#b26)
- [B.27 `public/app.js`](#b27)
- [B.28 `public/site.webmanifest`](#b28)
- [B.29 `onetouchsso.html`](#b29)
- [B.30 `styles2.css`](#b30)
- [B.31 `scripts/metabase-setup.mjs`](#b31)
- [B.32 `remote.mjs`](#b32)
- [B.33 `.claude/agents/onetouch-developer.md`](#b33)
- [B.34 `.claude/agents/onetouch-reviewer.md`](#b34)
- [B.35 `scripts/check.mjs`](#b35)
- [B.36 `scripts/build-docs.mjs`](#b36)
- [B.37 `README.md`](#b37)

<a id="b1"></a>
### B.1 `.gitignore`

```
# 🔑 SENSITIVE ENVIRONMENT VARIABLES & SECRETS
.env
.env.*
!.env.example

# 🧊 Cube Store local data & scratch diagnostics
.cubestore/
diag*.txt
curl.txt
files.txt

# 📦 DEPENDENCY FOLDERS (Can be re-installed using 'npm install')
node_modules/
.npm
.eslintcache

# 📊 RAW DATA & LARGE DATASETS (Keep your 75,000 CSV rows local)
csv_data/
*.csv
*.sql
# ...except the table setup script: without it a fresh clone's database can't start
!load_csv.sql
# ...and the reporting views Metabase uses
!db/*.sql

# Metabase dashboard links differ per machine (scripts/metabase-setup.mjs writes them)
metabase-dashboards.json

# 🐳 DOCKER INTERNAL PERSISTENT STORAGE
.docker/
pgdata/
mbdata/

# 🖥️ OPERATING SYSTEM SPECIFIC JUNK
Thumbs.db
.DS_Store
desktop.ini
```

<a id="b2"></a>
### B.2 `.gitattributes`

```
# Shell scripts run inside Linux containers; Windows line endings break them
*.sh text eol=lf
```

<a id="b3"></a>
### B.3 `package.json`

```json
{
  "name": "data-analysis-tool",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.131.0",
    "7zip-bin": "^5.2.0",
    "accepts": "^2.0.0",
    "body-parser": "^2.3.0",
    "bytes": "^3.1.2",
    "call-bind-apply-helpers": "^1.0.2",
    "call-bound": "^1.0.4",
    "content-disposition": "^1.1.0",
    "content-type": "^1.0.5",
    "cookie": "^0.7.2",
    "cookie-signature": "^1.2.2",
    "cors": "^2.8.6",
    "data-uri-to-buffer": "^4.0.1",
    "debug": "^4.4.3",
    "depd": "^2.0.0",
    "docx": "^9.12.0",
    "dotenv": "^18.0.5",
    "dunder-proto": "^1.0.1",
    "ee-first": "^1.1.1",
    "encodeurl": "^2.0.0",
    "es-define-property": "^1.0.1",
    "es-errors": "^1.3.0",
    "es-object-atoms": "^1.1.2",
    "escape-html": "^1.0.3",
    "etag": "^1.8.1",
    "exceljs": "^4.4.0",
    "express": "^5.2.1",
    "fast-sha256": "^1.3.0",
    "fetch-blob": "^3.2.0",
    "finalhandler": "^2.1.1",
    "formdata-polyfill": "^4.0.10",
    "forwarded": "^0.2.0",
    "fresh": "^2.0.0",
    "function-bind": "^1.1.2",
    "get-intrinsic": "^1.3.0",
    "get-proto": "^1.0.1",
    "gopd": "^1.2.0",
    "has-symbols": "^1.1.0",
    "hasown": "^2.0.4",
    "http-errors": "^2.0.1",
    "iconv-lite": "^0.7.3",
    "inherits": "^2.0.4",
    "ipaddr.js": "^1.9.1",
    "is-promise": "^4.0.0",
    "json-schema-to-ts": "^3.1.1",
    "math-intrinsics": "^1.1.0",
    "media-typer": "^1.1.1",
    "merge-descriptors": "^2.0.0",
    "mime-db": "^1.54.0",
    "mime-types": "^3.0.2",
    "ms": "^2.1.3",
    "negotiator": "^1.1.0",
    "node-domexception": "^1.0.0",
    "node-fetch": "^3.3.2",
    "object-assign": "^4.1.1",
    "object-inspect": "^1.13.4",
    "on-finished": "^2.4.1",
    "once": "^1.4.0",
    "parseurl": "^1.3.3",
    "path-to-regexp": "^8.4.2",
    "pdfmake": "^0.2.23",
    "pg": "^8.23.1",
    "proxy-addr": "^2.0.8",
    "qs": "^6.16.0",
    "range-parser": "^1.3.0",
    "raw-body": "^3.0.2",
    "router": "^2.2.0",
    "safer-buffer": "^2.1.2",
    "send": "^1.2.1",
    "serve-static": "^2.2.1",
    "setprototypeof": "^1.2.0",
    "side-channel": "^1.1.1",
    "side-channel-list": "^1.0.1",
    "side-channel-map": "^1.0.1",
    "side-channel-weakmap": "^1.0.2",
    "standardwebhooks": "^1.1.1",
    "statuses": "^2.0.2",
    "toidentifier": "^1.0.1",
    "ts-algebra": "^2.0.0",
    "type-is": "^2.1.0",
    "unpipe": "^1.0.0",
    "vary": "^1.1.2",
    "web-streams-polyfill": "^3.3.3",
    "wrappy": "^1.0.2"
  },
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1",
    "check": "node scripts/check.mjs",
    "docs": "node scripts/build-docs.mjs",
    "start": "node server.mjs",
    "users": "node scripts/users.mjs",
    "remote": "node remote.mjs"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/vperez-stars/OneTouch-TEQSolutions.git"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "bugs": {
    "url": "https://github.com/vperez-stars/OneTouch-TEQSolutions/issues"
  },
  "homepage": "https://github.com/vperez-stars/OneTouch-TEQSolutions#readme"
}
```

<a id="b4"></a>
### B.4 `.env.example`

```
APP_PORT=8000
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_WORKSPACE_ID=your_anthropic_workspace_id_here
CUBE_API_URL=http://localhost:4000/cubejs-api/v1/load
CUBE_API_TOKEN=super_secret_key_change_me_later
# Optional: pin "today" so relative dates ("last month", "this week") land inside the CSV export window.
# Leave blank to use the real clock. The export covers roughly 2026-06-01 to 2026-09-01.
ASSUME_TODAY=
# Optional: override the Claude model used for translation (defaults to claude-sonnet-5-5).
CLAUDE_MODEL=

# Database / Cube secrets (docker-compose.yml reads these; it refuses to start without them)
POSTGRES_PASSWORD=change_me
CUBEJS_API_SECRET=change_me_long_random_string
CUBEJS_SQL_PASSWORD=change_me

# Sign-in account database (onetouch_auth): password for its onetouch_app role.
# Use a long random value, e.g.: node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
AUTH_DB_PASSWORD=change_me_long_random_string

# Metabase: password for the read-only database role it connects as (metabase_reader),
# and the admin login that scripts/metabase-setup.mjs creates. Pick your own values.
METABASE_DB_PASSWORD=change_me_long_random_string
METABASE_ADMIN_EMAIL=you@example.com
METABASE_ADMIN_PASSWORD=change_me_8plus_chars
```

<a id="b5"></a>
### B.5 `load_csv.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS change_request (
    number text PRIMARY KEY,
    type text,
    created text,
    sub_type text,
    task_type text,
    configuration_item text,
    short_description text,
    owner_group text,
    outage text,
    state text,
    approval text,
    close_code text,
    failure_code text,
    success_code text,
    process_failure text,
    diwakar_kumar text,
    requested_by text,
    state_1 text,
    planned_start_date text,
    brewery text,
    brewery_locations text,
    work_notes text,
    planned_end_date text,
    risk text,
    planned_start_date_1 text,
    planned_end_date_1 text,
    description text,
    change_plan text,
    verification_plan text,
    backout_plan text,
    purpose_of_change text,
    incident text,
    problem text,
    enhancement text,
    sap_impact text,
    sap_transport_required text,
    environment text,
    project text,
    comments_and_work_notes text
);

CREATE TABLE IF NOT EXISTS sc_req_item (
    number text PRIMARY KEY,
    item text,
    description text,
    short_description text,
    opened text,
    updated text,
    closed text,
    stage text,
    state text,
    parent text,
    request text,
    requested_for text,
    opened_by text,
    approval text,
    approval_history text,
    approval_set text,
    location text,
    work_notes text,
    fulfilled_time text,
    order_guide text
);

CREATE TABLE IF NOT EXISTS incident (
    number text PRIMARY KEY,
    created text,
    short_description text,
    description text,
    affected_user text,
    assignment_group text,
    assigned_to text,
    problem text,
    state text,
    parent_incident text,
    priority text,
    impact text,
    urgency text,
    breach_reason text,
    global_incident text,
    knowledge_article_reference text,
    category text,
    subcategory text,
    updated text,
    was_p1 text,
    configuration_item text,
    contact_type text,
    reassignment_count text,
    close_code text,
    close_notes text,
    cause_code text,
    cause_sub_code text,
    opened_by_group text,
    location text,
    reopen_count text,
    caused_by_change text,
    business_impact_outage text,
    resolved text,
    closed text,
    responsibility_for_outage text,
    on_hold_reason text,
    work_notes text,
    risk_register_number text,
    tags text,
    third_party_related_ticket text,
    business_impact text,
    downgrade_reason text,
    downgrade_type text,
    kb_article text
);

CREATE TABLE IF NOT EXISTS sc_task (
    number text PRIMARY KEY,
    item text,
    state text,
    short_description text,
    assignment_group text,
    assigned_to text,
    parent text,
    opened_by text,
    approval text,
    approval_history text,
    approval_set text,
    request text,
    request_item text,
    sla_flag text,
    created text,
    updated text,
    additional_comments text,
    description text,
    work_notes text,
    active text
);

CREATE TABLE IF NOT EXISTS change_approvals (
    approval_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_type text,
    parent text NOT NULL REFERENCES change_request(number),
    assignment_group text,
    short_description text,
    created text,
    work_notes text,
    approval text,
    state text
);

CREATE TABLE IF NOT EXISTS ritm_approvals (
    approval_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_type text,
    parent text NOT NULL REFERENCES sc_req_item(number),
    assignment_group text,
    short_description text,
    created text,
    approval text,
    state text
);

CREATE INDEX IF NOT EXISTS sc_task_request_item_idx ON sc_task(request_item);
CREATE INDEX IF NOT EXISTS sc_task_parent_idx ON sc_task(parent);
CREATE INDEX IF NOT EXISTS sc_req_item_request_idx ON sc_req_item(request);

-- Load each CSV that is present in csv_data/. A missing file is skipped with a
-- notice instead of failing the whole setup, so a fresh clone without the
-- export still starts (empty tables; sign-in works, queries return nothing).
DO $$
DECLARE
    loads text[][] := ARRAY[
        ['change_request',   '',                                                                                       'change_request.csv'],
        ['sc_req_item',      '',                                                                                       'sc_req_item.csv'],
        ['incident',         '',                                                                                       'incident.csv'],
        ['sc_task',          '',                                                                                       'sc_task.csv'],
        ['change_approvals', '(task_type, parent, assignment_group, short_description, created, work_notes, approval, state)', 'change_approvals.csv'],
        ['ritm_approvals',   '(task_type, parent, assignment_group, short_description, created, approval, state)',             'ritm_approvals.csv']
    ];
    path text;
BEGIN
    FOR i IN 1 .. array_length(loads, 1) LOOP
        path := '/tmp/my_csv_files/' || loads[i][3];
        IF pg_stat_file(path, true) IS NULL THEN
            RAISE NOTICE 'load_csv: % not found, leaving table % empty', loads[i][3], loads[i][1];
        ELSE
            EXECUTE format('COPY %I %s FROM %L WITH (FORMAT csv, HEADER true, ENCODING %L)',
                           loads[i][1], loads[i][2], path, 'UTF8');
        END IF;
    END LOOP;
END $$;

-- Keep the task-to-request-item relationship while preserving four exported
-- tasks whose referenced request items are absent from these CSVs.
ALTER TABLE sc_task
    ADD CONSTRAINT sc_task_request_item_fk
    FOREIGN KEY (request_item) REFERENCES sc_req_item(number) NOT VALID;

COMMIT;
```

<a id="b6"></a>
### B.6 `db/init-auth.sh`

```sh
#!/bin/sh
# Creates the OneTouch account database (onetouch_auth) and the only role
# allowed into it (onetouch_app). The tables themselves are created by the
# app on start (auth.mjs -> ensureSchema).
#
# Runs when the Postgres volume is first created, and again on every
# `docker compose up` through the db-setup service (over the network, using
# PGHOST/PGPASSWORD), so databases created before sign-in existed get it too.
# Safe to repeat; it also re-syncs the role's password with AUTH_DB_PASSWORD.
set -e

if [ -z "$AUTH_DB_PASSWORD" ]; then
  echo "init-auth: AUTH_DB_PASSWORD is not set; add it to .env" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v pw="$AUTH_DB_PASSWORD" <<'EOSQL'
SELECT 'CREATE ROLE onetouch_app LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'onetouch_app') \gexec
SELECT format('ALTER ROLE onetouch_app WITH LOGIN PASSWORD %L', :'pw') \gexec

SELECT 'CREATE DATABASE onetouch_auth OWNER onetouch_app'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'onetouch_auth') \gexec

-- Only onetouch_app (and the admin superuser) can open the account database
REVOKE CONNECT ON DATABASE onetouch_auth FROM PUBLIC;
GRANT CONNECT ON DATABASE onetouch_auth TO onetouch_app;

-- ...and onetouch_app can't open the analytics data
SELECT 'REVOKE CONNECT ON DATABASE analytics_db FROM PUBLIC'
 WHERE EXISTS (SELECT FROM pg_database WHERE datname = 'analytics_db') \gexec
EOSQL

echo "init-auth: onetouch_auth database and onetouch_app role are ready"
```

<a id="b7"></a>
### B.7 `db/init-reporting.sh`

```sh
#!/bin/sh
# Creates/updates the reporting views (db/reporting-views.sql) in analytics_db
# and the read-only role Metabase connects as (metabase_reader). The role can
# read the reporting views and nothing else.
#
# Runs on every `docker compose up` through the db-setup service. Safe to repeat;
# it also re-syncs metabase_reader's password with METABASE_DB_PASSWORD.
set -e
HERE=$(dirname "$0")

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname analytics_db -q -f "$HERE/reporting-views.sql"
echo "init-reporting: reporting views are up to date"

if [ -z "$METABASE_DB_PASSWORD" ]; then
  echo "init-reporting: METABASE_DB_PASSWORD not set; skipping the metabase_reader role"
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname analytics_db -q -v pw="$METABASE_DB_PASSWORD" <<'EOSQL'
SELECT 'CREATE ROLE metabase_reader LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'metabase_reader') \gexec
SELECT format('ALTER ROLE metabase_reader WITH LOGIN PASSWORD %L', :'pw') \gexec

GRANT CONNECT ON DATABASE analytics_db TO metabase_reader;
-- Only the reporting views: the views read the raw tables with their owner's
-- rights, so metabase_reader needs no access to the public schema at all
REVOKE ALL ON SCHEMA public FROM metabase_reader;
GRANT USAGE ON SCHEMA reporting TO metabase_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO metabase_reader;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA reporting TO metabase_reader;
EOSQL
echo "init-reporting: metabase_reader can read the reporting views"
```

<a id="b8"></a>
### B.8 `db/reporting-views.sql`

```sql
-- =====================================================================
-- REPORTING VIEWS for Metabase (schema "reporting" in analytics_db)
--
-- The raw tables store every column as text. These views expose the same
-- data with real timestamps, numbers and yes/no values, plus ready-made
-- fields (is_open, hours_to_resolve, age_days, ...) so dashboards can be
-- built point-and-click. Safe to re-run: every view is CREATE OR REPLACE.
--
-- The export is a frozen snapshot, so "now" for ages and "upcoming" is the
-- newest timestamp in the data (reporting.data_as_of), not today's date.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS reporting;

-- Text -> timestamp, treating '' as missing
CREATE OR REPLACE FUNCTION reporting.ts(value text) RETURNS timestamp
    LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(value, '')::timestamp $$;

CREATE OR REPLACE VIEW reporting.data_as_of AS
SELECT max(t) AS as_of FROM (
    SELECT max(reporting.ts(updated)) AS t FROM public.incident
    UNION ALL SELECT max(reporting.ts(updated)) FROM public.sc_task
    UNION ALL SELECT max(reporting.ts(updated)) FROM public.sc_req_item
    UNION ALL SELECT max(reporting.ts(created)) FROM public.change_request
) latest;

-- ---------------------------------------------------------------------
-- Incidents
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.incidents AS
SELECT
    i.number,
    reporting.ts(i.created)  AS created_at,
    reporting.ts(i.resolved) AS resolved_at,
    reporting.ts(i.closed)   AS closed_at,
    i.state,
    i.state IN ('New', 'In Progress', 'On Hold') AS is_open,
    i.priority,
    i.impact,
    i.urgency,
    i.category,
    i.subcategory,
    i.assignment_group,
    i.assigned_to,
    -- 'zzz' is a placeholder (about a third of incidents, nearly all monitoring
    -- alerts with no system attached), so it counts as "no system recorded"
    CASE WHEN i.configuration_item IN ('', 'zzz') THEN NULL ELSE i.configuration_item END AS configuration_item,
    i.location,
    i.contact_type,
    -- Monitoring alerts (Event Management) vs. tickets raised by people
    CASE WHEN i.contact_type = 'Event Management' THEN 'Monitoring alert' ELSE 'Person' END AS source,
    i.close_code,
    i.cause_code,
    nullif(i.on_hold_reason, '') AS on_hold_reason,
    nullif(i.breach_reason, '')  AS breach_reason,
    i.reassignment_count::int AS reassignment_count,
    i.reopen_count::int       AS reopen_count,
    i.reassignment_count::int > 0 AS was_reassigned,
    i.was_p1 = 'true' AS was_p1,
    nullif(i.caused_by_change, '') AS caused_by_change,
    round((extract(epoch FROM reporting.ts(i.resolved) - reporting.ts(i.created)) / 3600)::numeric, 2) AS hours_to_resolve,
    CASE WHEN i.state IN ('New', 'In Progress', 'On Hold')
         THEN round((extract(epoch FROM a.as_of - reporting.ts(i.created)) / 86400)::numeric, 1) END AS age_days,
    CASE WHEN i.state NOT IN ('New', 'In Progress', 'On Hold') THEN NULL
         WHEN a.as_of - reporting.ts(i.created) < interval '1 day'  THEN '1. Under 1 day'
         WHEN a.as_of - reporting.ts(i.created) < interval '3 days' THEN '2. 1-3 days'
         WHEN a.as_of - reporting.ts(i.created) < interval '7 days' THEN '3. 3-7 days'
         WHEN a.as_of - reporting.ts(i.created) < interval '30 days' THEN '4. 7-30 days'
         ELSE '5. Over 30 days' END AS age_bucket,
    -- (columns below were added later; a view can only grow at the end)
    nullif(i.problem, '')         AS problem,
    nullif(i.kb_article, '')      AS kb_article,
    nullif(i.opened_by_group, '') AS opened_by_group,
    i.short_description,
    i.close_code = 'Solved (Work Around)' AS closed_with_workaround,
    -- for the incident record page (drill-down)
    nullif(i.description, '') AS description,
    nullif(i.close_notes, '') AS close_notes
FROM public.incident i CROSS JOIN reporting.data_as_of a;

-- ---------------------------------------------------------------------
-- Changes
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.changes AS
SELECT
    c.number,
    reporting.ts(c.created)            AS created_at,
    reporting.ts(c.planned_start_date) AS planned_start,
    reporting.ts(c.planned_end_date)   AS planned_end,
    c.type,
    c.sub_type,
    c.type IN ('Emergency', 'Expedited') AS is_emergency_or_expedited,
    c.state,
    c.state NOT IN ('Closed', 'Canceled') AS is_open,
    c.approval,
    c.risk,
    c.outage = 'Yes' AS has_outage,
    c.environment,
    c.owner_group,
    -- 'zzz' is a placeholder here too (about 600 changes): "no system recorded"
    CASE WHEN c.configuration_item IN ('', 'zzz') THEN NULL ELSE c.configuration_item END AS configuration_item,
    c.short_description,
    nullif(c.close_code, '')   AS close_code,
    nullif(c.failure_code, '') AS failure_code,
    CASE c.close_code WHEN 'Successful' THEN true WHEN 'Unsuccessful' THEN false END AS succeeded,
    -- Planned to start within 7 days after the snapshot
    reporting.ts(c.planned_start_date) >= a.as_of
        AND reporting.ts(c.planned_start_date) < a.as_of + interval '7 days' AS starts_next_7_days,
    -- (columns below were added later; a view can only grow at the end)
    c.brewery = 'Yes'                AS affects_brewery,
    nullif(c.brewery_locations, '')  AS brewery_locations,
    c.sap_impact = 'Yes'             AS affects_sap,
    c.sap_transport_required = 'Yes' AS needs_sap_transport,
    c.process_failure = 'true'       AS process_failure,
    -- Planned length of the change window
    round((extract(epoch FROM reporting.ts(c.planned_end_date) - reporting.ts(c.planned_start_date)) / 3600)::numeric, 1) AS planned_hours,
    -- How far ahead of its start the change was raised (negative: logged after it started)
    round((extract(epoch FROM reporting.ts(c.planned_start_date) - reporting.ts(c.created)) / 86400)::numeric, 1) AS lead_days,
    nullif(c.incident, '') AS linked_incident,
    nullif(c.problem, '')  AS linked_problem,
    nullif(c.project, '')  AS project,
    -- for the change record page (drill-down)
    nullif(c.description, '')       AS description,
    nullif(c.purpose_of_change, '') AS purpose_of_change
FROM public.change_request c CROSS JOIN reporting.data_as_of a;

-- One row per (change, brewery): a change can list several breweries,
-- comma-separated, in brewery_locations
CREATE OR REPLACE VIEW reporting.change_breweries AS
SELECT
    c.number,
    trim(b.brewery) AS brewery,
    c.created_at,
    c.planned_start,
    c.type,
    c.state,
    c.risk,
    c.has_outage,
    c.affects_sap,
    c.environment,
    c.short_description
FROM reporting.changes c
CROSS JOIN LATERAL regexp_split_to_table(c.brewery_locations, '\s*[,;]\s*') AS b(brewery)
WHERE c.brewery_locations IS NOT NULL AND trim(b.brewery) <> '';

-- ---------------------------------------------------------------------
-- Requested items (RITMs)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.requests AS
SELECT
    r.number,
    r.item,
    reporting.ts(r.opened)         AS opened_at,
    reporting.ts(r.fulfilled_time) AS fulfilled_at,
    reporting.ts(r.closed)         AS closed_at,
    r.state,
    r.state IN ('Open', 'Pending', 'Work in Progress') AS is_open,
    r.stage,
    r.approval,
    r.location,
    r.requested_for,
    round((extract(epoch FROM coalesce(reporting.ts(r.fulfilled_time), reporting.ts(r.closed)) - reporting.ts(r.opened)) / 3600)::numeric, 2)
        AS hours_to_fulfil,
    CASE WHEN r.state IN ('Open', 'Pending', 'Work in Progress')
         THEN round((extract(epoch FROM a.as_of - reporting.ts(r.opened)) / 86400)::numeric, 1) END AS age_days,
    -- (columns below were added later; a view can only grow at the end)
    nullif(r.order_guide, '') AS order_guide,
    r.short_description
FROM public.sc_req_item r CROSS JOIN reporting.data_as_of a;

-- ---------------------------------------------------------------------
-- Catalog tasks (fulfilment work, with SLA)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.catalog_tasks AS
SELECT
    t.number,
    t.item,
    reporting.ts(t.created) AS created_at,
    reporting.ts(t.updated) AS updated_at,
    t.state,
    t.active = 'true' AS is_open,
    t.assignment_group,
    t.assigned_to,
    t.sla_flag = 'true' AS sla_breached,
    t.request_item,
    CASE WHEN t.active = 'true'
         THEN round((extract(epoch FROM a.as_of - reporting.ts(t.created)) / 86400)::numeric, 1) END AS age_days
FROM public.sc_task t CROSS JOIN reporting.data_as_of a;

-- ---------------------------------------------------------------------
-- Approvals (changes and requests together)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.approvals AS
SELECT
    'Change' AS approval_for,
    ca.parent,
    ca.assignment_group AS approver_group,
    ca.approval,
    ca.state,
    ca.approval = 'Requested' AS is_waiting,
    reporting.ts(ca.created) AS created_at,
    CASE WHEN ca.approval = 'Requested'
         THEN round((extract(epoch FROM a.as_of - reporting.ts(ca.created)) / 86400)::numeric, 1) END AS waiting_days
FROM public.change_approvals ca CROSS JOIN reporting.data_as_of a
UNION ALL
SELECT
    'Request',
    ra.parent,
    ra.assignment_group,
    ra.approval,
    ra.state,
    ra.approval = 'Requested',
    reporting.ts(ra.created),
    CASE WHEN ra.approval = 'Requested'
         THEN round((extract(epoch FROM a.as_of - reporting.ts(ra.created)) / 86400)::numeric, 1) END
FROM public.ritm_approvals ra CROSS JOIN reporting.data_as_of a;
```

<a id="b9"></a>
### B.9 `model/cubes/incident.yml`

```yaml
cubes:
  - name: incident
    sql_table: public.incident
    data_source: default

    joins: []

    dimensions:
      - name: business_impact
        sql: business_impact
        type: string

      - name: assignment_group
        sql: assignment_group
        type: string

      - name: location
        sql: location
        type: string

      - name: downgrade_reason
        sql: downgrade_reason
        type: string

      - name: reopen_count
        sql: reopen_count
        type: string

      - name: opened_by_group
        sql: opened_by_group
        type: string

      - name: problem
        sql: problem
        type: string

      - name: assigned_to
        sql: assigned_to
        type: string

      - name: state
        sql: state
        type: string

      - name: responsibility_for_outage
        sql: responsibility_for_outage
        type: string

      - name: breach_reason
        sql: breach_reason
        type: string

      - name: short_description
        sql: short_description
        type: string

      - name: downgrade_type
        sql: downgrade_type
        type: string

      - name: contact_type
        sql: contact_type
        type: string

      - name: number
        sql: number
        type: string

      - name: reassignment_count
        sql: reassignment_count
        type: string

      - name: kb_article
        sql: kb_article
        type: string

      - name: description
        sql: description
        type: string

      - name: on_hold_reason
        sql: on_hold_reason
        type: string

      - name: knowledge_article_reference
        sql: knowledge_article_reference
        type: string

      - name: created
        sql: created
        type: string

      - name: subcategory
        sql: subcategory
        type: string

      - name: closed
        sql: closed
        type: string

      - name: impact
        sql: impact
        type: string

      - name: parent_incident
        sql: parent_incident
        type: string

      - name: caused_by_change
        sql: caused_by_change
        type: string

      - name: resolved
        sql: resolved
        type: string

      - name: category
        sql: category
        type: string

      - name: priority
        sql: priority
        type: string

      - name: tags
        sql: tags
        type: string

      - name: cause_sub_code
        sql: cause_sub_code
        type: string

      - name: cause_code
        sql: cause_code
        type: string

      - name: close_notes
        sql: close_notes
        type: string

      - name: was_p1
        sql: was_p1
        type: string

      - name: risk_register_number
        sql: risk_register_number
        type: string

      - name: close_code
        sql: close_code
        type: string

      - name: business_impact_outage
        sql: business_impact_outage
        type: string

      - name: work_notes
        sql: work_notes
        type: string

      - name: updated
        sql: updated
        type: string

      - name: affected_user
        sql: affected_user
        type: string

      - name: configuration_item
        sql: configuration_item
        type: string

      - name: urgency
        sql: urgency
        type: string

      - name: third_party_related_ticket
        sql: third_party_related_ticket
        type: string

      - name: global_incident
        sql: global_incident
        type: string

      # --- derived date buckets (added for trend / per-period questions) ---
      - name: created_day
        sql: "LEFT({CUBE}.created, 10)"
        type: string

      - name: created_month
        sql: "LEFT({CUBE}.created, 7)"
        type: string

      - name: created_week
        sql: "TO_CHAR(NULLIF({CUBE}.created, '')::timestamp, 'IYYY-\"W\"IW')"
        type: string

      - name: resolved_day
        sql: "LEFT({CUBE}.resolved, 10)"
        type: string

      - name: resolved_month
        sql: "LEFT({CUBE}.resolved, 7)"
        type: string

      - name: closed_day
        sql: "LEFT({CUBE}.closed, 10)"
        type: string

      - name: closed_month
        sql: "LEFT({CUBE}.closed, 7)"
        type: string


    measures:
      - name: count
        type: count

    pre_aggregations:
      # Pre-aggregation definitions go here.
      # Learn more in the documentation: https://cube.dev/docs/caching/pre-aggregations/getting-started

```

<a id="b10"></a>
### B.10 `model/cubes/change_request.yml`

```yaml
cubes:
  - name: change_request
    sql_table: public.change_request
    data_source: default

    joins: []

    dimensions:
      - name: brewery
        sql: brewery
        type: string

      - name: description
        sql: description
        type: string

      - name: planned_start_date_1
        sql: planned_start_date_1
        type: string

      - name: planned_end_date_1
        sql: planned_end_date_1
        type: string

      - name: requested_by
        sql: requested_by
        type: string

      - name: problem
        sql: problem
        type: string

      - name: purpose_of_change
        sql: purpose_of_change
        type: string

      - name: approval
        sql: approval
        type: string

      - name: comments_and_work_notes
        sql: comments_and_work_notes
        type: string

      - name: type
        sql: type
        type: string

      - name: enhancement
        sql: enhancement
        type: string

      - name: state
        sql: state
        type: string

      - name: close_code
        sql: close_code
        type: string

      - name: state_1
        sql: state_1
        type: string

      - name: process_failure
        sql: process_failure
        type: string

      - name: brewery_locations
        sql: brewery_locations
        type: string

      - name: task_type
        sql: task_type
        type: string

      - name: failure_code
        sql: failure_code
        type: string

      - name: planned_start_date
        sql: planned_start_date
        type: string

      - name: environment
        sql: environment
        type: string

      - name: project
        sql: project
        type: string

      - name: incident
        sql: incident
        type: string

      - name: risk
        sql: risk
        type: string

      - name: change_plan
        sql: change_plan
        type: string

      - name: backout_plan
        sql: backout_plan
        type: string

      - name: owner_group
        sql: owner_group
        type: string

      - name: configuration_item
        sql: configuration_item
        type: string

      - name: verification_plan
        sql: verification_plan
        type: string

      - name: sap_transport_required
        sql: sap_transport_required
        type: string

      - name: sub_type
        sql: sub_type
        type: string

      - name: planned_end_date
        sql: planned_end_date
        type: string

      - name: diwakar_kumar
        sql: diwakar_kumar
        type: string

      - name: number
        sql: number
        type: string

      - name: work_notes
        sql: work_notes
        type: string

      - name: success_code
        sql: success_code
        type: string

      - name: sap_impact
        sql: sap_impact
        type: string

      - name: created
        sql: created
        type: string

      - name: short_description
        sql: short_description
        type: string

      - name: outage
        sql: outage
        type: string

      # --- derived date buckets (added for trend / per-period questions) ---
      - name: created_day
        sql: "LEFT({CUBE}.created, 10)"
        type: string

      - name: created_month
        sql: "LEFT({CUBE}.created, 7)"
        type: string

      - name: created_week
        sql: "TO_CHAR(NULLIF({CUBE}.created, '')::timestamp, 'IYYY-\"W\"IW')"
        type: string

      - name: planned_start_month
        sql: "LEFT({CUBE}.planned_start_date, 7)"
        type: string


    measures:
      - name: count
        type: count

    pre_aggregations:
      # Pre-aggregation definitions go here.
      # Learn more in the documentation: https://cube.dev/docs/caching/pre-aggregations/getting-started

```

<a id="b11"></a>
### B.11 `model/cubes/sc_req_item.yml`

```yaml
cubes:
  - name: sc_req_item
    sql_table: public.sc_req_item
    data_source: default

    joins: []

    dimensions:
      - name: stage
        sql: stage
        type: string

      - name: updated
        sql: updated
        type: string

      - name: approval_set
        sql: approval_set
        type: string

      - name: short_description
        sql: short_description
        type: string

      - name: number
        sql: number
        type: string

      - name: description
        sql: description
        type: string

      - name: approval
        sql: approval
        type: string

      - name: state
        sql: state
        type: string

      - name: closed
        sql: closed
        type: string

      - name: order_guide
        sql: order_guide
        type: string

      - name: request
        sql: request
        type: string

      - name: location
        sql: location
        type: string

      - name: requested_for
        sql: requested_for
        type: string

      - name: parent
        sql: parent
        type: string

      - name: work_notes
        sql: work_notes
        type: string

      - name: item
        sql: item
        type: string

      - name: approval_history
        sql: approval_history
        type: string

      - name: opened_by
        sql: opened_by
        type: string

      - name: opened
        sql: opened
        type: string

      - name: fulfilled_time
        sql: fulfilled_time
        type: string

      # --- derived date buckets (added for trend / per-period questions) ---
      - name: opened_day
        sql: "LEFT({CUBE}.opened, 10)"
        type: string

      - name: opened_month
        sql: "LEFT({CUBE}.opened, 7)"
        type: string

      - name: opened_week
        sql: "TO_CHAR(NULLIF({CUBE}.opened, '')::timestamp, 'IYYY-\"W\"IW')"
        type: string

      - name: closed_month
        sql: "LEFT({CUBE}.closed, 7)"
        type: string


    measures:
      - name: count
        type: count

    pre_aggregations:
      # Pre-aggregation definitions go here.
      # Learn more in the documentation: https://cube.dev/docs/caching/pre-aggregations/getting-started

```

<a id="b12"></a>
### B.12 `model/cubes/sc_task.yml`

```yaml
cubes:
  - name: sc_task
    sql_table: public.sc_task
    data_source: default

    joins: []

    dimensions:
      - name: description
        sql: description
        type: string

      - name: request
        sql: request
        type: string

      - name: approval_history
        sql: approval_history
        type: string

      - name: item
        sql: item
        type: string

      - name: approval_set
        sql: approval_set
        type: string

      - name: additional_comments
        sql: additional_comments
        type: string

      - name: active
        sql: active
        type: string

      - name: work_notes
        sql: work_notes
        type: string

      - name: request_item
        sql: request_item
        type: string

      - name: assignment_group
        sql: assignment_group
        type: string

      - name: created
        sql: created
        type: string

      - name: assigned_to
        sql: assigned_to
        type: string

      - name: opened_by
        sql: opened_by
        type: string

      - name: approval
        sql: approval
        type: string

      - name: parent
        sql: parent
        type: string

      - name: state
        sql: state
        type: string

      - name: sla_flag
        sql: sla_flag
        type: string

      - name: number
        sql: number
        type: string

      - name: updated
        sql: updated
        type: string

      - name: short_description
        sql: short_description
        type: string

      # --- derived date buckets (added for trend / per-period questions) ---
      - name: created_day
        sql: "LEFT({CUBE}.created, 10)"
        type: string

      - name: created_month
        sql: "LEFT({CUBE}.created, 7)"
        type: string

      - name: created_week
        sql: "TO_CHAR(NULLIF({CUBE}.created, '')::timestamp, 'IYYY-\"W\"IW')"
        type: string


    measures:
      - name: count
        type: count

    pre_aggregations:
      # Pre-aggregation definitions go here.
      # Learn more in the documentation: https://cube.dev/docs/caching/pre-aggregations/getting-started

```

<a id="b13"></a>
### B.13 `model/cubes/change_approvals.yml`

```yaml
cubes:
  - name: change_approvals
    sql_table: public.change_approvals
    data_source: default

    joins: []

    dimensions:
      - name: approval
        sql: approval
        type: string

      - name: created
        sql: created
        type: string

      - name: assignment_group
        sql: assignment_group
        type: string

      - name: work_notes
        sql: work_notes
        type: string

      - name: state
        sql: state
        type: string

      - name: parent
        sql: parent
        type: string

      - name: task_type
        sql: task_type
        type: string

      - name: short_description
        sql: short_description
        type: string

      # --- derived date buckets (added for trend / per-period questions) ---
      - name: created_day
        sql: "LEFT({CUBE}.created, 10)"
        type: string

      - name: created_month
        sql: "LEFT({CUBE}.created, 7)"
        type: string

      - name: created_week
        sql: "TO_CHAR(NULLIF({CUBE}.created, '')::timestamp, 'IYYY-\"W\"IW')"
        type: string


    measures:
      - name: count
        type: count

    pre_aggregations:
      # Pre-aggregation definitions go here.
      # Learn more in the documentation: https://cube.dev/docs/caching/pre-aggregations/getting-started

```

<a id="b14"></a>
### B.14 `model/cubes/ritm_approvals.yml`

```yaml
cubes:
  - name: ritm_approvals
    sql_table: public.ritm_approvals
    data_source: default

    joins: []

    dimensions:
      - name: assignment_group
        sql: assignment_group
        type: string

      - name: parent
        sql: parent
        type: string

      - name: approval
        sql: approval
        type: string

      - name: state
        sql: state
        type: string

      - name: created
        sql: created
        type: string

      - name: short_description
        sql: short_description
        type: string

      - name: task_type
        sql: task_type
        type: string

      # --- derived date buckets (added for trend / per-period questions) ---
      - name: created_day
        sql: "LEFT({CUBE}.created, 10)"
        type: string

      - name: created_month
        sql: "LEFT({CUBE}.created, 7)"
        type: string

      - name: created_week
        sql: "TO_CHAR(NULLIF({CUBE}.created, '')::timestamp, 'IYYY-\"W\"IW')"
        type: string


    measures:
      - name: count
        type: count

    pre_aggregations:
      # Pre-aggregation definitions go here.
      # Learn more in the documentation: https://cube.dev/docs/caching/pre-aggregations/getting-started

```

<a id="b15"></a>
### B.15 `model/views/example_view.yml`

```yaml
# In Cube, views are used to expose slices of your data graph and act as data marts.
# You can control which measures and dimensions are exposed to BIs or data apps,
# as well as the direction of joins between the exposed cubes.
# You can learn more about views in documentation here - https://cube.dev/docs/schema/reference/view


# The following example shows a view defined on top of orders and customers cubes.
# Both orders and customers cubes are exposed using the "includes" parameter to
# control which measures and dimensions are exposed.
# Prefixes can also be applied when exposing measures or dimensions.
# In this case, the customers' city dimension is prefixed with the cube name,
# resulting in "customers_city" when querying the view.

# views:
#   - name: example_view
#
#     cubes:
#       - join_path: orders
#         includes:
#           - status
#           - created_date
#
#           - total_amount
#           - count
#
#       - join_path: orders.customers
#         prefix: true
#         includes:
#           - city
```

<a id="b16"></a>
### B.16 `Dockerfile`

```dockerfile
FROM node:20-alpine
# 7-Zip builds the .zip / .7z downloads (the binary bundled in npm's
# 7zip-bin is built for glibc and does not run on Alpine)
RUN apk add --no-cache 7zip
ENV SEVEN_ZIP_PATH=/usr/bin/7z
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8000
CMD ["node", "server.mjs"]
```

<a id="b17"></a>
### B.17 `docker-compose.yml`

```yaml
services:
  # 1. THE DATA LAYER (PostgreSQL)
  postgres:
    image: postgres:16-alpine
    container_name: analytics_postgres
    restart: always
    # Passwords come from the git-ignored .env file (see .env.example)
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: analytics_db
      AUTH_DB_PASSWORD: ${AUTH_DB_PASSWORD:?set AUTH_DB_PASSWORD in .env}
    # Only this computer can connect (127.0.0.1); other people reach the tool
    # through the app on port 8000, never the database directly
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      # Persist data so recreating the container doesn't wipe the tables
      - pgdata:/var/lib/postgresql/data
      # On first start (empty data dir) Postgres runs these scripts to create + load the tables
      - ./load_csv.sql:/docker-entrypoint-initdb.d/load_csv.sql:ro
      - ./csv_data:/tmp/my_csv_files:ro
      # ...and to create the separate sign-in account database (onetouch_auth)
      - ./db/init-auth.sh:/docker-entrypoint-initdb.d/20-init-auth.sh:ro
    # Healthy once Postgres accepts network connections. (-h 127.0.0.1 matters:
    # during first-time setup a temporary server answers on the local socket only.)
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U admin -d analytics_db"]
      interval: 2s
      timeout: 3s
      retries: 60

  # 1b. DATABASE SETUP. Runs on every `docker compose up`, then exits.
  # Postgres only runs its own setup scripts when its volume is brand new, so a
  # database created before sign-in existed would never get onetouch_auth.
  # This creates it if missing, keeps onetouch_app's password in step with .env,
  # and creates/updates the reporting views and the read-only Metabase role.
  db-setup:
    image: postgres:16-alpine
    restart: "no"
    entrypoint: ["sh", "-c", "sh /db/init-auth.sh && sh /db/init-reporting.sh"]
    environment:
      PGHOST: postgres
      PGPASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_USER: admin
      AUTH_DB_PASSWORD: ${AUTH_DB_PASSWORD:?set AUTH_DB_PASSWORD in .env}
      METABASE_DB_PASSWORD: ${METABASE_DB_PASSWORD:-}
    volumes:
      - ./db:/db:ro
    depends_on:
      postgres:
        condition: service_healthy

  # 2. THE SEMANTIC LAYER (Cube.dev)
   # 2. THE SEMANTIC LAYER (Cube.dev)
  cube:
    image: cubejs/cube:v0.35
    container_name: analytics_cube
    restart: always
    # This computer only (the app reaches Cube inside Docker's network)
    ports:
      - "127.0.0.1:4000:4000"     # REST API
      - "127.0.0.1:15432:15432"   # SQL API
    volumes:
      - .:/cube/conf
      # Keep Cube Store's RocksDB files out of the OneDrive-synced folder (prevents corruption)
      - cubestore_data:/cube/conf/.cubestore
    environment:
      CUBEJS_DB_TYPE: postgres
      CUBEJS_DB_HOST: postgres
      CUBEJS_DB_NAME: analytics_db
      CUBEJS_DB_USER: admin
      CUBEJS_DB_PASS: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      CUBEJS_DEV_MODE: "true"
      CUBEJS_API_SECRET: ${CUBEJS_API_SECRET:?set CUBEJS_API_SECRET in .env}
      CUBEJS_PG_SQL_PORT: 15432
      CUBEJS_SQL_USER: admin_cube
      CUBEJS_SQL_PASSWORD: ${CUBEJS_SQL_PASSWORD:?set CUBEJS_SQL_PASSWORD in .env}
      # 🎯 ADD THIS EXACT LINE HERE TO UNBLOCK THE CONNECTIONS:
      CUBEJS_BIND_ADDRESS: "0.0.0.0"
      # Force Cube onto 4000 (the mounted .env must not hijack the port)
      CUBEJS_PORT: "4000"
      PORT: "4000"
     # 👈 IMPORTANT: Allows outside connection loops
    depends_on:
      - postgres

  # 3. THE VISUALIZATION LAYER (Metabase)
  metabase:
    image: metabase/metabase:v0.50.4
    container_name: analytics_metabase
    restart: always
    # This computer only: Metabase has its own logins, separate from OneTouch's
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      MB_DB_TYPE: h2
      # Keep Metabase's own data (logins, connections, questions, dashboards) on
      # the mbdata volume; without this it lives inside the container and is
      # wiped whenever the container is recreated
      MB_DB_FILE: /metabase-data/metabase.db
    volumes:
      - mbdata:/metabase-data
    depends_on:
      - cube

  # 4. THE NODE APPLICATION ORCHESTRATOR LAYER
  app:
    build: .
    container_name: analytics_node_app
    restart: always
    ports:
      - "8000:8000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      PORT: 8000
      # 🎯 TARGETS CUBE BY SERVICE NAME NATIVELY:
      CUBE_API_URL: http://cube:4000/cubejs-api/v1/load
      # Secrets come from the git-ignored .env file (never hard-code them here)
      CUBE_API_TOKEN: ${CUBE_API_TOKEN:?set CUBE_API_TOKEN in .env}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      ANTHROPIC_WORKSPACE_ID: ${ANTHROPIC_WORKSPACE_ID:-}
      # Sign-in accounts: their own database and role (see auth.mjs, db/init-auth.sh)
      AUTH_DB_HOST: postgres
      AUTH_DB_PASSWORD: ${AUTH_DB_PASSWORD:?set AUTH_DB_PASSWORD in .env}
      # Used by scripts/metabase-setup.mjs and to show dashboards in the Dashboards tab
      METABASE_URL: http://metabase:3000
      METABASE_DB_PASSWORD: ${METABASE_DB_PASSWORD:-}
      METABASE_ADMIN_EMAIL: ${METABASE_ADMIN_EMAIL:-}
      METABASE_ADMIN_PASSWORD: ${METABASE_ADMIN_PASSWORD:-}
    depends_on:
      cube:
        condition: service_started
      # The account database must exist before the app loads db/accounts.json
      db-setup:
        condition: service_completed_successfully

  # 5. OPTIONAL: SHARE OVER THE INTERNET (Cloudflare Tunnel). Off unless asked for.
  # Quick tunnel: no account needed, gives a random https://....trycloudflare.com
  # link that changes every time it starts (see it with: docker logs onetouch_tunnel).
  #   docker compose --profile tunnel up -d tunnel
  #   docker compose stop tunnel
  tunnel:
    image: cloudflare/cloudflared:2026.9.3
    container_name: onetouch_tunnel
    profiles: ["tunnel"]
    restart: unless-stopped
    command: tunnel --no-autoupdate --url http://app:8000
    depends_on:
      - app

  # Named tunnel: a permanent address on your own domain. Needs a Cloudflare
  # account; create the tunnel there (route it to http://app:8000) and put its
  # token in .env as TUNNEL_TOKEN.
  #   docker compose --profile tunnel-named up -d tunnel-named
  tunnel-named:
    image: cloudflare/cloudflared:2026.9.3
    container_name: onetouch_tunnel_named
    profiles: ["tunnel-named"]
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:-}
    depends_on:
      - app

volumes:
  pgdata:
  mbdata:
  cubestore_data:
```

<a id="b18"></a>
### B.18 `business_logic.mjs`

```js
// =====================================================================
//  business_logic.mjs
//  The domain brain of the tool. Everything Claude needs to turn an IT
//  person's plain-English question about this ServiceNow export into a
//  structured Cube.dev JSON query lives here, plus the server-side
//  validator that normalizes and sanity-checks what Claude returns.
//
//  All values below were pulled from the real CSVs in csv_data/ on
//  2026-10-19. If the exports change, re-profile and update the
//  catalog; the system prompt is generated from it.
// =====================================================================

// ---------------------------------------------------------------------
// 1. ENTITY CATALOG — one record per ServiceNow table (Cube "cube")
// ---------------------------------------------------------------------
export const ENTITY_CATALOG = {
  incident: {
    label: 'Incidents (INC)',
    itil: 'Unplanned interruptions or degradations of a service. Someone reported something broken, or a monitoring tool raised an alert.',
    ticketPrefix: 'INC',
    dateColumn: 'created',
    rowCount: 23334,
    dateRange: '2026-07-05 to 2026-09-01',
    dimensions: ['number', 'created', 'created_day', 'created_week', 'created_month', 'short_description', 'description', 'affected_user', 'assignment_group', 'assigned_to', 'problem', 'state', 'parent_incident', 'priority', 'impact', 'urgency', 'breach_reason', 'global_incident', 'knowledge_article_reference', 'category', 'subcategory', 'updated', 'was_p1', 'configuration_item', 'contact_type', 'reassignment_count', 'close_code', 'close_notes', 'cause_code', 'cause_sub_code', 'opened_by_group', 'location', 'reopen_count', 'caused_by_change', 'business_impact_outage', 'resolved', 'resolved_day', 'resolved_month', 'closed', 'closed_day', 'closed_month', 'responsibility_for_outage', 'on_hold_reason', 'work_notes', 'risk_register_number', 'tags', 'third_party_related_ticket', 'business_impact', 'downgrade_reason', 'downgrade_type', 'kb_article'],
    listColumns: ['number', 'created', 'priority', 'state', 'short_description', 'assignment_group', 'category', 'subcategory', 'location'],
    detailColumns: ['number', 'created', 'updated', 'resolved', 'closed', 'priority', 'impact', 'urgency', 'state', 'on_hold_reason', 'short_description', 'description', 'category', 'subcategory', 'assignment_group', 'assigned_to', 'affected_user', 'location', 'configuration_item', 'contact_type', 'close_code', 'close_notes', 'cause_code', 'reassignment_count', 'reopen_count', 'caused_by_change', 'was_p1'],
    enums: {
      state: ['New', 'In Progress', 'On Hold', 'Resolved', 'Closed'],
      priority: ['P1 - Critical', 'P2 - High', 'P3 - Average', 'P4 - Low'],
      impact: ['1 - Enterprise', '2 - Site/Dept', '3 - Multiple Users', '4 - User'],
      urgency: ['1 - xxx (Immediate Loss)', '2 - xxx (Workaround)', '3 - xxx (No Loss)', '4 - Low'],
      category: ['Hardware', 'Business Services', 'Network', 'Inquiry / Help', 'Security', 'Software/Configuration', 'Printing', 'Email', 'Telephony', 'Database'],
      subcategory: ['Server', 'Performance', 'Application Functionality', 'Alert', 'Job Failure', 'Advice/Guidance', 'Access', 'Password Reset', 'Dropped Call', 'Network Printer', 'Operating System - User', 'Software Installation', 'Laptop', 'Account Locked', 'Outlook', 'Other', 'Data', 'Mobile Phone', 'Desktop', 'User Connectivity - Onsite', 'VDI', 'Account Disabled', 'MS Office', 'Local Printer', 'Exchange', 'IPT Phone', 'Hardware', 'Analogue Phone', 'User Connectivity - Remote', 'LAN', 'Backup', 'iPad', 'Wireless', 'Firewall', 'Network', 'Password Expired', 'Storage / SAN', 'Complaint', 'Network Device', 'Call Center/Switchboard', 'Ticket Status', 'PC Configuration', 'Mobile', 'Security', 'WAN', 'Backup Device', 'DB2', 'Oracle', 'Transfer/Handoff to Other Partner', 'Audio Conference', 'MS SQL Server', 'Voice Mail'],
      contact_type: ['Event Management', 'Self-service', 'Phone', 'Chat', 'Email', 'Walk-in'],
      close_code: ['Solved (Permanently)', 'Solved (Work Around)', 'Closed/Resolved by Caller', 'Not Solved (Not Reproducible)'],
      cause_code: ['Business as Usual', 'Business/System Changes', 'Lack of Maintenance', 'Portfolio Activity'],
      on_hold_reason: ['Awaiting Caller', 'Awaiting Vendor', 'Awaiting Change'],
      responsibility_for_outage: ['Accenture', 'TCS', 'Molson Coors', 'MCBC', 'MillerCoors', 'ProLeiT', 'Microsoft', 'SAP', 'ServiceNow', 'AT&T', 'BT'],
      downgrade_type: ['Pre-Approved', 'IT Resource Approved'],
      breach_reason: ['Waiting on End user', 'Other', 'Waiting on another vendor', 'Waiting on MCBC'],
      was_p1: ['true', 'false'],
      global_incident: ['true', 'false'],
    },
    openStates: ['New', 'In Progress', 'On Hold'],
    closedStates: ['Resolved', 'Closed'],
  },

  change_request: {
    label: 'Change Requests (CHG)',
    itil: 'Planned modifications to production or non-production systems: patching, deployments, network changes, reboots, config changes. They go through approval and CAB.',
    ticketPrefix: 'CHG',
    dateColumn: 'created',
    rowCount: 1969,
    dateRange: '2026-06-01 to 2026-09-01 (planned_start_date runs 2024-08 to 2026-12)',
    dimensions: ['number', 'type', 'created', 'created_day', 'created_week', 'created_month', 'sub_type', 'task_type', 'configuration_item', 'short_description', 'owner_group', 'outage', 'state', 'approval', 'close_code', 'failure_code', 'success_code', 'process_failure', 'diwakar_kumar', 'requested_by', 'state_1', 'planned_start_date', 'planned_start_month', 'brewery', 'brewery_locations', 'work_notes', 'planned_end_date', 'risk', 'planned_start_date_1', 'planned_end_date_1', 'description', 'change_plan', 'verification_plan', 'backout_plan', 'purpose_of_change', 'incident', 'problem', 'enhancement', 'sap_impact', 'sap_transport_required', 'environment', 'project', 'comments_and_work_notes'],
    listColumns: ['number', 'created', 'type', 'sub_type', 'state', 'approval', 'risk', 'short_description', 'owner_group', 'planned_start_date', 'environment'],
    detailColumns: ['number', 'created', 'type', 'sub_type', 'state', 'approval', 'risk', 'outage', 'environment', 'short_description', 'description', 'owner_group', 'requested_by', 'configuration_item', 'planned_start_date', 'planned_end_date', 'close_code', 'success_code', 'failure_code', 'process_failure', 'sap_impact', 'brewery', 'brewery_locations', 'purpose_of_change', 'change_plan', 'backout_plan', 'incident'],
    enums: {
      type: ['Normal', 'Standard', 'Expedited', 'Hypercare', 'Request for Awareness', 'Emergency'],
      sub_type: ['Application', 'Scheduled Maintenance Patching', 'Infrastructure Change', 'Network Change', 'Network Security', 'Other', 'Workstation Patching', 'Security', 'Role Change', 'Database', 'Reboot', 'Server Provisioning or Decommissioning', 'Certificate Maintenance', 'Compliance', 'Storage Change', 'Network Firewall'],
      state: ['Pending', 'Pre-approve', 'Review', 'Build and Test', 'Work in Progress', 'Closed', 'Canceled'],
      approval: ['Approved', 'Not Yet Requested', 'Requested', 'Rejected'],
      close_code: ['Successful', 'Unsuccessful'],
      failure_code: ['Incomplete', 'Caused Incident', 'Issues', 'Backout'],
      success_code: ['Complete', 'Authorized Extension'],
      process_failure: ['true', 'false'],
      outage: ['Yes', 'No'],
      risk: ['Low', 'Medium', 'High', 'Standard', 'RFA'],
      brewery: ['Yes', 'No'],
      environment: ['Production', 'Non-Production'],
      sap_impact: ['Yes', 'No'],
      sap_transport_required: ['Yes', 'No'],
    },
    openStates: ['Pending', 'Pre-approve', 'Review', 'Build and Test', 'Work in Progress'],
    closedStates: ['Closed', 'Canceled'],
  },

  change_approvals: {
    label: 'Change approval records',
    itil: 'One row per approval group asked to sign off on a change. parent = the CHG number. Use this when the question is about approvers or approval groups, not when it is about the change itself.',
    ticketPrefix: null,
    dateColumn: 'created',
    rowCount: 9942,
    dateRange: '2026-06-01 to 2026-09-01',
    dimensions: ['task_type', 'parent', 'assignment_group', 'short_description', 'created', 'created_day', 'created_week', 'created_month', 'work_notes', 'approval', 'state'],
    listColumns: ['parent', 'assignment_group', 'approval', 'state', 'created', 'short_description'],
    detailColumns: ['parent', 'assignment_group', 'approval', 'state', 'created', 'short_description', 'work_notes'],
    enums: {
      approval: ['Approved', 'Not Yet Requested', 'Cancelled', 'Requested'],
      state: ['Closed Complete', 'Pending', 'Closed Incomplete', 'Open'],
    },
    openStates: ['Open', 'Pending'],
    closedStates: ['Closed Complete', 'Closed Incomplete'],
  },

  sc_req_item: {
    label: 'Requested Items (RITM) — service catalog requests',
    itil: 'Things people order from the service catalog: software, laptops, AD accounts, mailbox changes, VDI access, server start/stop, terminations. Not broken things. The REQ number is the parent order; the RITM is the individual item.',
    ticketPrefix: 'RITM',
    dateColumn: 'opened',
    rowCount: 17501,
    dateRange: '2026-06-01 to 2026-09-01',
    dimensions: ['number', 'item', 'description', 'short_description', 'opened', 'opened_day', 'opened_week', 'opened_month', 'updated', 'closed', 'closed_month', 'stage', 'state', 'parent', 'request', 'requested_for', 'opened_by', 'approval', 'approval_history', 'approval_set', 'location', 'work_notes', 'fulfilled_time', 'order_guide'],
    listColumns: ['number', 'opened', 'item', 'state', 'stage', 'approval', 'short_description', 'location'],
    detailColumns: ['number', 'request', 'opened', 'updated', 'closed', 'item', 'state', 'stage', 'approval', 'short_description', 'description', 'requested_for', 'opened_by', 'location', 'fulfilled_time'],
    enums: {
      state: ['Open', 'Pending', 'Fulfilled', 'Closed Complete', 'Closed Cancelled', 'Closed Incomplete', 'Closed Rejected', 'Unsatisfied Fulfillment'],
      stage: ['Completed', 'Request Completed', 'Fulfillment', 'Request Cancelled', 'Request Approved', 'Waiting for Approval', 'complete', 'Request Failed', 'operation_failed', 'Cancelled', 'request_approved', 'Deployment'],
      approval: ['Approved', 'Requested', 'Rejected', 'Not Yet Requested'],
      item: ['Non-standard Service Request', 'Virtual Server - Start', 'Start and Snooze Applications/Servers', 'Virtual Server - Stop', 'PC Software', 'Reclaim Asset', 'GovernIT Assistance Request', 'AD Request', 'General Mailbox / General Calendar - Add or Change', 'Distribution List Creation / Update / Remove', 'Network Share Access and Creation', 'SAP Request (Molson Systems ONLY)', 'PC Request', 'VDI - Pool Access', 'Virtual Server-Virtual Server Interface-Modify Schedule', 'Request Upgrade to Office License', 'Power User Access (PUA) (IT Only)', 'ServiceNow Access and Group Maintenance', 'External Computer Hardware', 'GBS Group Maintenance', 'Non-standard Brewery Request', 'Access to an Existing SharePoint Site', 'Employee/Contractor Termination', 'Non-standard Network Request', 'Enterprise Application Access Request', 'SAP Non-Production Request (ONA/Miller/MillerCoors/Americas)', 'Application Enhancement Request (IT ONLY)', 'Firewall Request', 'Accenture – General Infrastructure Request', 'iPad/Tablet Request', 'BP&S Adhoc Data Load Service Request', 'Request new or replacement Mobile Phone', 'Accenture – General Application Request', 'OneDrive and SharePoint Management', 'SAP Role Change Request', 'Brewery Radio Request', 'New ServiceNow Requests - GBS', 'Batch Job Request', 'Anaplan Access Request', 'New ServiceNow Requests', 'USB Exception Request', 'DNS/DHCP/IP Address Request', 'Configure Printer with Network and SAP Printing', 'Update CI(s)', 'Website block/unblock', 'Elevated Privileges for end users', 'Office Telephone Request', 'VDI - Pool Updates', 'Create CI(s)', 'Existing Standalone/Portable Printer Driver Install', 'Reporting Help', 'PC Software Security Exception Request', 'BPN Access Request', 'Server Provisioning - Cloud', 'Individual Office Telephone Request', 'Request for Packaging', 'New SharePoint Project or Team Site', 'File or Folder Restore', 'Network Device Request', 'ServiceNow Catalog Update (IT ONLY)', 'Audio Conferencing for Microsoft Teams', 'New Meeting Room or Other Resource', 'Changes to Mobile Phone Account', 'Service Introduction', 'Policy Updates (GPO and Intune Policies)', 'Network Drive Mapping Assistance', 'Network Activation', 'Partner SOW/WO Request (IT ONLY)', 'Location / Shared Based Telephone Request', 'WCSC', 'Phone Accessories', 'Request Vulnerability Scan', 'Reporting Help IT', 'Move Single User', 'ODM Office Companion', 'Contact Centre & Calabrio Access', 'Service Decommission/Retirement'],
    },
    openStates: ['Open', 'Pending'],
    closedStates: ['Fulfilled', 'Closed Complete', 'Closed Cancelled', 'Closed Incomplete', 'Closed Rejected', 'Unsatisfied Fulfillment'],
  },

  ritm_approvals: {
    label: 'Requested-item approval records',
    itil: 'One row per approval group asked to sign off on a RITM (manager approval, software validation, security). parent = the RITM number.',
    ticketPrefix: null,
    dateColumn: 'created',
    rowCount: 5379,
    dateRange: '2026-06-01 to 2026-09-01',
    dimensions: ['task_type', 'parent', 'assignment_group', 'short_description', 'created', 'created_day', 'created_week', 'created_month', 'approval', 'state'],
    listColumns: ['parent', 'assignment_group', 'approval', 'state', 'created', 'short_description'],
    detailColumns: ['parent', 'assignment_group', 'approval', 'state', 'created', 'short_description'],
    enums: {
      approval: ['Approved', 'Rejected', 'Requested', 'No Longer Required'],
      state: ['Closed Complete', 'Open', 'Closed Skipped'],
    },
    openStates: ['Open'],
    closedStates: ['Closed Complete', 'Closed Skipped'],
  },

  sc_task: {
    label: 'Catalog Tasks (SCTASK) — fulfillment work items',
    itil: 'The work items a fulfillment team actually performs to deliver a RITM (create the account, image the laptop, grant the share). request_item = the RITM, request = the REQ.',
    ticketPrefix: 'SCTASK',
    dateColumn: 'created',
    rowCount: 16321,
    dateRange: '2026-06-01 to 2026-09-01',
    dimensions: ['number', 'item', 'state', 'short_description', 'assignment_group', 'assigned_to', 'parent', 'opened_by', 'approval', 'approval_history', 'approval_set', 'request', 'request_item', 'sla_flag', 'created', 'created_day', 'created_week', 'created_month', 'updated', 'additional_comments', 'description', 'work_notes', 'active'],
    listColumns: ['number', 'created', 'item', 'state', 'assignment_group', 'assigned_to', 'sla_flag', 'short_description', 'request_item'],
    detailColumns: ['number', 'request', 'request_item', 'created', 'updated', 'item', 'state', 'active', 'sla_flag', 'assignment_group', 'assigned_to', 'opened_by', 'short_description', 'description', 'additional_comments'],
    enums: {
      state: ['Open', 'Pending', 'Work in Progress', 'Closed Complete', 'Closed Cancelled', 'Closed Incomplete'],
      sla_flag: ['true', 'false'],
      active: ['true', 'false'],
    },
    openStates: ['Open', 'Pending', 'Work in Progress'],
    closedStates: ['Closed Complete', 'Closed Cancelled', 'Closed Incomplete'],
  },
};

// ---------------------------------------------------------------------
// 2. QUERY CONTRACT — what Claude is allowed to emit
// ---------------------------------------------------------------------
export const ALLOWED_OPERATORS = [
  'equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith',
  'set', 'notSet', 'gt', 'gte', 'lt', 'lte',
];

export const LIMITS = { defaultList: 50, defaultTop: 10, max: 500, perTypeList: 25 };

// The four standalone ticket types. "Ticket" in plain speech means any of
// these. Approval records are sub-records of a change or request, so they
// are only included when the user explicitly asks about approvals.
export const TICKET_TYPES = ['incident', 'change_request', 'sc_req_item', 'sc_task'];

const CUBE_NAMES = Object.keys(ENTITY_CATALOG);

// Structured-output schema. Every object is closed (additionalProperties:false)
// and every field is required so the response shape is always identical.
// A question about one ticket type has one entry in `queries`; a question
// about "tickets" in general has one entry per ticket type.
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'queries', 'message', 'assumptions'],
  properties: {
    intent: { type: 'string', enum: ['query', 'clarify', 'unsupported'] },
    queries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['entity', 'query'],
        properties: {
          entity: { type: 'string', enum: CUBE_NAMES },
          query: {
      type: 'object',
      additionalProperties: false,
      required: ['measures', 'dimensions', 'filters', 'order', 'limit'],
      properties: {
        measures: { type: 'array', items: { type: 'string' } },
        dimensions: { type: 'array', items: { type: 'string' } },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['member', 'operator', 'values'],
            properties: {
              member: { type: 'string' },
              operator: { type: 'string', enum: ALLOWED_OPERATORS },
              values: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        order: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['member', 'direction'],
            properties: {
              member: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'] },
            },
          },
        },
        limit: { type: 'integer' },
      },
          },
        },
      },
    },
    message: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
};

// ---------------------------------------------------------------------
// 3. SYSTEM PROMPT — the business logic, written for Claude
//    (stable text => cacheable; today's date is injected in the user turn)
// ---------------------------------------------------------------------
function memberList(cube) {
  const e = ENTITY_CATALOG[cube];
  return `${cube}: measures=[${cube}.count]; dimensions=[${e.dimensions.map(d => `${cube}.${d}`).join(', ')}]`;
}

function enumBlock(cube) {
  const e = ENTITY_CATALOG[cube];
  return Object.entries(e.enums)
    .map(([col, vals]) => `  ${cube}.${col}: ${vals.map(v => JSON.stringify(v)).join(' | ')}`)
    .join('\n');
}

export function buildSystemPrompt() {
  const cubes = Object.keys(ENTITY_CATALOG);
  return `You are the query-translation layer of an internal IT service-management analytics tool.
The user is an IT person (service desk analyst, sysadmin, change manager, team lead) asking questions in everyday language about a ServiceNow export. Your only job is to translate each question into structured Cube.dev queries (one per ticket type involved), or to say clearly why you cannot. You never answer the question yourself and you never write SQL.

=====================================================================
A. THE DATA (six ServiceNow tables, loaded as Cube cubes)
=====================================================================
${cubes.map(c => {
  const e = ENTITY_CATALOG[c];
  return `- ${c} — ${e.label}. ${e.itil} Rows: ${e.rowCount}. Date coverage: ${e.dateRange}.`;
}).join('\n')}

How they relate (ITIL mental model):
- A REQ is an order; it contains one or more RITMs (sc_req_item.request = REQ number). Each RITM spawns SCTASKs (sc_task.request_item = RITM number) and may need approvals (ritm_approvals.parent = RITM number).
- A CHG needs approvals (change_approvals.parent = CHG number). An incident can be linked to a change that caused it (incident.caused_by_change = CHG number) and a change can reference the incident it fixes (change_request.incident).
- IMPORTANT: the cubes are NOT joined. Each entry in "queries" must use members from exactly one cube. When a question spans several ticket types, emit one entry per type (see C0); the server runs them side by side and merges the counts. Questions that need a row-level join between tables (e.g. "incidents caused by changes owned by team X") are still not possible; pick the cube the question is fundamentally about and state the limitation in assumptions.

Ticket number prefixes resolve the entity instantly:
  INC → incident.number | CHG → change_request.number | RITM → sc_req_item.number
  REQ → sc_req_item.request (or sc_task.request) | SCTASK → sc_task.number

Exact member names you may use (nothing else exists):
${cubes.map(memberList).join('\n')}

ALL columns are stored as TEXT. Dates are text in the form "YYYY-MM-DD HH:MM:SS", which sorts correctly as a string. The *_day, *_week, *_month dimensions are derived text buckets ("2026-08-14", "2026-W33", "2026-08") made for grouping and trends. Counts like reassignment_count are text digits.

The only measure is <cube>.count. There are no sums, averages, durations, or percentages in the model.

=====================================================================
B. KNOWN VALUES (exact spellings — equals is case-sensitive, contains is not)
=====================================================================
${cubes.map(c => `${c}:\n${enumBlock(c)}`).join('\n')}

Spelling traps in this data:
- change_request.state uses "Canceled" (one L). sc_req_item, sc_task and change_approvals use "Cancelled" (two Ls).
- sc_req_item.stage is inconsistent ("Completed" vs "complete", "Request Approved" vs "request_approved"). Prefer sc_req_item.state for status; if you must use stage, use "contains" (which is case-insensitive).
- Priority/impact/urgency are strings with a number prefix ("P1 - Critical", "1 - Enterprise"). Use the full string with equals.
- People are anonymized as "Individual 1234" in affected_user, assigned_to, requested_by, opened_by, requested_for. Real names will never match. If the user names a person, use intent "clarify" and ask for the Individual ID or a ticket number.
- Group names are codes: ACN-* = Accenture teams, TCS-* = Tata Consultancy teams, MCBC-* / MC-* = Molson Coors internal teams. Always use "contains" with the distinctive token, never equals (e.g. "wintel" → assignment_group contains "WINTEL").

=====================================================================
C. HOW TO READ THE USER (speech nuances → query decisions)
=====================================================================
C0. "Ticket" means ANY ticket type
In this tool a "ticket" is any single event logged in ServiceNow: an incident, a change, a requested item, or a catalog task. These four are the ticket types: ${TICKET_TYPES.join(', ')}.
- Generic words → all four ticket types, one entry in "queries" per type: "ticket(s)", "tix", "tkts", "case(s)", "record(s)", "item(s) logged", "event(s)", "everything", "anything", "all work", "workload", "volume", "the queue" (no type named), "what came in", "what got logged".
- Approval records (change_approvals, ritm_approvals) are NOT tickets on their own; they are sign-offs attached to a change or request. Include them only when the user explicitly asks about approvals.
- Narrow the set to the ticket types where every requested filter or grouping actually exists, and say which types were dropped and why in assumptions. Field availability:
    priority / impact / urgency / category / subcategory / contact_type / P1–P4 / severity → incident only.
    type / sub_type / risk / environment / outage / planned dates / CAB → change_request only.
    catalog item → sc_req_item and sc_task.
    team / group / queue → incident.assignment_group, change_request.owner_group, sc_task.assignment_group (sc_req_item has no team column, so drop it).
    location → incident.location and sc_req_item.location only.
    assigned_to (a person) → incident and sc_task only.
    approval status → change_request, sc_req_item.
    state, created/opened date, short_description, number → all four (use each type's own date column and its own state values, see C3).
  Example: "P1 tickets" → incident only, because priority exists only on incidents. "Tickets for the WINTEL team" → incident, change_request and sc_task.
- The same filter must be expressed in each type's own terms. "Open tickets" → incident.state [New, In Progress, On Hold], change_request.state [Pending, Pre-approve, Review, Build and Test, Work in Progress], sc_req_item.state [Open, Pending], sc_task.state [Open, Pending, Work in Progress]. "Tickets last month" → incident.created, change_request.created, sc_req_item.opened, sc_task.created.
- Every entry must have the SAME shape: same measures pattern (<cube>.count or none), the equivalent single dimension when grouping (e.g. created_month / opened_month, assignment_group / owner_group), the same order direction, and the same limit. The server merges grouped counts by dimension value and applies the limit to the merged totals, so for "top N" give each entry the same limit N.
- Note in assumptions that a requested item and the catalog tasks created to fulfil it are counted as separate tickets.
- When the user names one type explicitly ("incidents", "changes", "requests", "tasks") use only that type.

C1. Which ticket type, when one is named?
- "incident", "INC", "issue", "outage", "alert", "something broke", "went down", "major incident", "sev1", "P1/P2/P3/P4" → incident.
- "change", "CHG", "CR", "RFC", "CAB", "deploy/deployment", "release", "patch/patching", "reboot", "maintenance window", "go-live", "hypercare", "rollout" → change_request.
- "request", "RITM", "REQ", "service request", "catalog", "ordered", "onboarding/offboarding", "new hire", "termination", "access request", "software request", "new laptop" → sc_req_item.
- "task", "SCTASK", "catalog task", "fulfillment task", "work item", "my queue" (when about doing fulfillment work) → sc_task.
- Questions about WHO approved / WHICH approval group / approvals pending with a group → change_approvals (if about changes) or ritm_approvals (if about requests). Questions like "changes pending approval" or "rejected requests" use the approval column on change_request / sc_req_item instead.
- No entity words at all ("how many are open", "what came in today") → treat it as "tickets": all four ticket types, per C0.
- The word "problem" usually means incident in casual speech. Only use incident.problem when they say "problem ticket" or give a PRB number.

C2. What shape of answer?
- "how many", "count", "number of", "volume", "total" → measures=[<cube>.count], no dimensions.
- "by X", "per X", "breakdown", "split", "grouped", "distribution", "across teams", "which groups" → dimensions=[X] + count, order count desc.
- "top N", "most", "busiest", "biggest", "worst", "noisiest", "leading" → dimension + count, order desc, limit N (default 10). "fewest/least/quietest" → order asc.
- "trend", "over time", "per day/week/month", "daily/weekly/monthly", "month over month" → group by the *_month / *_week / *_day dimension, order by that dimension asc.
- "show", "list", "give me", "pull", "which tickets", "what are the", "find" → NO measures; dimensions = the standard list columns below; order by the date column desc; limit 50 unless they say a number. When listing several ticket types at once, use limit ${LIMITS.perTypeList} per type unless they say a number; each type is shown as its own table.
- "details", "what happened with", "status of", "look up", or just a bare ticket number → filter number equals that ticket, dimensions = the detail columns, limit 1. A ticket number always identifies exactly one type by its prefix.
- "who" → assignment_group (or assigned_to if they clearly mean a person). "where" → location. "when" → created/opened. "why / what caused" → cause_code or close_code. "what kind" → category/subcategory or item/type.
- "percent", "share", "ratio", "rate" → return the count broken down by the relevant dimension and say in message that percentages must be derived from the counts.
- Averages, MTTR, resolution time, time to close, aging in days, SLA compliance %, durations of any kind → intent "unsupported" with a message explaining the model only has counts, plus the nearest count question you CAN run. Exceptions that ARE supported: "SLA breached tasks" → sc_task.sla_flag equals true; "breached incidents" → incident.breach_reason set.

Standard list columns:
${cubes.map(c => `  ${c}: ${ENTITY_CATALOG[c].listColumns.map(d => `${c}.${d}`).join(', ')}`).join('\n')}
Detail columns (for single-ticket lookups):
${cubes.map(c => `  ${c}: ${ENTITY_CATALOG[c].detailColumns.map(d => `${c}.${d}`).join(', ')}`).join('\n')}

C3. Status words (the biggest source of nuance)
- "open", "active", "outstanding", "unresolved", "still open", "in the queue", "backlog", "pending", "not closed", "currently", "right now", "WIP", "ongoing":
    incident.state equals [${ENTITY_CATALOG.incident.openStates.join(', ')}]
    change_request.state equals [${ENTITY_CATALOG.change_request.openStates.join(', ')}]
    sc_req_item.state equals [${ENTITY_CATALOG.sc_req_item.openStates.join(', ')}]
    sc_task.state equals [${ENTITY_CATALOG.sc_task.openStates.join(', ')}]  (or sc_task.active equals true — equivalent)
    change_approvals.state equals [Open, Pending] ; ritm_approvals.state equals [Open]
- "closed", "done", "finished", "completed", "wrapped up":
    incident.state equals [Resolved, Closed] unless they say specifically "closed" (then just Closed) or "resolved" (then just Resolved — resolved means fixed but not yet formally closed).
    change_request.state Closed ; sc_req_item.state [Fulfilled, Closed Complete] ; sc_task.state Closed Complete.
- "cancelled/canceled/withdrawn/abandoned" → change_request.state "Canceled" / sc_req_item.state "Closed Cancelled" / sc_task.state "Closed Cancelled" / change_approvals.approval "Cancelled".
- "on hold", "waiting", "parked", "paused", "stuck waiting on the user/vendor" → incident.state On Hold (+ on_hold_reason if they say on whom: user/caller → Awaiting Caller, vendor/third party → Awaiting Vendor, change → Awaiting Change).
- "new", "unassigned", "untouched", "nobody picked up" → incident.state New (or sc_task.state Open).
- "stuck", "stale", "aging", "old", "sitting there", "rotting" → open states AND created before a cutoff (default: older than 7 days from today) — state the cutoff in assumptions.
- "reopened", "bounced back", "came back" → incident.reopen_count notEquals "0".
- "reassigned", "bounced around", "ping-ponged", "hot potato", "passed around" → incident.reassignment_count gte "2" (reassigned at least once → notEquals "0").
- "failed change", "unsuccessful", "went wrong", "blew up", "rolled back", "backed out" → change_request.close_code "Unsuccessful" (rolled back/backed out specifically → failure_code "Backout"; "caused an incident" → failure_code "Caused Incident"). "process failure" / "not followed process" → process_failure true.
- "successful changes", "went fine" → change_request.close_code Successful.
- "rejected" → change_request.approval Rejected / sc_req_item.approval Rejected / ritm_approvals.approval Rejected.
- "pending approval", "waiting for approval", "awaiting CAB", "not approved yet", "needs sign-off" → <cube>.approval equals "Requested" (change_request, sc_req_item) or approval records with state Open/Pending.
- "approved" → approval equals Approved.
- "fulfilled", "delivered", "provisioned" → sc_req_item.state [Fulfilled, Closed Complete].
- "failed request" → sc_req_item.stage contains "fail".
- "SLA breach", "breached", "over SLA", "missed SLA", "late" → sc_task.sla_flag true (tasks) or incident.breach_reason set (incidents).

C4. Priority / severity words (incident)
- "P1", "critical", "sev1", "severity 1", "major", "crit", "fire", "on fire", "burning", "all hands" → priority "P1 - Critical". "was a P1 at some point / downgraded P1s" → was_p1 true.
- "P2", "high", "sev2", "urgent", "hot" → "P2 - High". "high priority" alone → P1 and P2 together, say so.
- "P3", "average", "medium", "normal" → "P3 - Average". "P4", "low", "minor", "trivial" → "P4 - Low".
- "enterprise-wide", "everyone affected", "whole company" → impact "1 - Enterprise". "site down", "a whole plant/department" → impact "2 - Site/Dept". "multiple users" → "3 - Multiple Users". "single user", "one person" → "4 - User".
- "downgraded", "lowered priority" → downgrade_type set.

C5. Time phrases
The user message tells you TODAY's date. Compute concrete ISO dates from it. Use the entity's date column (incident/change_request/sc_task/approvals: created; sc_req_item: opened) unless they say resolved/closed/planned/scheduled. Always emit date filters as:
  - a whole month ("in August", "August's", "last month") → <date_col> startsWith "YYYY-MM"
  - a whole day ("on Aug 14", "yesterday", "today") → <date_col> startsWith "YYYY-MM-DD"
  - a range ("last 30 days", "since July", "between X and Y", "this week", "Q3", "year to date") → two filters: gte "YYYY-MM-DD" and lt "YYYY-MM-DD" (exclusive upper bound, next day).
- "recently", "lately" → last 7 days. "the past couple weeks" → 14 days. "this quarter" → calendar quarter containing today. "YTD" → Jan 1 to today.
- "this month" = calendar month of today. "last month" = the previous calendar month. "this week" = Monday of this week to today. "last week" = previous Mon–Sun.
- "resolved/fixed in <period>" → incident.resolved. "closed in <period>" → closed. "scheduled/planned for <period>", "upcoming", "next week", "on the calendar" → change_request.planned_start_date (upcoming = planned_start_date gte today). "went live" → planned_end_date.
- Data coverage is roughly 2026-06-01 to 2026-09-01 (incidents from 2026-07-05). If the computed window falls entirely outside that, still build the query but warn in assumptions that it is probably outside the export window.
- Words like "ever", "all time", "overall", "in total" → no date filter.

C6. Teams, groups, places, things
- Team / group / queue / squad / desk → assignment_group (incident, sc_task, approvals) or owner_group (change_request). Use contains with the distinctive token: "wintel / windows server team" → "WINTEL"; "linux" → "LINUX"; "SAP basis" → "SAP-BASIS"; "SAP" → "SAP"; "network team" → "Network"; "NOC" → "NOC"; "service desk / help desk / L1 / tier 1" → "ServiceDesk"; "IAM / identity / access management" → "IAM"; "desktop support / EUS / deskside" → "EUS"; "VDI / Citrix" → "VDI"; "M365 / Office 365 / Exchange online" → "M365"; "DBA / SQL team" → "SQL"; "Oracle" → "ORACLE"; "Azure" → "AZURE"; "AWS" → "AWS"; "storage" → "STORAGE"; "backup" → "BACKUP"; "security" → "Security"; "Accenture" → "ACN-"; "TCS / Tata" → "TCS-"; "Molson / internal / MCBC" → "MCBC".
- "opened by the monitoring tool / auto-generated / event management / alerts" → incident.contact_type "Event Management" or opened_by_group contains "ALERTING". "called in" → contact_type Phone. "chat" → Chat. "portal / self-service / submitted online" → Self-service. "walked up" → Walk-in. "emailed" → Email. "human-reported / real users (not monitoring)" → contact_type notEquals "Event Management".
- Locations → location (incident, sc_req_item) with contains: breweries by name ("Golden", "Milwaukee", "Fort Worth", "Burton", "Toronto", "Longueuil", "Albany", "Trenton", "Shenandoah", "Moncton", "Fraser Valley", "Tadcaster", "Aspall"); "HQ / corporate / head office" → startsWith "Corporate" (Milwaukee & Chicago); "Romania / GBS" → "Romania"; "UK" → Burton, Tadcaster, Aspall, Cardiff, Leeds, "Mobile UK" — use contains "Burton" if they say Burton, otherwise pick the most common and state it; "Canada" → Toronto/Longueuil/Moncton/Fraser Valley/Montreal; "cloud / Azure region / AWS region" → contains "Azure" or "US East"; "remote / WFH / home" → "Home Based". "Milwaukee" matches BOTH "Corporate - Milwaukee" and "Milwaukee Brewery" — use contains "Milwaukee" and say so, unless they say brewery or corporate.
- change_request: "brewery changes / plant changes" → brewery equals Yes; a named brewery → brewery_locations contains "<name>".
- Server / host / app / CI / device / box names → configuration_item contains "<name>". "noisiest server / which CI generates the most" → group by configuration_item, top 10.
- "environment: prod / production / live" → change_request.environment Production; "non-prod / dev / QA / test / UAT" → Non-Production.
- "SAP changes / anything touching SAP" → change_request.sap_impact Yes (or owner_group contains SAP if they mean the SAP team). "transports" → sap_transport_required Yes.
- "with an outage / downtime / service interruption" → change_request.outage Yes (planned outage). "caused an outage" → incident.business_impact_outage set.
- "caused by a change / change-related incidents / collateral from patching" → incident.caused_by_change set (or incident.cause_code "Business/System Changes").
- "knowledge article / KB attached" → incident.kb_article set.
- Category synonyms (incident): "hardware / laptop / desktop / device" → category Hardware (subcategory Laptop / Desktop when specific); "server issues" → subcategory Server; "slow / performance / latency" → subcategory Performance; "app not working / application bug" → Application Functionality; "job / batch / IWS / scheduler failures" → Job Failure; "password / locked out / can't log in" → subcategory equals [Password Reset, Account Locked, Password Expired, Account Disabled]; "access" → subcategory Access; "printer / printing" → category Printing (or subcategory contains "Printer"); "email / Outlook / mailbox" → category Email (or subcategory Outlook/Exchange); "phone / telephony / call drop / softphone" → category Telephony (dropped calls → subcategory Dropped Call); "network / wifi / LAN / WAN / VPN / connectivity" → category Network (specific subcategories Wireless, LAN, WAN, User Connectivity - Remote); "security / malware / phishing" → category Security; "database / SQL / Oracle" → category Database or subcategory contains "SQL"/"Oracle"; "VDI / virtual desktop" → subcategory VDI; "how-to / question / guidance" → category "Inquiry / Help".
- Catalog item synonyms (sc_req_item.item / sc_task.item): "software / install / license" → item contains "Software" (Office license → "Office License"); "new PC / laptop / computer / hardware" → "PC Request" or contains "Hardware"; "AD / account / group membership" → "AD Request"; "shared mailbox / calendar" → contains "Mailbox"; "distribution list / DL" → contains "Distribution List"; "share / network drive / folder access" → contains "Network Share"; "VDI" → contains "VDI"; "server start/stop/snooze" → contains "Virtual Server" or "Snooze"; "termination / offboarding / leaver" → contains "Termination"; "SharePoint" → contains "SharePoint"; "phone / mobile / iPad / tablet" → contains "Mobile Phone" / "iPad"; "firewall rule / port opening" → "Firewall Request"; "admin rights / local admin / elevated" → contains "Power User" or "Elevated"; "non-standard / NSSR / custom / one-off" → "Non-standard Service Request"; "SAP role / SAP access" → contains "SAP"; "reclaim / return equipment" → "Reclaim Asset"; "DNS / IP" → contains "DNS".

C7. Logic words
- "and", "that are also", "with", "which are" → additional filters (AND).
- "or", "either", "any of" on the SAME field → one filter with multiple values. On different fields → not expressible in one Cube query; pick the dominant one and note it in assumptions.
- "not", "except", "excluding", "other than", "besides", "isn't", "aren't", "without" → notEquals / notContains / notSet.
- "at least N", "N or more" → gte; "more than" → gt; "under / less than / fewer than" → lt; "at most / up to" → lte (values are text digits — only meaningful for single-digit counts like reassignment_count and reopen_count).
- "only", "just" → restrictive filter, nothing else. "all", "every", "everything" → drop status filters.
- "same as before but …", "now by …", "what about …" → there is no memory; build the full query from the current message and ask in message if critical context is missing.
- Typos, shorthand, and slang are expected: "incdent", "tkts", "chg's", "wrk in prog", "closd", "assgn grp", "prio", "sev", "cat", "sub cat", "CI", "env", "prod", "svr", "pw reset", "acct". Resolve them to the obvious member or value.
- Plural/singular, capitalization, and punctuation never matter in the user's text. They DO matter in your output values for equals.

C8. Defaults and when to ask
- Make reasonable assumptions and list each one in assumptions (e.g. "Treated 'open' as each ticket type's open states", "'tickets' = incidents, changes, requests and tasks", "Requests were left out because they have no team column"). The user can correct you on the next turn.
- Use intent "clarify" ONLY when: the entity is genuinely unknowable and the defaults would produce something misleading; a person's real name is given; or a location/group word matches several very different things and no sensible default exists. Ask one short, concrete question in message.
- Use intent "unsupported" for averages, durations, percentages-as-numbers, joins across tables, and anything not in the member list. Explain in one or two plain sentences and offer the nearest supported question.
- Never emit a query with no measures and no dimensions. Never invent member names. Never put SQL anywhere.

Questions about periods outside the data:
- Each table only holds the dates in its "Date coverage" (section A). Before querying, compare the period the user asks about with the coverage of every ticket type involved.
- If the period is entirely outside the coverage (e.g. "tickets before June 2026", "anything from last year", "next month's incidents"), do not query. Use intent "unsupported" and, in message, say plainly that the data has nothing for that period and give the exact dates it does cover for the ticket types asked about (e.g. "Incidents in this export run from 5 July 2026 to 1 September 2026, so there are none before June. Changes, requests and tasks start on 1 June 2026."). Offer the nearest period that has data.
- If the period only partly overlaps, query the overlapping part and add an assumption saying which part has no data (e.g. "Incidents only start on 2026-07-05, so June has none").
- When a query you run comes back empty, the server works out why and explains it to the user; you do not need to predict empty results.

Follow-up questions (the conversation so far is included above the newest question):
- Earlier user turns and your earlier JSON answers are the same user's conversation in this session. A turn may start with a "[Result of your previous answer: ...]" note telling you what that query returned (row counts) or that it failed.
- Resolve references against that history: "those", "that team", "same but for changes", "now by month", "only the P1s", "what about last week", "break that down", "show me the details of the first one". Start from the most recent relevant query and change only what the new question changes; keep its other filters, date range and entity unless the user says otherwise.
- If you asked a clarifying question, the next turn is most likely the answer to it; combine it with the original question.
- If an earlier query failed or returned nothing, do not repeat it unchanged; adjust it (looser match, different value) and say what you changed in assumptions.
- A clearly unrelated question starts fresh; do not carry old filters into it.
- Mention carried-over context in assumptions (e.g. "Kept the August 2026 date range from the previous question").

=====================================================================
D. OUTPUT FORMAT
=====================================================================
Return exactly one JSON object matching the provided schema:
{
  "intent": "query" | "clarify" | "unsupported",
  "queries": [
    { "entity": "<cube name>",
      "query": { "measures": [...], "dimensions": [...], "filters": [{"member","operator","values"}], "order": [{"member","direction"}], "limit": <int, 0 = none> } }
  ],
  "message": "<for query: one plain-English sentence restating what you will fetch; for clarify/unsupported: the question or explanation>",
  "assumptions": ["<each interpretation you made>"]
}
Rules: one entry per ticket type involved, each entity at most once. For a single ticket type, "queries" has exactly one entry. For intent clarify/unsupported, "queries" is []. For "set"/"notSet" operators pass values []. Values are always strings. Order may only reference members that appear in measures or dimensions.

=====================================================================
E. WORKED EXAMPLES (TODAY = 2026-09-02 in these examples)
=====================================================================
User: "how many open P1s do we have"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":[],"filters":[{"member":"incident.state","operator":"equals","values":["New","In Progress","On Hold"]},{"member":"incident.priority","operator":"equals","values":["P1 - Critical"]}],"order":[],"limit":0}}],"message":"Count of incidents that are still open and rated P1 - Critical.","assumptions":["Priority only exists on incidents, so only incidents are counted","'open' = state New, In Progress or On Hold"]}

User: "how many tickets came in last week"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":[],"filters":[{"member":"incident.created","operator":"gte","values":["2026-08-24"]},{"member":"incident.created","operator":"lt","values":["2026-08-31"]}],"order":[],"limit":0}},{"entity":"change_request","query":{"measures":["change_request.count"],"dimensions":[],"filters":[{"member":"change_request.created","operator":"gte","values":["2026-08-24"]},{"member":"change_request.created","operator":"lt","values":["2026-08-31"]}],"order":[],"limit":0}},{"entity":"sc_req_item","query":{"measures":["sc_req_item.count"],"dimensions":[],"filters":[{"member":"sc_req_item.opened","operator":"gte","values":["2026-08-24"]},{"member":"sc_req_item.opened","operator":"lt","values":["2026-08-31"]}],"order":[],"limit":0}},{"entity":"sc_task","query":{"measures":["sc_task.count"],"dimensions":[],"filters":[{"member":"sc_task.created","operator":"gte","values":["2026-08-24"]},{"member":"sc_task.created","operator":"lt","values":["2026-08-31"]}],"order":[],"limit":0}}],"message":"Number of tickets of every type logged last week, broken out by type with a total.","assumptions":["'tickets' = incidents, changes, requested items and catalog tasks","'last week' = Monday 2026-08-24 through Sunday 2026-08-30","A request and the tasks created to fulfil it count as separate tickets"]}

User: "monthly ticket volume"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":["incident.created_month"],"filters":[],"order":[{"member":"incident.created_month","direction":"asc"}],"limit":0}},{"entity":"change_request","query":{"measures":["change_request.count"],"dimensions":["change_request.created_month"],"filters":[],"order":[{"member":"change_request.created_month","direction":"asc"}],"limit":0}},{"entity":"sc_req_item","query":{"measures":["sc_req_item.count"],"dimensions":["sc_req_item.opened_month"],"filters":[],"order":[{"member":"sc_req_item.opened_month","direction":"asc"}],"limit":0}},{"entity":"sc_task","query":{"measures":["sc_task.count"],"dimensions":["sc_task.created_month"],"filters":[],"order":[{"member":"sc_task.created_month","direction":"asc"}],"limit":0}}],"message":"Tickets logged per month, split by ticket type with a monthly total.","assumptions":["'tickets' = incidents, changes, requested items and catalog tasks","Requests are grouped by the month they were opened; the others by the month they were created","Incidents only start on 2026-07-05 in this export, so June has no incidents"]}

User: "whos getting slammed with tickets last month"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":["incident.assignment_group"],"filters":[{"member":"incident.created","operator":"startsWith","values":["2026-08"]}],"order":[{"member":"incident.count","direction":"desc"}],"limit":10}},{"entity":"change_request","query":{"measures":["change_request.count"],"dimensions":["change_request.owner_group"],"filters":[{"member":"change_request.created","operator":"startsWith","values":["2026-08"]}],"order":[{"member":"change_request.count","direction":"desc"}],"limit":10}},{"entity":"sc_task","query":{"measures":["sc_task.count"],"dimensions":["sc_task.assignment_group"],"filters":[{"member":"sc_task.created","operator":"startsWith","values":["2026-08"]}],"order":[{"member":"sc_task.count","direction":"desc"}],"limit":10}}],"message":"Top 10 teams by total tickets logged in August 2026, across incidents, changes and catalog tasks.","assumptions":["'tickets' = every ticket type that has a team: incidents, changes (owning team) and catalog tasks","Requested items were left out because they have no team column","'slammed' = highest combined volume, top 10","'last month' = August 2026"]}

User: "show me the wintel teams stuff thats still sitting there"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":[],"dimensions":["incident.number","incident.created","incident.priority","incident.state","incident.short_description","incident.assignment_group","incident.category","incident.subcategory","incident.location"],"filters":[{"member":"incident.assignment_group","operator":"contains","values":["WINTEL"]},{"member":"incident.state","operator":"equals","values":["New","In Progress","On Hold"]}],"order":[{"member":"incident.created","direction":"asc"}],"limit":25}},{"entity":"change_request","query":{"measures":[],"dimensions":["change_request.number","change_request.created","change_request.type","change_request.sub_type","change_request.state","change_request.approval","change_request.risk","change_request.short_description","change_request.owner_group","change_request.planned_start_date","change_request.environment"],"filters":[{"member":"change_request.owner_group","operator":"contains","values":["WINTEL"]},{"member":"change_request.state","operator":"equals","values":["Pending","Pre-approve","Review","Build and Test","Work in Progress"]}],"order":[{"member":"change_request.created","direction":"asc"}],"limit":25}},{"entity":"sc_task","query":{"measures":[],"dimensions":["sc_task.number","sc_task.created","sc_task.item","sc_task.state","sc_task.assignment_group","sc_task.assigned_to","sc_task.sla_flag","sc_task.short_description","sc_task.request_item"],"filters":[{"member":"sc_task.assignment_group","operator":"contains","values":["WINTEL"]},{"member":"sc_task.state","operator":"equals","values":["Open","Pending","Work in Progress"]}],"order":[{"member":"sc_task.created","direction":"asc"}],"limit":25}}],"message":"Open tickets of every type owned by the Wintel team, oldest first, one table per ticket type.","assumptions":["'stuff' = any ticket type with a team: incidents, changes and catalog tasks","'still sitting there' = each type's open states, sorted oldest first","'wintel team' = team name containing WINTEL","Requested items were left out because they have no team column"]}

User: "whos getting slammed with incidents last month"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":["incident.assignment_group"],"filters":[{"member":"incident.created","operator":"startsWith","values":["2026-08"]}],"order":[{"member":"incident.count","direction":"desc"}],"limit":10}}],"message":"Top 10 assignment groups by number of incidents created in August 2026.","assumptions":["'incidents' was named explicitly, so only incidents are counted","'slammed' = highest volume, showing top 10","'last month' = August 2026"]}

User: "which changes failed in the last 30 days and did any cause incidents"
→ {"intent":"query","queries":[{"entity":"change_request","query":{"measures":[],"dimensions":["change_request.number","change_request.created","change_request.type","change_request.sub_type","change_request.state","change_request.close_code","change_request.failure_code","change_request.short_description","change_request.owner_group","change_request.planned_start_date"],"filters":[{"member":"change_request.close_code","operator":"equals","values":["Unsuccessful"]},{"member":"change_request.created","operator":"gte","values":["2026-08-03"]},{"member":"change_request.created","operator":"lt","values":["2026-09-03"]}],"order":[{"member":"change_request.created","direction":"desc"}],"limit":50}}],"message":"Unsuccessful changes created in the last 30 days, with their failure code (look for 'Caused Incident').","assumptions":["'failed' = close_code Unsuccessful","Last 30 days measured on created date: 2026-08-03 to 2026-09-02"]}

User: "monthly trend of password resets"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":["incident.count"],"dimensions":["incident.created_month"],"filters":[{"member":"incident.subcategory","operator":"equals","values":["Password Reset","Account Locked","Password Expired"]}],"order":[{"member":"incident.created_month","direction":"asc"}],"limit":0}}],"message":"Incidents per month for password reset, account locked and password expired subcategories.","assumptions":["'password resets' includes Account Locked and Password Expired subcategories"]}

User: "whats the avg time to resolve a P2"
→ {"intent":"unsupported","queries":[],"message":"The data model only supports counts — there is no duration or average measure, so I can't compute resolution time. I can show you how many P2 incidents were resolved per month, or list resolved P2s with their created and resolved timestamps if you want to compute it yourself.","assumptions":[]}

User: "what did John Smith open last week"
→ {"intent":"clarify","queries":[],"message":"People in this export are anonymized as 'Individual NNNN', so a real name won't match. Do you have the Individual ID, or a ticket number I can start from?","assumptions":[]}

User: "software requests waiting on approval from the security guys"
→ {"intent":"query","queries":[{"entity":"ritm_approvals","query":{"measures":[],"dimensions":["ritm_approvals.parent","ritm_approvals.assignment_group","ritm_approvals.approval","ritm_approvals.state","ritm_approvals.created","ritm_approvals.short_description"],"filters":[{"member":"ritm_approvals.short_description","operator":"contains","values":["Software"]},{"member":"ritm_approvals.assignment_group","operator":"contains","values":["Security"]},{"member":"ritm_approvals.state","operator":"equals","values":["Open"]}],"order":[{"member":"ritm_approvals.created","direction":"asc"}],"limit":50}}],"message":"Open RITM approval records for software requests sitting with a Security approval group, oldest first.","assumptions":["Used the approval-records table because the question is about a specific approver group","'software' matched on the approval short description"]}

User: "INC1814467"
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":[],"dimensions":["incident.number","incident.created","incident.updated","incident.resolved","incident.closed","incident.priority","incident.impact","incident.urgency","incident.state","incident.on_hold_reason","incident.short_description","incident.description","incident.category","incident.subcategory","incident.assignment_group","incident.assigned_to","incident.affected_user","incident.location","incident.configuration_item","incident.contact_type","incident.close_code","incident.close_notes","incident.cause_code","incident.reassignment_count","incident.reopen_count","incident.caused_by_change","incident.was_p1"],"filters":[{"member":"incident.number","operator":"equals","values":["INC1814467"]}],"order":[],"limit":1}}],"message":"Full details for incident INC1814467.","assumptions":[]}

User: "anything prod scheduled for next week with downtime?"
→ {"intent":"query","queries":[{"entity":"change_request","query":{"measures":[],"dimensions":["change_request.number","change_request.created","change_request.type","change_request.sub_type","change_request.state","change_request.approval","change_request.risk","change_request.short_description","change_request.owner_group","change_request.planned_start_date","change_request.environment"],"filters":[{"member":"change_request.environment","operator":"equals","values":["Production"]},{"member":"change_request.outage","operator":"equals","values":["Yes"]},{"member":"change_request.planned_start_date","operator":"gte","values":["2026-09-07"]},{"member":"change_request.planned_start_date","operator":"lt","values":["2026-09-14"]}],"order":[{"member":"change_request.planned_start_date","direction":"asc"}],"limit":50}}],"message":"Production changes with a planned outage whose planned start falls in the week of 2026-09-07.","assumptions":["'next week' = Monday 2026-09-07 through Sunday 2026-09-13","'downtime' = outage Yes"]}
`;
}

// The volatile part (today's date) goes in the user turn so the system
// prompt stays byte-identical and cacheable.
export function buildUserMessage(userPrompt, today = new Date()) {
  const iso = today.toISOString().slice(0, 10);
  const weekday = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return `TODAY is ${iso} (${weekday}). Translate this question into the JSON query object:\n\n"""${userPrompt}"""`;
}

// ---------------------------------------------------------------------
// 4. VALIDATOR / NORMALIZER — runs on Claude's output before Cube sees it
// ---------------------------------------------------------------------
const MEMBER_INDEX = (() => {
  const idx = new Map();
  for (const [cube, e] of Object.entries(ENTITY_CATALOG)) {
    idx.set(`${cube}.count`, { cube, kind: 'measure' });
    for (const d of e.dimensions) idx.set(`${cube}.${d}`, { cube, kind: 'dimension', column: d });
  }
  return idx;
})();

// Loose synonyms the validator can repair when Claude emits a near-miss
// value with "equals". Keys are lowercase; values are canonical strings.
const VALUE_SYNONYMS = {
  'incident.priority': { p1: 'P1 - Critical', critical: 'P1 - Critical', p2: 'P2 - High', high: 'P2 - High', p3: 'P3 - Average', average: 'P3 - Average', medium: 'P3 - Average', normal: 'P3 - Average', p4: 'P4 - Low', low: 'P4 - Low' },
  'incident.impact': { enterprise: '1 - Enterprise', 'site/dept': '2 - Site/Dept', site: '2 - Site/Dept', 'multiple users': '3 - Multiple Users', user: '4 - User', 'single user': '4 - User' },
  'change_request.state': { cancelled: 'Canceled', wip: 'Work in Progress', 'in progress': 'Work in Progress' },
  'sc_req_item.state': { canceled: 'Closed Cancelled', cancelled: 'Closed Cancelled', complete: 'Closed Complete', completed: 'Closed Complete' },
  'sc_task.state': { canceled: 'Closed Cancelled', cancelled: 'Closed Cancelled', complete: 'Closed Complete', completed: 'Closed Complete', wip: 'Work in Progress', 'in progress': 'Work in Progress' },
  'change_approvals.approval': { canceled: 'Cancelled', rejected: 'Cancelled', pending: 'Requested' },
};

function canonicalValue(member, raw) {
  const info = MEMBER_INDEX.get(member);
  if (!info || info.kind !== 'dimension') return raw;
  const enumVals = ENTITY_CATALOG[info.cube].enums[info.column];
  if (!enumVals) return raw;
  const lower = String(raw).trim().toLowerCase();
  const exact = enumVals.find(v => v.toLowerCase() === lower);
  if (exact) return exact;
  const syn = VALUE_SYNONYMS[member]?.[lower];
  if (syn) return syn;
  // unique partial match ("critical" -> "P1 - Critical")
  const partial = enumVals.filter(v => v.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  return raw; // leave it; Cube will simply return no rows
}


// Validates one sub-query against its declared cube. Pushes human-readable
// problems/warnings into the arrays passed in; returns the Cube-ready query.
function validateOne(entity, q, problems, warnings) {
  const tag = ENTITY_CATALOG[entity]?.label || entity;
  const measures = (q.measures || []).filter(m => typeof m === 'string');
  const dimensions = (q.dimensions || []).filter(d => typeof d === 'string');
  const filters = Array.isArray(q.filters) ? q.filters : [];
  const order = Array.isArray(q.order) ? q.order : [];

  if (measures.length === 0 && dimensions.length === 0) {
    problems.push(`${tag}: query has neither measures nor dimensions.`);
    return null;
  }

  // every member must exist and belong to this entry's cube
  const checkMember = (m, where) => {
    const info = MEMBER_INDEX.get(m);
    if (!info) { problems.push(`${tag}: unknown member "${m}" in ${where}.`); return null; }
    if (info.cube !== entity) { problems.push(`${tag}: "${m}" belongs to ${info.cube}; each query must stay inside one table.`); return null; }
    return info;
  };
  for (const m of measures) { const i = checkMember(m, 'measures'); if (i && i.kind !== 'measure') problems.push(`${tag}: "${m}" is not a measure.`); }
  for (const d of dimensions) { const i = checkMember(d, 'dimensions'); if (i && i.kind !== 'dimension') problems.push(`${tag}: "${d}" is not a dimension.`); }

  // filters: operator whitelist, value normalization, set/notSet shape
  const cleanFilters = [];
  for (const f of filters) {
    if (!f || typeof f.member !== 'string') { problems.push(`${tag}: filter missing member.`); continue; }
    if (!checkMember(f.member, 'filters')) continue;
    if (!ALLOWED_OPERATORS.includes(f.operator)) { problems.push(`${tag}: operator "${f.operator}" not allowed.`); continue; }
    if (f.operator === 'set' || f.operator === 'notSet') {
      cleanFilters.push({ member: f.member, operator: f.operator });
      continue;
    }
    let values = Array.isArray(f.values) ? f.values.map(v => String(v)) : [];
    if (values.length === 0) { problems.push(`${tag}: filter on ${f.member} (${f.operator}) has no values.`); continue; }
    if (f.operator === 'equals' || f.operator === 'notEquals') {
      values = values.map(v => {
        const c = canonicalValue(f.member, v);
        if (c !== v) warnings.push(`Normalized "${v}" to "${c}" for ${f.member}.`);
        return c;
      });
    }
    cleanFilters.push({ member: f.member, operator: f.operator, values });
  }

  // order may only reference selected members; convert to Cube's object form
  const selected = new Set([...measures, ...dimensions]);
  const cubeOrder = {};
  for (const o of order) {
    if (!o || typeof o.member !== 'string') continue;
    if (!selected.has(o.member)) { warnings.push(`Dropped order on ${o.member}: not in the selected members.`); continue; }
    cubeOrder[o.member] = o.direction === 'asc' ? 'asc' : 'desc';
  }

  // limit: list queries get a default; everything is capped
  let limit = Number.isInteger(q.limit) && q.limit > 0 ? q.limit : 0;
  if (measures.length === 0 && limit === 0) limit = LIMITS.defaultList;
  if (limit > LIMITS.max) { warnings.push(`Limit ${limit} capped to ${LIMITS.max}.`); limit = LIMITS.max; }

  const cubeQuery = {};
  if (measures.length) cubeQuery.measures = measures;
  if (dimensions.length) cubeQuery.dimensions = dimensions;
  if (cleanFilters.length) cubeQuery.filters = cleanFilters;
  if (Object.keys(cubeOrder).length) cubeQuery.order = cubeOrder;
  if (limit) cubeQuery.limit = limit;
  return cubeQuery;
}

const isTimeBucket = member => /_(day|week|month)$/.test(member);

// Decides whether several sub-queries can be shown as one combined table.
// They can when every one is "count, grouped by at most one column". In that
// case each sub-query fetches all groups (no order/limit) and the server
// sorts and limits the merged totals, so "top 10 teams" is a true top 10.
function planMerge(entries) {
  if (entries.length < 2) return null;
  const mergeable = entries.every(e =>
    (e.cubeQuery.measures || []).length === 1 &&
    (e.cubeQuery.dimensions || []).length <= 1);
  if (!mergeable) return null;
  const dimCounts = new Set(entries.map(e => (e.cubeQuery.dimensions || []).length));
  if (dimCounts.size !== 1) return null;

  const first = entries[0].cubeQuery;
  const dimension = (first.dimensions || [])[0] || null;
  let sortBy = 'total';
  let direction = 'desc';
  const [orderMember, orderDir] = Object.entries(first.order || {})[0] || [];
  if (orderMember) {
    sortBy = orderMember === dimension ? 'key' : 'total';
    direction = orderDir;
  } else if (dimension && isTimeBucket(dimension)) {
    sortBy = 'key';
    direction = 'asc';
  }
  const limit = Math.max(0, ...entries.map(e => e.cubeQuery.limit || 0));

  for (const e of entries) { delete e.cubeQuery.order; delete e.cubeQuery.limit; }
  return { dimension, sortBy, direction, limit };
}

/**
 * Takes the parsed structured output from Claude and returns one of
 *   { ok: true,  intent: 'query', queries: [{ entity, cubeQuery }], merge, message, assumptions }
 *   { ok: true,  intent: 'clarify' | 'unsupported', queries: [], merge: null, message, assumptions }
 *   { ok: false, error }
 * Each cubeQuery is ready to POST to /cubejs-api/v1/load. `merge` is null, or
 * a plan for combineResults() when the per-type counts should be one table.
 */
export function normalizeAndValidate(ai) {
  const problems = [];
  const warnings = [];
  if (!ai || typeof ai !== 'object') return { ok: false, error: 'Model returned no JSON object.' };

  const intent = ai.intent;
  const message = typeof ai.message === 'string' ? ai.message : '';
  const assumptions = Array.isArray(ai.assumptions) ? ai.assumptions.filter(a => typeof a === 'string') : [];

  if (intent === 'clarify' || intent === 'unsupported') {
    return { ok: true, intent, queries: [], merge: null, message, assumptions };
  }
  if (intent !== 'query') return { ok: false, error: `Unknown intent "${intent}".` };

  const raw = Array.isArray(ai.queries) ? ai.queries : [];
  if (raw.length === 0) return { ok: false, error: 'No queries were produced.' };

  const seen = new Set();
  const entries = [];
  for (const item of raw) {
    const entity = item?.entity;
    if (!ENTITY_CATALOG[entity]) { problems.push(`Unknown ticket type "${entity}".`); continue; }
    if (seen.has(entity)) { warnings.push(`Ignored a second query for ${entity}.`); continue; }
    seen.add(entity);
    const cubeQuery = validateOne(entity, item.query || {}, problems, warnings);
    if (cubeQuery) entries.push({ entity, cubeQuery });
  }
  if (problems.length) return { ok: false, error: problems.join(' ') };

  const merge = planMerge(entries);
  return { ok: true, intent: 'query', queries: entries, merge, message, assumptions: [...assumptions, ...warnings] };
}

/**
 * Merges per-type count results into one table.
 *   sections: [{ entity, rows }]  (rows straight from Cube)
 * Returns { dimension, entities, rows: [{ key, counts: { entity: n }, total }], totals }
 * `dimension` is the first query's grouping member, used for labels and formatting.
 */
export function combineResults(plan, queries, sections) {
  const entities = sections.map(s => s.entity);
  const dimFor = Object.fromEntries(queries.map(q => [q.entity, (q.cubeQuery.dimensions || [])[0] || null]));
  const byKey = new Map();

  for (const { entity, rows } of sections) {
    for (const r of rows) {
      const key = plan.dimension ? (r[dimFor[entity]] ?? '') : '';
      const n = Number(r[`${entity}.count`]) || 0;
      if (!byKey.has(key)) byKey.set(key, { key, counts: {}, total: 0 });
      const slot = byKey.get(key);
      slot.counts[entity] = (slot.counts[entity] || 0) + n;
      slot.total += n;
    }
  }

  let rows = [...byKey.values()];
  const sign = plan.direction === 'asc' ? 1 : -1;
  rows.sort((a, b) => plan.sortBy === 'key'
    ? sign * String(a.key).localeCompare(String(b.key))
    : (sign * (a.total - b.total)) || String(a.key).localeCompare(String(b.key)));
  if (plan.limit) rows = rows.slice(0, plan.limit);

  const totals = { counts: {}, total: 0 };
  for (const r of rows) {
    for (const e of entities) totals.counts[e] = (totals.counts[e] || 0) + (r.counts[e] || 0);
    totals.total += r.total;
  }
  return { dimension: plan.dimension, entities, rows, totals };
}
```

<a id="b19"></a>
### B.19 `BUSINESS_LOGIC.md`

````markdown
# Business logic: plain English → structured query

This document explains how the tool turns an IT person's question into a Cube.dev JSON query. The executable version of this logic lives in [business_logic.mjs](business_logic.mjs); the server in [server.mjs](server.mjs) only wires it to the Claude API and to Cube.

## 1. The pipeline

```
user text ──► Claude (system prompt = this business logic, JSON schema enforced)
          ──► { intent, queries: [{ entity, query }, ...], message, assumptions }
          ──► normalizeAndValidate()  (member whitelist, one-cube-per-query rule, value spelling, limits, merge plan)
          ──► POST /cubejs-api/v1/load once per ticket type, in parallel
          ──► combineResults() when the per-type counts should be one table
          ──► tables + the restated question + the assumptions, back to the chat UI
```

Three intents can come back:

| intent | meaning | what the server does |
|---|---|---|
| `query` | the question maps onto the data | validates, runs it, returns rows |
| `clarify` | one short question back to the user (for example a person's real name, which is anonymized in the export) | returns the question, runs nothing |
| `unsupported` | the data model cannot answer it (averages, durations, cross-table joins) | returns the explanation and the nearest supported question |

The `assumptions` list is always shown to the user. It is how the tool stays honest about every interpretation it made ("treated 'open' as New / In Progress / On Hold").

## 2. The data, in ITIL terms

| cube | ServiceNow table | what it is | rows | date column |
|---|---|---|---|---|
| `incident` | INC | something broke or a monitor alerted | 23,334 | `created` |
| `change_request` | CHG | planned work: patching, deployments, network changes | 1,969 | `created`, `planned_start_date` |
| `change_approvals` | approval records for CHGs | one row per approval group per change | 9,942 | `created` |
| `sc_req_item` | RITM | things ordered from the catalog: software, laptops, AD, VDI | 17,501 | `opened` |
| `ritm_approvals` | approval records for RITMs | manager / software / security sign-off | 5,379 | `created` |
| `sc_task` | SCTASK | the fulfillment work items behind a RITM | 16,321 | `created` |

Relationships are by ticket number only (RITM → REQ, SCTASK → RITM, approvals → parent). The cubes are **not joined**, so each sub-query stays inside one table and the validator rejects any sub-query that mixes tables. Questions about several ticket types become several sub-queries whose results are shown side by side.

Export coverage is roughly 2026-06-01 to 2026-09-01 (incidents from 2026-07-05).

## 3. Entity resolution (which table?)

### "Ticket" means any ticket type

A ticket is any single event logged in ServiceNow. The four ticket types are incidents, changes, requested items, and catalog tasks. Approval records are sign-offs attached to a change or request, so they only count when the user asks about approvals.

Generic words fan out to every ticket type: ticket, tix, case, record, event, everything, anything, workload, volume, "what came in". A question with no type word at all is treated the same way.

The set is then narrowed to the types where every requested filter or grouping exists. The assumptions say which types were dropped and why.

| the question involves | ticket types that have it |
|---|---|
| priority, impact, urgency, category, P1–P4, how it was reported | incidents only |
| change type, risk, environment, outage, planned dates | changes only |
| catalog item | requests, tasks |
| team / group / queue | incidents and tasks (assigned team), changes (owning team). Requests have no team column. |
| location | incidents, requests |
| a person it is assigned to | incidents, tasks |
| status, date, summary, ticket number | all four, each in its own terms |

Each type gets the same filter in its own vocabulary. For example, "open" uses each type's own open states. "Last month" uses the opened date for requests and the created date for the others.

How the results are shown:

- **Counts** ("how many tickets", "tickets per month", "top teams by tickets") merge into one table with a column per ticket type and a total. For "top N", the server ranks on the merged totals, so the top 10 is a true combined top 10.
- **Lists** ("show me the Wintel team's open stuff") show one table per ticket type, 25 rows each by default.
- A request and the tasks created to fulfil it count as separate tickets, and the assumptions say so.

### When one type is named

| user says | cube |
|---|---|
| incident, INC, issue, outage, alert, P1/P2, sev1, "went down" | `incident` |
| change, CHG, CR, RFC, CAB, deploy, release, patch, reboot, maintenance window | `change_request` |
| request, RITM, REQ, catalog, ordered, onboarding, termination, software request, new laptop | `sc_req_item` |
| task, SCTASK, fulfillment task, work item | `sc_task` |
| "who approved", "which approval group", "sitting with the security approvers" | `change_approvals` / `ritm_approvals` |
| a bare ticket number | by prefix: INC, CHG, RITM, REQ, SCTASK |
| nothing recognizable | all four ticket types, as above |

"Changes pending approval" uses `change_request.approval`, not the approvals table. The approvals tables are only for questions about approvers.

## 4. Answer shape (what kind of query?)

| user says | shape |
|---|---|
| how many, count, volume, total | `count` only |
| by X, per X, breakdown, split, across teams | `count` grouped by X, ordered desc |
| top N, most, busiest, worst, noisiest | grouped, ordered desc, limit N (default 10) |
| trend, over time, per day / week / month | grouped by `*_day` / `*_week` / `*_month`, ordered asc |
| show, list, give me, pull, which tickets | the entity's standard list columns, newest first, limit 50 |
| details, status of, or a bare ticket number | the entity's detail columns, limit 1 |
| percent, share, rate | counts by dimension; the UI note says to derive the percentage |
| average, MTTR, time to resolve, aging in days | `unsupported` with an alternative |

The `*_day`, `*_week`, `*_month` dimensions are derived text buckets added to the Cube models ([model/cubes/](model/cubes/)) so trend questions can group, since every column in the export is text.

## 5. Status vocabulary (the biggest nuance)

| user says | incident | change_request | sc_req_item | sc_task |
|---|---|---|---|---|
| open, active, outstanding, backlog, still, currently, WIP | New, In Progress, On Hold | Pending, Pre-approve, Review, Build and Test, Work in Progress | Open, Pending | Open, Pending, Work in Progress |
| closed, done, finished | Resolved, Closed | Closed | Fulfilled, Closed Complete | Closed Complete |
| resolved | Resolved only | | | |
| cancelled, withdrawn | | **Canceled** (one L) | Closed Cancelled | Closed Cancelled |
| on hold, waiting on user / vendor | On Hold + `on_hold_reason` | | | |
| stuck, stale, aging | open + created before a cutoff (7 days default) | same | same | same |
| reopened, came back | `reopen_count` ≠ 0 | | | |
| bounced around, ping-ponged | `reassignment_count` ≥ 2 | | | |
| failed, blew up, rolled back | | `close_code` Unsuccessful (+ `failure_code`) | `stage` contains "fail" | |
| pending approval, awaiting CAB | | `approval` Requested | `approval` Requested | |
| SLA breached, late | `breach_reason` set | | | `sla_flag` true |

Spelling traps the validator repairs automatically: "Cancelled" → "Canceled" on changes, "p1" → "P1 - Critical", "closed" → "Closed", and any case-insensitive match against the known value lists.

## 6. Priority, teams, places, categories

- **Priority:** P1 / critical / sev1 / "on fire" → `P1 - Critical`; P2 / high / urgent → `P2 - High`; "high priority" alone → P1 and P2 together; P3 / normal → `P3 - Average`; P4 / low / minor → `P4 - Low`. "was a P1" → `was_p1` true.
- **Teams:** group names are codes (ACN = Accenture, TCS = Tata, MCBC/MC = Molson Coors internal). Always `contains` on a distinctive token: wintel → WINTEL, service desk / L1 → ServiceDesk, SAP basis → SAP-BASIS, IAM, EUS, VDI, M365, NOC, SQL, AZURE, AWS. Changes use `owner_group`; everything else uses `assignment_group`.
- **Source of the ticket:** monitoring / auto-generated → `contact_type` Event Management; called in → Phone; portal → Self-service; "real people" → not Event Management.
- **Places:** brewery names with `contains`. "Milwaukee" matches both the corporate office and the brewery and the assumption says so. HQ / corporate → `startsWith` "Corporate".
- **Categories:** password / locked out → subcategory Password Reset, Account Locked, Password Expired, Account Disabled; printer → category Printing; server → subcategory Server; slow → Performance; batch / IWS → Job Failure; email / Outlook → Email; phone → Telephony.
- **Catalog items:** software → item contains "Software"; new PC → "PC Request"; AD / account → "AD Request"; VDI; termination / offboarding; SharePoint; firewall; "non-standard" → Non-standard Service Request.
- **Changes:** prod / live → environment Production; downtime → outage Yes; SAP → sap_impact Yes; emergency / standard / normal → type; patching → sub_type contains "Patching"; brewery changes → brewery Yes.

## 7. Time phrases

The user turn tells Claude today's date; the system prompt never contains it, so the prompt stays cacheable.

| user says | filter |
|---|---|
| in August, last month | `startsWith "2026-08"` |
| yesterday, on Aug 14 | `startsWith "2026-08-14"` |
| last 30 days, since July, Q3, this week, YTD | `gte "YYYY-MM-DD"` and `lt "YYYY-MM-DD"` (exclusive upper bound) |
| resolved in, closed in | `resolved` / `closed` instead of `created` |
| scheduled for, upcoming, next week | `change_request.planned_start_date` |
| ever, all time, overall | no date filter |

Because the export is a frozen snapshot, relative phrases drift out of range as real time moves on. Set `ASSUME_TODAY=2026-09-02` in `.env` to pin the reference date for demos; the model also warns in assumptions when a computed window falls outside the export.

## 8. Logic words, typos, slang

- "and" → more filters. "or" on the same field → one filter with several values. "or" across fields → pick the dominant one, note it.
- "not / except / excluding / without" → `notEquals`, `notContains`, `notSet`.
- "at least / more than / under" → `gte` / `gt` / `lt` (only meaningful on small text digits like `reassignment_count`).
- "all / everything" drops status filters. "only / just" is restrictive.
- There is no conversation memory: "same thing but by team" is rebuilt from the current message alone.
- Typos and shorthand are expected and resolved: incdent, tkts, chg's, wrk in prog, assgn grp, prio, sev, cat, sub cat, CI, env, prod, svr, pw reset.

## 9. When it asks vs. assumes

Assume and state it whenever a sensible default exists. Ask (`clarify`) only when the entity is genuinely unknowable, a real person's name is given, or a place/group word matches several unrelated things. Say `unsupported` for averages, durations, joins, and anything not in the member list.

## 10. Server-side guardrails

`normalizeAndValidate()` in [business_logic.mjs](business_logic.mjs) runs on every response before Cube sees it:

- every member must exist in the catalog, and each sub-query's members must belong to its own cube
- each ticket type may appear at most once
- several count sub-queries, each grouped by at most one column, are merged. The server fetches all groups, then sorts and limits the merged totals.
- operators are whitelisted (`equals`, `notEquals`, `contains`, `notContains`, `startsWith`, `endsWith`, `set`, `notSet`, `gt`, `gte`, `lt`, `lte`)
- `equals` / `notEquals` values are snapped to the exact spelling in the data
- `order` may only reference selected members; list queries default to 50 rows; everything is capped at 500
- a query with neither measures nor dimensions is rejected

## 11. Maintaining it

- **New export?** Re-profile the distinct values (state, priority, category, item, etc.) and update `ENTITY_CATALOG` in [business_logic.mjs](business_logic.mjs). The system prompt, the member whitelist, and the value normalizer are all generated from that one object.
- **New column?** Add it to the cube YAML in [model/cubes/](model/cubes/) and to the cube's `dimensions` array in the catalog.
- **New phrase people use?** Add it to the matching section of the prompt in `buildSystemPrompt()`, or add a worked example at the bottom; examples are the strongest lever.
- **Testing:** start the server, then POST `{ "userPrompt": "..." }` to `/api/query` and read `message`, `assumptions`, and `aiInterpretation` before trusting the rows.
````

<a id="b20"></a>
### B.20 `empty_results.mjs`

```js
// =====================================================================
// EMPTY RESULTS: when a query finds nothing, work out why and say so
// =====================================================================
//
// "Show me open P1 incidents" -> 0 rows. Rather than a bare "no records",
// the server re-runs the query with each filter removed in turn (and checks
// the table's date coverage), so it can tell which condition emptied the
// result: "without 'state is open' there are 3 P1 incidents, all Closed".
// Claude then turns those facts into a short, direct answer.

import { ENTITY_CATALOG } from './business_logic.mjs';

// Free-text columns: grouping by them says nothing useful
const LONG_TEXT = new Set(['short_description', 'description', 'close_notes', 'work_notes',
  'comments_and_work_notes', 'additional_comments', 'change_plan', 'backout_plan',
  'verification_plan', 'purpose_of_change', 'approval_history']);

const MAX_FILTERS_CHECKED = 6;
const BREAKDOWN_LIMIT = 8;

// No rows, or only counts that are all zero ("how many open P1s" -> 0)
export function isEmptyResult(rows) {
  if (!rows.length) return true;
  if (rows.length !== 1) return false;
  const entries = Object.entries(rows[0]);
  return entries.length > 0 && entries.every(([k, v]) => k.endsWith('.count') && Number(v) === 0);
}

const describeFilter = f =>
  `${f.member} ${f.operator}${f.values?.length ? ' ' + f.values.map(v => `"${v}"`).join(', ') : ''}`;

// Timestamp columns (and their _day/_week/_month buckets)
const DATE_COLUMNS = new Set(['created', 'opened', 'updated', 'resolved', 'closed', 'fulfilled_time',
  'planned_start_date', 'planned_end_date']);

// What to group by to show what a removed filter was hiding: the column
// itself, or for dates its month (raw timestamps would list every second)
function breakdownMember(entity, member) {
  const column = member.slice(entity.length + 1);
  if (LONG_TEXT.has(column)) return null;
  const base = column.replace(/_(day|week|month)$/, '');
  if (DATE_COLUMNS.has(base)) {
    const month = `${base}_month`;
    return ENTITY_CATALOG[entity]?.dimensions.includes(month) ? `${entity}.${month}` : null;
  }
  return member;
}

const countOf = rows => Number(rows[0]?.[Object.keys(rows[0] || {}).find(k => k.endsWith('.count'))] ?? 0);

// Facts about why one empty query found nothing, as plain lines for Claude
export async function diagnoseEmpty(entity, cubeQuery, runCubeQuery) {
  const catalog = ENTITY_CATALOG[entity];
  const count = `${entity}.count`;
  const dateDim = `${entity}.${catalog?.dateColumn || 'created'}`;
  const filters = cubeQuery.filters || [];
  const facts = [];

  const [totalRows, firstRows, lastRows] = await Promise.all([
    runCubeQuery({ measures: [count] }),
    runCubeQuery({ dimensions: [dateDim], order: { [dateDim]: 'asc' }, limit: 1 }),
    runCubeQuery({ dimensions: [dateDim], order: { [dateDim]: 'desc' }, limit: 1 }),
  ]);
  const total = countOf(totalRows);
  if (!total) {
    facts.push(`${entity}: the table is empty (no data has been loaded for it).`);
    return facts;
  }
  facts.push(`${entity}: ${total.toLocaleString('en-US')} rows in total; ${dateDim} runs from ${firstRows[0]?.[dateDim]} to ${lastRows[0]?.[dateDim]}.`);
  facts.push(`${entity}: the query's filters were: ${filters.length ? filters.map(describeFilter).join('; ') : '(none)'}.`);

  // Remove one filter at a time
  const checks = filters.slice(0, MAX_FILTERS_CHECKED).map(async (f, i) => {
    const others = filters.filter((_, j) => j !== i);
    const base = others.length ? { filters: others } : {};
    const n = countOf(await runCubeQuery({ measures: [count], ...base }));
    let line = `Without the filter [${describeFilter(f)}]: ${n.toLocaleString('en-US')} rows match the other filters.`;
    const group = n > 0 ? breakdownMember(entity, f.member) : null;
    if (group) {
      const rows = await runCubeQuery({ measures: [count], dimensions: [group], ...base, order: { [count]: 'desc' }, limit: BREAKDOWN_LIMIT });
      const parts = rows.map(r => `${r[group] === null || r[group] === '' ? '(blank)' : r[group]} = ${Number(r[count]).toLocaleString('en-US')}`);
      if (parts.length) line += ` Those rows by ${group}: ${parts.join(', ')}${rows.length === BREAKDOWN_LIMIT ? ', ...' : ''}.`;
    }
    return line;
  });
  facts.push(...await Promise.all(checks));
  return facts;
}

const EXPLAIN_SYSTEM = `You explain to an IT person why their question about a ServiceNow ticket export found no results.
You get their question, what was searched for, and facts computed from the data: each ticket type's date coverage, and what each filter was hiding.
Write 1 to 3 short sentences of plain English. No markdown, no bullet points, no internal field names like "incident.state" (say "state").
Start with the direct answer, using the facts' real numbers. Examples of the tone:
- "There are no open P1 incidents right now: all 3 P1 incidents in the data are closed."
- "There are no tickets before June. Incidents in this export run from 5 July 2026 to 1 September 2026; changes and requests start on 1 June 2026."
- "No team name contains 'Wintel Ops'. The closest teams are ACN-INFRA-CLOUD-WINTEL and ..."
If one filter clearly explains the empty result, name it. If the dates asked about are outside the coverage, give the coverage.
If a table is empty because no data is loaded, say the data has not been loaded on this copy of OneTouch.
End with one short suggestion of a nearby question that would return data, when there is one. Use only the facts given; do not guess.`;

// Short explanation for the user; falls back to plain facts if Claude can't answer
export async function explainEmpty({ anthropic, model, question, searchedFor, facts }) {
  const fallback = `No matching records were found. ${facts.filter(f => / runs from | is empty/.test(f)).join(' ')}`.trim();
  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      output_config: { effort: 'low' },
      system: EXPLAIN_SYSTEM,
      messages: [{
        role: 'user',
        content: `Question: """${question}"""\nWhat was searched for: ${searchedFor}\n\nFacts:\n${facts.map(f => `- ${f}`).join('\n')}`,
      }],
    });
    if (message.stop_reason === 'refusal') return fallback;
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return text || fallback;
  } catch (error) {
    console.error('🔎 Could not explain the empty result:', error.message);
    return fallback;
  }
}
```

<a id="b21"></a>
### B.21 `export.mjs`

```js
// =====================================================================
// EXPORT: the tables shown in the chat -> downloadable files
// =====================================================================
//
// The browser sends the tables exactly as the user sees them (English
// column labels, formatted values). Every format is built from that one
// shape:
//
//   { title, question, tables: [{ title, columns: [{ label, num }], rows: [[cell]], footer }] }
//
// Document formats (pdf, docx, xlsx, csv, txt, rtf) are built in memory.
// Archive formats (zip, 7z) bundle all six document formats together.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import PdfPrinter from 'pdfmake';
import sevenZipBin from '7zip-bin';
import {
  AlignmentType, Document, HeadingLevel, Packer, PageOrientation,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';

const run = promisify(execFile);

export const DOCUMENT_FORMATS = ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'rtf'];
export const ARCHIVE_FORMATS = ['zip', '7z'];
export const EXPORT_FORMATS = [...DOCUMENT_FORMATS, ...ARCHIVE_FORMATS];

const MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  rtf: 'application/rtf',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
};

// 7-Zip writes both archive formats
const SEVEN_ZIP = process.env.SEVEN_ZIP_PATH || sevenZipBin.path7za;

// npm does not keep the executable bit on the bundled Linux/macOS binary
if (process.platform !== 'win32' && !process.env.SEVEN_ZIP_PATH) {
  chmod(SEVEN_ZIP, 0o755).catch(() => {});
}

// ---------------------------------------------------------------------
// Input checking
// ---------------------------------------------------------------------

const MAX_CELLS = 2_000_000;

// Returns an error message, or null when the payload is usable
export function validateExport(body) {
  if (!body || typeof body !== 'object') return 'Missing export payload.';
  if (!EXPORT_FORMATS.includes(body.format)) return `Unsupported format "${body.format}".`;
  if (!Array.isArray(body.tables) || body.tables.length === 0) return 'There is no data to export.';

  let cells = 0;
  for (const t of body.tables) {
    if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) return 'Malformed table in export payload.';
    if (t.rows.some(r => !Array.isArray(r) || r.length !== t.columns.length)) return 'Table rows do not match their columns.';
    cells += t.rows.length * t.columns.length;
  }
  if (cells > MAX_CELLS) return 'That result is too large to export.';
  return null;
}

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

// Numbers stay numbers for spreadsheets/CSV; everything else reads them formatted
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return String(value);
}

function generatedLine() {
  return `Generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

// Heading lines that open every document: title, the question, the date
function headerLines(payload) {
  const lines = [payload.title || 'One Touch export'];
  if (payload.question) lines.push(`Question: ${payload.question}`);
  lines.push(generatedLine());
  return lines;
}

function rowCountText(table) {
  const n = table.rows.length;
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'row' : 'rows'}`;
}

export function exportFileName(payload) {
  const slug = String(payload.question || payload.title || 'results')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'results';
  const date = new Date().toISOString().slice(0, 10);
  return `one-touch-${slug}-${date}`;
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------

function csvField(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(payload) {
  const multi = payload.tables.length > 1;
  const blocks = payload.tables.map(t => {
    const lines = [];
    if (multi && t.title) lines.push(csvField(t.title));
    lines.push(t.columns.map(c => csvField(c.label)).join(','));
    for (const r of t.rows) lines.push(r.map(csvField).join(','));
    if (t.footer) lines.push(t.footer.map(csvField).join(','));
    return lines.join('\r\n');
  });
  // The BOM makes Excel open the file as UTF-8 instead of guessing
  return Buffer.from('\uFEFF' + blocks.join('\r\n\r\n') + '\r\n', 'utf8');
}

// ---------------------------------------------------------------------
// Plain text: aligned columns, long values wrapped inside their column
// ---------------------------------------------------------------------

const TXT_MAX_COL = 60;

function wrapText(text, width) {
  const out = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      // Words longer than the column are hard-split
      let w = word;
      while (w.length > width) {
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

function txtTable(table) {
  const all = [table.columns.map(c => c.label), ...table.rows.map(r => r.map(cellText))];
  if (table.footer) all.push(table.footer.map(cellText));

  const widths = table.columns.map((_, i) =>
    Math.min(TXT_MAX_COL, Math.max(...all.map(r => Math.max(...r[i].split(/\r?\n/).map(l => l.length))))));

  const renderRow = row => {
    const cells = row.map((v, i) => wrapText(v, widths[i]));
    const height = Math.max(...cells.map(c => c.length));
    const lines = [];
    for (let li = 0; li < height; li++) {
      lines.push(cells.map((c, i) => {
        const v = c[li] || '';
        return table.columns[i].num ? v.padStart(widths[i]) : v.padEnd(widths[i]);
      }).join(' | ').trimEnd());
    }
    return lines.join('\n');
  };
  const rule = widths.map(w => '-'.repeat(w)).join('-+-');

  const parts = [renderRow(all[0]), rule];
  const bodyEnd = table.footer ? all.length - 1 : all.length;
  for (let i = 1; i < bodyEnd; i++) parts.push(renderRow(all[i]));
  if (table.footer) parts.push(rule, renderRow(all[all.length - 1]));
  return parts.join('\n');
}

function buildTxt(payload) {
  const out = [...headerLines(payload), ''];
  for (const t of payload.tables) {
    if (t.title) out.push(t.title, '='.repeat(t.title.length));
    out.push(rowCountText(t), '', txtTable(t), '');
  }
  return Buffer.from(out.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------
// RTF (opens in Word, WordPad, Pages, LibreOffice)
// ---------------------------------------------------------------------

function rtfEscape(value) {
  let out = '';
  for (const ch of cellText(value)) {
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (ch === '\n') out += '\\line ';
    else if (ch === '\r') continue;
    else if (ch === '\t') out += '\\tab ';
    else if (code < 128) out += ch;
    else {
      // \uN takes a signed 16-bit value; characters beyond the BMP need a surrogate pair
      for (const unit of String.fromCodePoint(code).split('')) {
        const n = unit.charCodeAt(0);
        out += `\\u${n > 32767 ? n - 65536 : n}?`;
      }
    }
  }
  return out;
}

// Landscape letter page with 0.5" margins leaves 14,400 twips for the table
const RTF_TABLE_WIDTH = 14400;

function rtfTable(table) {
  const n = table.columns.length;
  const colWidth = Math.floor(RTF_TABLE_WIDTH / n);
  const border = '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10';

  const row = (cells, { header = false, footer = false } = {}) => {
    const shade = header || footer ? '\\clcbpat2' : '';
    let s = `\\trowd\\trgaph80\\trleft0${header ? '\\trhdr' : ''}`;
    for (let i = 1; i <= n; i++) s += `${border}${shade}\\cellx${colWidth * i}`;
    s += '\n';
    cells.forEach((v, i) => {
      const align = table.columns[i].num ? '\\qr' : '\\ql';
      const text = rtfEscape(v);
      s += `\\pard\\intbl${align} ${header || footer ? `{\\b ${text}}` : text}\\cell\n`;
    });
    return s + '\\row\n';
  };

  let s = row(table.columns.map(c => c.label), { header: true });
  for (const r of table.rows) s += row(r);
  if (table.footer) s += row(table.footer, { footer: true });
  return s + '\\pard\\par\n';
}

function buildRtf(payload) {
  const [title, ...rest] = headerLines(payload);
  const fontSize = payload.tables.some(t => t.columns.length > 8) ? 14 : 18;
  let s = '{\\rtf1\\ansi\\ansicpg1252\\deff0\n' +
    '{\\fonttbl{\\f0\\fswiss Helvetica;}}\n' +
    '{\\colortbl;\\red26\\green32\\blue44;\\red237\\green242\\blue247;\\red113\\green128\\blue150;}\n' +
    '\\paperw15840\\paperh12240\\landscape\\margl720\\margr720\\margt720\\margb720\n' +
    `\\pard{\\b\\fs32\\cf1 ${rtfEscape(title)}}\\par\n`;
  for (const line of rest) s += `\\pard{\\fs18\\cf3 ${rtfEscape(line)}}\\par\n`;
  s += '\\pard\\par\n';

  for (const t of payload.tables) {
    if (t.title) s += `\\pard{\\b\\fs24 ${rtfEscape(t.title)}}\\par\n`;
    s += `\\pard{\\fs16\\cf3 ${rtfEscape(rowCountText(t))}}\\par\n`;
    s += `{\\fs${fontSize}\n${rtfTable(t)}}`;
  }
  return Buffer.from(s + '}', 'utf8');
}

// ---------------------------------------------------------------------
// Excel: one worksheet per table
// ---------------------------------------------------------------------

function sheetName(title, index, used) {
  let base = String(title || `Results ${index + 1}`).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet ${index + 1}`;
  let name = base;
  for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base.slice(0, 28)} ${k}`;
  used.add(name.toLowerCase());
  return name;
}

async function buildXlsx(payload) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'One Touch';
  wb.created = new Date();
  const used = new Set();

  payload.tables.forEach((t, idx) => {
    const ws = wb.addWorksheet(sheetName(t.title, idx, used), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(t.columns.map(c => c.label));
    for (const r of t.rows) ws.addRow(r.map(v => (v === null || v === undefined ? '' : v)));
    if (t.footer) ws.addRow(t.footer).font = { bold: true };

    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF2F7' } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };

    t.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      const longest = Math.max(c.label.length, ...t.rows.map(r => cellText(r[i]).length));
      col.width = Math.min(60, Math.max(10, longest + 2));
      if (c.num) col.numFmt = '#,##0';
      else if (longest > 60) col.alignment = { wrapText: true, vertical: 'top' };
    });
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------

function docxParagraph(text, { bold = false, size, align } = {}) {
  const lines = String(text).split(/\r?\n/);
  return new Paragraph({
    alignment: align,
    children: lines.map((line, i) => new TextRun({ text: line, bold, size, break: i > 0 ? 1 : undefined })),
  });
}

function docxTable(table) {
  const size = table.columns.length > 8 ? 14 : 18; // half-points
  const shade = { type: ShadingType.CLEAR, color: 'auto', fill: 'EDF2F7' };
  const makeRow = (cells, { header = false, footer = false } = {}) => new TableRow({
    tableHeader: header,
    children: cells.map((v, i) => new TableCell({
      shading: header || footer ? shade : undefined,
      children: [docxParagraph(cellText(v), {
        bold: header || footer,
        size,
        align: table.columns[i].num ? AlignmentType.RIGHT : AlignmentType.LEFT,
      })],
    })),
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      makeRow(table.columns.map(c => c.label), { header: true }),
      ...table.rows.map(r => makeRow(r)),
      ...(table.footer ? [makeRow(table.footer, { footer: true })] : []),
    ],
  });
}

async function buildDocx(payload) {
  const [title, ...rest] = headerLines(payload);
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    ...rest.map(l => docxParagraph(l, { size: 18 })),
    new Paragraph(''),
  ];
  for (const t of payload.tables) {
    if (t.title) children.push(new Paragraph({ text: t.title, heading: HeadingLevel.HEADING_2 }));
    children.push(docxParagraph(rowCountText(t), { size: 16 }), docxTable(t), new Paragraph(''));
  }

  const doc = new Document({
    creator: 'One Touch',
    title,
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------

// The built-in PDF fonts need no font files on disk
const pdfPrinter = new PdfPrinter({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

// The built-in fonts only cover Western European characters
function pdfSafe(value) {
  return cellText(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF\u2013\u2014\u2026\u20AC]/g, '?');
}

function pdfTable(table) {
  const n = table.columns.length;
  const fontSize = n > 12 ? 6 : n > 8 ? 7 : 9;
  const cell = (v, i, bold, fill) => ({
    text: pdfSafe(v),
    bold,
    fillColor: fill,
    alignment: table.columns[i].num ? 'right' : 'left',
  });

  const body = [
    table.columns.map((c, i) => cell(c.label, i, true, '#edf2f7')),
    ...table.rows.map(r => r.map((v, i) => cell(v, i, false))),
  ];
  if (table.footer) body.push(table.footer.map((v, i) => cell(v, i, true, '#edf2f7')));

  // A field/value card keeps its label column narrow
  const isDetail = n === 2 && table.columns[0].label === 'Field';
  return {
    fontSize,
    table: { headerRows: 1, dontBreakRows: false, widths: isDetail ? [150, '*'] : Array(n).fill('*'), body },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#cbd5e0',
      vLineColor: () => '#cbd5e0',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 14],
  };
}

function buildPdf(payload) {
  const [title, ...rest] = headerLines(payload);
  const content = [
    { text: pdfSafe(title), fontSize: 16, bold: true, color: '#1a202c', margin: [0, 0, 0, 4] },
    ...rest.map(l => ({ text: pdfSafe(l), fontSize: 9, color: '#718096' })),
    { text: ' ', margin: [0, 0, 0, 6] },
  ];
  for (const t of payload.tables) {
    if (t.title) content.push({ text: pdfSafe(t.title), fontSize: 12, bold: true, margin: [0, 6, 0, 2] });
    content.push({ text: rowCountText(t), fontSize: 8, color: '#718096', margin: [0, 0, 0, 4] }, pdfTable(t));
  }

  const doc = pdfPrinter.createPdfKitDocument({
    info: { title: pdfSafe(title), creator: 'One Touch' },
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [36, 36, 36, 40],
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    footer: (page, pages) => ({ text: `Page ${page} of ${pages}`, alignment: 'center', fontSize: 8, color: '#a0aec0' }),
    content,
  });

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// ---------------------------------------------------------------------
// Archives: every document format bundled into one file
// ---------------------------------------------------------------------

const BUILDERS = { pdf: buildPdf, docx: buildDocx, xlsx: buildXlsx, csv: buildCsv, txt: buildTxt, rtf: buildRtf };

async function buildArchive(payload, format, baseName) {
  const dir = await mkdtemp(path.join(tmpdir(), 'one-touch-export-'));
  try {
    const filesDir = path.join(dir, 'files');
    await mkdir(filesDir);

    const names = [];
    for (const fmt of DOCUMENT_FORMATS) {
      const name = `${baseName}.${fmt}`;
      await writeFile(path.join(filesDir, name), await BUILDERS[fmt](payload));
      names.push(name);
    }

    const out = path.join(dir, `archive.${format}`);
    try {
      await run(SEVEN_ZIP, ['a', `-t${format}`, '-bd', '-y', out, ...names], { cwd: filesDir });
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new ExportUnavailableError('The 7-Zip tool is missing on this server, so archives cannot be created.');
      }
      throw err;
    }
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export class ExportUnavailableError extends Error {}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

export async function buildExport(payload) {
  const format = payload.format;
  const baseName = exportFileName(payload);
  const buffer = ARCHIVE_FORMATS.includes(format)
    ? await buildArchive(payload, format, baseName)
    : await BUILDERS[format](payload);
  return { buffer, fileName: `${baseName}.${format}`, contentType: MIME_TYPES[format] };
}
```

<a id="b22"></a>
### B.22 `auth.mjs`

```js
// =====================================================================
// AUTH: user accounts and sign-in sessions, stored in Postgres
// =====================================================================
//
// Accounts live in their own database (onetouch_auth), reached through
// their own database user (onetouch_app), so nothing on the analytics side
// (Cube, Metabase, Claude's queries against analytics_db) can read them.
//
// Passwords are never stored: only a salted scrypt hash. Session tokens are
// never stored either: only their SHA-256, so a copy of the sessions table
// can't be used to sign in.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const scrypt = promisify(scryptCb);

// Created on first use, so .env has been loaded by then (imports run before dotenv.config())
let poolInstance = null;
export const pool = {
  query: (...args) => getPool().query(...args),
  end: () => (poolInstance ? poolInstance.end() : Promise.resolve()),
};

function getPool() {
  if (!poolInstance) {
    poolInstance = new pg.Pool({
      host: process.env.AUTH_DB_HOST || 'localhost',
      port: Number(process.env.AUTH_DB_PORT || 5432),
      database: process.env.AUTH_DB_NAME || 'onetouch_auth',
      user: process.env.AUTH_DB_USER || 'onetouch_app',
      password: process.env.AUTH_DB_PASSWORD,
      max: 5,
    });
    // An idle connection dropping (e.g. Postgres restarting) must not crash the server
    poolInstance.on('error', err => console.error('🔐 Auth database connection error:', err.message));
  }
  return poolInstance;
}

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Five wrong passwords lock that account for 15 minutes
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------
// Schema (created on first start; safe to run every start)
// ---------------------------------------------------------------------

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              serial PRIMARY KEY,
      username        text UNIQUE NOT NULL CHECK (username = lower(username)),
      password_hash   text NOT NULL,
      display_name    text,
      is_active       boolean NOT NULL DEFAULT true,
      failed_attempts integer NOT NULL DEFAULT 0,
      locked_until    timestamptz,
      created_at      timestamptz NOT NULL DEFAULT now(),
      last_login_at   timestamptz
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  text PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT now(),
      expires_at  timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

    -- When the password, name or active flag last changed (millisecond precision,
    -- so it round-trips exactly through the accounts file; see syncAccounts)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS
      updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now());
  `);
}

// ---------------------------------------------------------------------
// Passwords: "scrypt$N$r$p$salt$hash" (base64), so cost can be raised later
// ---------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, saltB64, hashB64] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

// Checked against when the username doesn't exist, so a wrong username takes
// as long as a wrong password and doesn't reveal which accounts exist
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

// The sign-in form shows "@molsoncoors.com" after the box, so accept it typed out too
export function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase().replace(/@molsoncoors\.com$/, '');
}

export function validatePassword(password) {
  // No minimum length; only an empty password is refused (it would let anyone in with just the username)
  if (typeof password !== 'string' || password.length === 0) return 'The password cannot be empty.';
  if (password.length > 200) return 'Passwords must be at most 200 characters.';
  return null;
}

// ---------------------------------------------------------------------
// Sign in / sessions
// ---------------------------------------------------------------------

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// -> { ok: true, user, token } | { ok: false, reason: 'invalid' | 'locked' }
export async function signIn(username, password) {
  const name = normalizeUsername(username);
  const { rows } = await pool.query(
    'SELECT id, username, display_name, password_hash, is_active, locked_until FROM users WHERE username = $1',
    [name]);
  const user = rows[0];

  const passwordOk = await verifyPassword(password || '', user ? user.password_hash : DUMMY_HASH);
  if (!user || !user.is_active) return { ok: false, reason: 'invalid' };

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return { ok: false, reason: 'locked' };
  }

  if (!passwordOk) {
    // Count the miss; the fifth one in a row locks the account for a while
    await pool.query(
      `UPDATE users
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE WHEN failed_attempts + 1 >= $2
                                  THEN now() + ($3 || ' milliseconds')::interval END
        WHERE id = $1`,
      [user.id, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MS)]);
    return { ok: false, reason: 'invalid' };
  }

  const token = randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)",
    [hashToken(token), user.id, String(SESSION_TTL_MS)]);
  await pool.query(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
    [user.id]);

  return { ok: true, token, user: { id: user.id, username: user.username, displayName: user.display_name } };
}

// The signed-in user for a token, or null if it is unknown, expired, or the account was deactivated
export async function getSessionUser(token) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
    [hashToken(token)]);
  return rows[0] ? { id: rows[0].id, username: rows[0].username, displayName: rows[0].display_name } : null;
}

export async function signOut(token) {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function deleteExpiredSessions() {
  const { rowCount } = await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
  return rowCount;
}

// ---------------------------------------------------------------------
// Account management (used by scripts/users.mjs)
// ---------------------------------------------------------------------

export async function addUser(username, password, displayName = null) {
  const name = normalizeUsername(username);
  if (!/^[a-z0-9._-]{2,64}$/.test(name)) throw new Error('Usernames may only use letters, numbers, dots, dashes and underscores.');
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash, display_name) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING RETURNING id',
    [name, await hashPassword(password), displayName]);
  if (!rows.length) throw new Error(`User "${name}" already exists. Use reset-password to change their password.`);
  return name;
}

export async function resetPassword(username, password) {
  const name = normalizeUsername(username);
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL,
                      updated_at = date_trunc('milliseconds', now())
      WHERE username = $1 RETURNING id`,
    [name, await hashPassword(password)]);
  if (!rows.length) throw new Error(`No user named "${name}".`);
  // Anyone signed in with the old password is signed out
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
  return name;
}

export async function setActive(username, active) {
  const name = normalizeUsername(username);
  const { rows } = await pool.query(
    `UPDATE users SET is_active = $2, failed_attempts = 0, locked_until = NULL,
                      updated_at = date_trunc('milliseconds', now())
      WHERE username = $1 RETURNING id`,
    [name, active]);
  if (!rows.length) throw new Error(`No user named "${name}".`);
  if (!active) await pool.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
  return name;
}

export async function listUsers() {
  const { rows } = await pool.query(
    `SELECT username, display_name, is_active, locked_until > now() AS locked, created_at, last_login_at
       FROM users ORDER BY username`);
  return rows;
}

// ---------------------------------------------------------------------
// Accounts file (db/accounts.json): shares accounts with clones of the repo.
// Holds usernames, display names and password *hashes*, never passwords.
// Written by `users export`; loaded automatically when the server starts.
// ---------------------------------------------------------------------

export const ACCOUNTS_FILE_VERSION = 1;

export async function exportAccounts() {
  const { rows } = await pool.query(
    'SELECT username, display_name, password_hash, is_active, updated_at FROM users ORDER BY username');
  return {
    version: ACCOUNTS_FILE_VERSION,
    note: 'OneTouch sign-in accounts. Password hashes only. Regenerate with: node scripts/users.mjs export',
    accounts: rows.map(r => ({
      username: r.username,
      displayName: r.display_name,
      passwordHash: r.password_hash,
      active: r.is_active,
      updatedAt: r.updated_at.toISOString(),
    })),
  };
}

// Brings the database up to date with an accounts file. Accounts missing
// from the database are added; an existing account is only overwritten when
// the file's copy changed more recently, so an old file can never undo a
// newer password reset or deactivation. Accounts not in the file are left alone.
// -> { added, updated, unchanged, invalid: [messages] }
export async function syncAccounts(file) {
  if (!file || file.version !== ACCOUNTS_FILE_VERSION || !Array.isArray(file.accounts)) {
    throw new Error(`Not a OneTouch accounts file (expected version ${ACCOUNTS_FILE_VERSION} with an "accounts" list).`);
  }
  const result = { added: [], updated: [], unchanged: 0, invalid: [] };

  for (const [i, a] of file.accounts.entries()) {
    const name = normalizeUsername(a?.username);
    const updatedAt = new Date(a?.updatedAt);
    if (!/^[a-z0-9._-]{2,64}$/.test(name) || !String(a?.passwordHash).startsWith('scrypt$')
        || typeof a?.active !== 'boolean' || Number.isNaN(updatedAt.getTime())) {
      result.invalid.push(`entry ${i + 1} (${a?.username ?? 'no username'}) is malformed`);
      continue;
    }

    const inserted = await pool.query(
      `INSERT INTO users (username, password_hash, display_name, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING RETURNING id`,
      [name, a.passwordHash, a.displayName || null, a.active, updatedAt]);
    if (inserted.rows.length) { result.added.push(name); continue; }

    const changed = await pool.query(
      `UPDATE users SET password_hash = $2, display_name = $3, is_active = $4, updated_at = $5,
                        failed_attempts = 0, locked_until = NULL
        WHERE username = $1 AND updated_at < $5 RETURNING id`,
      [name, a.passwordHash, a.displayName || null, a.active, updatedAt]);
    if (changed.rows.length) {
      // New password or deactivated: sessions from before the change end
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [changed.rows[0].id]);
      result.updated.push(name);
    } else {
      result.unchanged += 1;
    }
  }
  return result;
}

// Where the accounts file lives, relative to the project folder
export const DEFAULT_ACCOUNTS_FILE = 'db/accounts.json';
```

<a id="b23"></a>
### B.23 `scripts/users.mjs`

```js
// Manage OneTouch sign-in accounts.
//
// Run inside the app container (it can reach the database):
//   docker exec -it analytics_node_app npm run users -- list
//   docker exec -it analytics_node_app npm run users -- add jsmith "Jane Smith"
//   docker exec -it analytics_node_app npm run users -- reset-password jsmith
//   docker exec -it analytics_node_app npm run users -- deactivate jsmith
//   docker exec -it analytics_node_app npm run users -- activate jsmith
//
// Many at once, from a CSV with a header row: Username, Display Name, Password
// (Display Name is optional). The file is piped in, so it never has to be
// copied into the project folder. From PowerShell:
//   Get-Content $HOME\Downloads\people.csv | docker exec -i analytics_node_app node scripts/users.mjs import -
// Existing usernames are skipped, never overwritten.
//
// Sharing accounts with clones of the repo:
//   docker exec analytics_node_app node scripts/users.mjs export
// writes db/accounts.json (password hashes only); commit it, and every clone's
// server loads it when it starts. `sync` loads it by hand.
//
// Passwords are typed at a hidden prompt. For automation, pipe the password
// in and add --password-stdin (e.g. echo "secret" | ... add jsmith --password-stdin).

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const auth = await import('../auth.mjs');

const USAGE = `Usage: npm run users -- <command> [args]

  list                              Show every account
  add <username> ["Display Name"]   Create an account (asks for a password)
  reset-password <username>         Set a new password (signs them out everywhere)
  deactivate <username>             Block sign-in (signs them out everywhere)
  activate <username>               Allow sign-in again
  import <file.csv | ->             Add everyone in a CSV (columns: Username, Display Name, Password);
                                    "-" reads the CSV from stdin. Existing usernames are skipped.
  export [file]                     Write every account to db/accounts.json (or [file]) for clones;
                                    password hashes only, never passwords
  sync [file]                       Load db/accounts.json (or [file]): adds missing accounts and
                                    applies newer changes (the server also does this when it starts)

Add --password-stdin to read the password from stdin instead of prompting.`;

// Reads a line from the terminal without echoing what is typed
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('No terminal to type a password into. Run with "docker exec -it", or use --password-stdin.'));
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

async function askNewPassword(fromStdin) {
  if (fromStdin) return readStdin();
  const first = await promptHidden('New password: ');
  const second = await promptHidden('Repeat password: ');
  if (first !== second) throw new Error('The two passwords did not match.');
  return first;
}

// Splits CSV text into rows of fields; handles quoted fields with commas,
// doubled quotes and line breaks inside quotes
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

async function importCsv(source) {
  const fs = await import('node:fs/promises');
  const text = (source === '-' ? await readStdin() : await fs.readFile(source, 'utf8')).replace(/^﻿/, '');
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('The CSV is empty.');

  // Columns are found by name, in any order and any capitalization
  const col = name => header.findIndex(h => h.trim().toLowerCase().replace(/[\s_-]+/g, '') === name);
  const iUser = col('username'), iName = col('displayname'), iPass = col('password');
  if (iUser < 0 || iPass < 0) {
    throw new Error(`The header row needs "Username" and "Password" columns (found: ${header.join(', ')}).`);
  }

  const added = [], skipped = [], failed = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const line = index + 2; // +1 for the header, +1 for counting from 1
    const username = (row[iUser] || '').trim();
    const password = row[iPass] ?? '';
    const displayName = iName >= 0 ? (row[iName] || '').trim() || null : null;
    const key = auth.normalizeUsername(username);

    if (!username) { failed.push(`line ${line}: no username`); continue; }
    if (seen.has(key)) { failed.push(`line ${line}: ${key} appears more than once in the file`); continue; }
    seen.add(key);

    try {
      await auth.addUser(username, password, displayName);
      added.push(key);
    } catch (err) {
      if (/already exists/.test(err.message)) skipped.push(key);
      else failed.push(`line ${line} (${key}): ${err.message}`);
    }
  }

  console.log(`Added ${added.length} of ${rows.length} ${rows.length === 1 ? 'person' : 'people'}.`);
  if (added.length) console.log(`  Added: ${added.join(', ')}`);
  if (skipped.length) console.log(`  Skipped (already have an account, password left unchanged): ${skipped.join(', ')}`);
  if (failed.length) {
    console.log('  Not added:');
    for (const f of failed) console.log(`    ${f}`);
    process.exitCode = 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fromStdin = args.includes('--password-stdin');
  const [command, username, displayName] = args.filter(a => a !== '--password-stdin');

  await auth.ensureSchema();

  switch (command) {
    case 'list': {
      const users = await auth.listUsers();
      if (!users.length) return console.log('No accounts yet. Add one with: npm run users -- add <username>');
      console.table(users.map(u => ({
        username: u.username,
        name: u.display_name || '',
        status: !u.is_active ? 'deactivated' : u.locked ? 'locked (too many tries)' : 'active',
        created: u.created_at.toISOString().slice(0, 10),
        'last sign-in': u.last_login_at ? u.last_login_at.toISOString().replace('T', ' ').slice(0, 16) : 'never',
      })));
      return;
    }
    case 'add': {
      if (!username) throw new Error('Give a username: add <username> ["Display Name"]');
      const name = await auth.addUser(username, await askNewPassword(fromStdin), displayName || null);
      return console.log(`Added ${name}. They sign in as ${name} (or ${name}@molsoncoors.com).`);
    }
    case 'reset-password': {
      if (!username) throw new Error('Give a username: reset-password <username>');
      const name = await auth.resetPassword(username, await askNewPassword(fromStdin));
      return console.log(`Password changed for ${name}. Any open sessions were signed out.`);
    }
    case 'deactivate':
    case 'activate': {
      if (!username) throw new Error(`Give a username: ${command} <username>`);
      const name = await auth.setActive(username, command === 'activate');
      return console.log(command === 'activate' ? `${name} can sign in again.` : `${name} can no longer sign in and was signed out.`);
    }
    case 'export': {
      const fs = await import('node:fs/promises');
      const file = username || auth.DEFAULT_ACCOUNTS_FILE;
      const data = await auth.exportAccounts();
      await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
      return console.log(`Wrote ${data.accounts.length} accounts to ${file}. Commit it so clones get them.`);
    }
    case 'sync': {
      const fs = await import('node:fs/promises');
      const file = username || auth.DEFAULT_ACCOUNTS_FILE;
      const r = await auth.syncAccounts(JSON.parse(await fs.readFile(file, 'utf8')));
      console.log(`From ${file}: ${r.added.length} added, ${r.updated.length} updated, ${r.unchanged} already up to date.`);
      if (r.added.length) console.log(`  Added: ${r.added.join(', ')}`);
      if (r.updated.length) console.log(`  Updated: ${r.updated.join(', ')}`);
      if (r.invalid.length) { console.log(`  Skipped: ${r.invalid.join('; ')}`); process.exitCode = 1; }
      return;
    }
    case 'import': {
      if (!username) throw new Error('Give a CSV file, or "-" to read it from stdin: import <file.csv | ->');
      return importCsv(username);
    }
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await auth.pool.end();
}
```

<a id="b24"></a>
### B.24 `server.mjs`

```js
import dns from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  buildUserMessage,
  normalizeAndValidate,
  combineResults,
  OUTPUT_SCHEMA,
} from './business_logic.mjs';
import { buildExport, validateExport, ExportUnavailableError } from './export.mjs';
import * as auth from './auth.mjs';
import { diagnoseEmpty, explainEmpty, isEmptyResult } from './empty_results.mjs';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// Content-Disposition is exposed so the browser can read the download's file name
app.use(cors({ origin: '*', exposedHeaders: ['Content-Disposition'] }));

// =====================================================================
// METABASE DASHBOARDS: Metabase only listens on this computer, so its
// public-dashboard pages (and the scripts and data they load) are passed
// through this server. That way the Dashboards tab works wherever OneTouch
// does: localhost, the network address, the tunnel and remote mode.
// =====================================================================

const METABASE_URL = (process.env.METABASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const METABASE_DASHBOARDS_FILE = 'metabase-dashboards.json';
// What a public dashboard page needs from Metabase, and nothing else
// (no admin pages, no signed-in API)
const METABASE_PATHS = /^\/(public\/|app\/|api\/public\/|api\/session\/properties$|api\/geojson)/;
// Headers passed back to the browser; fetch already undid any compression
const METABASE_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified',
  'content-security-policy', 'x-frame-options', 'location'];

app.use(async (req, res, next) => {
  if (!METABASE_PATHS.test(req.path) || !['GET', 'HEAD'].includes(req.method)) return next();
  try {
    const upstream = await fetch(METABASE_URL + req.originalUrl, {
      method: req.method,
      headers: { accept: req.get('accept') || '*/*', 'accept-language': req.get('accept-language') || 'en' },
      redirect: 'manual',
      signal: AbortSignal.timeout(120 * 1000),
    });
    res.status(upstream.status);
    for (const h of METABASE_RESPONSE_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error(`📊 Metabase unreachable for ${req.path}: ${error.message}`);
    res.status(502).send('Metabase is not reachable right now.');
  }
});
// Exports carry whole result tables back up, so that route gets a bigger limit
app.use('/api/export', express.json({ limit: '25mb' }));
app.use(express.json());
app.use(express.static('public'));

// =====================================================================
// SIGN IN: accounts and sessions live in Postgres (see auth.mjs);
// /api/query, /api/export and /api/conversation need a session
// =====================================================================

// Conversation memory per session token: { conversation, queue }. Kept in
// RAM, so a server restart keeps people signed in but Claude forgets.
const conversations = new Map();

// What Claude remembers for one signed-in session (see translateToQuery)
function newConversation() {
  return {
    messages: [],     // Anthropic.MessageParam[]: user turns + Claude's full replies, append-only
    turns: 0,         // completed question/answer pairs
    pendingNote: null // what the last answer's query returned, told to Claude with the next question
  };
}

function conversationState(token) {
  let state = conversations.get(token);
  if (!state) {
    // queue: questions in one session run one at a time
    state = { conversation: newConversation(), queue: Promise.resolve(), lastUsed: Date.now() };
    conversations.set(token, state);
  }
  state.lastUsed = Date.now();
  return state;
}

// Per-address brake on wrong passwords, on top of the per-account lockout in
// auth.mjs (which can't cover guesses spread across many usernames)
const MAX_FAILURES_PER_IP = 20;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failuresByIp = new Map(); // ip -> { count, resetAt }

// Through the Cloudflare tunnel every request arrives from the tunnel
// container, so the visitor's real address comes from Cloudflare's
// CF-Connecting-IP header. That header is only believed from the tunnel
// containers themselves; anyone else could simply make it up.
const TUNNEL_HOSTS = ['tunnel', 'tunnel-named']; // service names in docker-compose.yml
let tunnelAddresses = new Set();

async function refreshTunnelAddresses() {
  const found = new Set();
  for (const host of TUNNEL_HOSTS) {
    try {
      for (const { address } of await dns.lookup(host, { all: true })) found.add(address);
    } catch { /* that tunnel isn't running */ }
  }
  tunnelAddresses = found;
}
refreshTunnelAddresses();
setInterval(refreshTunnelAddresses, 30 * 1000).unref();

function clientIp(req) {
  const direct = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const forwarded = req.get('CF-Connecting-IP');
  return tunnelAddresses.has(direct) && forwarded ? forwarded.trim() : direct;
}

function tooManyFailures(ip) {
  const entry = failuresByIp.get(ip);
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES_PER_IP);
}

function recordFailure(ip) {
  const entry = failuresByIp.get(ip);
  if (!entry || entry.resetAt <= Date.now()) failuresByIp.set(ip, { count: 1, resetAt: Date.now() + FAILURE_WINDOW_MS });
  else entry.count += 1;
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const ip = clientIp(req);
  if (tooManyFailures(ip)) {
    return res.status(429).json({ error: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.' });
  }

  try {
    const result = await auth.signIn(username, password);
    if (!result.ok) {
      recordFailure(ip);
      return res.status(401).json({
        error: result.reason === 'locked'
          ? 'This account is locked for 15 minutes after too many wrong passwords.'
          : 'Incorrect email or password.',
      });
    }
    console.log(`🔐 ${result.user.username} signed in from ${ip}`);
    res.json({ token: result.token, username: result.user.username, displayName: result.user.displayName });
  } catch (error) {
    console.error('🔐 Sign-in failed:', error.message);
    res.status(503).json({ error: 'Sign-in is unavailable right now (the account database could not be reached).' });
  }
});

function sessionToken(req) {
  const m = (req.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  return m ? m[1] : null;
}

app.post('/api/logout', async (req, res) => {
  const token = sessionToken(req);
  if (token) {
    conversations.delete(token);
    await auth.signOut(token).catch(err => console.error('🔐 Sign-out failed:', err.message));
  }
  res.json({ ok: true });
});

async function requireLogin(req, res, next) {
  const token = sessionToken(req);
  let user = null;
  try {
    user = token ? await auth.getSessionUser(token) : null;
  } catch (error) {
    console.error('🔐 Session check failed:', error.message);
    return res.status(503).json({ error: 'The account database could not be reached. Please try again shortly.' });
  }
  if (!user) {
    if (token) conversations.delete(token);
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  req.user = user;
  req.session = conversationState(token);
  next();
}

app.use(['/api/query', '/api/export', '/api/conversation', '/api/me', '/api/dashboards'], requireLogin);

// Who is signed in (the page shows their display name)
app.get('/api/me', (req, res) => {
  res.json({ username: req.user.username, displayName: req.user.displayName });
});

// The dashboards built by scripts/metabase-setup.mjs, for the Dashboards tab
app.get('/api/dashboards', (_req, res) => {
  try {
    const { dashboards, details = [] } = JSON.parse(readFileSync(METABASE_DASHBOARDS_FILE, 'utf8'));
    res.json({
      // `group` is the drawer heading; files from before groups existed get one heading
      dashboards: dashboards.map(d => ({
        key: d.key, group: d.group || 'Dashboards', name: d.name, description: d.description, path: `/public/dashboard/${d.uuid}`,
      })),
      // The pages a click on a chart opens (not in the drawer); their filters name the page
      details: details.map(d => ({ key: d.key, name: d.name, path: `/public/dashboard/${d.uuid}`, params: d.params })),
    });
  } catch {
    res.json({ dashboards: [], details: [] });
  }
});

// "New chat": Claude forgets this session's conversation
app.post('/api/conversation/reset', (req, res) => {
  // Queued behind any question still running, so its answer can't land in the new conversation
  req.session.queue = req.session.queue.then(() => {
    req.session.conversation = newConversation();
  });
  req.session.queue.then(() => res.json({ ok: true }));
});

// Hourly housekeeping: expired sessions, idle conversations, old failure counts
setInterval(async () => {
  const idleCutoff = Date.now() - auth.SESSION_TTL_MS;
  for (const [token, state] of conversations) if (state.lastUsed < idleCutoff) conversations.delete(token);
  for (const [ip, entry] of failuresByIp) if (entry.resetAt <= Date.now()) failuresByIp.delete(ip);
  try {
    const removed = await auth.deleteExpiredSessions();
    if (removed) console.log(`🔐 Removed ${removed} expired sessions`);
  } catch (error) {
    console.error('🔐 Session cleanup failed:', error.message);
  }
}, 60 * 60 * 1000).unref();

const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
if (!anthropicKey || anthropicKey.startsWith('REPLACE_WITH')) {
  console.error('❌ ANTHROPIC_API_KEY is missing or still the placeholder. Set a real key in .env, then run: docker compose up -d --force-recreate app');
}

const anthropicWorkspaceId = (process.env.ANTHROPIC_WORKSPACE_ID || '').trim();

const anthropic = new Anthropic({
  apiKey: anthropicKey,
  defaultHeaders: anthropicWorkspaceId ? { 'anthropic-workspace-id': anthropicWorkspaceId } : undefined,
});

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

// The CSV export is a frozen snapshot (roughly 2026-06-01 to 2026-09-01).
// Relative phrases like "last month" are computed from TODAY, which drifts
// past the data over time. Set ASSUME_TODAY=YYYY-MM-DD in .env to pin the
// reference date (e.g. 2026-09-02) so relative dates land inside the export.
function referenceToday() {
  const pinned = (process.env.ASSUME_TODAY || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(pinned)) {
    const d = new Date(`${pinned}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

// The business logic (entity catalog, vocabulary, worked examples) lives in
// business_logic.mjs. It is built once and sent as a cached system block;
// only the user turn (which carries today's date) changes per request.
const SYSTEM_PROMPT = buildSystemPrompt();

// 🛡️ RESILIENT NETWORK RETRY LOOP HANDSHAKE
async function fetchWithRetry(url, options, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`⚠️ Cube is busy or compiling. Retrying in ${delay / 1000}s... (Attempt ${i + 1}/${retries})`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

// A session's conversation starts over after this many questions, so one
// very long session can't grow every request without limit
const MAX_CONVERSATION_TURNS = 40;

// Step 1: plain English -> structured JSON (schema-enforced by the API).
// Claude sees the session's earlier questions and its own earlier answers,
// so follow-ups like "same but for changes" or "only the P1s" work.
async function translateToQuery(conversation, userPrompt) {
  let memoryReset = false;
  if (conversation.turns >= MAX_CONVERSATION_TURNS) {
    Object.assign(conversation, newConversation());
    memoryReset = true;
  }

  // Tell Claude what its previous answer produced, inside the new user turn
  // (history is append-only: earlier turns are never edited after the fact)
  const note = conversation.pendingNote ? `[Result of your previous answer: ${conversation.pendingNote}]\n\n` : '';
  const userTurn = { role: 'user', content: note + buildUserMessage(userPrompt, referenceToday()) };

  const stream = anthropic.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    // Caches the conversation so far, so each follow-up only pays full price for the new turn
    cache_control: { type: 'ephemeral' },
    messages: [...conversation.messages, userTurn],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  });
  const message = await stream.finalMessage();

  // A failed call leaves the conversation as it was, so the user can just ask again
  if (message.stop_reason === 'refusal') {
    throw new Error('The assistant declined to translate that request.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('The translation was cut off; try a shorter question.');
  }

  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = JSON.parse(text);

  // Remember the turn. Claude's reply goes back exactly as returned (thinking
  // blocks included); Sonnet 5.5 rejects or drops altered earlier turns.
  conversation.messages.push(userTurn, { role: 'assistant', content: message.content });
  conversation.turns += 1;
  conversation.pendingNote = null;

  return { parsed, usage: message.usage, memoryReset };
}

// One line for Claude about what the last answer's queries returned
function describeResults(sections) {
  return sections
    .map(s => `${s.entity} query returned ${s.rows.length} ${s.rows.length === 1 ? 'row' : 'rows'}`)
    .join('; ') + '.';
}

// Step 2: validated Cube query -> rows
async function runCubeQuery(cubeQuery) {
  const cubeResponse = await fetchWithRetry(
    process.env.CUBE_API_URL || 'http://localhost:4000/cubejs-api/v1/load',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.CUBE_API_TOKEN || 'super_secret_key_change_me_later',
      },
      body: JSON.stringify({ query: cubeQuery }),
    }
  );

  const contentType = cubeResponse.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('Cube.dev is still initializing its internal model registry. Try again in a few seconds.');
  }
  const data = await cubeResponse.json();
  if (data.error) throw new Error(`Cube Engine Error: ${data.error}`);
  return data.data || [];
}

app.post('/api/query', async (req, res) => {
  const { userPrompt } = req.body;
  if (!userPrompt || typeof userPrompt !== 'string') {
    return res.status(400).json({ error: 'userPrompt parameter is required.' });
  }

  // Questions from one session run in order, so the conversation history
  // can't interleave if the user sends a second one before the first returns
  const session = req.session;
  const run = session.queue.then(() => answerQuestion(session.conversation, userPrompt, res));
  session.queue = run.catch(() => {});
  await run;
});

async function answerQuestion(conversation, userPrompt, res) {
  // Set once Claude's answer is in the conversation; from then on, whatever
  // happens to the query is reported to Claude with the next question
  let remembered = false;

  try {
    console.log(`\n💬 Processing prompt: "${userPrompt}" (turn ${conversation.turns + 1})`);

    const { parsed, usage, memoryReset } = await translateToQuery(conversation, userPrompt);
    remembered = true;
    console.log(`🧠 tokens in=${usage.input_tokens} cached=${usage.cache_read_input_tokens ?? 0} out=${usage.output_tokens}`);

    const verdict = normalizeAndValidate(parsed);
    if (!verdict.ok) {
      console.warn('⚠️ Rejected by validator:', verdict.error, JSON.stringify(parsed));
      conversation.pendingNote = `it was rejected before running: ${verdict.error}`;
      return res.status(400).json({
        error: `I couldn't map that question onto the data: ${verdict.error}`,
        aiInterpretation: parsed,
      });
    }

    if (verdict.intent !== 'query') {
      // clarify / unsupported: nothing to run, hand the explanation back
      console.log(`🙋 ${verdict.intent}: ${verdict.message}`);
      return res.json({
        intent: verdict.intent,
        message: verdict.message,
        assumptions: verdict.assumptions,
        memoryReset,
        sections: [],
        results: [],
      });
    }

    // One Cube query per ticket type, run side by side
    for (const q of verdict.queries) console.log(`🤖 Cube query [${q.entity}]:`, JSON.stringify(q.cubeQuery));
    const sections = await Promise.all(verdict.queries.map(async q => ({
      entity: q.entity,
      rows: await runCubeQuery(q.cubeQuery),
    })));
    // Nothing found: work out why (which filter emptied it, what dates the data
    // covers) and have Claude say so plainly, instead of a bare "no records"
    const emptyQueries = verdict.queries.filter((_, i) => isEmptyResult(sections[i].rows));
    let explanation = null;
    if (emptyQueries.length) {
      try {
        const facts = (await Promise.all(emptyQueries.map(q => diagnoseEmpty(q.entity, q.cubeQuery, runCubeQuery)))).flat();
        console.log('🔎 Empty result facts:\n   ' + facts.join('\n   '));
        explanation = await explainEmpty({ anthropic, model: CLAUDE_MODEL, question: userPrompt, searchedFor: verdict.message, facts });
        console.log(`🔎 Explained: ${explanation}`);
      } catch (error) {
        console.error('🔎 Could not diagnose the empty result:', error.message);
      }
    }
    conversation.pendingNote = describeResults(sections) + (explanation ? ` What the user was told about the empty result: ${explanation}` : '');

    // Counts across several ticket types become one table with a total column
    const combined = verdict.merge ? combineResults(verdict.merge, verdict.queries, sections) : null;

    res.json({
      intent: 'query',
      // `entity` / `results` describe the single-type case; `sections` and
      // `combined` describe questions that spanned several ticket types
      entity: sections.length === 1 ? sections[0].entity : 'multiple',
      message: verdict.message,
      assumptions: verdict.assumptions,
      memoryReset,
      aiInterpretation: verdict.queries,
      results: sections.length === 1 ? sections[0].rows : [],
      sections,
      combined,
      // Why nothing (or part of it) was found; allEmpty means there's no table to show
      explanation,
      allEmpty: emptyQueries.length === verdict.queries.length,
    });

  } catch (error) {
    if (remembered) conversation.pendingNote = `it failed when run: ${error.message}`;
    if (error instanceof Anthropic.APIError) {
      console.error(`📋 Claude API error ${error.status}:`, error.message);
      return res.status(502).json({ error: `Claude API error (${error.status}): ${error.message}` });
    }
    console.error('📋 Execution Failure Context:', error);
    res.status(500).json({ error: `Server pipeline failed: ${error.message}` });
  }
}

// The tables shown in the chat -> a downloadable file (see export.mjs)
app.post('/api/export', async (req, res) => {
  const problem = validateExport(req.body);
  if (problem) return res.status(400).json({ error: problem });

  try {
    const { buffer, fileName, contentType } = await buildExport(req.body);
    console.log(`📥 Export ${req.body.format}: ${fileName} (${buffer.length.toLocaleString()} bytes)`);
    res.attachment(fileName);
    res.type(contentType);
    res.send(buffer);
  } catch (error) {
    if (error instanceof ExportUnavailableError) {
      return res.status(501).json({ error: error.message });
    }
    console.error('📥 Export failed:', error);
    res.status(500).json({ error: `Could not create the ${req.body.format.toUpperCase()} file: ${error.message}` });
  }
});

app.listen(port, () => {
  console.log(`🚀 Node.js Orchestrator live on port ${port} (model: ${CLAUDE_MODEL})`);
});

// Account setup: create the tables if this is a fresh database, then load the
// shared accounts file (db/accounts.json) so a fresh clone has everyone's
// sign-ins. Retries, because on first start Postgres is still initializing.
async function prepareAccounts(attempt = 1) {
  try {
    await auth.ensureSchema();
  } catch (error) {
    const wait = Math.min(attempt * 2, 15);
    console.error(`🔐 Account database not reachable yet (${error.message}); retrying in ${wait}s`);
    setTimeout(() => prepareAccounts(attempt + 1), wait * 1000).unref();
    return;
  }

  const file = process.env.ACCOUNTS_FILE ?? auth.DEFAULT_ACCOUNTS_FILE;
  if (file && existsSync(file)) {
    try {
      const r = await auth.syncAccounts(JSON.parse(readFileSync(file, 'utf8')));
      if (r.added.length || r.updated.length) {
        console.log(`🔐 Loaded ${file}: ${r.added.length} accounts added, ${r.updated.length} updated`);
      }
      if (r.invalid.length) console.warn(`🔐 ${file}: skipped ${r.invalid.join('; ')}`);
    } catch (error) {
      console.error(`🔐 Could not load ${file}: ${error.message}`);
    }
  }

  const users = await auth.listUsers();
  console.log(users.length
    ? `🔐 Account database ready (${users.length} ${users.length === 1 ? 'account' : 'accounts'})`
    : '🔐 Account database ready, but it has no accounts yet. Add one with: docker exec -it analytics_node_app node scripts/users.mjs add <username>');
}
prepareAccounts();
```

<a id="b25"></a>
### B.25 `public/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OneTouch</title>
    <link rel="icon" type="image/x-icon" href="favicon.ico">
    <link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">
    <link rel="manifest" href="site.webmanifest">
    <link rel="stylesheet" href="style.css">
</head>
<body class="signed-out">
    <!-- SIGN-IN PAGE: shown until the user signs in -->
    <div id="login-view" class="login-page">
        <img src="molsoncoorslogo.png" alt="Molson Coors" class="login-brand">
        <main class="box">
            <img src="favicon-32x32.png" alt="" width="32" height="32">
            <h1>Sign in to OneTouch</h1>
            <p class="sub">Enter your Molson Coors Email</p>
            <form id="login-form" onsubmit="event.preventDefault(); signIn();">
                <label for="login-email">Molson Coors Email</label>
                <div class="combo">
                    <input id="login-email" type="text" placeholder="your-email" autocomplete="username" required
                           spellcheck="false" autocapitalize="off">
                    <span class="suffix">@molsoncoors.com</span>
                </div>
                <label for="login-password" class="password-label">Password</label>
                <div class="combo">
                    <input id="login-password" type="password" placeholder="your-password" autocomplete="current-password" required>
                </div>
                <p id="login-error" class="login-error" role="alert"></p>
                <button id="login-btn" class="btn" type="submit">Continue with SSO</button>
            </form>
            <div class="or"><span>or use</span></div>
            <div class="provs">
                <button class="prov" type="button" onclick="showLoginError('Microsoft Entra ID sign-in is not available yet. Use your email and password.')"><img src="microsoftlogo.png" alt="" height="24" width="24"> Microsoft Entra ID</button>
            </div>
            <p class="foot">Forgot your email or password? <a href="#">Contact Support</a></p>
        </main>
    </div>

    <header class="app-header">
        <h1 class="app-title"><img src="android-chrome-192x192.png" alt="" class="app-logo"> OneTouch <span id="user-name" class="user-name"></span></h1>
        <nav class="tab-navigation">
            <button class="tab-btn active" onclick="switchTab('chat')">💬 AI Assistant</button>
            <button class="tab-btn" onclick="switchTab('dashboard')">📈 Dashboards</button>
            <button class="sign-out-btn" type="button" onclick="signOut()">Sign out</button>
        </nav>
    </header>

    <main class="app-content">
        <!-- CHAT VIEW CONTAINER -->
        <section id="chat-view" class="view-panel active">
            <div class="chat-container">
                <div class="chat-messages" id="chat-log">
                    <div class="msg system-msg" id="welcome-msg">Hello!</div>
                </div>
                <div class="chat-input-area">
                    <input type="text" id="user-prompt" placeholder="Ask a data question..." onkeydown="if(event.key === 'Enter') sendPrompt()">
                    <button id="send-btn" onclick="sendPrompt()">Ask Claude</button>
                    <button id="new-chat-btn" type="button" onclick="newChat()" title="Start over: Claude forgets this conversation">New chat</button>
                </div>
            </div>
        </section>

        <!-- DASHBOARD VIEW CONTAINER (METABASE) -->
        <section id="dashboard-view" class="view-panel">
            <div class="dashboard-container">
                <!-- Top-left: the drawer button and which dashboard is showing -->
                <div class="dashboard-toolbar">
                    <button type="button" class="drawer-toggle" id="dashboard-drawer-toggle"
                            aria-controls="dashboard-drawer" aria-expanded="false" onclick="toggleDashboardDrawer()">
                        <span aria-hidden="true">☰</span> Dashboards
                    </button>
                    <!-- Shown on the detail pages a click opens -->
                    <button type="button" class="dashboard-back" id="dashboard-back" hidden onclick="dashboardBack()">← Back</button>
                    <div class="dashboard-current">
                        <span class="dashboard-current-group" id="dashboard-current-group"></span>
                        <span class="dashboard-current-name" id="dashboard-current-name"></span>
                        <span class="dashboard-current-desc" id="dashboard-current-desc"></span>
                    </div>
                    <span class="dashboard-hint" id="dashboard-hint" hidden>Click a bar, slice, number or blue value for details</span>
                </div>
                <div class="dashboard-body">
                    <div class="dashboard-backdrop" id="dashboard-backdrop" onclick="toggleDashboardDrawer(false)"></div>
                    <!-- Filled in by app.js from /api/dashboards (built by scripts/metabase-setup.mjs) -->
                    <aside class="dashboard-drawer" id="dashboard-drawer" aria-label="Dashboards">
                        <div class="drawer-header">
                            <span>Dashboards</span>
                            <button type="button" class="drawer-close" onclick="toggleDashboardDrawer(false)" aria-label="Close">✕</button>
                        </div>
                        <nav id="dashboard-picker"></nav>
                    </aside>
                    <p class="dashboard-message" id="dashboard-message">Loading dashboards…</p>
                    <iframe id="dashboard-frame" title="Dashboard" hidden></iframe>
                </div>
            </div>
        </section>
    </main>

    <script src="app.js"></script>
</body>
</html>
```

<a id="b26"></a>
### B.26 `public/style.css`

```css
:root {
    --bg-primary: #f4f6f9;
    --panel-bg: #ffffff;
    --accent: #10a37f;
    --text: #2d3748;
    --border: #e2e8f0;
}

body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background-color: var(--bg-primary);
    color: var(--text);
    display: flex;
    flex-direction: column;
    height: 100vh;
}

.app-header {
    background: #1a202c;
    color: white;
    padding: 10px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.app-header h1 { margin: 0; font-size: 1.25rem; }
.app-title { display: flex; align-items: center; gap: 8px; }
.app-logo { width: 28px; height: 28px; border-radius: 6px; }
/* Signed-in person's name, next to the OneTouch title */
.user-name {
    font-size: 0.95rem;
    font-weight: 400;
    color: #cbd5e0;
    padding-left: 10px;
    margin-left: 2px;
    border-left: 1px solid #4a5568;
}
.user-name:empty { display: none; }

.tab-navigation .tab-btn {
    background: transparent;
    border: none;
    color: #a0aec0;
    padding: 10px 15px;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 500;
}

.tab-navigation .sign-out-btn {
    background: transparent;
    border: 1px solid #4a5568;
    border-radius: 6px;
    color: #cbd5e0;
    padding: 6px 12px;
    margin-left: 10px;
    cursor: pointer;
    font-size: 0.9rem;
}
.tab-navigation .sign-out-btn:hover { color: white; border-color: #a0aec0; }

.tab-navigation .tab-btn.active {
    color: white;
    border-bottom: 2px solid var(--accent);
}

.app-content { flex: 1; position: relative; overflow: hidden; }

.view-panel {
    display: none;
    position: absolute;
    width: 100%;
    height: 100%;
}

.view-panel.active { display: flex; }

/* CHAT AREA ARCHITECTURE */
.chat-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 1200px;
    margin: 20px auto;
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    height: calc(100% - 40px);
}

.chat-messages {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 15px;
}

.msg { padding: 12px 16px; border-radius: 6px; max-width: 75%; line-height: 1.5; }
.system-msg { background: #edf2f7; align-self: center; text-align: center; font-size: 0.9rem; }
.user-msg { background: var(--accent); color: white; align-self: flex-end; }
.ai-msg { background: #f7fafc; border: 1px solid var(--border); align-self: flex-start; }

.chat-input-area {
    display: flex;
    padding: 15px;
    border-top: 1px solid var(--border);
    gap: 10px;
}

.chat-input-area input {
    flex: 1;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 1rem;
}

.chat-input-area button {
    background: var(--accent);
    color: white;
    border: none;
    padding: 0 24px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
}

/* Secondary: clears the chat and Claude's memory of it */
.chat-input-area #new-chat-btn {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 0 16px;
}
.chat-input-area #new-chat-btn:hover { background: var(--bg-primary); }

/* DASHBOARD PANEL */
.dashboard-container { width: 100%; height: 100%; display: flex; flex-direction: column; }

/* Top-left: the drawer button and the dashboard that's showing */
.dashboard-toolbar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-bg);
}
.drawer-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
}
.drawer-toggle span { font-size: 1.1rem; line-height: 1; }
.dashboard-current { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dashboard-current-group { color: #718096; font-size: 0.85rem; }
.dashboard-current-group:not(:empty)::after { content: ' ›'; }
.dashboard-current-name { font-weight: 600; font-size: 1rem; }
.dashboard-current-desc { color: #718096; font-size: 0.85rem; }
/* Back from a detail page that a click on a chart opened */
.dashboard-back {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 12px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
    flex-shrink: 0;
}
.dashboard-back:hover { background: var(--bg-primary); }
.dashboard-hint { margin-left: auto; color: #a0aec0; font-size: 0.8rem; white-space: nowrap; }

/* The drawer slides over the dashboard from the left */
.dashboard-body { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; }
.dashboard-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(26, 32, 44, 0.35);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
    z-index: 2;
}
.dashboard-backdrop.open { opacity: 1; pointer-events: auto; }
.dashboard-drawer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(320px, 85vw);
    background: var(--panel-bg);
    border-right: 1px solid var(--border);
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.12);
    overflow-y: auto;
    transform: translateX(-100%);
    visibility: hidden;
    transition: transform 0.2s ease, visibility 0.2s;
    z-index: 3;
}
.dashboard-drawer.open { transform: none; visibility: visible; }
.drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px 6px;
    font-weight: 700;
}
.drawer-close { background: none; border: none; font-size: 1rem; color: #718096; cursor: pointer; padding: 4px 6px; }
.drawer-close:hover { color: var(--text); }
.drawer-group { padding: 6px 8px 10px; }
.drawer-group h3 {
    margin: 8px 8px 4px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #718096;
}
.dashboard-choice {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-left: 3px solid transparent;
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text);
    cursor: pointer;
}
.dashboard-choice:hover { background: var(--bg-primary); }
.dashboard-choice.active { background: #e6f6f1; border-left-color: var(--accent); }
.dashboard-choice-name { font-weight: 600; font-size: 0.92rem; }
.dashboard-choice-desc { font-size: 0.78rem; color: #718096; line-height: 1.35; }

.dashboard-message { margin: 40px auto; max-width: 560px; text-align: center; color: #4a5568; line-height: 1.6; }
#dashboard-frame { flex: 1; width: 100%; border: 0; }

@media (max-width: 640px) {
    .dashboard-toolbar { padding: 10px 16px; }
    .dashboard-current-desc { display: none; }
}
@media (max-width: 1100px) {
    .dashboard-hint { display: none; }
}

/* RESULT TABLES */
.ai-msg.wide { max-width: 100%; width: 100%; box-sizing: border-box; }

.result-title { font-weight: 600; margin-bottom: 8px; }
.result-caption { font-size: 0.8rem; color: #718096; margin-bottom: 4px; }
.result-empty { margin: 4px 0; color: #4a5568; }
/* Why a question found nothing (dates covered, which condition emptied it) */
.result-explanation {
    margin: 6px 0 4px;
    padding: 10px 14px;
    background: #fffbea;
    border-left: 3px solid #d69e2e;
    border-radius: 4px;
    color: var(--text);
    line-height: 1.5;
}

.result-big { font-size: 2rem; font-weight: 700; color: var(--accent); margin: 4px 0 8px; }
.result-big span { font-size: 1rem; font-weight: 500; color: var(--text); }

.table-wrap {
    overflow: auto;
    max-height: 480px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-bg);
}

.result-table { border-collapse: collapse; width: 100%; font-size: 0.875rem; }
.result-table th,
.result-table td {
    padding: 8px 12px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--border);
}
.result-table thead th {
    position: sticky;
    top: 0;
    background: #edf2f7;
    font-weight: 600;
    white-space: nowrap;
    z-index: 1;
}
.result-table tbody tr:nth-child(even) { background: #f9fafb; }
.result-table tbody tr:hover { background: #e6f6f1; }
.result-table td { min-width: 90px; }
.result-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.result-table td[title] { cursor: help; }

/* Single-ticket lookups: label on the left, value on the right */
.result-table.detail th { width: 200px; background: #f7fafc; white-space: nowrap; }
.result-table.detail td.long { white-space: pre-wrap; max-width: 700px; }

.assumptions { margin-top: 10px; font-size: 0.85rem; color: #4a5568; }
.assumptions summary { cursor: pointer; color: #718096; }
.assumptions ul { margin: 6px 0 0; padding-left: 20px; }

/* Tables that combine several ticket types */
.section-title { font-weight: 600; margin: 14px 0 4px; }
.result-table tfoot td {
    position: sticky;
    bottom: 0;
    background: #edf2f7;
    font-weight: 700;
    border-top: 2px solid var(--border);
}
.result-table td.total { font-weight: 600; }

/* Download bar under each result */
.download-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 0.85rem;
    color: #4a5568;
}
.download-bar select {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-bg);
    font-size: 0.85rem;
}
.download-bar button {
    background: var(--accent);
    color: white;
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.85rem;
}
.download-bar button:disabled { opacity: 0.6; cursor: wait; }
.download-status { color: #718096; }
.download-status.error { color: #c53030; }

/* =====================================================================
   SIGN-IN PAGE (from styles2.css; every rule is scoped to .login-page
   so it cannot restyle the app behind it)
   ===================================================================== */

/* Until sign-in only the login page shows; afterwards only the app */
body.signed-out .app-header,
body.signed-out .app-content { display: none; }
body:not(.signed-out) .login-page { display: none; }

.login-page {
  --brand: #4f46e5;
  --ink: #111827;
  --muted: #6b7280;
  --line: #e5e7eb;
  --bad: #dc2626;
  --ok: #15803d;

  position: fixed;
  inset: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  justify-items: center;
  padding: 0 16px 28px;
  background: #718aee;
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
}

.login-page *,
.login-page *::before,
.login-page *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.login-page a {
  color: var(--brand);
  text-decoration: none;
  font-weight: 600;
}

.login-page a:hover { text-decoration: underline; }

.login-page input,
.login-page select,
.login-page button { font: inherit; }

.login-page :focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

/* Page layout / branding */
.login-page .login-brand {
  display: block;
  max-width: 100%;
  margin: 48px 0 0;
}

/* Sign-in card */
.login-page .box {
  width: 100%;
  max-width: 430px;
  margin-top: 24px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 38px 34px;
  box-shadow: 0 10px 34px rgba(17, 24, 39, .06);
}

/* Typography */
.login-page .mark {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--brand);
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
  margin-bottom: 22px;
}

.login-page h1 {
  font-size: 1.4rem;
  letter-spacing: -.02em;
  margin-bottom: 7px;
}

.login-page .sub {
  color: var(--muted);
  font-size: .93rem;
  line-height: 1.6;
  margin-bottom: 26px;
}

.login-page label {
  display: block;
  font-size: .85rem;
  font-weight: 600;
  margin-bottom: 6px;
}

.login-page .password-label { margin-top: 16px; }

/* Form fields / inputs */
.login-page .field {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: .95rem;
  transition: border-color .15s, box-shadow .15s;
  background: #fff;
  color: inherit;
}

.login-page .field:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, .15);
}

.login-page .combo {
  display: flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color .15s, box-shadow .15s;
  background: #fff;
}

.login-page .combo:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, .15);
}

.login-page .combo input {
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 12px 4px 12px 14px;
  font-size: .95rem;
  background: none;
}

.login-page .combo input:focus { outline: none; }

.login-page .combo .suffix {
  padding: 12px 14px 12px 2px;
  color: var(--muted);
  font-size: .95rem;
  white-space: nowrap;
  background: #f5f6fa;
  align-self: stretch;
  display: flex;
  align-items: center;
  border-left: 1px solid var(--line);
}

/* Wrong email/password message; takes no space while empty */
.login-page .login-error {
  color: var(--bad);
  font-size: .88rem;
  font-weight: 600;
  margin-top: 12px;
}
.login-page .login-error:empty { display: none; }

/* CTA buttons / providers */
.login-page .btn {
  width: 100%;
  margin-top: 20px;
  padding: 13px;
  border: 0;
  border-radius: 10px;
  background: var(--brand);
  color: #fff;
  font-size: .97rem;
  font-weight: 700;
  cursor: pointer;
  transition: background .15s;
}

.login-page .btn:hover { background: #4338ca; }
.login-page .btn:disabled { opacity: .7; cursor: wait; }

.login-page .provs {
  display: grid;
  gap: 9px;
  margin: 24px 0 0;
}

.login-page .prov {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: #fff;
  font-size: .92rem;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  transition: background .15s, border-color .15s;
}

.login-page .prov:hover {
  background: #f5f6fa;
  border-color: #cbd0dd;
}

.login-page .prov .ic {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: .68rem;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
}

/* Divider / footer */
.login-page .or {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 24px 0 4px;
  color: var(--muted);
  font-size: .8rem;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.login-page .or::before,
.login-page .or::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line);
}

.login-page .foot {
  margin-top: 22px;
  color: var(--muted);
  font-size: .88rem;
  text-align: center;
}

/* Responsive / accessibility */
@media (max-width: 400px) {
  .login-page .box { padding: 28px 20px; }
  .login-page .combo .suffix {
    font-size: .85rem;
    padding-left: 6px;
    padding-right: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-page *,
  .login-page *::before,
  .login-page *::after {
    transition: none !important;
    animation: none !important;
  }
}
```

<a id="b27"></a>
### B.27 `public/app.js`

```js
// =====================================================================
// SIGN IN: the server checks the credentials and hands back a session
// token, which every API call then sends as "Authorization: Bearer ..."
// =====================================================================

// The API lives on the same server that served this page, whether that's
// localhost:8000, this computer's network address, or a tunnel link. Only a
// page opened straight from disk (file://) has no server, so fall back then.
const API_BASE = location.protocol.startsWith('http') ? location.origin : 'http://localhost:8000';
const TOKEN_KEY = 'onetouch-session';

// sessionStorage can be blocked (private windows, strict settings)
function readToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function saveToken(token) {
    try {
        if (token) sessionStorage.setItem(TOKEN_KEY, token);
        else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* stays signed in until the page is reloaded */ }
}

let sessionTokenValue = readToken();

function authHeaders() {
    return sessionTokenValue ? { Authorization: `Bearer ${sessionTokenValue}` } : {};
}

function showLoginError(message) {
    document.getElementById('login-error').textContent = message || '';
}

function showApp(signedIn) {
    document.body.classList.toggle('signed-out', !signedIn);
    if (signedIn) document.getElementById('user-prompt').focus();
    else document.getElementById('login-email').focus();
}

// The signed-in person's name, shown in the header and the chat greeting
// (their display name, or their username if they don't have one)
let currentUserName = '';

function setCurrentUser(user) {
    currentUserName = user ? (user.displayName || user.username || '') : '';
    document.getElementById('user-name').textContent = currentUserName;
    // The greeting uses just the first name: "Cassidy Sotelo" -> "Hello, Cassidy!"
    const firstName = currentUserName.trim().split(/\s+/)[0];
    const welcome = document.getElementById('welcome-msg');
    if (welcome) welcome.textContent = firstName ? `Hello, ${firstName}!` : 'Hello!';
}

// Who owns the stored session (after a reload, the name isn't known yet)
async function loadCurrentUser() {
    if (!sessionTokenValue) return;
    try {
        const response = await fetch(`${API_BASE}/api/me`, { headers: authHeaders() });
        if (handleUnauthorized(response)) return;
        if (response.ok) setCurrentUser(await response.json());
    } catch (err) {
        console.error('Could not load the signed-in user:', err);
    }
}

async function signIn() {
    const button = document.getElementById('login-btn');
    const passwordField = document.getElementById('login-password');
    showLoginError('');
    button.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: document.getElementById('login-email').value,
                password: passwordField.value,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token) {
            showLoginError(data.error || 'Sign-in failed. Please try again.');
            passwordField.value = '';
            passwordField.focus();
            return;
        }
        sessionTokenValue = data.token;
        saveToken(data.token);
        passwordField.value = '';
        clearChat();
        setCurrentUser(data);
        showApp(true);
    } catch (err) {
        showLoginError('Could not reach the OneTouch server. Please try again.');
        console.error(err);
    } finally {
        button.disabled = false;
    }
}

function signOut(message) {
    if (sessionTokenValue) {
        fetch(`${API_BASE}/api/logout`, { method: 'POST', headers: authHeaders() }).catch(() => {});
    }
    sessionTokenValue = null;
    saveToken(null);
    // The next person to sign in on this computer must not see this person's chat
    clearChat();
    setCurrentUser(null);
    showLoginError(typeof message === 'string' ? message : '');
    showApp(false);
}

// An expired session (or a server restart) sends the user back to sign in
function handleUnauthorized(response) {
    if (response.status !== 401) return false;
    signOut('Your session has ended. Please sign in again.');
    return true;
}

// =====================================================================
// CONVERSATION MEMORY: the server keeps this session's questions and
// Claude's answers, so follow-ups ("same but for changes") work.
// "New chat" clears both the screen and Claude's memory.
// =====================================================================

const WELCOME_HTML = document.getElementById('chat-log').innerHTML;

// Back to just the greeting (with the signed-in person's name)
function clearChat() {
    document.getElementById('chat-log').innerHTML = WELCOME_HTML;
    exportPayloads.clear();
    setCurrentUser(currentUserName ? { displayName: currentUserName } : null);
}

async function resetConversation() {
    if (!sessionTokenValue) return;
    try {
        const response = await fetch(`${API_BASE}/api/conversation/reset`, { method: 'POST', headers: authHeaders() });
        handleUnauthorized(response);
    } catch (err) {
        console.error('Could not reset the conversation:', err);
    }
}

async function newChat() {
    await resetConversation();
    clearChat();
    document.getElementById('user-prompt').focus();
}

// A token from earlier in this tab skips the sign-in page; if it has
// expired, the first API call returns 401 and brings the page back
showApp(Boolean(sessionTokenValue));
loadCurrentUser();

// A reload empties the chat on screen, so Claude forgets it too
resetConversation();

// Tab Views Toggling Module
function switchTab(viewName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(`${viewName}-view`).classList.add('active');
    if (viewName === 'dashboard') loadDashboards();
}

// =====================================================================
// DASHBOARDS TAB: the Metabase dashboards made by scripts/metabase-setup.mjs,
// shown through the OneTouch server (so they work from any address)
// =====================================================================

let dashboardsLoaded = false;
const LAST_DASHBOARD_KEY = 'onetouch-dashboard';

// Every page the frame can show, by its public id: the drawer's dashboards,
// and the detail pages a click on a chart opens
const dashboardPages = { main: new Map(), details: new Map() };
let currentMainDashboard = null;
const pageId = path => (String(path).match(/\/public\/dashboard\/([0-9a-f-]{36})/) || [])[1];

// The last dashboard this browser showed (storage can be blocked: then none)
function rememberedDashboard() {
    try { return localStorage.getItem(LAST_DASHBOARD_KEY); } catch { return null; }
}
function rememberDashboard(key) {
    try { localStorage.setItem(LAST_DASHBOARD_KEY, key); } catch { /* not remembered; that's fine */ }
}

async function loadDashboards() {
    if (dashboardsLoaded) return;
    const picker = document.getElementById('dashboard-picker');
    const message = document.getElementById('dashboard-message');
    try {
        const response = await fetch(`${API_BASE}/api/dashboards`, { headers: authHeaders() });
        if (handleUnauthorized(response)) return;
        const { dashboards, details = [] } = await response.json();
        for (const d of dashboards) dashboardPages.main.set(pageId(d.path), d);
        for (const d of details) dashboardPages.details.set(pageId(d.path), d);
        if (!dashboards.length) {
            message.textContent = 'No dashboards yet. Whoever runs this OneTouch server can create them with: ' +
                'docker exec analytics_node_app node scripts/metabase-setup.mjs';
            document.getElementById('dashboard-drawer-toggle').hidden = true;
            return;
        }

        // The drawer: one heading per group, dashboards in the order the server lists them
        const groups = new Map();
        for (const d of dashboards) {
            if (!groups.has(d.group)) groups.set(d.group, []);
            groups.get(d.group).push(d);
        }
        picker.innerHTML = '';
        for (const [group, items] of groups) {
            const section = document.createElement('section');
            section.className = 'drawer-group';
            const heading = document.createElement('h3');
            heading.textContent = group;
            section.appendChild(heading);
            for (const d of items) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'dashboard-choice';
                button.dataset.key = d.key;
                button.innerHTML = '<span class="dashboard-choice-name"></span><span class="dashboard-choice-desc"></span>';
                button.querySelector('.dashboard-choice-name').textContent = d.name;
                button.querySelector('.dashboard-choice-desc').textContent = d.description || '';
                button.onclick = () => {
                    showDashboard(d);
                    toggleDashboardDrawer(false);
                };
                section.appendChild(button);
            }
            picker.appendChild(section);
        }
        dashboardsLoaded = true;

        const remembered = dashboards.find(d => d.key === rememberedDashboard());
        showDashboard(remembered || dashboards[0]);
        // First visit: open the drawer so people see everything that's there
        if (!remembered) toggleDashboardDrawer(true);
    } catch (err) {
        message.textContent = 'Could not load the dashboards. Please try again.';
        console.error(err);
    }
}

function showDashboard(dashboard) {
    markCurrentDashboard(dashboard);
    const frame = document.getElementById('dashboard-frame');
    // #bordered=false: no extra frame around the dashboard inside ours;
    // titled=false: the toolbar above already names it
    frame.src = `${API_BASE}${dashboard.path}#bordered=false&titled=false`;
    frame.hidden = false;
    document.getElementById('dashboard-message').hidden = true;
}

// A drawer dashboard is showing: name it, highlight it, remember it
function markCurrentDashboard(dashboard) {
    currentMainDashboard = dashboard;
    document.querySelectorAll('.dashboard-choice').forEach(b => {
        const on = b.dataset.key === dashboard.key;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    setDashboardHeading(dashboard.group, dashboard.name, dashboard.description || '', false);
    rememberDashboard(dashboard.key);
}

function setDashboardHeading(parent, name, description, onDetailPage) {
    document.getElementById('dashboard-current-group').textContent = parent;
    document.getElementById('dashboard-current-name').textContent = name;
    document.getElementById('dashboard-current-desc').textContent = description;
    document.getElementById('dashboard-back').hidden = !onDetailPage;
    document.getElementById('dashboard-hint').hidden = onDetailPage;
}

// "Team: TCS-Network-Voice", or for a list "Incidents · Priority: P2 - High"
function detailPageLabel(detail, search) {
    const values = new URLSearchParams(search);
    const set = detail.params.map(p => [p.name, values.get(p.slug)]).filter(([, v]) => v);
    if (detail.params.length === 1) return `${detail.name}: ${set[0]?.[1] || ''}`;
    return set.length ? `${detail.name} · ${set.map(([n, v]) => `${n}: ${v}`).join(', ')}` : detail.name;
}

// Clicks inside a dashboard move the frame to a detail page without
// reloading it, so follow its address and keep the toolbar in step
let lastFrameAddress = '';
function followDashboardFrame() {
    const frame = document.getElementById('dashboard-frame');
    let where;
    try { where = frame.contentWindow.location; } catch { return; } // not ours (yet)
    if (!where || where.href === lastFrameAddress) return;
    lastFrameAddress = where.href;

    const id = pageId(where.pathname);
    const main = dashboardPages.main.get(id);
    const detail = dashboardPages.details.get(id);
    if (main) {
        if (main !== currentMainDashboard) markCurrentDashboard(main);
        else setDashboardHeading(main.group, main.name, main.description || '', false);
    } else if (detail) {
        setDashboardHeading(currentMainDashboard ? currentMainDashboard.name : '', detailPageLabel(detail, where.search), '', true);
    }
}
setInterval(followDashboardFrame, 400);
document.getElementById('dashboard-frame').addEventListener('load', followDashboardFrame);

function dashboardBack() {
    // Only from a detail page: on a drawer dashboard there is nothing to go back to
    // inside the frame, and history.back() would leave OneTouch's page instead
    if (document.getElementById('dashboard-back').hidden) return;
    document.getElementById('dashboard-frame').contentWindow.history.back();
}

// Opens or closes the drawer (no argument: the opposite of now)
function toggleDashboardDrawer(open) {
    const drawer = document.getElementById('dashboard-drawer');
    const toggle = document.getElementById('dashboard-drawer-toggle');
    const willOpen = typeof open === 'boolean' ? open : !drawer.classList.contains('open');
    drawer.classList.toggle('open', willOpen);
    document.getElementById('dashboard-backdrop').classList.toggle('open', willOpen);
    toggle.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
        (drawer.querySelector('.dashboard-choice.active') || drawer.querySelector('.dashboard-choice'))?.focus();
    } else if (drawer.contains(document.activeElement)) {
        toggle.focus();
    }
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('dashboard-drawer').classList.contains('open')) {
        toggleDashboardDrawer(false);
    }
});

// Asynchronous Chat Workflow Engine
async function sendPrompt() {
    const inputField = document.getElementById('user-prompt');
    const chatLog = document.getElementById('chat-log');
    const userPromptText = inputField.value.trim();
    console.log("User Prompt Text:", userPromptText);

    if (!userPromptText) return;

    // Append User message node to DOM bubble UI
    appendMessage('user-msg', userPromptText);
    inputField.value = '';

    // Append standard generic loading sequence notification
    const loadingId = appendMessage('ai-msg', '🤖 Thinking and querying Cube.dev...');

               try {
        // 🎯 FIX: Explicitly relative route path
        const response = await fetch(`${API_BASE}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ userPrompt: userPromptText })
        });

        console.log("THIS IS THE RESPONSE FROM THE SERVER:", response.status, response.statusText);

        if (handleUnauthorized(response)) {
            document.getElementById(loadingId).remove();
            return;
        }

        const data = await response.json();


        document.getElementById(loadingId).remove(); // Clear loading block

        if (data.memoryReset) {
            appendMessage('system-msg', 'This conversation got long, so Claude started fresh. Earlier questions are no longer remembered.');
        }

        if (data.error) {
            appendMessage('ai-msg', `❌ Error: ${data.error}`);
            return;
        }

        // Clarification or unsupported question: show the explanation only
        if (data.intent === 'clarify' || data.intent === 'unsupported') {
            appendMessage('ai-msg', `🙋 ${escapeHtml(data.message || 'I need a little more detail to run that.')}`);
            return;
        }

        // Normal query: restate what was fetched, show the rows as a table,
        // and tuck the assumptions into a collapsible note underneath
        let html = `<div class="result-title">${escapeHtml(data.message || 'Here is what I found:')}</div>`;
        // Nothing found anywhere: the server's explanation replaces the empty tables
        const explanationHtml = data.explanation
            ? `<div class="result-explanation">${escapeHtml(data.explanation)}</div>` : '';
        if (data.explanation && data.allEmpty) {
            html += explanationHtml;
        } else if (data.combined) {
            // Counts across several ticket types: one table, one column per type
            html += renderCombined(data.combined);
        } else if (data.sections && data.sections.length > 1) {
            // Lists across several ticket types: one titled table per type
            html += data.sections.map(s =>
                `<div class="section-title">${escapeHtml(capitalize(nounFor(s.entity, 2)))}</div>` +
                renderResults(s.rows, s.entity)
            ).join('');
        } else {
            html += renderResults(data.results || [], data.entity);
        }
        // Some ticket types found nothing: explain those under the tables
        if (data.explanation && !data.allEmpty) html += explanationHtml;

        if (data.assumptions && data.assumptions.length > 0) {
            html += `<details class="assumptions"><summary>How I read your question</summary><ul>` +
                data.assumptions.map(a => `<li>${escapeHtml(a)}</li>`).join('') +
                `</ul></details>`;
        }

        // Offer the same tables as a download in any of the export formats
        const tables = buildExportTables(data);
        if (tables.length) {
            html += downloadBarHtml(registerExport({
                title: data.message || 'One Touch results',
                question: userPromptText,
                tables,
            }));
        }

        appendMessage('ai-msg wide', html);

    } catch (err) {
        document.getElementById(loadingId).remove();
        appendMessage('ai-msg', `❌ Could not talk to backend server orchestration framework.`);
        console.error(err);
    }
}

// Escape text that came from the server or the model before inserting as HTML
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// =====================================================================
// RESULT RENDERING: rows from Cube -> readable table in plain English
// =====================================================================

// What one row of each table is called, for count headers and summaries
const ENTITY_NOUNS = {
    incident: ['incident', 'incidents'],
    change_request: ['change', 'changes'],
    change_approvals: ['change approval', 'change approvals'],
    sc_req_item: ['request', 'requests'],
    ritm_approvals: ['request approval', 'request approvals'],
    sc_task: ['task', 'tasks'],
};

// Column names that read badly when simply title-cased
const COLUMN_LABELS = {
    number: 'Ticket',
    short_description: 'Summary',
    description: 'Full Description',
    assignment_group: 'Assigned Team',
    owner_group: 'Owning Team',
    assigned_to: 'Assigned To',
    opened_by_group: 'Opened By Team',
    configuration_item: 'Server / System',
    contact_type: 'Reported Via',
    reassignment_count: 'Times Reassigned',
    reopen_count: 'Times Reopened',
    caused_by_change: 'Caused By Change',
    was_p1: 'Was Ever P1',
    on_hold_reason: 'On Hold Because',
    close_code: 'Close Result',
    close_notes: 'Close Notes',
    cause_code: 'Cause',
    sub_type: 'Change Category',
    type: 'Change Type',
    planned_start_date: 'Planned Start',
    planned_end_date: 'Planned End',
    planned_start_month: 'Planned Start Month',
    outage: 'Planned Outage',
    sap_impact: 'Affects SAP',
    sap_transport_required: 'SAP Transport Needed',
    process_failure: 'Process Failure',
    brewery: 'Brewery Change',
    brewery_locations: 'Breweries Affected',
    item: 'Catalog Item',
    requested_for: 'Requested For',
    opened_by: 'Opened By',
    request: 'Parent Order (REQ)',
    request_item: 'Parent Request (RITM)',
    parent: 'Parent Ticket',
    sla_flag: 'SLA Breached',
    active: 'Still Active',
    fulfilled_time: 'Fulfilled',
    kb_article: 'Knowledge Article',
    created_day: 'Day Created',
    created_week: 'Week Created',
    created_month: 'Month Created',
    opened_day: 'Day Opened',
    opened_week: 'Week Opened',
    opened_month: 'Month Opened',
    resolved_day: 'Day Resolved',
    resolved_month: 'Month Resolved',
    closed_day: 'Day Closed',
    closed_month: 'Month Closed',
};

// Columns whose values are long free text: shortened in tables, full on hover
const LONG_TEXT = new Set(['short_description', 'description', 'close_notes', 'work_notes',
    'comments_and_work_notes', 'additional_comments', 'change_plan', 'backout_plan',
    'verification_plan', 'purpose_of_change', 'approval_history']);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

function splitMember(member) {
    const dot = member.indexOf('.');
    return { cube: member.slice(0, dot), column: member.slice(dot + 1) };
}

function columnLabel(member) {
    const { cube, column } = splitMember(member);
    if (column === 'count') {
        const noun = (ENTITY_NOUNS[cube] || ['record', 'records'])[1];
        return `Number of ${noun[0].toUpperCase()}${noun.slice(1)}`;
    }
    if (COLUMN_LABELS[column]) return COLUMN_LABELS[column];
    return column.split('_')
        .map(w => ['sla', 'sap', 'ci', 'kb', 'id'].includes(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))
        .join(' ');
}

function formatValue(member, raw) {
    const { column } = splitMember(member);
    if (raw === null || raw === undefined || raw === '') return '—';
    const v = String(raw);

    if (column === 'count') return Number(v).toLocaleString();
    if (v === 'true') return 'Yes';
    if (v === 'false') return 'No';

    // "2026-08-14 08:44:55" -> "Aug 14, 2026, 8:44 AM"
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (m) {
        const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    // "2026-08-14" -> "Aug 14, 2026"
    m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    // "2026-08" -> "August 2026"
    m = v.match(/^(\d{4})-(\d{2})$/);
    if (m) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
    // "2026-W33" -> "Week 33 of 2026"
    m = v.match(/^(\d{4})-W(\d{2})$/);
    if (m) return `Week ${+m[2]} of ${m[1]}`;

    return v;
}

// One table cell; long text is cut short with the full value on hover
function cellHtml(member, raw, truncate) {
    const { column } = splitMember(member);
    const text = formatValue(member, raw);
    const isNumber = column === 'count';
    const cls = isNumber ? ' class="num"' : '';
    if (truncate && LONG_TEXT.has(column) && text.length > 120) {
        return `<td${cls} title="${escapeHtml(text)}">${escapeHtml(text.slice(0, 117))}…</td>`;
    }
    return `<td${cls}>${escapeHtml(text)}</td>`;
}

function renderResults(rows, entity) {
    if (!rows.length) {
        return `<p class="result-empty">No matching records were found for that question.</p>`;
    }
    const columns = Object.keys(rows[0]);
    const [singular, plural] = ENTITY_NOUNS[entity] || ['record', 'records'];

    // A single number ("how many open P1s") reads best as a sentence
    if (rows.length === 1 && columns.length === 1 && columns[0].endsWith('.count')) {
        const n = Number(rows[0][columns[0]]);
        return `<div class="result-big">${n.toLocaleString()} <span>${n === 1 ? singular : plural}</span></div>`;
    }

    // A single record with many fields (ticket lookup) reads best as a field/value card
    if (rows.length === 1 && columns.length > 4) {
        const body = columns.map(c => {
            const { column } = splitMember(c);
            const text = formatValue(c, rows[0][c]);
            const cls = LONG_TEXT.has(column) ? ' class="long"' : '';
            return `<tr><th>${escapeHtml(columnLabel(c))}</th><td${cls}>${escapeHtml(text)}</td></tr>`;
        }).join('');
        return `<div class="table-wrap"><table class="result-table detail"><tbody>${body}</tbody></table></div>`;
    }

    // Everything else: a normal table with a header row
    const head = columns.map(c => {
        const cls = c.endsWith('.count') ? ' class="num"' : '';
        return `<th${cls}>${escapeHtml(columnLabel(c))}</th>`;
    }).join('');
    const body = rows.map(r => `<tr>${columns.map(c => cellHtml(c, r[c], true)).join('')}</tr>`).join('');
    const caption = `${rows.length.toLocaleString()} ${rows.length === 1 ? 'row' : 'rows'}`;

    return `<div class="result-caption">${caption}</div>` +
        `<div class="table-wrap"><table class="result-table"><thead><tr>${head}</tr></thead>` +
        `<tbody>${body}</tbody></table></div>`;
}

function nounFor(entity, n) {
    const [singular, plural] = ENTITY_NOUNS[entity] || ['record', 'records'];
    return n === 1 ? singular : plural;
}

function capitalize(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Counts merged across ticket types (see combineResults in business_logic.mjs)
function renderCombined(combined) {
    const { dimension, entities, rows, totals } = combined;
    if (!rows.length) {
        return `<p class="result-empty">No matching tickets were found for that question.</p>`;
    }

    // No grouping: one row per ticket type, then the grand total
    if (!dimension) {
        const body = entities.map(e =>
            `<tr><td>${escapeHtml(capitalize(nounFor(e, 2)))}</td><td class="num">${(totals.counts[e] || 0).toLocaleString()}</td></tr>`
        ).join('');
        return `<div class="result-big">${totals.total.toLocaleString()} <span>${totals.total === 1 ? 'ticket' : 'tickets'}</span></div>` +
            `<div class="table-wrap"><table class="result-table"><thead><tr><th>Ticket Type</th><th class="num">Number of Tickets</th></tr></thead>` +
            `<tbody>${body}</tbody><tfoot><tr><td>Total</td><td class="num">${totals.total.toLocaleString()}</td></tr></tfoot></table></div>`;
    }

    // Grouped: the grouping column, one column per ticket type, and a total
    const typeHeads = entities.map(e => `<th class="num">${escapeHtml(capitalize(nounFor(e, 2)))}</th>`).join('');
    const head = `<th>${escapeHtml(columnLabel(dimension))}</th>${typeHeads}<th class="num">Total</th>`;
    const cell = n => `<td class="num">${n ? n.toLocaleString() : '—'}</td>`;
    const body = rows.map(r =>
        `<tr><td>${escapeHtml(formatValue(dimension, r.key))}</td>${entities.map(e => cell(r.counts[e])).join('')}` +
        `<td class="num total">${r.total.toLocaleString()}</td></tr>`
    ).join('');
    const foot = `<tr><td>Total</td>${entities.map(e => cell(totals.counts[e])).join('')}<td class="num">${totals.total.toLocaleString()}</td></tr>`;

    return `<div class="result-caption">${rows.length.toLocaleString()} ${rows.length === 1 ? 'row' : 'rows'}</div>` +
        `<div class="table-wrap"><table class="result-table"><thead><tr>${head}</tr></thead>` +
        `<tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

// =====================================================================
// DOWNLOADS: the tables above -> PDF, Word, Excel, CSV, text, RTF or an archive
// =====================================================================

// Download payloads waiting for a click, keyed by the id of their download bar
const exportPayloads = new Map();
let exportCounter = 0;

function registerExport(payload) {
    const id = 'export-' + (++exportCounter);
    exportPayloads.set(id, payload);
    return id;
}

// Values as the user reads them, except counts stay real numbers so
// spreadsheets can sum them, and empty cells stay empty instead of "—"
function exportValue(member, raw) {
    if (raw === null || raw === undefined || raw === '') return '';
    if (splitMember(member).column === 'count') return Number(raw);
    return formatValue(member, raw);
}

// One result table in the export shape (mirrors renderResults, without truncation)
function exportTableFromRows(rows, title) {
    if (!rows || !rows.length) return null;
    const columns = Object.keys(rows[0]);

    // A single record is shown as a field/value card, so export it that way too
    if (rows.length === 1 && columns.length > 4) {
        return {
            title,
            columns: [{ label: 'Field' }, { label: 'Value' }],
            rows: columns.map(c => [columnLabel(c), String(exportValue(c, rows[0][c]))]),
            footer: null,
        };
    }
    return {
        title,
        columns: columns.map(c => ({ label: columnLabel(c), num: c.endsWith('.count') })),
        rows: rows.map(r => columns.map(c => exportValue(c, r[c]))),
        footer: null,
    };
}

// Mirrors renderCombined: one column per ticket type plus a total
function exportTableFromCombined(combined) {
    const { dimension, entities, rows, totals } = combined;
    if (!rows.length) return null;
    const typeLabel = e => capitalize(nounFor(e, 2));

    if (!dimension) {
        return {
            title: null,
            columns: [{ label: 'Ticket Type' }, { label: 'Number of Tickets', num: true }],
            rows: entities.map(e => [typeLabel(e), totals.counts[e] || 0]),
            footer: ['Total', totals.total],
        };
    }
    return {
        title: null,
        columns: [
            { label: columnLabel(dimension) },
            ...entities.map(e => ({ label: typeLabel(e), num: true })),
            { label: 'Total', num: true },
        ],
        rows: rows.map(r => [formatValue(dimension, r.key), ...entities.map(e => r.counts[e] || 0), r.total]),
        footer: ['Total', ...entities.map(e => totals.counts[e] || 0), totals.total],
    };
}

function buildExportTables(data) {
    let tables;
    if (data.combined) {
        tables = [exportTableFromCombined(data.combined)];
    } else if (data.sections && data.sections.length > 1) {
        tables = data.sections.map(s => exportTableFromRows(s.rows, capitalize(nounFor(s.entity, 2))));
    } else {
        tables = [exportTableFromRows(data.results || [], null)];
    }
    return tables.filter(Boolean);
}

const EXPORT_OPTIONS = [
    ['Documents', [
        ['xlsx', 'Excel (.xlsx)'],
        ['csv', 'CSV (.csv)'],
        ['pdf', 'PDF (.pdf)'],
        ['docx', 'Word (.docx)'],
        ['rtf', 'Rich Text (.rtf)'],
        ['txt', 'Plain Text (.txt)'],
    ]],
    ['Archives (all formats above in one file)', [
        ['zip', 'ZIP (.zip)'],
        ['7z', '7-Zip (.7z)'],
    ]],
];

function downloadBarHtml(exportId) {
    const options = EXPORT_OPTIONS.map(([group, items]) =>
        `<optgroup label="${escapeHtml(group)}">` +
        items.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('') +
        `</optgroup>`
    ).join('');
    return `<div class="download-bar" id="${exportId}">` +
        `<label for="${exportId}-format">Download as</label>` +
        `<select id="${exportId}-format">${options}</select>` +
        `<button type="button" onclick="downloadExport('${exportId}')">⬇ Download</button>` +
        `<span class="download-status" role="status"></span>` +
        `</div>`;
}

async function downloadExport(exportId) {
    const payload = exportPayloads.get(exportId);
    const bar = document.getElementById(exportId);
    if (!payload || !bar) return;

    const format = bar.querySelector('select').value;
    const button = bar.querySelector('button');
    const status = bar.querySelector('.download-status');
    button.disabled = true;
    status.className = 'download-status';
    status.textContent = `Preparing ${format.toUpperCase()} file…`;

    try {
        const response = await fetch(`${API_BASE}/api/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ ...payload, format }),
        });
        if (handleUnauthorized(response)) {
            status.textContent = '';
            return;
        }
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `The server answered ${response.status}.`);
        }

        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/);
        const fileName = match ? match[1] : `one-touch-export.${format}`;

        // Hand the file to the browser through a temporary link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        status.textContent = `Downloaded ${fileName}`;
    } catch (err) {
        status.className = 'download-status error';
        status.textContent = `❌ ${err.message}`;
        console.error(err);
    } finally {
        button.disabled = false;
    }
}

// Element Node Builder Helper
let messageCounter = 0;
function appendMessage(cssClass, text) {
    const chatLog = document.getElementById('chat-log');
    const msgBlock = document.createElement('div');
    // A counter, not Date.now(): two messages added in the same millisecond
    // would share an id and the loading bubble could remove the wrong one
    const uniqueId = 'msg-' + (++messageCounter);
    
    msgBlock.id = uniqueId;
    msgBlock.className = `msg ${cssClass}`;
    msgBlock.innerHTML = text;
    
    chatLog.appendChild(msgBlock);
    chatLog.scrollTop = chatLog.scrollHeight; // Keep log automatically scrolled to bottom
    return uniqueId;
}
```

<a id="b28"></a>
### B.28 `public/site.webmanifest`

```json
{"name":"One Touch","short_name":"One Touch","icons":[{"src":"android-chrome-192x192.png","sizes":"192x192","type":"image/png"},{"src":"android-chrome-512x512.png","sizes":"512x512","type":"image/png"}],"theme_color":"#ffffff","background_color":"#ffffff","display":"standalone"}
```

<a id="b29"></a>
### B.29 `onetouchsso.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OneTouch SSO</title>
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="shortcut icon" type="image/x-icon" href="favicon.ico">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<img src="molsoncoorslogo.png" type="png" alt="Molson Coors" href="/molsoncoorslogo.png" padding="10px">
<main class="box">
<img src="favicon-32x32.png" type="png" sizes="32x32" href="/favicon-32x32.png">
  <h1>Sign in to OneTouch</h1>
  <p class="sub">Enter your Molson Coors Email</p>
  <form onsubmit="event.preventDefault()">
    <label for="team">Molson Coors Email</label>
    <div class="combo">
      <input id="team" type="text" placeholder="your-email" autocomplete="organization" required
             spellcheck="false" autocapitalize="off">
      <span class="suffix">@molsoncoors.com</span>
    </div>
       <div class="combo">
      <input id="team" type="text" placeholder="your-password" autocomplete="current-password" required
             spellcheck="false" autocapitalize="off">
    </div>
    <button class="btn" type="submit" style="margin-top:20px" onclick="location.href='vperez-stars.github.io/datatool/database';">Continue with SSO</button>
  </form>
  <div class="or"><span>or use</span></div>
  <div class="provs">
    <button class="prov" type="button"><img src="microsoftlogo.png" alt="Microsoft" height="24" width="24"> Microsoft Entra ID</button>
  </div>
  <p class="foot">Forgot your email or password? <a href="#">Contact Support</a></p>
</main>

</body>
</html>
```

<a id="b30"></a>
### B.30 `styles2.css`

```css
:root {
  --brand: #4f46e5;
  --ink: #111827;
  --muted: #6b7280;
  --line: #e5e7eb;
  --bad: #dc2626;
  --ok: #15803d;
}

/* ------------------------------
   Base / Reset
------------------------------ */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  min-height: 100vh;
  color: var(--ink);
  background: #fff;
  -webkit-text-size-adjust: 100%;
}

a {
  color: var(--brand);
  text-decoration: none;
  font-weight: 600;
}

a:hover {
  text-decoration: underline;
}

input,
select,
button {
  font: inherit;
}

:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

/* ------------------------------
   Page Layout / Branding
------------------------------ */
body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  place-items: start center;
  padding-top: 0;
  padding-bottom: 28px;
  min-height: 100vh;
  background: #718aee;
}

img[src="molsoncoorslogo.png"] {
  display: block;
  margin-top: 48px;
  margin-bottom: 0;
  padding: 0;
}

/* ------------------------------
   Sign-in Card
------------------------------ */
.box {
  width: 100%;
  max-width: 430px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 38px 34px;
  box-shadow: 0 10px 34px rgba(17, 24, 39, .06);
}

/* ------------------------------
   Typography
------------------------------ */
.mark {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--brand);
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
  margin-bottom: 22px;
}

h1 {
  font-size: 1.4rem;
  letter-spacing: -.02em;
  margin-bottom: 7px;
}

.sub {
  color: var(--muted);
  font-size: .93rem;
  line-height: 1.6;
  margin-bottom: 26px;
}

label {
  display: block;
  font-size: .85rem;
  font-weight: 600;
  margin-bottom: 6px;
}

/* ------------------------------
   Form Fields / Inputs
------------------------------ */
.field {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: .95rem;
  transition: border-color .15s, box-shadow .15s;
  background: #fff;
  color: inherit;
}

.field:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, .15);
}

.combo {
  display: flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color .15s, box-shadow .15s;
  background: #fff;
}

.combo:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, .15);
}

.combo input {
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 12px 4px 12px 14px;
  font-size: .95rem;
  background: none;
}

.combo input:focus {
  outline: none;
}

.combo .suffix {
  padding: 12px 14px 12px 2px;
  color: var(--muted);
  font-size: .95rem;
  white-space: nowrap;
  background: #f5f6fa;
  align-self: stretch;
  display: flex;
  align-items: center;
  border-left: 1px solid var(--line);
}

/* ------------------------------
   CTA Buttons / Providers
------------------------------ */
.btn {
  width: 100%;
  padding: 13px;
  border: 0;
  border-radius: 10px;
  background: var(--brand);
  color: #fff;
  font-size: .97rem;
  font-weight: 700;
  cursor: pointer;
  transition: background .15s;
}

.btn:hover {
  background: #4338ca;
}

.provs {
  display: grid;
  gap: 9px;
  margin: 24px 0 0;
}

.prov {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: #fff;
  font-size: .92rem;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  transition: background .15s, border-color .15s;
}

.prov:hover {
  background: #f5f6fa;
  border-color: #cbd0dd;
}

.prov .ic {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: .68rem;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
}

/* ------------------------------
   Divider / Footer
------------------------------ */
.or {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 24px 0 4px;
  color: var(--muted);
  font-size: .8rem;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.or::before,
.or::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line);
}

/* ------------------------------
   Responsive / Accessibility
------------------------------ */
@media (max-width: 400px) {
  .combo .suffix {
    font-size: .85rem;
    padding-left: 6px;
    padding-right: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
}

/* ------------------------------
   Database Page Styles
------------------------------ */
body.database-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  background: #718aee;
  padding: 0 0 28px;
  color: #1a2233;
}

.database-branding {
  width: 100%;
  display: flex;
  justify-content: center;
  padding-top: 18px;
}

.database-logo {
  display: block;
  width: auto;
  max-width: 320px;
  height: auto;
  margin: 0;
}

.database-wrap {
  width: 100%;
  max-width: 820px;
  background: #fff;
  border: 1px solid #e6eaf1;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 14px 34px -18px rgba(20, 28, 45, .16);
}

.database-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.database-top h1 {
  font-size: 1.05rem;
  letter-spacing: -.01em;
  margin: 0;
}

.database-top h1 span {
  color: #8a94a8;
  font-weight: 500;
  font-size: .85rem;
  margin-left: 8px;
}

input[type="search"] {
  padding: 9px 14px;
  border: 1px solid #d6dce7;
  border-radius: 10px;
  font-size: .88rem;
  width: 230px;
  transition: border-color .15s, box-shadow .15s;
}

input[type="search"]:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, .14);
}

.database-table {
  width: 100%;
  border-collapse: collapse;
  font-size: .88rem;
}

.database-table th {
  text-align: left;
  font-size: .73rem;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: #67718a;
  padding: 11px 14px;
  border-bottom: 2px solid #eef1f7;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.database-table th:hover {
  color: #1a2233;
}

.database-table th .dir {
  opacity: .45;
  margin-left: 5px;
  font-size: .7rem;
}

.database-table th.on .dir {
  opacity: 1;
  color: #3b82f6;
}

.database-table td {
  padding: 12px 14px;
  border-bottom: 1px solid #f1f4f9;
}

.database-table tbody tr:hover {
  background: #f8fafd;
}

.database-who {
  font-weight: 600;
}

.database-who small {
  display: block;
  font-weight: 400;
  color: #8a94a8;
}

.database-badge {
  font-size: .72rem;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
}

.database-badge.Paid {
  background: #e7f8ee;
  color: #177a45;
}

.database-badge.Pending {
  background: #fff4e0;
  color: #9a6a12;
}

.database-badge.Overdue {
  background: #fdeaea;
  color: #b42323;
}

.database-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
  font-size: .82rem;
  color: #67718a;
  flex-wrap: wrap;
  gap: 12px;
}

.database-pages {
  display: flex;
  gap: 6px;
}

.database-pages button {
  min-width: 32px;
  height: 32px;
  border: 1px solid #d6dce7;
  background: #fff;
  border-radius: 8px;
  font-size: .82rem;
  font-weight: 600;
  color: #3c4658;
  cursor: pointer;
  transition: background .15s;
}

.database-pages button:hover {
  background: #f1f5fb;
}

.database-pages button.cur {
  background: #1a2233;
  border-color: #1a2233;
  color: #fff;
}

.database-pages button:disabled {
  opacity: .4;
  cursor: default;
}

```

<a id="b31"></a>
### B.31 `scripts/metabase-setup.mjs`

```js
// Sets up Metabase for OneTouch, through Metabase's API:
//   1. the admin account (first run only; METABASE_ADMIN_EMAIL / _PASSWORD in .env)
//   2. the connection to the reporting views, as the read-only metabase_reader role
//   3. the ITIL dashboards defined in DASHBOARDS below (overview, sites, service
//      desk, problems, monitoring, workload, change, change risk, requests,
//      automation), rebuilt from scratch on every run inside the "OneTouch ITIL"
//      collection
//   4. public links for them, saved to metabase-dashboards.json, which the
//      OneTouch Dashboards tab reads (its drawer groups them by `group`)
//
// Safe to re-run (e.g. after changing a chart below):
//   docker exec analytics_node_app node scripts/metabase-setup.mjs

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const MB = (process.env.METABASE_URL || 'http://metabase:3000').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD;
const READER_PASSWORD = process.env.METABASE_DB_PASSWORD;
const DB_NAME = 'ServiceNow (OneTouch reporting)';
const COLLECTION_NAME = 'OneTouch ITIL';
const OUTPUT_FILE = 'metabase-dashboards.json';

// ---------------------------------------------------------------------
// The dashboards. Every chart is a SQL query against the reporting views
// (db/reporting-views.sql). Layout: Metabase's grid is 24 columns wide.
// ---------------------------------------------------------------------

const SCALAR = { display: 'scalar', w: 6, h: 3 };
// Last value with the change vs. the one before (rows: date, number; oldest first)
const TREND = { display: 'smartscalar', w: 6, h: 4 };
const line = (x, ...ys) => ({ display: 'line', w: 12, h: 7, viz: { 'graph.dimensions': [x], 'graph.metrics': ys } });
// One line per value of `series` (rows: x, series, y)
const lines = (x, series, y) => ({ display: 'line', w: 12, h: 7, viz: { 'graph.dimensions': [x, series], 'graph.metrics': [y] } });
const bar = (x, ...ys) => ({ display: 'bar', w: 12, h: 7, viz: { 'graph.dimensions': [x], 'graph.metrics': ys } });
const stacked = (x, series, y) => ({ display: 'bar', w: 12, h: 7, viz: { 'graph.dimensions': [x, series], 'graph.metrics': [y], 'stackable.stack_type': 'stacked' } });
const row = (x, y) => ({ display: 'row', w: 12, h: 7, viz: { 'graph.dimensions': [x], 'graph.metrics': [y] } });
const pie = (x, y) => ({ display: 'pie', w: 12, h: 7, viz: { 'pie.dimension': x, 'pie.metric': y } });
const table = (w = 24, h = 7) => ({ display: 'table', w, h });

// Only weeks (or days) that the export covers completely: the first and last
// are partial and would look like a sudden collapse. Arguments: the view, the
// date column that starts it, and the period ('week' or 'day').
const fullPeriods = (view, col, unit = 'week') => `
full_periods AS (
  SELECT date_trunc('${unit}', min(${col})) + interval '1 ${unit}' AS first_period,
         date_trunc('${unit}', (SELECT as_of FROM reporting.data_as_of)) AS end_period
  FROM reporting.${view}
)`;
const inFullPeriods = expr => `${expr} >= (SELECT first_period FROM full_periods) AND ${expr} < (SELECT end_period FROM full_periods)`;

// Catalog items that start, stop or snooze servers
const SERVER_POWER_ITEMS = `('Virtual Server - Start', 'Virtual Server - Stop', 'Start and Snooze Applications/Servers')`;
const ACCOUNT_SUBCATEGORIES = `('Password Reset', 'Account Locked', 'Password Expired', 'Account Disabled')`;

// Open incidents, requests and catalog tasks bucketed by age, for stacking
const OPEN_WORK_BY_AGE = `
WITH open_items AS (
  SELECT 'Incidents' AS type, age_days FROM reporting.incidents WHERE is_open
  UNION ALL SELECT 'Requests', age_days FROM reporting.requests WHERE is_open
  UNION ALL SELECT 'Catalog tasks', age_days FROM reporting.catalog_tasks WHERE is_open
),
bucketed AS (
  SELECT type, CASE WHEN age_days < 1 THEN 1 WHEN age_days < 3 THEN 2 WHEN age_days < 7 THEN 3
                    WHEN age_days < 30 THEN 4 ELSE 5 END AS bucket
  FROM open_items
)
SELECT (ARRAY['Under 1 day', '1-3 days', '3-7 days', '7-30 days', 'Over 30 days'])[bucket] AS "Age",
       type AS "Type", count(*) AS "Open items"
FROM bucketed GROUP BY bucket, type ORDER BY bucket, type`;

// Incidents, changes and requests per week on one chart. Each starts at its
// own first complete week (incidents only begin on 5 July).
const WEEKLY_VOLUME = `
WITH first_full AS (
  SELECT (SELECT date_trunc('week', min(created_at)) + interval '1 week' FROM reporting.incidents) AS incidents,
         (SELECT date_trunc('week', min(created_at)) + interval '1 week' FROM reporting.changes) AS changes,
         (SELECT date_trunc('week', min(opened_at)) + interval '1 week' FROM reporting.requests) AS requests,
         (SELECT date_trunc('week', as_of) FROM reporting.data_as_of) AS end_week
),
weeks AS (
  SELECT generate_series(least(incidents, changes, requests), end_week - interval '1 week', interval '1 week') AS week
  FROM first_full
),
inc AS (SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM reporting.incidents GROUP BY 1),
chg AS (SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM reporting.changes GROUP BY 1),
req AS (SELECT date_trunc('week', opened_at) AS week, count(*) AS n FROM reporting.requests GROUP BY 1)
SELECT w.week::date AS "Week",
       CASE WHEN w.week >= f.incidents THEN coalesce(inc.n, 0) END AS "Incidents",
       CASE WHEN w.week >= f.changes THEN coalesce(chg.n, 0) END AS "Changes",
       CASE WHEN w.week >= f.requests THEN coalesce(req.n, 0) END AS "Requests"
FROM weeks w CROSS JOIN first_full f
LEFT JOIN inc ON inc.week = w.week
LEFT JOIN chg ON chg.week = w.week
LEFT JOIN req ON req.week = w.week
ORDER BY 1`;

// "Opened per week" for a trend card: complete weeks only, oldest first
const weeklyTrend = (view, col, label, where = 'true') => `
WITH ${fullPeriods(view, col)}
SELECT date_trunc('week', ${col})::date AS "Week", count(*) FILTER (WHERE ${where}) AS "${label}"
FROM reporting.${view} WHERE ${inFullPeriods(`date_trunc('week', ${col})`)}
GROUP BY 1 ORDER BY 1`;

const WEEKLY_INCIDENTS = `
WITH ${fullPeriods('incidents', 'created_at')},
     opened AS (SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM reporting.incidents GROUP BY 1),
     resolved AS (SELECT date_trunc('week', resolved_at) AS week, count(*) AS n FROM reporting.incidents WHERE resolved_at IS NOT NULL GROUP BY 1)
SELECT coalesce(o.week, r.week)::date AS "Week", coalesce(o.n, 0) AS "Opened", coalesce(r.n, 0) AS "Resolved"
FROM opened o FULL JOIN resolved r ON o.week = r.week
WHERE ${inFullPeriods('coalesce(o.week, r.week)')} ORDER BY 1`;

// ---------------------------------------------------------------------
// DRILL-DOWN: what a click opens. A card's `click` applies to its bars,
// slices, points or number; a table's `links` applies per column. Each
// opens a detail dashboard (DETAILS, further down) with its filters set to
// the clicked row's values (col('Column')) or to fixed text.
// ---------------------------------------------------------------------

const col = name => ({ col: name });
const go = (to, params = {}) => ({ to, params });
const toIncident = c => go('incident-detail', { number: col(c) });
const toChange = c => go('change-detail', { number: col(c) });
const toRequest = c => go('request-detail', { number: col(c) });
const toTeam = c => go('team-detail', { team: col(c) });
const toSystem = c => go('system-detail', { system: col(c) });
const toSite = c => go('site-detail', { site: col(c) });
const toProblem = c => go('problem-detail', { problem: col(c) });
const toItem = c => go('item-detail', { item: col(c) });

// In the order they appear in OneTouch's drawer, under their `group` heading
const DASHBOARDS = [
  {
    key: 'overview',
    group: 'Overview',
    name: 'IT Operations Overview',
    description: 'The latest complete week at a glance across incidents, changes and requests.',
    cards: [
      { name: 'Incidents opened per week', ...TREND, sql: weeklyTrend('incidents', 'created_at', 'Incidents opened'),
        description: 'The latest complete week, compared with the week before.' },
      { name: 'Changes raised per week', ...TREND, sql: weeklyTrend('changes', 'created_at', 'Changes raised'),
        description: 'The latest complete week, compared with the week before.' },
      { name: 'Requests opened per week', ...TREND, sql: weeklyTrend('requests', 'opened_at', 'Requests opened'),
        description: 'The latest complete week, compared with the week before.' },
      { name: 'SLA breaches per week', click: go('task-list', { sla: 'Breached' }), ...TREND, sql: weeklyTrend('catalog_tasks', 'created_at', 'SLA breaches', 'sla_breached'),
        // Fewer breaches is good: show a drop in green, a rise in red
        viz: { 'scalar.switch_positive_negative': true },
        description: 'Catalog tasks that breached their SLA, by the week they were created; latest complete week vs. the one before.' },

      { name: 'Open incidents', click: go('incident-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open incidents" FROM reporting.incidents WHERE is_open` },
      { name: 'Open requests', click: go('request-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open requests" FROM reporting.requests WHERE is_open` },
      { name: 'Open catalog tasks', click: go('task-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open catalog tasks" FROM reporting.catalog_tasks WHERE is_open` },
      { name: 'Changes awaiting approval', click: go('change-list', { status: 'Open', approval: 'Requested' }), ...SCALAR, sql: `SELECT count(*) AS "Changes awaiting approval" FROM reporting.changes WHERE is_open AND approval = 'Requested'` },

      { name: 'Weekly volume: incidents, changes and requests', ...line('Week', 'Incidents', 'Changes', 'Requests'), sql: WEEKLY_VOLUME,
        description: 'Complete weeks only. Incidents in this export start on 5 July 2026, so their line starts later.' },
      { name: 'Open work by age', ...stacked('Age', 'Type', 'Open items'), sql: OPEN_WORK_BY_AGE },

      { name: 'Teams with the most open work', links: { Team: toTeam('Team') }, ...table(24), sql: `
WITH inc AS (SELECT assignment_group AS team, count(*) AS n, max(age_days) AS oldest FROM reporting.incidents WHERE is_open GROUP BY 1),
     task AS (SELECT assignment_group AS team, count(*) AS n, max(age_days) AS oldest FROM reporting.catalog_tasks WHERE is_open GROUP BY 1)
SELECT coalesce(inc.team, task.team) AS "Team",
       coalesce(inc.n, 0) AS "Open incidents", coalesce(task.n, 0) AS "Open catalog tasks",
       coalesce(inc.n, 0) + coalesce(task.n, 0) AS "Total open",
       greatest(inc.oldest, task.oldest) AS "Oldest (days)"
FROM inc FULL JOIN task ON inc.team = task.team
ORDER BY 4 DESC LIMIT 15` },
    ],
  },
  {
    key: 'sites',
    group: 'Overview',
    name: 'Sites & Breweries',
    description: 'Where the work comes from: offices, breweries and cloud sites.',
    cards: [
      { name: 'Sites with incidents', ...SCALAR, sql: `SELECT count(DISTINCT nullif(location, '')) AS "Sites with incidents" FROM reporting.incidents` },
      { name: 'Incidents at breweries', ...SCALAR, sql: `SELECT count(*) AS "Incidents at breweries" FROM reporting.incidents WHERE location ILIKE '%brewery%'` },
      { name: 'Changes affecting breweries', click: go('change-list', { brewery: 'Yes' }), ...SCALAR, sql: `SELECT count(*) AS "Changes affecting breweries" FROM reporting.changes WHERE affects_brewery` },
      { name: 'Breweries touched by changes', ...SCALAR, sql: `SELECT count(DISTINCT brewery) AS "Breweries touched by changes" FROM reporting.change_breweries` },

      { name: 'Incidents by site (top 12)', click: toSite('Site'), ...row('Site', 'Incidents'), h: 8, sql: `
SELECT location AS "Site", count(*) AS "Incidents"
FROM reporting.incidents WHERE nullif(location, '') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },
      { name: 'Requests by site (top 12)', click: toSite('Site'), ...row('Site', 'Requests'), h: 8, sql: `
SELECT location AS "Site", count(*) AS "Requests"
FROM reporting.requests WHERE nullif(location, '') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },

      { name: 'Brewery scorecard', links: { Brewery: toSite('Brewery') }, ...table(24, 8), sql: `
WITH inc AS (SELECT location AS site, count(*) AS incidents, count(*) FILTER (WHERE is_open) AS open_incidents,
                    round(avg(hours_to_resolve), 1) AS avg_hours
             FROM reporting.incidents WHERE location ILIKE '%brewery%' GROUP BY 1),
     req AS (SELECT location AS site, count(*) AS requests FROM reporting.requests WHERE location ILIKE '%brewery%' GROUP BY 1),
     chg AS (SELECT brewery AS site, count(*) AS changes, count(*) FILTER (WHERE has_outage) AS outage_changes
             FROM reporting.change_breweries GROUP BY 1)
SELECT coalesce(inc.site, req.site, chg.site) AS "Brewery",
       coalesce(inc.incidents, 0) AS "Incidents", coalesce(inc.open_incidents, 0) AS "Open incidents",
       inc.avg_hours AS "Avg hours to resolve", coalesce(req.requests, 0) AS "Requests",
       coalesce(chg.changes, 0) AS "Changes", coalesce(chg.outage_changes, 0) AS "Changes with an outage"
FROM inc
FULL JOIN req ON req.site = inc.site
FULL JOIN chg ON chg.site = coalesce(inc.site, req.site)
ORDER BY coalesce(inc.incidents, 0) + coalesce(req.requests, 0) + coalesce(chg.changes, 0) DESC` },

      { name: 'Changes by brewery (top 12)', click: toSite('Brewery'), ...row('Brewery', 'Changes'), h: 8, sql: `
SELECT brewery AS "Brewery", count(*) AS "Changes" FROM reporting.change_breweries GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        description: 'A change that lists several breweries counts once for each.' },
      { name: 'Weekly incidents at the 5 busiest breweries', click: toSite('Brewery'), ...lines('Week', 'Brewery', 'Incidents'), h: 8, sql: `
WITH ${fullPeriods('incidents', 'created_at')},
     top AS (SELECT location FROM reporting.incidents WHERE location ILIKE '%brewery%' GROUP BY 1 ORDER BY count(*) DESC LIMIT 5)
SELECT date_trunc('week', i.created_at)::date AS "Week", i.location AS "Brewery", count(*) AS "Incidents"
FROM reporting.incidents i JOIN top USING (location)
WHERE ${inFullPeriods("date_trunc('week', i.created_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },

      { name: 'Brewery changes with an outage in the next 14 days', links: { Brewery: toSite('Brewery'), Change: toChange('Change') }, ...table(24), sql: `
SELECT b.brewery AS "Brewery", b.number AS "Change", b.planned_start AS "Planned start", b.type AS "Type", b.risk AS "Risk",
       CASE WHEN b.affects_sap THEN 'Yes' ELSE 'No' END AS "Affects SAP", b.state AS "State", b.short_description AS "Summary"
FROM reporting.change_breweries b CROSS JOIN reporting.data_as_of a
WHERE b.has_outage AND b.state <> 'Canceled'
  AND b.planned_start >= a.as_of AND b.planned_start < a.as_of + interval '14 days'
ORDER BY b.planned_start, b.brewery`,
        description: 'Measured from the newest record in the export (1 September 2026), not from today.' },
    ],
  },
  {
    key: 'service-desk',
    group: 'Incidents & Problems',
    name: 'Service Desk',
    description: 'Incident Management: backlog, flow, resolution time, routing and noise.',
    cards: [
      { name: 'Open incidents', click: go('incident-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open incidents" FROM reporting.incidents WHERE is_open` },
      { name: 'Open more than 7 days', click: go('incident-list', { status: 'Open', older_than: '7' }), ...SCALAR, sql: `SELECT count(*) AS "Open more than 7 days" FROM reporting.incidents WHERE is_open AND age_days >= 7` },
      { name: 'Average hours to resolve', ...SCALAR, sql: `SELECT round(avg(hours_to_resolve), 1) AS "Average hours to resolve" FROM reporting.incidents` },
      { name: 'Reassigned at least once (%)', click: go('incident-list', { reassigned: 'Yes' }), ...SCALAR, sql: `SELECT round(100.0 * avg(was_reassigned::int), 1) AS "Reassigned at least once (%)" FROM reporting.incidents` },

      { name: 'Opened vs. resolved per week', ...line('Week', 'Opened', 'Resolved'), sql: WEEKLY_INCIDENTS },
      { name: 'Open incidents by age', click: go('incident-list', { status: 'Open', age: col('Age') }), ...bar('Age', 'Open incidents'), sql: `
SELECT substr(age_bucket, 4) AS "Age", count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open GROUP BY age_bucket ORDER BY age_bucket` },

      { name: 'Average hours to resolve by priority', click: go('incident-list', { priority: col('Priority') }), ...bar('Priority', 'Average hours to resolve'), sql: `
SELECT priority AS "Priority", round(avg(hours_to_resolve), 1) AS "Average hours to resolve", count(*) AS "Incidents"
FROM reporting.incidents WHERE hours_to_resolve IS NOT NULL GROUP BY 1 ORDER BY 1` },
      { name: 'Open incidents by team (top 10)', click: toTeam('Team'), ...row('Team', 'Open incidents'), sql: `
SELECT assignment_group AS "Team", count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },

      { name: 'Monitoring alerts vs. people, per week', ...line('Week', 'Monitoring alerts', 'Raised by people'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week",
       count(*) FILTER (WHERE source = 'Monitoring alert') AS "Monitoring alerts",
       count(*) FILTER (WHERE source = 'Person') AS "Raised by people"
FROM reporting.incidents WHERE ${inFullPeriods("date_trunc('week', created_at)")} GROUP BY 1 ORDER BY 1` },
      { name: 'Ticket ping-pong: reassignment by team', links: { Team: toTeam('Team') }, ...table(12), sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents",
       round(100.0 * avg(was_reassigned::int), 1) AS "Reassigned (%)",
       count(*) FILTER (WHERE reassignment_count >= 3) AS "Reassigned 3+ times"
FROM reporting.incidents GROUP BY 1 HAVING count(*) >= 50 ORDER BY 3 DESC LIMIT 15` },

      { name: 'Problem candidates: systems with the most incidents', links: { 'Server / system': toSystem('Server / system') }, ...table(24), sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Incidents",
       count(*) FILTER (WHERE source = 'Monitoring alert') AS "From monitoring",
       count(*) FILTER (WHERE is_open) AS "Still open",
       mode() WITHIN GROUP (ORDER BY subcategory) AS "Most common subcategory",
       round(avg(hours_to_resolve), 1) AS "Avg hours to resolve"
FROM reporting.incidents WHERE coalesce(configuration_item, '') <> ''
GROUP BY 1 ORDER BY 2 DESC LIMIT 15` },
    ],
  },
  {
    key: 'problems',
    group: 'Incidents & Problems',
    name: 'Problems & Major Incidents',
    description: 'Problem Management: recurring issues, workarounds, knowledge articles and P1/P2 incidents.',
    cards: [
      { name: 'Incidents linked to a problem', ...SCALAR, sql: `SELECT count(problem) AS "Incidents linked to a problem" FROM reporting.incidents` },
      { name: 'Problem records with incidents', ...SCALAR, sql: `SELECT count(DISTINCT problem) AS "Problem records with incidents" FROM reporting.incidents` },
      { name: 'Closed with a workaround', click: go('incident-list', { workaround: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE closed_with_workaround) AS "Closed with a workaround" FROM reporting.incidents`,
        description: 'Workarounds point to an underlying problem that has not been fixed.' },
      { name: 'Reopened incidents', click: go('incident-list', { reopened: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE reopen_count > 0) AS "Reopened incidents" FROM reporting.incidents` },

      { name: 'Problem records with the most incidents', links: { Problem: toProblem('Problem'), 'Main system': toSystem('Main system') }, ...table(24, 9), sql: `
SELECT problem AS "Problem", count(*) AS "Incidents", count(*) FILTER (WHERE is_open) AS "Still open",
       mode() WITHIN GROUP (ORDER BY subcategory) AS "Main subcategory",
       mode() WITHIN GROUP (ORDER BY configuration_item) AS "Main system",
       min(created_at)::date AS "First seen", max(created_at)::date AS "Last seen"
FROM reporting.incidents WHERE problem IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 15` },

      { name: 'Weekly incidents for the 5 biggest problems', click: toProblem('Problem'), ...lines('Week', 'Problem', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')},
     top AS (SELECT problem FROM reporting.incidents WHERE problem IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 5)
SELECT date_trunc('week', i.created_at)::date AS "Week", i.problem AS "Problem", count(*) AS "Incidents"
FROM reporting.incidents i JOIN top USING (problem)
WHERE ${inFullPeriods("date_trunc('week', i.created_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Workarounds by subcategory (top 10)', click: go('incident-list', { workaround: 'Yes', subcategory: col('Subcategory') }), ...row('Subcategory', 'Closed with a workaround'), sql: `
SELECT subcategory AS "Subcategory", count(*) AS "Closed with a workaround"
FROM reporting.incidents WHERE closed_with_workaround GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },

      { name: 'Recurring issues with no problem record', links: { 'Server / system': toSystem('Server / system'), Subcategory: go('incident-list', { system: col('Server / system'), subcategory: col('Subcategory') }) }, ...table(24), sql: `
SELECT configuration_item AS "Server / system", subcategory AS "Subcategory", count(*) AS "Incidents",
       count(DISTINCT date_trunc('week', created_at)) AS "Weeks it happened",
       round(100.0 * avg((source = 'Monitoring alert')::int)) AS "From monitoring (%)",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.incidents
WHERE problem IS NULL AND configuration_item IS NOT NULL
GROUP BY 1, 2 HAVING count(*) >= 20
ORDER BY 3 DESC LIMIT 15`,
        description: 'The same system and issue type keep coming back, but no problem record links them: candidates for Problem Management.' },

      { name: 'Most used knowledge articles', links: { 'Knowledge article': go('incident-list', { kb: col('Knowledge article') }) }, ...table(12), sql: `
SELECT kb_article AS "Knowledge article", count(*) AS "Incidents",
       mode() WITHIN GROUP (ORDER BY subcategory) AS "Main subcategory",
       round(avg(hours_to_resolve), 1) AS "Avg hours to resolve"
FROM reporting.incidents WHERE kb_article IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Incidents caused by changes', links: { Incident: toIncident('Incident'), 'Caused by change': toChange('Caused by change'), Team: toTeam('Team') }, ...table(12), sql: `
SELECT number AS "Incident", caused_by_change AS "Caused by change", priority AS "Priority",
       created_at AS "Created", assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE caused_by_change IS NOT NULL ORDER BY created_at DESC` },

      { name: 'P1 and P2 incidents', links: { Incident: toIncident('Incident'), Team: toTeam('Team'), 'Server / system': toSystem('Server / system') }, ...table(24, 8), sql: `
SELECT number AS "Incident", priority AS "Priority", created_at AS "Created", hours_to_resolve AS "Hours to resolve",
       state AS "State", assignment_group AS "Team", configuration_item AS "Server / system", short_description AS "Summary"
FROM reporting.incidents
WHERE priority IN ('P1 - Critical', 'P2 - High') OR was_p1
ORDER BY priority, created_at DESC` },
    ],
  },
  {
    key: 'monitoring',
    group: 'Incidents & Problems',
    name: 'Monitoring & Alerts',
    description: 'Event Management: alert volume, noisy systems and alerts that close themselves.',
    cards: [
      { name: 'Monitoring alerts', click: go('incident-list', { source: 'Monitoring alert' }), ...SCALAR, sql: `SELECT count(*) AS "Monitoring alerts" FROM reporting.incidents WHERE source = 'Monitoring alert'` },
      { name: 'Share of all incidents (%)', ...SCALAR, sql: `SELECT round(100.0 * avg((source = 'Monitoring alert')::int), 1) AS "Share of all incidents (%)" FROM reporting.incidents` },
      { name: 'Alerts closed within an hour (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((hours_to_resolve <= 1)::int), 1) AS "Alerts closed within an hour (%)"
FROM reporting.incidents WHERE source = 'Monitoring alert' AND hours_to_resolve IS NOT NULL`,
        description: 'Alerts that close within an hour often fixed themselves: candidates for tuning or auto-closing.' },
      { name: 'Alerts with no system recorded', ...SCALAR, sql: `
SELECT count(*) AS "Alerts with no system recorded" FROM reporting.incidents WHERE source = 'Monitoring alert' AND configuration_item IS NULL`,
        description: "Their system is the placeholder 'zzz', so they can't be traced to what raised them." },

      { name: 'Alerts per day', click: go('incident-list', { source: 'Monitoring alert', date: col('Day') }), ...line('Day', 'Alerts'), sql: `
WITH ${fullPeriods('incidents', 'created_at', 'day')}
SELECT date_trunc('day', created_at)::date AS "Day", count(*) AS "Alerts"
FROM reporting.incidents
WHERE source = 'Monitoring alert' AND ${inFullPeriods("date_trunc('day', created_at)")}
GROUP BY 1 ORDER BY 1` },
      { name: 'Noisiest systems (top 10)', click: toSystem('Server / system'), ...row('Server / system', 'Alerts'), sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' AND configuration_item IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },

      { name: 'Alerts by hour of day', click: go('incident-list', { source: 'Monitoring alert', hour: col('Hour') }), ...bar('Hour', 'Alerts'), sql: `
SELECT to_char(created_at, 'HH24') AS "Hour", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' GROUP BY 1 ORDER BY 1`,
        description: 'Hours as recorded in ServiceNow.' },
      { name: 'How fast alerts close, by type', links: { 'Alert type': go('incident-list', { source: 'Monitoring alert', subcategory: col('Alert type') }) }, ...table(12), sql: `
SELECT subcategory AS "Alert type", count(*) AS "Alerts",
       round(100.0 * avg((hours_to_resolve <= 1)::int) FILTER (WHERE hours_to_resolve IS NOT NULL), 1) AS "Closed within 1 hour (%)",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_resolve) * 60)::numeric) AS "Median minutes to close",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.incidents WHERE source = 'Monitoring alert'
GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },

      { name: 'Teams receiving the most alerts', click: toTeam('Team'), ...row('Team', 'Alerts'), sql: `
SELECT assignment_group AS "Team", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Where alerts come from', click: go('incident-list', { source: 'Monitoring alert', opened_by: col('Raised by') }), ...row('Raised by', 'Alerts'), sql: `
SELECT coalesce(opened_by_group, 'Not recorded') AS "Raised by", count(*) AS "Alerts"
FROM reporting.incidents WHERE source = 'Monitoring alert' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        description: 'The group that opened the alert, which usually identifies the monitoring tool or automation.' },
    ],
  },
  {
    key: 'workload',
    group: 'Incidents & Problems',
    name: 'Workload & Channels',
    description: 'When and how people contact IT, and how the work spreads across teams.',
    cards: [
      { name: 'Incidents raised by people', click: go('incident-list', { source: 'Person' }), ...SCALAR, sql: `SELECT count(*) AS "Incidents raised by people" FROM reporting.incidents WHERE source = 'Person'`,
        description: 'Everything except monitoring alerts.' },
      { name: 'Self-service share (%)', click: go('incident-list', { channel: 'Self-service' }), ...SCALAR, sql: `
SELECT round(100.0 * avg((contact_type = 'Self-service')::int), 1) AS "Self-service share (%)" FROM reporting.incidents WHERE source = 'Person'` },
      { name: 'Resolved without reassignment (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((reassignment_count = 0)::int), 1) AS "Resolved without reassignment (%)" FROM reporting.incidents WHERE source = 'Person'`,
        description: 'People-raised incidents that the first team handled all the way.' },
      { name: 'Password and account issues', ...SCALAR, sql: `
SELECT count(*) AS "Password and account issues" FROM reporting.incidents WHERE subcategory IN ${ACCOUNT_SUBCATEGORIES}` },

      { name: 'People-raised incidents by hour of day', click: go('incident-list', { source: 'Person', hour: col('Hour') }), ...bar('Hour', 'Incidents'), sql: `
SELECT to_char(created_at, 'HH24') AS "Hour", count(*) AS "Incidents"
FROM reporting.incidents WHERE source = 'Person' GROUP BY 1 ORDER BY 1`,
        description: 'Hours as recorded in ServiceNow. Useful for staffing the service desk.' },
      { name: 'People-raised incidents by day of week', click: go('incident-list', { source: 'Person', weekday: col('Day') }), ...bar('Day', 'Incidents'), sql: `
SELECT to_char(created_at, 'Dy') AS "Day", count(*) AS "Incidents"
FROM reporting.incidents WHERE source = 'Person'
GROUP BY 1, extract(isodow FROM created_at) ORDER BY extract(isodow FROM created_at)` },

      { name: 'Weekly incidents by channel', click: go('incident-list', { channel: col('Channel') }), ...lines('Week', 'Channel', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", contact_type AS "Channel", count(*) AS "Incidents"
FROM reporting.incidents
WHERE source = 'Person' AND ${inFullPeriods("date_trunc('week', created_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Channel mix', click: go('incident-list', { channel: col('Channel') }), ...pie('Channel', 'Incidents'), sql: `
SELECT contact_type AS "Channel", count(*) AS "Incidents"
FROM reporting.incidents WHERE source = 'Person' GROUP BY 1 ORDER BY 2 DESC` },

      { name: 'Team workload', links: { Team: toTeam('Team') }, ...table(24, 8), sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents", count(*) FILTER (WHERE is_open) AS "Open now",
       count(DISTINCT nullif(assigned_to, '')) AS "People",
       round(count(*)::numeric / nullif(count(DISTINCT nullif(assigned_to, '')), 0), 1) AS "Incidents per person",
       round(avg(hours_to_resolve), 1) AS "Avg hours to resolve",
       round(100.0 * avg(was_reassigned::int), 1) AS "Reassigned (%)",
       round(100.0 * avg((source = 'Monitoring alert')::int)) AS "From monitoring (%)"
FROM reporting.incidents
GROUP BY 1 HAVING count(*) >= 100
ORDER BY 2 DESC LIMIT 15` },

      { name: 'Why open incidents are waiting', click: go('incident-list', { waiting: col('Status') }), ...row('Status', 'Open incidents'), sql: `
SELECT CASE WHEN state = 'On Hold' THEN 'On hold: ' || coalesce(on_hold_reason, 'no reason given') ELSE state END AS "Status",
       count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open GROUP BY 1 ORDER BY 2 DESC` },
      { name: 'Open incidents per person (top 10)', click: go('incident-list', { status: 'Open', assignee: col('Assigned to') }), ...row('Assigned to', 'Open incidents'), sql: `
SELECT assigned_to AS "Assigned to", count(*) AS "Open incidents"
FROM reporting.incidents WHERE is_open AND nullif(assigned_to, '') IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        description: 'People are anonymized in this export.' },
    ],
  },
  {
    key: 'change',
    group: 'Change',
    name: 'Change / CAB',
    description: 'Change Management: volume, success, risk, what is coming up, and approvals.',
    cards: [
      { name: 'Changes in the export', ...SCALAR, sql: `SELECT count(*) AS "Changes" FROM reporting.changes` },
      { name: 'Change success rate (%)', ...SCALAR, sql: `
SELECT round(100.0 * count(*) FILTER (WHERE succeeded) / nullif(count(*) FILTER (WHERE succeeded IS NOT NULL), 0), 1) AS "Success rate (%)"
FROM reporting.changes` },
      { name: 'Emergency or expedited (%)', click: go('change-list', { urgent: 'Yes' }), ...SCALAR, sql: `SELECT round(100.0 * avg(is_emergency_or_expedited::int), 1) AS "Emergency or expedited (%)" FROM reporting.changes` },
      { name: 'Starting in the next 7 days', click: go('change-list', { starts_within: '7' }), ...SCALAR, sql: `SELECT count(*) AS "Starting in the next 7 days" FROM reporting.changes WHERE starts_next_7_days AND state <> 'Canceled'` },

      { name: 'Upcoming Production changes (next 7 days)', links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') }, ...table(24, 8), sql: `
SELECT number AS "Change", planned_start AS "Planned start", planned_end AS "Planned end",
       CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage", type AS "Type", risk AS "Risk",
       state AS "State", approval AS "Approval", owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes
WHERE starts_next_7_days AND environment = 'Production' AND state <> 'Canceled'
ORDER BY has_outage DESC, planned_start` },

      { name: 'Changes per week by type', click: go('change-list', { type: col('Type') }), ...stacked('Week', 'Type', 'Changes'), sql: `
WITH ${fullPeriods('changes', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", type AS "Type", count(*) AS "Changes"
FROM reporting.changes WHERE ${inFullPeriods("date_trunc('week', created_at)")} GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Changes by risk', click: go('change-list', { risk: col('Risk') }), ...pie('Risk', 'Changes'), sql: `
SELECT coalesce(nullif(risk, ''), 'Not set') AS "Risk", count(*) AS "Changes" FROM reporting.changes GROUP BY 1 ORDER BY 2 DESC` },

      { name: 'Change approvals waiting, by approver group', click: toTeam('Approver group'), ...row('Approver group', 'Waiting'), sql: `
SELECT approver_group AS "Approver group", count(*) AS "Waiting", round(max(waiting_days), 1) AS "Oldest (days)"
FROM reporting.approvals WHERE approval_for = 'Change' AND is_waiting GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Failed changes and changes that caused incidents', links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') }, ...table(12), sql: `
SELECT number AS "Change", created_at AS "Created", type AS "Type", close_code AS "Result",
       failure_code AS "Failure", owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes WHERE succeeded = false OR failure_code IS NOT NULL ORDER BY created_at DESC` },
    ],
  },
  {
    key: 'change-risk',
    group: 'Change',
    name: 'Change Risk & Business Impact',
    description: 'Changes that touch breweries and SAP, how much notice they get, and process failures.',
    cards: [
      { name: 'Changes affecting breweries', click: go('change-list', { brewery: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE affects_brewery) AS "Changes affecting breweries" FROM reporting.changes` },
      { name: 'Changes affecting SAP', click: go('change-list', { sap: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE affects_sap) AS "Changes affecting SAP" FROM reporting.changes` },
      { name: 'Needing an SAP transport', click: go('change-list', { transport: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE needs_sap_transport) AS "Needing an SAP transport" FROM reporting.changes` },
      { name: 'Flagged as a process failure', click: go('change-list', { process_failure: 'Yes' }), ...SCALAR, sql: `SELECT count(*) FILTER (WHERE process_failure) AS "Flagged as a process failure" FROM reporting.changes` },

      { name: 'Days of notice by change type', click: go('change-list', { type: col('Change type') }), ...bar('Change type', 'Median days of notice'), h: 8, sql: `
SELECT type AS "Change type",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY lead_days))::numeric, 1) AS "Median days of notice",
       count(*) AS "Changes", count(*) FILTER (WHERE lead_days < 0) AS "Logged after it started"
FROM reporting.changes WHERE lead_days IS NOT NULL GROUP BY 1 ORDER BY 2`,
        description: 'How long before the planned start each kind of change is raised (median). "Logged after it started" counts changes recorded once work had begun.' },
      { name: 'Changes with an outage per week, by environment', click: go('change-list', { outage: 'Yes', environment: col('Environment') }), ...stacked('Week', 'Environment', 'Changes with an outage'), h: 8, sql: `
WITH bounds AS (
  SELECT date_trunc('week', min(created_at)) AS first_week,
         date_trunc('week', (SELECT as_of FROM reporting.data_as_of)) + interval '4 weeks' AS last_week
  FROM reporting.changes
)
SELECT date_trunc('week', planned_start)::date AS "Week", coalesce(environment, 'Not set') AS "Environment",
       count(*) AS "Changes with an outage"
FROM reporting.changes CROSS JOIN bounds
WHERE has_outage AND state <> 'Canceled' AND planned_start >= first_week AND planned_start < last_week
GROUP BY 1, 2 ORDER BY 1, 2`,
        description: 'By the week the change is planned to start, up to four weeks past the end of the export.' },

      { name: 'Most changed systems (top 10)', click: toSystem('Server / system'), ...row('Server / system', 'Changes'), h: 9, sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Changes"
FROM reporting.changes WHERE configuration_item IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Changes by category and risk', click: go('change-list', { category: col('Category'), risk: col('Risk') }), ...stacked('Category', 'Risk', 'Changes'), h: 9, sql: `
WITH top AS (SELECT sub_type FROM reporting.changes GROUP BY 1 ORDER BY count(*) DESC LIMIT 8)
SELECT c.sub_type AS "Category", coalesce(nullif(c.risk, ''), 'Not set') AS "Risk", count(*) AS "Changes"
FROM reporting.changes c JOIN top USING (sub_type)
GROUP BY 1, 2 ORDER BY 1, 2` },

      { name: 'SAP and brewery changes in the next 14 days', links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') }, ...table(24), sql: `
SELECT c.number AS "Change", c.planned_start AS "Planned start",
       CASE WHEN c.has_outage THEN 'Yes' ELSE 'No' END AS "Outage",
       CASE WHEN c.affects_sap THEN 'Yes' ELSE 'No' END AS "SAP",
       coalesce(c.brewery_locations, '') AS "Breweries", c.risk AS "Risk", c.approval AS "Approval",
       c.owner_group AS "Owning team", c.short_description AS "Summary"
FROM reporting.changes c CROSS JOIN reporting.data_as_of a
WHERE (c.affects_sap OR c.affects_brewery) AND c.state <> 'Canceled'
  AND c.planned_start >= a.as_of AND c.planned_start < a.as_of + interval '14 days'
ORDER BY c.planned_start`,
        description: 'Measured from the newest record in the export (1 September 2026), not from today.' },
      { name: 'Changes flagged as a process failure', links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') }, ...table(24), sql: `
SELECT number AS "Change", created_at AS "Created", type AS "Type", sub_type AS "Category", state AS "State",
       close_code AS "Result", owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes WHERE process_failure ORDER BY created_at DESC` },
    ],
  },
  {
    key: 'requests',
    group: 'Requests',
    name: 'Requests',
    description: 'Request Fulfilment: demand, backlog, fulfilment time, SLA and approvals.',
    cards: [
      { name: 'Open requests', click: go('request-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open requests" FROM reporting.requests WHERE is_open` },
      { name: 'Open catalog tasks', click: go('task-list', { status: 'Open' }), ...SCALAR, sql: `SELECT count(*) AS "Open catalog tasks" FROM reporting.catalog_tasks WHERE is_open` },
      { name: 'Catalog task SLA breaches (%)', click: go('task-list', { sla: 'Breached' }), ...SCALAR, sql: `SELECT round(100.0 * avg(sla_breached::int), 1) AS "SLA breaches (%)" FROM reporting.catalog_tasks` },
      { name: 'Request approvals waiting', ...SCALAR, sql: `SELECT count(*) AS "Request approvals waiting" FROM reporting.approvals WHERE approval_for = 'Request' AND is_waiting` },

      { name: 'Most requested items (top 10)', click: toItem('Item'), ...row('Item', 'Requests'), sql: `
SELECT item AS "Item", count(*) AS "Requests" FROM reporting.requests GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      // "Completed" = fulfilled, or closed without a fulfilled time (same rule as hours_to_fulfil)
      { name: 'Requests opened vs. completed per week', ...line('Week', 'Opened', 'Completed'), sql: `
WITH ${fullPeriods('requests', 'opened_at')},
     o AS (SELECT date_trunc('week', opened_at) AS week, count(*) AS n FROM reporting.requests GROUP BY 1),
     c AS (SELECT date_trunc('week', coalesce(fulfilled_at, closed_at)) AS week, count(*) AS n
           FROM reporting.requests WHERE coalesce(fulfilled_at, closed_at) IS NOT NULL GROUP BY 1)
SELECT coalesce(o.week, c.week)::date AS "Week", coalesce(o.n, 0) AS "Opened", coalesce(c.n, 0) AS "Completed"
FROM o FULL JOIN c ON o.week = c.week
WHERE ${inFullPeriods('coalesce(o.week, c.week)')} ORDER BY 1` },

      { name: 'Fulfilment time for the most requested items', links: { Item: toItem('Item') }, ...table(12), sql: `
SELECT item AS "Item", count(*) AS "Requests",
       round(avg(hours_to_fulfil), 1) AS "Avg hours",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_fulfil))::numeric, 1) AS "Median hours",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.requests GROUP BY 1 ORDER BY 2 DESC LIMIT 15` },
      { name: 'SLA breaches by team', links: { Team: toTeam('Team') }, ...table(12), sql: `
SELECT assignment_group AS "Team", count(*) AS "Tasks",
       count(*) FILTER (WHERE sla_breached) AS "Breached",
       round(100.0 * avg(sla_breached::int), 1) AS "Breached (%)",
       count(*) FILTER (WHERE is_open) AS "Open now"
FROM reporting.catalog_tasks GROUP BY 1 HAVING count(*) >= 50 ORDER BY 3 DESC LIMIT 15` },

      { name: 'Open catalog tasks by team and state', click: go('task-list', { status: 'Open', team: col('Team'), state: col('State') }), ...stacked('Team', 'State', 'Open tasks'), sql: `
WITH top AS (SELECT assignment_group FROM reporting.catalog_tasks WHERE is_open GROUP BY 1 ORDER BY count(*) DESC LIMIT 8)
SELECT t.assignment_group AS "Team", t.state AS "State", count(*) AS "Open tasks"
FROM reporting.catalog_tasks t JOIN top USING (assignment_group) WHERE t.is_open GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Request approvals waiting, by approver group', click: toTeam('Approver group'), ...row('Approver group', 'Waiting'), sql: `
SELECT approver_group AS "Approver group", count(*) AS "Waiting", round(max(waiting_days), 1) AS "Oldest (days)"
FROM reporting.approvals WHERE approval_for = 'Request' AND is_waiting GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
    ],
  },
  {
    key: 'automation',
    group: 'Requests',
    name: 'Automation & Self-service',
    description: 'Where automation and self-service would save the most effort.',
    cards: [
      { name: 'Server start/stop requests', ...SCALAR, sql: `
SELECT count(*) AS "Server start/stop requests" FROM reporting.requests WHERE item IN ${SERVER_POWER_ITEMS}`,
        description: 'Virtual Server Start, Stop, and Start and Snooze requests.' },
      { name: 'Server start/stop requests: weekly average', ...SCALAR, sql: `
WITH ${fullPeriods('requests', 'opened_at')}
SELECT round(count(*)::numeric / nullif(count(DISTINCT date_trunc('week', opened_at)), 0)) AS "Weekly average"
FROM reporting.requests
WHERE item IN ${SERVER_POWER_ITEMS} AND ${inFullPeriods("date_trunc('week', opened_at)")}`,
        description: 'Average over complete weeks.' },
      { name: 'Requests completed within an hour (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((hours_to_fulfil <= 1)::int), 1) AS "Completed within an hour (%)"
FROM reporting.requests WHERE hours_to_fulfil IS NOT NULL` },
      { name: 'Rejected or cancelled requests', click: go('request-list', { outcome: 'Rejected or cancelled' }), ...SCALAR, sql: `
SELECT count(*) AS "Rejected or cancelled requests" FROM reporting.requests
WHERE approval = 'Rejected' OR state = 'Closed Cancelled'`,
        description: 'Effort spent on requests that never went ahead.' },

      { name: 'Automation candidates', links: { 'Catalog item': toItem('Catalog item') }, ...table(24, 8), sql: `
WITH ${fullPeriods('requests', 'opened_at')},
     span AS (SELECT extract(epoch FROM end_period - first_period) / 604800 AS weeks FROM full_periods)
SELECT item AS "Catalog item", count(*) AS "Requests",
       round(count(*) FILTER (WHERE ${inFullPeriods("date_trunc('week', opened_at)")}) / (SELECT weeks FROM span)::numeric, 1) AS "Per week",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_fulfil))::numeric, 1) AS "Median hours to complete",
       round(100.0 * avg((hours_to_fulfil <= 1)::int) FILTER (WHERE hours_to_fulfil IS NOT NULL), 1) AS "Done within 1 hour (%)",
       count(*) FILTER (WHERE is_open) AS "Still open"
FROM reporting.requests
GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
        description: 'High volume and slow to complete: good candidates for automation. High volume and already done within an hour: probably automated already.' },

      { name: 'Server start/stop requests per week', ...lines('Week', 'Request', 'Requests'), sql: `
WITH ${fullPeriods('requests', 'opened_at')}
SELECT date_trunc('week', opened_at)::date AS "Week",
       CASE item WHEN 'Virtual Server - Start' THEN 'Start' WHEN 'Virtual Server - Stop' THEN 'Stop'
                 ELSE 'Start and snooze' END AS "Request",
       count(*) AS "Requests"
FROM reporting.requests
WHERE item IN ${SERVER_POWER_ITEMS} AND ${inFullPeriods("date_trunc('week', opened_at)")}
GROUP BY 1, 2 ORDER BY 1, 2` },
      { name: 'Password and account issues by channel', click: go('incident-list', { subcategory: col('Issue'), channel: col('Channel') }), ...stacked('Issue', 'Channel', 'Incidents'), sql: `
SELECT subcategory AS "Issue", contact_type AS "Channel", count(*) AS "Incidents"
FROM reporting.incidents WHERE subcategory IN ${ACCOUNT_SUBCATEGORIES}
GROUP BY 1, 2 ORDER BY 1, 2`,
        description: 'Phone, chat and email contacts here are candidates for self-service password reset and unlock.' },

      { name: 'Most rejected or cancelled items (top 10)', click: toItem('Catalog item'), ...row('Catalog item', 'Rejected or cancelled'), sql: `
SELECT item AS "Catalog item", count(*) AS "Rejected or cancelled"
FROM reporting.requests WHERE approval = 'Rejected' OR state = 'Closed Cancelled'
GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
      { name: 'Requests by order guide', click: go('request-list', { guide: col('Order guide') }), ...row('Order guide', 'Requests'), sql: `
SELECT coalesce(order_guide, 'Ordered directly (no guide)') AS "Order guide", count(*) AS "Requests"
FROM reporting.requests GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        description: 'Order guides bundle several items into one form, e.g. for new hires.' },
    ],
  },
];

// ---------------------------------------------------------------------
// DETAIL DASHBOARDS: what the clicks above open. Not in the drawer; each
// takes filters (`params`) from the link. {{slug}} in a card's SQL is filled
// from the filter with that slug. Record pages (incident, change, request)
// put a one-row "Go to" table under the record, because Metabase's record
// view can't hold links.
// ---------------------------------------------------------------------

// Lists: every filter is optional; Metabase leaves out a [[...]] part when
// its filter is empty. Each entry: [slug, label, SQL condition].
const listParams = filters => filters.map(([slug, name]) => ({ slug, name }));
const listWhere = filters => `WHERE true\n${filters.map(([, , cond]) => `  [[AND ${cond}]]`).join('\n')}`;
const OPEN_OR_CLOSED = slug => `CASE WHEN is_open THEN 'Open' ELSE 'Closed' END = {{${slug}}}`;

const INCIDENT_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status')],
  ['priority', 'Priority', 'priority = {{priority}}'],
  ['subcategory', 'Subcategory', 'subcategory = {{subcategory}}'],
  ['channel', 'Reported via', 'contact_type = {{channel}}'],
  ['source', 'Source', 'source = {{source}}'],
  ['age', 'Open for', 'is_open AND substr(age_bucket, 4) = {{age}}'],
  ['older_than', 'Open at least (days)', 'age_days >= CAST({{older_than}} AS numeric)'],
  ['hour', 'Hour of day', "to_char(created_at, 'HH24') = {{hour}}"],
  ['weekday', 'Day of week', "to_char(created_at, 'Dy') = {{weekday}}"],
  // Chart clicks send dates as 2026-08-17T00:00:00Z
  ['date', 'Date', 'created_at::date = CAST(left({{date}}, 10) AS date)'],
  ['team', 'Team', 'assignment_group = {{team}}'],
  ['system', 'Server / system', 'configuration_item = {{system}}'],
  ['site', 'Site', 'location = {{site}}'],
  ['kb', 'Knowledge article', 'kb_article = {{kb}}'],
  ['workaround', 'Closed with a workaround', "closed_with_workaround = ({{workaround}} = 'Yes')"],
  ['reopened', 'Reopened', "(reopen_count > 0) = ({{reopened}} = 'Yes')"],
  ['reassigned', 'Reassigned', "was_reassigned = ({{reassigned}} = 'Yes')"],
  ['waiting', 'Status detail', "is_open AND (CASE WHEN state = 'On Hold' THEN 'On hold: ' || coalesce(on_hold_reason, 'no reason given') ELSE state END) = {{waiting}}"],
  ['assignee', 'Assigned to', 'assigned_to = {{assignee}}'],
  ['opened_by', 'Raised by', "coalesce(opened_by_group, 'Not recorded') = {{opened_by}}"],
];

const CHANGE_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status')],
  ['type', 'Type', 'type = {{type}}'],
  ['risk', 'Risk', "coalesce(nullif(risk, ''), 'Not set') = {{risk}}"],
  ['category', 'Category', 'sub_type = {{category}}'],
  ['environment', 'Environment', "coalesce(environment, 'Not set') = {{environment}}"],
  ['outage', 'Outage', "has_outage = ({{outage}} = 'Yes')"],
  ['approval', 'Approval', 'approval = {{approval}}'],
  ['sap', 'Affects SAP', "affects_sap = ({{sap}} = 'Yes')"],
  ['transport', 'Needs SAP transport', "needs_sap_transport = ({{transport}} = 'Yes')"],
  ['brewery', 'Affects breweries', "affects_brewery = ({{brewery}} = 'Yes')"],
  ['process_failure', 'Process failure', "process_failure = ({{process_failure}} = 'Yes')"],
  ['urgent', 'Emergency or expedited', "is_emergency_or_expedited = ({{urgent}} = 'Yes')"],
  ['starts_within', 'Starts within (days)', "state <> 'Canceled' AND planned_start >= (SELECT as_of FROM reporting.data_as_of) AND planned_start < (SELECT as_of FROM reporting.data_as_of) + make_interval(days => CAST({{starts_within}} AS int))"],
];

const REQUEST_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status')],
  ['item', 'Catalog item', 'item = {{item}}'],
  ['site', 'Site', 'location = {{site}}'],
  ['approval', 'Approval', 'approval = {{approval}}'],
  ['outcome', 'Outcome', "{{outcome}} = 'Rejected or cancelled' AND (approval = 'Rejected' OR state = 'Closed Cancelled')"],
  ['guide', 'Order guide', "coalesce(order_guide, 'Ordered directly (no guide)') = {{guide}}"],
];

const TASK_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status')],
  ['team', 'Team', 'assignment_group = {{team}}'],
  ['state', 'State', 'state = {{state}}'],
  ['sla', 'SLA', "CASE WHEN sla_breached THEN 'Breached' ELSE 'Met' END = {{sla}}"],
  ['item', 'Catalog item', 'item = {{item}}'],
];

// Full-width record view, and the clickable "Go to" row under it
const RECORD = { display: 'object', w: 24, h: 12 };
const GO_TO = { display: 'table', w: 24, h: 3 };

const DETAILS = [
  {
    key: 'incident-detail',
    name: 'Incident',
    params: [{ slug: 'number', name: 'Incident' }],
    cards: [
      { name: 'Incident record', ...RECORD, h: 14, sql: `
SELECT number AS "Incident", short_description AS "Summary", state AS "State", priority AS "Priority",
       impact AS "Impact", urgency AS "Urgency", category AS "Category", subcategory AS "Subcategory",
       assignment_group AS "Team", nullif(assigned_to, '') AS "Assigned to", configuration_item AS "Server / system",
       nullif(location, '') AS "Site", contact_type AS "Reported via", source AS "Source", opened_by_group AS "Opened by",
       created_at AS "Created", resolved_at AS "Resolved", closed_at AS "Closed", hours_to_resolve AS "Hours to resolve",
       reassignment_count AS "Times reassigned", reopen_count AS "Times reopened", on_hold_reason AS "On hold because",
       close_code AS "Close result", cause_code AS "Cause", problem AS "Problem", kb_article AS "Knowledge article",
       caused_by_change AS "Caused by change", CASE WHEN was_p1 THEN 'Yes' ELSE 'No' END AS "Ever P1",
       description AS "Description", close_notes AS "Close notes"
FROM reporting.incidents WHERE number = {{number}}` },
      { name: 'Go to', ...GO_TO, description: 'Click a value to open its page.', sql: `
SELECT assignment_group AS "Team", configuration_item AS "Server / system", nullif(location, '') AS "Site",
       problem AS "Problem", caused_by_change AS "Caused by change"
FROM reporting.incidents WHERE number = {{number}}`,
        links: { Team: toTeam('Team'), 'Server / system': toSystem('Server / system'), Site: toSite('Site'), Problem: toProblem('Problem'), 'Caused by change': toChange('Caused by change') } },
      { name: 'Other incidents on the same system', ...table(24, 8), sql: `
SELECT i.number AS "Incident", i.created_at AS "Created", i.priority AS "Priority", i.state AS "State",
       i.subcategory AS "Subcategory", i.short_description AS "Summary"
FROM reporting.incidents i
WHERE i.configuration_item = (SELECT configuration_item FROM reporting.incidents WHERE number = {{number}})
  AND i.number <> {{number}}
ORDER BY i.created_at DESC LIMIT 25`,
        links: { Incident: toIncident('Incident') } },
    ],
  },
  {
    key: 'change-detail',
    name: 'Change',
    params: [{ slug: 'number', name: 'Change' }],
    cards: [
      { name: 'Change record', ...RECORD, h: 14, sql: `
SELECT number AS "Change", short_description AS "Summary", type AS "Type", sub_type AS "Category", state AS "State",
       approval AS "Approval", risk AS "Risk", environment AS "Environment",
       CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage",
       planned_start AS "Planned start", planned_end AS "Planned end", planned_hours AS "Planned hours",
       lead_days AS "Days of notice", owner_group AS "Owning team", configuration_item AS "Server / system",
       CASE WHEN affects_sap THEN 'Yes' ELSE 'No' END AS "Affects SAP",
       CASE WHEN needs_sap_transport THEN 'Yes' ELSE 'No' END AS "Needs SAP transport",
       brewery_locations AS "Breweries", close_code AS "Result", failure_code AS "Failure",
       CASE WHEN process_failure THEN 'Yes' ELSE 'No' END AS "Process failure",
       linked_incident AS "Linked incident", linked_problem AS "Linked problem", project AS "Project",
       created_at AS "Created", purpose_of_change AS "Purpose", description AS "Description"
FROM reporting.changes WHERE number = {{number}}` },
      { name: 'Go to', ...GO_TO, description: 'Click a value to open its page.', sql: `
SELECT owner_group AS "Owning team", configuration_item AS "Server / system",
       linked_incident AS "Linked incident", linked_problem AS "Linked problem"
FROM reporting.changes WHERE number = {{number}}`,
        links: { 'Owning team': toTeam('Owning team'), 'Server / system': toSystem('Server / system'), 'Linked incident': toIncident('Linked incident'), 'Linked problem': toProblem('Linked problem') } },
      { name: 'Approvals for this change', ...table(12), sql: `
SELECT approver_group AS "Approver group", approval AS "Approval", state AS "State",
       created_at AS "Requested", waiting_days AS "Waiting (days)"
FROM reporting.approvals WHERE approval_for = 'Change' AND parent = {{number}} ORDER BY created_at`,
        links: { 'Approver group': toTeam('Approver group') } },
      { name: 'Incidents caused by this change', ...table(12), sql: `
SELECT number AS "Incident", created_at AS "Created", priority AS "Priority",
       assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE caused_by_change = {{number}} ORDER BY created_at DESC`,
        links: { Incident: toIncident('Incident'), Team: toTeam('Team') } },
      { name: 'Breweries affected', ...table(24, 5), sql: `
SELECT brewery AS "Brewery" FROM reporting.change_breweries WHERE number = {{number}} ORDER BY 1`,
        links: { Brewery: toSite('Brewery') } },
    ],
  },
  {
    key: 'request-detail',
    name: 'Request',
    params: [{ slug: 'number', name: 'Request' }],
    cards: [
      { name: 'Request record', ...RECORD, sql: `
SELECT number AS "Request", item AS "Catalog item", short_description AS "Summary", state AS "State", stage AS "Stage",
       approval AS "Approval", opened_at AS "Opened", fulfilled_at AS "Fulfilled", closed_at AS "Closed",
       hours_to_fulfil AS "Hours to complete", age_days AS "Open for (days)", nullif(location, '') AS "Site",
       requested_for AS "Requested for", order_guide AS "Order guide"
FROM reporting.requests WHERE number = {{number}}` },
      { name: 'Go to', ...GO_TO, description: 'Click a value to open its page.', sql: `
SELECT item AS "Catalog item", nullif(location, '') AS "Site" FROM reporting.requests WHERE number = {{number}}`,
        links: { 'Catalog item': toItem('Catalog item'), Site: toSite('Site') } },
      { name: 'Catalog tasks for this request', ...table(12), sql: `
SELECT number AS "Task", assignment_group AS "Team", state AS "State",
       CASE WHEN sla_breached THEN 'Yes' ELSE 'No' END AS "SLA breached",
       created_at AS "Created", age_days AS "Open for (days)"
FROM reporting.catalog_tasks WHERE request_item = {{number}} ORDER BY created_at`,
        links: { Team: toTeam('Team') } },
      { name: 'Approvals for this request', ...table(12), sql: `
SELECT approver_group AS "Approver group", approval AS "Approval", state AS "State",
       created_at AS "Requested", waiting_days AS "Waiting (days)"
FROM reporting.approvals WHERE approval_for = 'Request' AND parent = {{number}} ORDER BY created_at`,
        links: { 'Approver group': toTeam('Approver group') } },
    ],
  },
  {
    key: 'team-detail',
    name: 'Team',
    params: [{ slug: 'team', name: 'Team' }],
    cards: [
      { name: 'Open incidents', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Open incidents" FROM reporting.incidents WHERE assignment_group = {{team}}` },
      { name: 'Average hours to resolve', ...SCALAR, sql: `SELECT round(avg(hours_to_resolve), 1) AS "Average hours to resolve" FROM reporting.incidents WHERE assignment_group = {{team}}` },
      { name: 'Open catalog tasks', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Open catalog tasks" FROM reporting.catalog_tasks WHERE assignment_group = {{team}}` },
      { name: 'Approvals waiting on this team', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_waiting) AS "Approvals waiting" FROM reporting.approvals WHERE approver_group = {{team}}` },

      { name: 'Incidents opened per week', ...line('Week', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", count(*) AS "Incidents"
FROM reporting.incidents
WHERE assignment_group = {{team}} AND ${inFullPeriods("date_trunc('week', created_at)")}
GROUP BY 1 ORDER BY 1` },
      { name: 'Systems this team works on (top 10)', ...row('Server / system', 'Incidents'), sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Incidents"
FROM reporting.incidents WHERE assignment_group = {{team}} AND configuration_item IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toSystem('Server / system') },

      { name: 'Open incidents', ...table(24, 8), sql: `
SELECT number AS "Incident", priority AS "Priority", state AS "State", age_days AS "Open for (days)",
       configuration_item AS "Server / system", short_description AS "Summary"
FROM reporting.incidents WHERE assignment_group = {{team}} AND is_open
ORDER BY age_days DESC LIMIT 100`,
        links: { Incident: toIncident('Incident'), 'Server / system': toSystem('Server / system') } },

      { name: 'Issue types', ...table(12), sql: `
SELECT subcategory AS "Subcategory", count(*) AS "Incidents", count(*) FILTER (WHERE is_open) AS "Open now",
       round(avg(hours_to_resolve), 1) AS "Avg hours to resolve", assignment_group AS "Team"
FROM reporting.incidents WHERE assignment_group = {{team}}
GROUP BY subcategory, assignment_group ORDER BY 2 DESC LIMIT 15`,
        links: { Subcategory: go('incident-list', { team: col('Team'), subcategory: col('Subcategory') }) } },
      { name: 'Open incidents per person', ...row('Assigned to', 'Open incidents'), sql: `
SELECT assigned_to AS "Assigned to", count(*) AS "Open incidents"
FROM reporting.incidents WHERE assignment_group = {{team}} AND is_open AND nullif(assigned_to, '') IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: go('incident-list', { status: 'Open', assignee: col('Assigned to') }) },

      { name: 'Open catalog tasks', ...table(12), sql: `
SELECT number AS "Task", request_item AS "Request", item AS "Catalog item", state AS "State",
       CASE WHEN sla_breached THEN 'Yes' ELSE 'No' END AS "SLA breached", age_days AS "Open for (days)"
FROM reporting.catalog_tasks WHERE assignment_group = {{team}} AND is_open
ORDER BY age_days DESC LIMIT 100`,
        links: { Request: toRequest('Request'), 'Catalog item': toItem('Catalog item') } },
      { name: 'Approvals waiting on this team', ...table(12), sql: `
SELECT CASE WHEN approval_for = 'Change' THEN parent END AS "Change",
       CASE WHEN approval_for = 'Request' THEN parent END AS "Request",
       created_at AS "Requested", waiting_days AS "Waiting (days)"
FROM reporting.approvals WHERE approver_group = {{team}} AND is_waiting
ORDER BY waiting_days DESC LIMIT 100`,
        links: { Change: toChange('Change'), Request: toRequest('Request') } },

      { name: 'Changes owned by this team', ...table(24), sql: `
SELECT number AS "Change", planned_start AS "Planned start", type AS "Type", risk AS "Risk", state AS "State",
       CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage", short_description AS "Summary"
FROM reporting.changes WHERE owner_group = {{team}}
ORDER BY planned_start DESC NULLS LAST LIMIT 50`,
        links: { Change: toChange('Change') } },
    ],
  },
  {
    key: 'system-detail',
    name: 'Server / system',
    params: [{ slug: 'system', name: 'Server / system' }],
    cards: [
      { name: 'Incidents', ...SCALAR, sql: `SELECT count(*) AS "Incidents" FROM reporting.incidents WHERE configuration_item = {{system}}` },
      { name: 'From monitoring (%)', ...SCALAR, sql: `SELECT round(100.0 * avg((source = 'Monitoring alert')::int), 1) AS "From monitoring (%)" FROM reporting.incidents WHERE configuration_item = {{system}}` },
      { name: 'Open incidents', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Open incidents" FROM reporting.incidents WHERE configuration_item = {{system}}` },
      { name: 'Changes to this system', ...SCALAR, sql: `SELECT count(*) AS "Changes" FROM reporting.changes WHERE configuration_item = {{system}}` },

      { name: 'Incidents and changes per week', ...line('Week', 'Incidents', 'Changes'), sql: `
WITH ${fullPeriods('incidents', 'created_at')},
     inc AS (SELECT date_trunc('week', created_at) AS week, count(*) AS n FROM reporting.incidents WHERE configuration_item = {{system}} GROUP BY 1),
     chg AS (SELECT date_trunc('week', planned_start) AS week, count(*) AS n FROM reporting.changes WHERE configuration_item = {{system}} GROUP BY 1),
     weeks AS (SELECT generate_series((SELECT first_period FROM full_periods), (SELECT end_period FROM full_periods) - interval '1 week', interval '1 week') AS week)
SELECT w.week::date AS "Week", coalesce(inc.n, 0) AS "Incidents", coalesce(chg.n, 0) AS "Changes"
FROM weeks w LEFT JOIN inc USING (week) LEFT JOIN chg USING (week) ORDER BY 1`,
        description: 'Changes by the week they were planned to start. A change followed by a jump in incidents is worth a look.' },
      { name: 'Teams handling it', ...row('Team', 'Incidents'), sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents"
FROM reporting.incidents WHERE configuration_item = {{system}} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toTeam('Team') },

      { name: 'Issue types', ...table(24, 6), sql: `
SELECT subcategory AS "Subcategory", count(*) AS "Incidents",
       round(100.0 * avg((source = 'Monitoring alert')::int)) AS "From monitoring (%)",
       count(*) FILTER (WHERE is_open) AS "Open now", configuration_item AS "Server / system"
FROM reporting.incidents WHERE configuration_item = {{system}}
GROUP BY subcategory, configuration_item ORDER BY 2 DESC LIMIT 15`,
        links: { Subcategory: go('incident-list', { system: col('Server / system'), subcategory: col('Subcategory') }) } },

      { name: 'Recent incidents', ...table(24, 8), sql: `
SELECT number AS "Incident", created_at AS "Created", priority AS "Priority", state AS "State",
       assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE configuration_item = {{system}}
ORDER BY created_at DESC LIMIT 100`,
        links: { Incident: toIncident('Incident'), Team: toTeam('Team') } },
      { name: 'Changes to this system', ...table(24), sql: `
SELECT number AS "Change", planned_start AS "Planned start", type AS "Type", risk AS "Risk", state AS "State",
       owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes WHERE configuration_item = {{system}}
ORDER BY planned_start DESC NULLS LAST LIMIT 50`,
        links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') } },
    ],
  },
  {
    key: 'site-detail',
    name: 'Site',
    params: [{ slug: 'site', name: 'Site' }],
    cards: [
      { name: 'Incidents', ...SCALAR, sql: `SELECT count(*) AS "Incidents" FROM reporting.incidents WHERE location = {{site}}` },
      { name: 'Open incidents', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Open incidents" FROM reporting.incidents WHERE location = {{site}}` },
      { name: 'Requests', ...SCALAR, sql: `SELECT count(*) AS "Requests" FROM reporting.requests WHERE location = {{site}}` },
      { name: 'Changes at this brewery', ...SCALAR, sql: `SELECT count(*) AS "Changes at this brewery" FROM reporting.change_breweries WHERE brewery = {{site}}`,
        description: 'Only breweries are recorded on changes.' },

      { name: 'Incidents opened per week', ...line('Week', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", count(*) AS "Incidents"
FROM reporting.incidents
WHERE location = {{site}} AND ${inFullPeriods("date_trunc('week', created_at)")}
GROUP BY 1 ORDER BY 1` },
      { name: 'Most requested items here', ...row('Catalog item', 'Requests'), sql: `
SELECT item AS "Catalog item", count(*) AS "Requests"
FROM reporting.requests WHERE location = {{site}} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toItem('Catalog item') },

      { name: 'Issue types', ...table(12), sql: `
SELECT subcategory AS "Subcategory", count(*) AS "Incidents", count(*) FILTER (WHERE is_open) AS "Open now",
       location AS "Site"
FROM reporting.incidents WHERE location = {{site}}
GROUP BY subcategory, location ORDER BY 2 DESC LIMIT 15`,
        links: { Subcategory: go('incident-list', { site: col('Site'), subcategory: col('Subcategory') }) } },
      { name: 'Open incidents', ...table(12), sql: `
SELECT number AS "Incident", priority AS "Priority", state AS "State", age_days AS "Open for (days)",
       assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE location = {{site}} AND is_open
ORDER BY age_days DESC LIMIT 100`,
        links: { Incident: toIncident('Incident'), Team: toTeam('Team') } },

      { name: 'Changes at this brewery', ...table(24), sql: `
SELECT number AS "Change", planned_start AS "Planned start", type AS "Type", risk AS "Risk",
       CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage", state AS "State", short_description AS "Summary"
FROM reporting.change_breweries WHERE brewery = {{site}}
ORDER BY planned_start DESC NULLS LAST LIMIT 50`,
        links: { Change: toChange('Change') } },
    ],
  },
  {
    key: 'problem-detail',
    name: 'Problem',
    params: [{ slug: 'problem', name: 'Problem' }],
    cards: [
      { name: 'Linked incidents', ...SCALAR, sql: `SELECT count(*) AS "Linked incidents" FROM reporting.incidents WHERE problem = {{problem}}` },
      { name: 'Still open', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Still open" FROM reporting.incidents WHERE problem = {{problem}}` },
      { name: 'Systems affected', ...SCALAR, sql: `SELECT count(DISTINCT configuration_item) AS "Systems affected" FROM reporting.incidents WHERE problem = {{problem}}` },
      { name: 'Average hours to resolve', ...SCALAR, sql: `SELECT round(avg(hours_to_resolve), 1) AS "Average hours to resolve" FROM reporting.incidents WHERE problem = {{problem}}` },

      { name: 'Linked incidents per week', ...line('Week', 'Incidents'), sql: `
WITH ${fullPeriods('incidents', 'created_at')}
SELECT date_trunc('week', created_at)::date AS "Week", count(*) AS "Incidents"
FROM reporting.incidents
WHERE problem = {{problem}} AND ${inFullPeriods("date_trunc('week', created_at)")}
GROUP BY 1 ORDER BY 1` },
      { name: 'Systems affected', ...row('Server / system', 'Incidents'), sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Incidents"
FROM reporting.incidents WHERE problem = {{problem}} AND configuration_item IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toSystem('Server / system') },

      { name: 'Linked incidents', ...table(24, 8), sql: `
SELECT number AS "Incident", created_at AS "Created", priority AS "Priority", state AS "State",
       configuration_item AS "Server / system", assignment_group AS "Team", short_description AS "Summary"
FROM reporting.incidents WHERE problem = {{problem}}
ORDER BY created_at DESC LIMIT 200`,
        links: { Incident: toIncident('Incident'), 'Server / system': toSystem('Server / system'), Team: toTeam('Team') } },
      { name: 'Teams involved', ...row('Team', 'Incidents'), sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents"
FROM reporting.incidents WHERE problem = {{problem}} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toTeam('Team') },
      { name: 'Changes linked to this problem', ...table(12), sql: `
SELECT number AS "Change", planned_start AS "Planned start", type AS "Type", state AS "State",
       owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes WHERE linked_problem = {{problem}}
ORDER BY planned_start DESC NULLS LAST`,
        links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') } },
    ],
  },
  {
    key: 'item-detail',
    name: 'Catalog item',
    params: [{ slug: 'item', name: 'Catalog item' }],
    cards: [
      { name: 'Requests', ...SCALAR, sql: `SELECT count(*) AS "Requests" FROM reporting.requests WHERE item = {{item}}` },
      { name: 'Median hours to complete', ...SCALAR, sql: `
SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_fulfil))::numeric, 1) AS "Median hours to complete"
FROM reporting.requests WHERE item = {{item}}` },
      { name: 'Done within 1 hour (%)', ...SCALAR, sql: `
SELECT round(100.0 * avg((hours_to_fulfil <= 1)::int), 1) AS "Done within 1 hour (%)"
FROM reporting.requests WHERE item = {{item}} AND hours_to_fulfil IS NOT NULL` },
      { name: 'Still open', ...SCALAR, sql: `SELECT count(*) FILTER (WHERE is_open) AS "Still open" FROM reporting.requests WHERE item = {{item}}` },

      { name: 'Opened vs. completed per week', ...line('Week', 'Opened', 'Completed'), sql: `
WITH ${fullPeriods('requests', 'opened_at')},
     o AS (SELECT date_trunc('week', opened_at) AS week, count(*) AS n FROM reporting.requests WHERE item = {{item}} GROUP BY 1),
     c AS (SELECT date_trunc('week', coalesce(fulfilled_at, closed_at)) AS week, count(*) AS n
           FROM reporting.requests WHERE item = {{item}} AND coalesce(fulfilled_at, closed_at) IS NOT NULL GROUP BY 1)
SELECT coalesce(o.week, c.week)::date AS "Week", coalesce(o.n, 0) AS "Opened", coalesce(c.n, 0) AS "Completed"
FROM o FULL JOIN c ON o.week = c.week
WHERE ${inFullPeriods('coalesce(o.week, c.week)')} ORDER BY 1` },
      { name: 'Requests by site', ...row('Site', 'Requests'), sql: `
SELECT location AS "Site", count(*) AS "Requests"
FROM reporting.requests WHERE item = {{item}} AND nullif(location, '') IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        click: toSite('Site') },

      { name: 'Open requests', ...table(24, 8), sql: `
SELECT number AS "Request", state AS "State", stage AS "Stage", opened_at AS "Opened",
       age_days AS "Open for (days)", nullif(location, '') AS "Site", requested_for AS "Requested for"
FROM reporting.requests WHERE item = {{item}} AND is_open
ORDER BY age_days DESC LIMIT 100`,
        links: { Request: toRequest('Request'), Site: toSite('Site') } },
      { name: 'Teams fulfilling it', ...table(12), sql: `
SELECT assignment_group AS "Team", count(*) AS "Tasks", count(*) FILTER (WHERE sla_breached) AS "SLA breached",
       round(100.0 * avg(sla_breached::int), 1) AS "Breached (%)", count(*) FILTER (WHERE is_open) AS "Open now"
FROM reporting.catalog_tasks WHERE item = {{item}} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
        links: { Team: toTeam('Team') } },
      { name: 'Approval outcomes', ...table(12), sql: `
SELECT approval AS "Approval", count(*) AS "Requests", item AS "Catalog item"
FROM reporting.requests WHERE item = {{item}} GROUP BY approval, item ORDER BY 2 DESC`,
        links: { Approval: go('request-list', { item: col('Catalog item'), approval: col('Approval') }) } },
    ],
  },
  {
    key: 'incident-list',
    name: 'Incidents',
    params: listParams(INCIDENT_FILTERS),
    cards: [
      { name: 'Matching incidents', ...SCALAR, sql: `SELECT count(*) AS "Matching incidents" FROM reporting.incidents ${listWhere(INCIDENT_FILTERS)}` },
      { name: 'By team (top 8)', ...row('Team', 'Incidents'), w: 9, h: 6, sql: `
SELECT assignment_group AS "Team", count(*) AS "Incidents" FROM reporting.incidents ${listWhere(INCIDENT_FILTERS)}
GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        click: toTeam('Team') },
      { name: 'By server / system (top 8)', ...row('Server / system', 'Incidents'), w: 9, h: 6, sql: `
SELECT configuration_item AS "Server / system", count(*) AS "Incidents" FROM reporting.incidents ${listWhere(INCIDENT_FILTERS)}
  AND configuration_item IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        click: toSystem('Server / system') },
      { name: 'Incidents', ...table(24, 10), description: 'Newest first, up to 500.', sql: `
SELECT number AS "Incident", created_at AS "Created", priority AS "Priority", state AS "State",
       assignment_group AS "Team", configuration_item AS "Server / system", subcategory AS "Subcategory",
       short_description AS "Summary"
FROM reporting.incidents ${listWhere(INCIDENT_FILTERS)}
ORDER BY created_at DESC LIMIT 500`,
        links: { Incident: toIncident('Incident'), Team: toTeam('Team'), 'Server / system': toSystem('Server / system') } },
    ],
  },
  {
    key: 'change-list',
    name: 'Changes',
    params: listParams(CHANGE_FILTERS),
    cards: [
      { name: 'Matching changes', ...SCALAR, sql: `SELECT count(*) AS "Matching changes" FROM reporting.changes ${listWhere(CHANGE_FILTERS)}` },
      { name: 'By owning team (top 8)', ...row('Owning team', 'Changes'), w: 18, h: 6, sql: `
SELECT owner_group AS "Owning team", count(*) AS "Changes" FROM reporting.changes ${listWhere(CHANGE_FILTERS)}
GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        click: toTeam('Owning team') },
      { name: 'Changes', ...table(24, 10), description: 'Latest planned start first, up to 500.', sql: `
SELECT number AS "Change", planned_start AS "Planned start", type AS "Type", risk AS "Risk", state AS "State",
       approval AS "Approval", CASE WHEN has_outage THEN 'Yes' ELSE 'No' END AS "Outage",
       owner_group AS "Owning team", short_description AS "Summary"
FROM reporting.changes ${listWhere(CHANGE_FILTERS)}
ORDER BY planned_start DESC NULLS LAST LIMIT 500`,
        links: { Change: toChange('Change'), 'Owning team': toTeam('Owning team') } },
    ],
  },
  {
    key: 'request-list',
    name: 'Requests',
    params: listParams(REQUEST_FILTERS),
    cards: [
      { name: 'Matching requests', ...SCALAR, sql: `SELECT count(*) AS "Matching requests" FROM reporting.requests ${listWhere(REQUEST_FILTERS)}` },
      { name: 'By catalog item (top 8)', ...row('Catalog item', 'Requests'), w: 18, h: 6, sql: `
SELECT item AS "Catalog item", count(*) AS "Requests" FROM reporting.requests ${listWhere(REQUEST_FILTERS)}
GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        click: toItem('Catalog item') },
      { name: 'Requests', ...table(24, 10), description: 'Newest first, up to 500.', sql: `
SELECT number AS "Request", item AS "Catalog item", state AS "State", stage AS "Stage", opened_at AS "Opened",
       age_days AS "Open for (days)", nullif(location, '') AS "Site", requested_for AS "Requested for"
FROM reporting.requests ${listWhere(REQUEST_FILTERS)}
ORDER BY opened_at DESC LIMIT 500`,
        links: { Request: toRequest('Request'), 'Catalog item': toItem('Catalog item'), Site: toSite('Site') } },
    ],
  },
  {
    key: 'task-list',
    name: 'Catalog tasks',
    params: listParams(TASK_FILTERS),
    cards: [
      { name: 'Matching catalog tasks', ...SCALAR, sql: `SELECT count(*) AS "Matching catalog tasks" FROM reporting.catalog_tasks ${listWhere(TASK_FILTERS)}` },
      { name: 'By team (top 8)', ...row('Team', 'Tasks'), w: 18, h: 6, sql: `
SELECT assignment_group AS "Team", count(*) AS "Tasks" FROM reporting.catalog_tasks ${listWhere(TASK_FILTERS)}
GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        click: toTeam('Team') },
      { name: 'Catalog tasks', ...table(24, 10), description: 'Newest first, up to 500.', sql: `
SELECT number AS "Task", request_item AS "Request", item AS "Catalog item", assignment_group AS "Team", state AS "State",
       CASE WHEN sla_breached THEN 'Breached' ELSE 'Met' END AS "SLA", created_at AS "Created", age_days AS "Open for (days)"
FROM reporting.catalog_tasks ${listWhere(TASK_FILTERS)}
ORDER BY created_at DESC LIMIT 500`,
        links: { Request: toRequest('Request'), 'Catalog item': toItem('Catalog item'), Team: toTeam('Team') } },
    ],
  },
];

// ---------------------------------------------------------------------
// Metabase API helpers
// ---------------------------------------------------------------------

let session = null;

async function api(method, path, body) {
  const res = await fetch(MB + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Metabase-Session': session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForMetabase() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(MB + '/api/health');
      if (r.ok && (await r.json()).status === 'ok') return;
    } catch { /* still starting */ }
    if (i === 0) console.log(`Waiting for Metabase at ${MB} ...`);
    await sleep(2000);
  }
  throw new Error(`Metabase at ${MB} did not become ready.`);
}

// Lays cards out left to right, wrapping at 24 columns
function layout(cards) {
  let x = 0, y = 0, rowHeight = 0;
  return cards.map(c => {
    if (x + c.w > 24) { x = 0; y += rowHeight; rowHeight = 0; }
    const pos = { col: x, row: y, size_x: c.w, size_y: c.h };
    x += c.w; rowHeight = Math.max(rowHeight, c.h);
    return pos;
  });
}

// ---------------------------------------------------------------------
// Setup steps
// ---------------------------------------------------------------------

async function signIn() {
  const props = await api('GET', '/api/session/properties');
  if (!props['has-user-setup']) {
    const r = await api('POST', '/api/setup', {
      token: props['setup-token'],
      user: { first_name: 'OneTouch', last_name: 'Admin', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, site_name: 'OneTouch' },
      prefs: { site_name: 'OneTouch', site_locale: 'en', allow_tracking: false },
    });
    session = r.id;
    console.log(`Created the Metabase admin account (${ADMIN_EMAIL}).`);
  } else {
    try {
      session = (await api('POST', '/api/session', { username: ADMIN_EMAIL, password: ADMIN_PASSWORD })).id;
    } catch (err) {
      throw new Error(`Metabase is already set up, but signing in as ${ADMIN_EMAIL} failed. ` +
        'Put the Metabase admin email and password in .env (METABASE_ADMIN_EMAIL / METABASE_ADMIN_PASSWORD). ' + err.message);
    }
    console.log(`Signed in to Metabase as ${ADMIN_EMAIL}.`);
  }
}

async function connectDatabase() {
  const details = {
    host: 'postgres', port: 5432, dbname: 'analytics_db',
    user: 'metabase_reader', password: READER_PASSWORD, ssl: false,
    'schema-filters-type': 'inclusion', 'schema-filters-patterns': 'reporting',
  };
  const list = await api('GET', '/api/database');
  const existing = (list.data || list).find(d => d.name === DB_NAME);
  let id;
  if (existing) {
    id = existing.id;
    await api('PUT', `/api/database/${id}`, { details, engine: 'postgres', name: DB_NAME });
  } else {
    id = (await api('POST', '/api/database', { engine: 'postgres', name: DB_NAME, details, is_full_sync: true })).id;
    console.log(`Connected Metabase to the reporting views as metabase_reader.`);
  }
  await api('POST', `/api/database/${id}/sync_schema`);
  // Wait until Metabase has seen the views, so cards can be saved against them
  for (let i = 0; i < 60; i++) {
    const meta = await api('GET', `/api/database/${id}/metadata`);
    const names = (meta.tables || []).map(t => t.name);
    if (['incidents', 'changes', 'requests', 'catalog_tasks', 'approvals'].every(n => names.includes(n))) return id;
    await sleep(2000);
  }
  throw new Error('Metabase did not finish reading the reporting views. Is the db-setup service done?');
}

async function freshCollection() {
  const collections = await api('GET', '/api/collection');
  const existing = collections.find(c => c.name === COLLECTION_NAME && !c.archived && !c.personal_owner_id);
  if (existing) {
    // Rebuild from scratch: archive what the previous run made
    const items = await api('GET', `/api/collection/${existing.id}/items`);
    for (const item of items.data || items) {
      if (item.model === 'dashboard') await api('PUT', `/api/dashboard/${item.id}`, { archived: true });
      if (item.model === 'card') await api('PUT', `/api/card/${item.id}`, { archived: true });
    }
    return existing.id;
  }
  return (await api('POST', '/api/collection', { name: COLLECTION_NAME, color: '#10a37f', description: 'Dashboards built by OneTouch (scripts/metabase-setup.mjs). Re-running the script rebuilds them.' })).id;
}

// The {{name}} variables a card's SQL uses, as Metabase template tags. Each
// must be one of the dashboard's filters (`params`), which fill it.
function templateTags(sql, def) {
  const names = [...new Set([...sql.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(m => m[1]))];
  return Object.fromEntries(names.map(name => {
    const param = (def.params || []).find(p => p.slug === name);
    if (!param) throw new Error(`"${def.name}": {{${name}}} is not one of its filters.`);
    return [name, { id: randomUUID(), name, 'display-name': param.name, type: 'text' }];
  }));
}

// A click (go(...)) as a Metabase click behaviour: a link to the target's
// public page, its filters set from the clicked row (Metabase URL-encodes
// {{Column}} values) or to fixed text. Filters the link doesn't set are
// hidden, and the page title too: OneTouch's toolbar names the page.
function clickBehavior(link, shells) {
  const target = shells.get(link.to);
  if (!target) throw new Error(`Click target "${link.to}" is not a dashboard.`);
  const slugs = (target.def.params || []).map(p => p.slug);
  const query = Object.entries(link.params).map(([slug, value]) => {
    if (!slugs.includes(slug)) throw new Error(`"${target.def.name}" has no filter "${slug}".`);
    return `${slug}=${value.col ? `{{${value.col}}}` : encodeURIComponent(value)}`;
  }).join('&');
  const unused = slugs.filter(s => !(s in link.params));
  const hash = ['titled=false', 'bordered=false', ...(unused.length ? [`hide_parameters=${unused.join(',')}`] : [])].join('&');
  return { type: 'link', linkType: 'url', linkTemplate: `/public/dashboard/${target.uuid}?${query}#${hash}` };
}

// A card's click settings for its dashboard: whole-card `click`, per-column `links`
function clickSettings(c, shells) {
  const settings = {};
  if (c.click) settings.click_behavior = clickBehavior(c.click, shells);
  if (c.links) {
    settings.column_settings = Object.fromEntries(Object.entries(c.links).map(([column, link]) =>
      [JSON.stringify(['name', column]), { click_behavior: clickBehavior(link, shells) }]));
  }
  return settings;
}

// Catches mistakes in DASHBOARDS / DETAILS before anything in Metabase changes
function checkDefinitions() {
  const all = [...DASHBOARDS, ...DETAILS];
  const keys = all.map(d => d.key);
  const dupe = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dupe) throw new Error(`Two dashboards use the key "${dupe}".`);
  const fake = new Map(all.map(def => [def.key, { def, uuid: 'check' }]));
  for (const def of all) {
    for (const c of def.cards) {
      templateTags(c.sql, def);
      clickSettings(c, fake);
    }
  }
}

// Step 1: an empty dashboard with its public link, so every page's address
// is known before any link to it is written
async function createShell(def, collectionId) {
  const dash = await api('POST', '/api/dashboard', { name: def.name, description: def.description || null, collection_id: collectionId });
  const { uuid } = await api('POST', `/api/dashboard/${dash.id}/public_link`);
  return { id: dash.id, uuid, def };
}

// Step 2: its cards, filters, and what clicking each card opens
async function fillDashboard(shell, databaseId, collectionId, shells) {
  const { def } = shell;
  const positions = layout(def.cards);
  const dashcards = [];
  for (const [i, c] of def.cards.entries()) {
    const tags = templateTags(c.sql, def);
    const card = await api('POST', '/api/card', {
      name: c.name,
      // Shown as the (i) tip on the chart: how to read it
      description: c.description || null,
      collection_id: collectionId,
      display: c.display,
      visualization_settings: c.viz || {},
      dataset_query: { type: 'native', native: { query: c.sql.trim(), 'template-tags': tags }, database: databaseId },
    });
    dashcards.push({
      id: -(i + 1), card_id: card.id, ...positions[i],
      visualization_settings: clickSettings(c, shells),
      parameter_mappings: Object.keys(tags).map(tag => ({
        parameter_id: `p_${tag}`, card_id: card.id, target: ['variable', ['template-tag', tag]],
      })),
    });
  }
  await api('PUT', `/api/dashboard/${shell.id}`, {
    parameters: (def.params || []).map(p => ({ id: `p_${p.slug}`, name: p.name, slug: p.slug, type: 'string/=', sectionId: 'string' })),
    dashcards,
  });
  console.log(`Built "${def.name}"${def.params ? ' (detail page)' : ''}: ${def.cards.length} charts.`);
}

// ---------------------------------------------------------------------

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !READER_PASSWORD) {
    throw new Error('Set METABASE_ADMIN_EMAIL, METABASE_ADMIN_PASSWORD and METABASE_DB_PASSWORD in .env, ' +
      'then run `docker compose up -d` so the app container sees them.');
  }
  checkDefinitions();
  await waitForMetabase();
  await signIn();
  await api('PUT', '/api/setting/enable-public-sharing', { value: true });
  const databaseId = await connectDatabase();
  const collectionId = await freshCollection();

  const shells = new Map();
  for (const def of [...DASHBOARDS, ...DETAILS]) shells.set(def.key, await createShell(def, collectionId));
  for (const shell of shells.values()) await fillDashboard(shell, databaseId, collectionId, shells);

  // The drawer lists `dashboards`; `details` lets OneTouch name the page a click opened
  await writeFile(OUTPUT_FILE, JSON.stringify({
    dashboards: DASHBOARDS.map(d => ({ key: d.key, group: d.group, name: d.name, description: d.description, uuid: shells.get(d.key).uuid })),
    details: DETAILS.map(d => ({ key: d.key, name: d.name, uuid: shells.get(d.key).uuid, params: d.params })),
  }, null, 2) + '\n');
  console.log(`Saved the public links to ${OUTPUT_FILE}; the OneTouch Dashboards tab shows them now.`);
}

try {
  await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
```

<a id="b32"></a>
### B.32 `remote.mjs`

```js
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
```

<a id="b33"></a>
### B.33 `.claude/agents/onetouch-developer.md`

```markdown
---
name: onetouch-developer
description: Builds and changes features in OneTouch (the ITIL analytics tool in this repo) - chat/translator, exports, sign-in and accounts, Metabase dashboards, reporting views, Docker setup. Use it for any implementation work in this repo; it knows the architecture, how to run and test the stack, and the project's known pitfalls.
---

You implement changes in OneTouch, an internal ITIL analytics tool: people ask questions in plain English about a frozen ServiceNow export, and Claude turns them into Cube queries. Make the change, run it, check it works, and report what you verified and what you could not.

## How the pieces fit

| File | Role |
|---|---|
| `server.mjs` | Express app (port 8000): sign-in routes, `/api/query` (one-shot translator with per-session conversation memory), `/api/export`, dashboards list, and a pass-through of Metabase public-dashboard pages |
| `business_logic.mjs` | Everything Claude knows about the data: `ENTITY_CATALOG`, `buildSystemPrompt()` (sections A-E), `OUTPUT_SCHEMA`, and `normalizeAndValidate()`, which every Claude-built query passes through before Cube |
| `empty_results.mjs` | When a query returns nothing: re-runs it minus one filter at a time, then Claude explains why |
| `export.mjs` | Tables -> pdf/docx/xlsx/csv/txt/rtf, and zip/7z bundles (7-Zip) |
| `auth.mjs` | Accounts and sessions in the `onetouch_auth` Postgres DB (its own role `onetouch_app`); scrypt hashes; `db/accounts.json` export/sync |
| `remote.mjs` | "Remote mode" for clones: serves `public/` on localhost and forwards `/api`, `/public`, `/app` to a OneTouch server |
| `public/` | The single-page UI (`index.html`, `app.js`, `style.css`); no build step |
| `db/` | `init-auth.sh`, `init-reporting.sh`, `reporting-views.sql` (typed `reporting.*` views for Metabase), `accounts.json` |
| `scripts/users.mjs` | Account admin CLI (add, import CSV, export, sync, ...) |
| `scripts/metabase-setup.mjs` | Builds the Metabase dashboards (the `DASHBOARDS` list, each with its drawer `group`) and the drill-down pages clicks open (`DETAILS`; each chart's `click` / table's `links` say where a click goes) via Metabase's API; checks every link before changing anything; rerunnable. Writes `metabase-dashboards.json`, which the Dashboards tab reads |
| `model/cubes/*.yml` | Cube data model over `analytics_db` |
| `docker-compose.yml` | postgres, db-setup (runs `db/init-*.sh` on every `up`), cube, metabase, app, optional Cloudflare tunnels |

## Running and testing

- The project folder is mounted into the app container. After changing server-side `.mjs` files: `docker restart analytics_node_app`. `public/` changes only need a browser refresh. New npm dependencies: `docker compose up -d --build -V app` (`-V` because `node_modules` is an anonymous volume).
- Logs: `docker logs --tail 50 analytics_node_app`. Lines starting 🔐 are sign-in, 🤖 Cube queries, 🔎 empty-result diagnosis.
- API calls need a session: `POST /api/login` with `{username, password}`, then `Authorization: Bearer <token>`.
- Claude calls cost money. Prefer testing validators, exports and Cube queries directly; make real Claude calls only to verify prompt behaviour, and say how many you made.
- To run a second, throwaway stack beside the real one, use a compose override that changes every `container_name` and uses `ports: !override [...]`, and a different project name (`docker compose -p some-test ...`). Remove it with `down -v` when done.
- For UI checks, headless Edge driven over the DevTools protocol works on this machine.

## Conventions

- Plain JavaScript ES modules (`.mjs`), no TypeScript, no bundler. Match the surrounding comment style: short plain-English comments that say why, and banner comments for sections.
- Anything put into HTML goes through `escapeHtml` (or `textContent`). Model output and data values are untrusted.
- User-facing wording is plain English: no internal member names like `incident.state`.
- Secrets live only in `.env` (git-ignored); `.env.example` lists every variable with a placeholder. Compose uses `${VAR:?message}` for required ones.

## Pitfalls this project has already hit

- **Windows + Git Bash:** `docker exec ... /some/path` gets rewritten to `C:/Program Files/Git/...`; prefix commands with `MSYS_NO_PATHCONV=1`. `core.autocrlf` is on, so shell scripts rely on `.gitattributes` (`*.sh eol=lf`).
- **ES module order:** imports run before `dotenv.config()`, so read `process.env` lazily (see the lazy pool in `auth.mjs`).
- **Postgres init scripts only run on a brand-new volume.** Anything that must exist on existing installs goes in the `db-setup` service scripts, written to be safe to re-run.
- **The data is text and frozen.** Every raw column is `text`; timestamps are `'YYYY-MM-DD HH:MM:SS'` strings, also in Cube. Ages and "upcoming" use the newest timestamp in the data (`reporting.data_as_of`), not today. `configuration_item = 'zzz'` is a placeholder.
- **Claude conversation history is append-only.** Never edit or drop earlier turns, and pass assistant `content` back exactly as returned (thinking blocks included); Sonnet 5.5 rejects or ignores altered history. New context goes into the next user turn (see `pendingNote`).
- **Claude Sonnet 5.5 API rules:** forced `tool_choice` (`any`/`tool`) and `thinking: {type: "disabled"}` return 400. Steer with the prompt; control depth with `output_config.effort`.
- **Every model-built query goes through `normalizeAndValidate`.** Don't add a path that sends model output to Cube unvalidated.
- **Accounts:** after changing accounts, run `node scripts/users.mjs export` and commit `db/accounts.json` (hashes only), so clones get them.

## Before you finish

Run `node --check` on every file you changed, restart what needs restarting, and exercise the change for real (curl, a script, or the browser). Report exactly what you ran and what you saw, including anything that failed or that you could not test.
```

<a id="b34"></a>
### B.34 `.claude/agents/onetouch-reviewer.md`

```markdown
---
name: onetouch-reviewer
description: Reviews changes to OneTouch (this repo) for bugs and for the project's specific risks - sign-in and data exposure, secrets, Claude API misuse, unvalidated queries, Docker/Windows setup breakage. Use it on a diff, a branch, or before a pull request. It reports findings; it does not edit files.
tools: Read, Grep, Glob, Bash
---

You review changes to OneTouch, an internal ITIL analytics tool (Express + Cube + Postgres + Metabase + the Claude API, run with Docker Compose on Windows machines). Find real problems; do not edit files.

Start from the diff (`git diff`, `git diff main...HEAD`, or what you were pointed at), then read enough surrounding code to judge each change. For every finding, give the file and line, what goes wrong, and a concrete scenario that triggers it. Rank by severity. Say plainly when you find nothing serious; don't pad with style nits.

## What to check, in this order

**1. Access and data exposure**
- Every new `/api/...` route that reads or changes data must be covered by `requireLogin` (the `app.use([...], requireLogin)` list in `server.mjs`).
- Per-user data (sessions, and anything new that belongs to one person) must be scoped by `req.user.id`, never by an id from the request alone.
- The Metabase pass-through in `server.mjs` must stay limited to public-dashboard paths (`METABASE_PATHS`); widening it would expose Metabase's admin API through OneTouch.
- Ports in `docker-compose.yml`: only the app (8000) may listen beyond `127.0.0.1`. Postgres, Cube and Metabase must stay on `127.0.0.1`.
- Model output and data values reaching HTML must go through `escapeHtml` / `textContent`.

**2. Secrets**
- No passwords, API keys or tokens in tracked files. `.env` is git-ignored; new variables belong in `.env.example` with placeholders.
- Never commit a CSV of plain-text passwords. `db/accounts.json` may only hold `scrypt$...` hashes.

**3. Claude API usage**
- Earlier conversation turns must never be edited or dropped. Assistant `content` goes back unchanged (thinking blocks included); new context goes in the next user turn.
- Claude Sonnet 5.5: forced `tool_choice` (`any`/`tool`) and `thinking: {type: "disabled"}` are 400 errors.
- Check `stop_reason` (`refusal`, `max_tokens`, unfinished `tool_use`) before trusting the output.
- Any query built by the model must pass through `normalizeAndValidate` before reaching Cube.

**4. Setup that breaks on other machines**
- Shell scripts must keep LF line endings (`.gitattributes`); Windows checkouts convert otherwise.
- Database objects needed on existing installs must be created by the re-runnable `db-setup` scripts, not only by Postgres's first-start init.
- New npm dependencies need `package.json` and `package-lock.json` updated; the README should say when collaborators must rebuild (`docker compose up -d --build -V`).
- Code that reads `process.env` at import time may run before `dotenv.config()`.

**5. Data correctness**
- All raw columns are text; dates are `'YYYY-MM-DD HH:MM:SS'` strings. Watch string-vs-number comparisons and date maths.
- The data is a frozen snapshot: "age", "open for N days" and "upcoming" should use the data's newest timestamp, not today, unless deliberately so.
- Weekly or monthly charts should not include partial periods at the edges of the export.

Useful commands (read-only): `git diff`, `git log`, `node --check <file>`, `docker compose config -q`, `docker logs --tail 50 analytics_node_app`. Don't restart containers or call paid APIs while reviewing.
```

<a id="b35"></a>
### B.35 `scripts/check.mjs`

```js
// Quick checks that need no data, no API key and no running containers.
//
//   npm run check
//
// 1. `node --check` on every tracked .mjs / .js file (syntax only, nothing runs)
// 2. `sh -n` on db/*.sh, and that they keep LF line endings
// 3. `docker compose config -q` with .env.example, if Docker is installed
// 4. documentation.md's appendix matches the code (scripts/build-docs.mjs --check)
//
// Exits non-zero if anything fails. Takes about a second.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const failures = [];
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') return null;
  if (r.status !== 0) failures.push(`${label}\n${(r.stderr || r.stdout).trim()}`);
  return r.status === 0;
}

const jsFiles = tracked.filter(f => /\.(mjs|js)$/.test(f));
for (const f of jsFiles) run(`node --check ${f}`, process.execPath, ['--check', f]);
console.log(`node --check: ${jsFiles.length} files`);

const shFiles = tracked.filter(f => /^db\/.*\.sh$/.test(f));
let shChecked = 0;
for (const f of shFiles) {
  if (readFileSync(f, 'utf8').includes('\r\n')) failures.push(`${f} has CRLF line endings (must be LF)`);
  if (run(`sh -n ${f}`, 'sh', ['-n', f]) !== null) shChecked++;
}
console.log(`shell scripts: ${shFiles.length} checked for LF, ${shChecked} for syntax${shChecked ? '' : ' (no sh found, skipped)'}`);

const compose = run('docker compose config', 'docker', ['compose', '--env-file', '.env.example', 'config', '-q']);
console.log(`docker compose config: ${compose === null ? 'skipped (no docker)' : compose ? 'ok' : 'failed'}`);

const docs = run('documentation.md', process.execPath, ['scripts/build-docs.mjs', '--check']);
console.log(`documentation.md: ${docs ? 'up to date' : 'out of date'}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
```

<a id="b36"></a>
### B.36 `scripts/build-docs.mjs`

```js
// Rebuilds the generated part of documentation.md: the appendix with every
// source file's full contents, and the table of package versions. The
// hand-written guide above it is left alone.
//
//   npm run docs              rewrite documentation.md
//   node scripts/build-docs.mjs --check   fail if it is out of date (npm run check does this)
//
// Every tracked file must be either in FILES (copied in full) or in SKIPPED
// (with the reason the guide gives). A new file that is in neither fails the
// check, so the guide can't silently fall behind the repo.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const DOC = 'documentation.md';
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
  'scripts/check.mjs', 'scripts/build-docs.mjs', 'README.md',
];

// Not copied in, and why (shown in the appendix)
const SKIPPED = {
  'documentation.md': 'this file',
  'package-lock.json': 'written by `npm install`; the versions it pins are in the table above',
  'db/accounts.json': "everyone's usernames and password hashes; make your own accounts instead (step 16)",
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
```

<a id="b37"></a>
### B.37 `README.md`

````markdown
## EVERYONE HAS THEIR OWN BRANCHES!!

# OneTouch

Ask questions about the ServiceNow export in plain English and download the results.

One computer runs the full tool (the **server**). Everyone else signs in to it with
the username and password they were given.

## Branch history and checks

`documentation.md` rebuilds OneTouch from scratch, step by step, with every file printed in
full, and shows where each branch sits. After any change run `npm run docs` to refresh it,
and `npm run check` (about a second, no Docker or API key needed) before each commit.

## Coding helpers (Claude Code)

The repo includes two Claude Code subagents in `.claude/agents/`:

- **onetouch-developer** builds features: it knows how OneTouch fits together, how to run
  and test it, and the pitfalls this project has hit.
- **onetouch-reviewer** reviews a diff or branch for this project's risks (sign-in and data
  exposure, secrets, Claude API rules, setup that breaks on other machines). Read-only.

In Claude Code, ask for them by name (e.g. "use onetouch-reviewer on my branch"), or see
them with `/agents`.

## Using OneTouch from a clone of this repo (remote mode)

You don't need Docker, the data, or an API key. Your `localhost:8000` shows the tool
and passes everything to the OneTouch server, where your account lives.

1. Install [Node.js](https://nodejs.org) 18 or newer.
2. In the cloned folder, run once:
   ```
   npm install
   ```
3. Ask whoever runs OneTouch for the **server address**, then start remote mode with it:
   ```
   npm run remote -- https://the-link-you-were-given.trycloudflare.com
   ```
   On the same network as the server you can use its network address instead,
   e.g. `npm run remote -- http://192.168.5.106:8000`.
4. Open **http://localhost:8000** and sign in with your own username and password.

Keep the terminal open while you use it; press `Ctrl+C` to stop. You can put the address
in a `.env` file as `ONETOUCH_SERVER=...` and then just run `npm run remote`.
If port 8000 is busy, set `REMOTE_PORT=8100` (and open `localhost:8100`).

You can also skip all of this and open the server address directly in your browser.

## Running your own full copy (works without anyone else's computer)

1. Install Docker Desktop and clone this repo.
2. Copy `.env.example` to `.env`. Put an Anthropic API key in `ANTHROPIC_API_KEY`;
   the other values can stay as they are for a local copy.
3. Get the ServiceNow export (the six CSVs) from the team and put them in a `csv_data/`
   folder. Without them the tool still starts and you can sign in, but every question
   comes back empty. (Add them before the first start, or see "Reloading the data".)
4. Run `docker compose up -d` and open http://localhost:8000.
5. Sign in with your usual username and password. Everyone's accounts come with the
   repo in `db/accounts.json` and are loaded automatically.

**Getting account changes:** when someone is added, has their password reset, or is
deactivated, the person who made the change exports and commits `db/accounts.json`.
Pull, then restart your copy (`docker compose restart app`) to pick it up.

**Reloading the data:** the CSVs are only loaded the first time the database starts.
To load them later, `docker compose down -v` (this also clears your copy's sign-in
sessions; accounts come back from `db/accounts.json`), then `docker compose up -d`.

## Running the server

Needs Docker Desktop, the CSV export in `csv_data/`, and a `.env` file
(copy `.env.example` and fill in every value). Then:

```
docker compose up -d
```

The tool is at http://localhost:8000. Only port 8000 is reachable from other computers;
Postgres, Cube and Metabase only accept connections from the server itself.

### Sharing it

**Same network (office Wi-Fi or VPN).** Others open `http://<server's IP address>:8000`
(find the IP with `ipconfig`). Nothing else to set up. Traffic is not encrypted, so
only use this on a network you trust.

**Over the internet (Cloudflare Tunnel).** Get permission first: this puts company data
behind a public link.

```
docker compose --profile tunnel up -d tunnel     # start
docker logs onetouch_tunnel                      # find the https://....trycloudflare.com link
docker compose stop tunnel                       # stop sharing
```

The quick-tunnel link changes every time the tunnel starts, so send people the new one.
For a permanent address, create a tunnel in a Cloudflare account (service:
`http://app:8000`), put its token in `.env` as `TUNNEL_TOKEN`, and use
`docker compose --profile tunnel-named up -d tunnel-named` instead.

### Dashboards (Metabase)

Ten ITIL dashboards appear in OneTouch's **Dashboards** tab. Open them from the
**☰ Dashboards** drawer in its top-left corner:

| Group | Dashboards |
|---|---|
| Overview | IT Operations Overview, Sites & Breweries |
| Incidents & Problems | Service Desk, Problems & Major Incidents, Monitoring & Alerts, Workload & Channels |
| Change | Change / CAB, Change Risk & Business Impact |
| Requests | Requests, Automation & Self-service |

To create them on a server:

1. Fill in `METABASE_DB_PASSWORD`, `METABASE_ADMIN_EMAIL` and `METABASE_ADMIN_PASSWORD`
   in `.env`. If you already set up Metabase yourself, use that admin login.
2. Run `docker compose up -d` (creates the reporting views and Metabase's read-only user).
3. Run:
   ```
   docker exec analytics_node_app node scripts/metabase-setup.mjs
   ```

Re-run step 3 any time; it rebuilds the dashboards in Metabase's "OneTouch ITIL"
collection and never touches anything else. The charts, and which drawer group each
dashboard sits in, are defined in `scripts/metabase-setup.mjs`; the data they read
in `db/reporting-views.sql`.

**Drilling down.** Click a bar, pie slice, line point, big number or blue table value
to open a detail page for it: a record (incident, change, request), a team, a server or
system, a site or brewery, a problem record, a catalog item, or a filtered list (e.g.
"Incidents · Priority: P2 - High"). Detail pages link onward too; on a record, use the
blue **Go to** row under it. OneTouch's toolbar shows where you are, with **← Back**.
What each click opens is set by `click` / `links` on the charts in
`scripts/metabase-setup.mjs`; the detail pages are its `DETAILS` list.

Metabase itself is at http://localhost:3000 on the server only. The dashboards are
public links that OneTouch passes through, so anyone with the link can view them.

### Accounts

Accounts live in the server's own Postgres database (`onetouch_auth`). Manage them on the server:

```
docker exec -it analytics_node_app node scripts/users.mjs list
docker exec -it analytics_node_app node scripts/users.mjs add jsmith "Jane Smith"
docker exec -it analytics_node_app node scripts/users.mjs reset-password jsmith
docker exec -it analytics_node_app node scripts/users.mjs deactivate jsmith
docker exec -it analytics_node_app node scripts/users.mjs activate jsmith
```

Many at once, from a CSV with the columns `Username, Display Name, Password` (PowerShell):

```
Get-Content people.csv | docker exec -i analytics_node_app node scripts/users.mjs import -
```

Never commit that CSV: it holds everyone's passwords.

**Sharing accounts with clones.** After any change above, write the accounts file and commit it:

```
docker exec analytics_node_app node scripts/users.mjs export
git add db/accounts.json
git commit -m "Update accounts"
```

`db/accounts.json` holds usernames, display names and password *hashes*, never the
passwords themselves. Every copy loads it on start: missing accounts are added, and an
account is only overwritten by a more recent change, so an old file never undoes a newer
password reset or deactivation.
````

## Appendix C: images

Make or download an image with the same name and size (step 14). The SHA-256 lets you check a copy against the original.

| File | What it is | Bytes | SHA-256 |
|---|---|---|---|
| `public/favicon.ico` | browser tab icon (16, 32 and 48 px inside one .ico) | 15,406 | `88a6812f2766f503…` |
| `public/favicon-16x16.png` | tab icon, 16×16 | 807 | `2fcfb1a29f6035d5…` |
| `public/favicon-32x32.png` | tab icon, 32×32; also shown on the sign-in box | 2,524 | `eae0050504b36a90…` |
| `public/apple-touch-icon.png` | iPhone/iPad home-screen icon, 180×180 | 21,591 | `84e9c21ace9b8766…` |
| `public/android-chrome-192x192.png` | app icon, 192×192; also the logo in the page header | 23,940 | `a2952fb3ef65d248…` |
| `public/android-chrome-512x512.png` | app icon, 512×512 | 56,975 | `892dc6ece74849f2…` |
| `public/molsoncoorslogo.png` | Molson Coors logo above the sign-in box, 320×143 | 17,266 | `3337f757109fc033…` |
| `public/microsoftlogo.png` | Microsoft logo on the "Microsoft Entra ID" button, 447×447 | 2,317 | `20479b072c51b6c4…` |
| `molsoncoorslogo.png` | unused copy of public/molsoncoorslogo.png | 17,266 | `3337f757109fc033…` |
| `microsoftlogo.png` | unused copy of the Microsoft logo, 447×447 | 1,273 | `d08ad38884617b08…` |
| `microsoftlogo (1).png` | unused copy of public/microsoftlogo.png | 2,317 | `20479b072c51b6c4…` |

## Appendix D: files not copied here

| File | Why |
|---|---|
| `documentation.md` | this file |
| `package-lock.json` | written by `npm install`; the versions it pins are in the table above |
| `db/accounts.json` | everyone's usernames and password hashes; make your own accounts instead (step 16) |

<!-- END GENERATED -->
