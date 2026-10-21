# OneTouch: how each branch got where it is

This file lists, in order, the steps that built OneTouch, and marks where each branch
(`main`, `Ventura`, `Luke`, `Q`) currently sits. Update it in the same commit or PR as any
change, so it always matches the repository.

Last updated: 2026-10-21, at `main` = `b377932` (PR #20).

## Where each branch is

| Branch | Tip | Compared with `main` | To bring it up to date |
|---|---|---|---|
| `main` | `b377932` (PR #20) | default branch | — |
| `Ventura` | `374371c` | same content as `main` (its last commit is what PR #20 merged) | nothing needed |
| `Luke` | `38b08cf` (PR #13) | 0 ahead, 5 commits behind (steps 14–20) | `git checkout Luke && git merge origin/main` |
| `Q` | `edd9250` (PR #12) | 0 ahead, 6 commits behind (steps 13–20) | `git checkout Q && git merge origin/main` |

No branch has work that `main` lacks, so every branch is one point on the history below.
All PRs so far come from `Ventura` into `main`.

To refresh this table:

```
git fetch --all
git rev-list --left-right --count origin/main...origin/<branch>   # "<main-only> <branch-only>"
git log --oneline origin/<branch>..origin/main                     # what the branch is missing
```

## Steps, in order

Each step names the commit or PR that made it. Checking out that commit gives the
repository exactly as it was after the step.

### Setup (Oct 5–8)

1. **First version** (`8faf290`, Oct 5). Plain-English questions about the ServiceNow
   export, translated by Claude into Cube queries. No sign-in, no business logic, no charts.
2. **Docker stack working** (`fd08cbc` … `39c7dc3`, Oct 6). Tracked `package.json`, added the
   `Dockerfile`, and fixed `docker-compose.yml`, the Cube model, `server.mjs` and `app.js`
   until the stack ran end to end.
3. **Per-person branches** (`e80a6d9`, Oct 8). README note that everyone works on their own branch.

### Features (Oct 19–20)

4. **PR #1: business logic.** `business_logic.mjs` and `BUSINESS_LOGIC.md` (ITIL rules the
   translator applies).
5. **PR #2: readable answers.** Results shown in English instead of raw JSON.
6. **PR #3: business logic fixes.**
7. **PR #4, #6: OneTouch branding** in the page title and welcome text.
8. **PR #5 and `4eecc63`: favicons** and site icons in `public/`.
9. **PR #7: downloads and welcome message.** `export.mjs` (Excel, Word, PDF and zip downloads of results).
10. **`6b49ff4`, `a857168`: Microsoft and Molson Coors logo files** at the repo root.
11. **PR #8: sign-in page.** Sign-in screen with a first user, the logos in `public/`, and the SSO template `onetouchsso.html`.
12. **PR #9: conversation memory.** Claude keeps context across questions.
13. **PR #10: accounts.** `auth.mjs`, users with passwords and display names, `scripts/users.mjs`, `db/init-auth.sh`.
14. **PR #11: sign-in page fixes.**
15. **PR #12: user and password fixes.** `db/accounts.json` shared with clones, and `load_csv.sql`. ← **`Q` is here**
16. **PR #13: fixes.** ← **`Luke` is here**
17. **PR #14: Metabase charts.** Metabase in `docker-compose.yml`, `db/reporting-views.sql`,
    `db/init-reporting.sh`, `scripts/metabase-setup.mjs`, the Dashboards tab.
18. **PR #15: better responses** from the translator.
19. **PR #16: Claude Code agents** in `.claude/agents/` (`onetouch-developer`, `onetouch-reviewer`).
20. **PR #17: dashboards drawer** with grouped views. (PR #18 and #19 only synced `main` and `Ventura`.)
21. **PR #20: better Metabase dashboards**, with drill-down detail pages. ← **`main` and `Ventura` are here**
22. **Quick checks and this file** (this PR). `npm run check` and `documentation.md`.

## Getting a working copy at the current state

See README.md for the full detail. In short:

1. Install Docker Desktop and Node.js 18+, and clone the repo.
2. Copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, and replace the `change_me` values.
3. Put the six ServiceNow CSVs in `csv_data/`.
4. `docker compose up -d`, then open http://localhost:8000 and sign in.
5. For dashboards: `docker exec analytics_node_app node scripts/metabase-setup.mjs`.

Or, to use someone else's server without Docker: `npm install`, then
`npm run remote -- <server address>`.

## Checks

There is no CI and no test suite yet. Run this before every commit:

```
npm run check
```

It takes about a second and needs no data, API key or running containers. It runs
`node --check` on every tracked `.mjs`/`.js` file, checks `db/*.sh` for shell syntax and
LF line endings, and validates `docker-compose.yml` against `.env.example` (skipped if
Docker isn't installed).

After that, test the change itself against a running stack (see
`.claude/agents/onetouch-developer.md`). Avoid real Claude calls unless you are checking
prompt behaviour, because they cost money.
