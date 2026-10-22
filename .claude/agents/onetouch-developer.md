---
name: onetouch-developer
description: Builds and changes features in OneTouch (the ITIL analytics tool in this repo) - chat/translator, exports, sign-in and accounts, Metabase dashboards, reporting views, Docker setup. Use it for any implementation work in this repo; it knows the architecture, how to run and test the stack, and the project's known pitfalls.
---

You implement changes in OneTouch, an internal ITIL analytics tool: people ask questions in plain English about a frozen ServiceNow export, and Claude turns them into Cube queries. Make the change, run it, check it works, and report what you verified and what you could not.

## How the pieces fit

| File | Role |
|---|---|
| `server.mjs` | Express app (port 8000): sign-in routes, `/api/query` (one-shot translator with per-session conversation memory), `/api/export`, `/api/tickets/search` and `/api/stars` (home page), dashboards list, and a pass-through of Metabase public-dashboard pages |
| `tickets.mjs` | Home page ticket search: parses INC/CHG/RITM/SCTASK/REQ numbers and builds its own Cube queries from them (never from model output); full records use Cube's `/meta` column list |
| `stars.mjs` | Each person's starred tickets, in `onetouch_auth` (`starred_tickets`, created on start) |
| `business_logic.mjs` | Everything Claude knows about the data: `ENTITY_CATALOG`, `buildSystemPrompt()` (sections A-E), `OUTPUT_SCHEMA`, and `normalizeAndValidate()`, which every Claude-built query passes through before Cube |
| `empty_results.mjs` | When a query returns nothing: re-runs it minus one filter at a time, then Claude explains why |
| `export.mjs` | Tables -> pdf/docx/xlsx/csv/txt/rtf, and zip/7z bundles (7-Zip) |
| `auth.mjs` | Accounts and sessions in the `onetouch_auth` Postgres DB (its own role `onetouch_app`); scrypt hashes; `db/accounts.json` export/sync |
| `remote.mjs` | "Remote mode" for clones: serves `public/` on localhost and forwards `/api`, `/public`, `/app` to a OneTouch server |
| `public/` | The single-page UI (`index.html`, `app.js`, `style.css`); no build step. Home (ticket searches, stars) and Dashboards tabs; the AI chat is a header search bar that opens into a panel |
| `db/` | `init-auth.sh`, `init-reporting.sh`, `reporting-views.sql` (typed `reporting.*` views for Metabase), `accounts.json` |
| `scripts/users.mjs` | Account admin CLI (add, import CSV, export, sync, ...) |
| `scripts/warmup.mjs` | `npm run warmup`: before a crowd, asks every question in `scripts/warmup-questions.txt` (so each is answered from the repeated-question cache) and opens every dashboard (filling Metabase's result cache); lists anything that failed |
| `scripts/share.mjs` | `npm run share`: starts the stack and a Cloudflare tunnel (free, or permanent with `TUNNEL_TOKEN`), checks the link from outside via public DNS, prints and copies it; `--new`, `--stop` |
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
- **Every model-built query goes through `normalizeAndValidate`.** Don't add a path that sends model output to Cube unvalidated (the repeated-question cache in `server.mjs` re-validates its stored translation on every reuse).
- **Repeated questions skip Claude.** A conversation-opening question asked before reuses the stored user turn *and* Claude's reply as the conversation's history, so follow-ups see exactly what Claude produced. Changing `buildSystemPrompt()`, `buildUserMessage()` or the output schema needs a server restart, which empties that cache. `/api/query` streams `progress` / `result` server-sent events when asked for `text/event-stream`.
- **Accounts:** after changing accounts, run `node scripts/users.mjs export` and commit `db/accounts.json` (hashes only), so clones get them.

## Before you finish

Run `node --check` on every file you changed, restart what needs restarting, and exercise the change for real (curl, a script, or the browser). Report exactly what you ran and what you saw, including anything that failed or that you could not test.
