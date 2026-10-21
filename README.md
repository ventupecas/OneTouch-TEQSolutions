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
