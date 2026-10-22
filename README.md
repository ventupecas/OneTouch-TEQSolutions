## USE GUIDE, DOCUMENTATION, BUILD FROM SCRATCH!!!

# OneTouch

Ask questions about the ServiceNow export in plain English, get the answers as tables,
download them in eight formats, and explore ten ITIL dashboards.

One computer runs the full tool (the **server**). Everyone else signs in to it with the
username and password they were given.

This file holds everything about OneTouch:

- **[Part 1: Using and running OneTouch](#part-1-using-and-running-onetouch)**: how to reach
  it, run your own copy, run the server, share it, set up dashboards and manage accounts.
- **[Part 2: Every feature, in detail](#part-2-every-feature-in-detail)**: what each part of
  OneTouch does, how it behaves, and its limits.
- **[Part 3: Building it from scratch](#part-3-building-it-from-scratch)**: 22 steps to
  rebuild OneTouch without cloning the repository, with every file printed in full in
  [Appendix B](#appendix-b-every-file-in-full).
- **[Branches and history](#where-each-branch-is)**: where each branch is and how the
  repository got here.

Keep it current: after any change to the code, run `npm run docs` and commit the updated
README. `npm run check` (about a second, with no Docker or API key needed) fails when this
file no longer matches the code, so run it before each commit.

---

# Part 1: Using and running OneTouch

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

Keep the terminal open while you use it, and press `Ctrl+C` to stop. You can put the
address in a `.env` file as `ONETOUCH_SERVER=...` and then just run `npm run remote`.
If port 8000 is busy, set `REMOTE_PORT=8100` (and open `localhost:8100`).

You can also skip all of this and open the server address directly in your browser.

## Running your own full copy (works without anyone else's computer)

1. Install Docker Desktop and clone this repo.
2. Copy `.env.example` to `.env`. Put an Anthropic API key in `ANTHROPIC_API_KEY`;
   the other values can stay as they are for a local copy.
3. Get the ServiceNow export (the six CSVs) from the team and put them in a `csv_data/`
   folder. Without them the tool still starts and you can sign in, but every question
   comes back empty. Add them before the first start, or see "Reloading the data".
4. Run `docker compose up -d` and open http://localhost:8000.
5. Sign in with your usual username and password. Everyone's accounts come with the
   repo in `db/accounts.json` and are loaded automatically.

**Getting account changes:** when someone is added, has their password reset, or is
deactivated, the person who made the change exports and commits `db/accounts.json`.
Pull, then restart your copy (`docker compose restart app`) to pick it up.

**Reloading the data:** the CSVs are only loaded the first time the database starts.
To load them later, run `docker compose down -v` and then `docker compose up -d`. This
also clears your copy's sign-in sessions; accounts come back from `db/accounts.json`.

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
(find the IP with `ipconfig`). There's nothing else to set up. Traffic is not encrypted,
so use this only on a network you trust.

**Over the internet.** Get permission first: this puts company data behind a public link.
One command starts OneTouch if needed, starts a Cloudflare Tunnel, checks the link works,
and copies it to your clipboard:

```
npm run share
```

The next section covers the one-time setup, what to do every time you start your computer,
and how to get a link that never changes.

### Sharing over the internet with Cloudflare

**How it works.** A small program in Docker (the `onetouch_tunnel` container) connects
out from your computer to Cloudflare. Cloudflare gives you a public `https://` link and
passes visitors through to OneTouch on port 8000. There are no router or firewall changes,
and the people you share with install nothing: they open the link and sign in with their
own username and password. Everything works through it: sign-in, the home page searches
and stars, the AI assistant, downloads, and the dashboards with drill-down.

It only works while **your computer is on and awake, with Docker Desktop running**.

#### One-time setup

1. Install [Node.js](https://nodejs.org) 18 or newer, and run `npm install` once in the
   project folder. This is what runs `npm run share`.
2. In **Docker Desktop → Settings → General**, turn on **Start Docker Desktop when you
   sign in to your computer**. OneTouch and the tunnel then start again by themselves
   after a restart.
3. In **Windows Settings → System → Power & battery → Screen, sleep & hibernate
   timeouts**, set **When plugged in, put my device to sleep after** to **Never**, and keep
   the computer plugged in. The screen can still turn off; only sleep stops the link.
4. Get the OK from whoever owns the ServiceNow data.

#### Every time you start your computer

1. Sign in to Windows and wait for Docker Desktop to finish starting (it says **Engine
   running**).
2. Open a terminal in the project folder (in VS Code: **Terminal → New Terminal**) and run:
   ```
   npm run share
   ```
3. Wait for **OneTouch is shared at: https://….trycloudflare.com**. The link is already on
   your clipboard: paste it to the people who use OneTouch. Before it prints the link, the
   command checks that the link works from the internet, so it's safe to send.

Why this is needed: the free link is new every time the tunnel starts, and the tunnel
restarts whenever your computer or Docker does. `npm run share` finds the current link,
and starts anything that didn't come back on its own. It's safe to run at any time; if
nothing restarted, it just shows the same link again.

| Command | What it does |
|---|---|
| `npm run share` | Start sharing, or show the current link |
| `npm run share -- --new` | Replace the link with a new one (the old one stops working, e.g. to cut off people who had it) |
| `npm run share -- --stop` | Stop sharing; OneTouch keeps running on this computer |

Without Node.js, the same thing by hand: `docker compose --profile tunnel up -d tunnel`,
then `docker logs onetouch_tunnel` (the last `https://….trycloudflare.com` line is the
current link), and `docker compose stop tunnel` to stop.

#### A link that never changes (optional, about $10 a year)

A named tunnel keeps one address, e.g. `https://onetouch.your-domain.com`, through
restarts, so you never resend it. It needs a free Cloudflare account and a domain.

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Buy a domain in **Domain Registration → Register Domains** (a `.com` is about $10 a
   year). Bought there, it's connected to your account automatically.
3. Go to **Zero Trust → Networks → Tunnels → Create a tunnel**, choose **Cloudflared**,
   and name it `onetouch`. If Zero Trust asks you to pick a plan first, choose **Free**
   (it may ask for a card even though it's $0).
4. On the install screen choose **Docker**, and copy only the long token that follows
   `--token`. Don't run the command it shows.
5. Add a public hostname (newer screens call it a *published application route*):
   subdomain `onetouch`, your domain, service type **HTTP**, URL `app:8000`. Save.
6. Add both lines to `.env`:
   ```
   TUNNEL_TOKEN=the-token-you-copied
   ONETOUCH_PUBLIC_URL=https://onetouch.your-domain.com
   ```
7. Run `npm run share`. With a token in `.env` it starts the permanent tunnel instead of
   the free one (and stops the free one), then prints your address once it's connected.

After that, a restart needs nothing from you: the tunnel comes back with Docker on the
same address. Running `npm run share` is still a quick way to confirm it's up.

#### If something goes wrong

| What you see | What to do |
|---|---|
| `Docker is not running` | Open Docker Desktop, wait for **Engine running**, and run `npm run share` again. |
| `It is not answering yet` | A new free link can take a minute or two to start working. Open it yourself before sending it. If it still fails after 5 minutes, run `npm run share -- --new`. |
| People get "This site can't be reached" or a Cloudflare error page | Your computer is asleep or off, Docker isn't running, or they have an old link. Run `npm run share` and send the link it prints. |
| `The permanent tunnel did not connect` | The token in `.env` is wrong or was deleted in Cloudflare. Copy it again (step 4 above). |
| The permanent address shows "error code: 502", always or only sometimes | Something else is also running your tunnel: usually a container started by the dashboard's `docker run cloudflare/cloudflared … --token …` command, or the Windows service its `cloudflared.exe service install …` command creates. Those can't reach `app:8000`, and Cloudflare splits visitors between them and this project's tunnel. `npm run share` finds them on this computer and prints the command that removes each one: `docker rm -f <container name>` for a container, or, in an **administrator** PowerShell, `& "C:\Program Files (x86)\cloudflared\cloudflared.exe" service uninstall` for the service. The tunnel's **Connectors** list in the Cloudflare dashboard should show a single connector; one on another computer has to be stopped there. |
| A question shows an error after about 100 seconds | Cloudflare ends any request that takes longer than 100 seconds. It's rare (answers usually take 3–5 seconds); ask again. |
| Someone sees the old version after you change OneTouch | They press Ctrl+F5. Changes go live through the link as soon as they're running on your computer. |

**Limits.** Free links are a Cloudflare testing feature with no uptime promise; they're
fine for a team. Anyone with the link reaches the sign-in page, and only people with an
account in OneTouch can get past it.

### Presentation day (many people at once)

Measured with 30 people using OneTouch at the same moment, on the laptop that runs it:

| What 30 people do at once | How long each waits |
|---|---|
| Ask a question that was asked before | about 0.5 s |
| Ask a new question | 2–5 s, almost all of it Claude; the Claude API limits allow about 200 new questions a minute, and the cached instructions don't count toward them |
| Open the same dashboard | about 5 s (one person alone: 0.2 s), once the dashboards have been opened once |

A faster computer barely changes the AI answers: Claude runs on Anthropic's servers, and
OneTouch doesn't use a graphics card. Dashboards are the part a computer works hard on,
which is why Metabase keeps each chart's result (see [Dashboards](#dashboards-metabase)).

**On the morning of the presentation:**

1. Make sure OneTouch is shared: `npm run share`.
2. Warm it up:
   ```
   npm run warmup
   ```
   It signs in as the **warmup** account (username `warmup`, password from
   `WARMUP_PASSWORD` in `.env`, or it asks), then asks every question in
   `scripts/warmup-questions.txt` and opens every dashboard. That takes about a minute.
   To use another account instead: `npm run warmup -- --user <username>`.
   Afterwards those questions answer instantly for everyone, provided they're asked with
   the same words (capitals, spacing and a closing "?" don't matter), and every dashboard
   opens from Metabase's cache. It ends with a list of anything that failed, so it doubles
   as a final check that everything works.
3. Demo with the questions in that file. Edit the file to add your own (one per line) and
   run `npm run warmup` again; questions it has already asked come back instantly, marked ⚡.
4. **Don't restart OneTouch afterwards.** A restart (including `docker compose up` after
   editing `.env`) forgets the remembered questions. They are also tied to the date
   Claude sees as "today", which is the real date in UTC unless `ASSUME_TODAY` is set, so
   warm up on the day itself. A presentation that runs past 7 PM Central crosses into the
   next UTC day; run the warm-up again then.

Follow-up questions ("same but for changes") always go to Claude, so they take the usual
few seconds. The warm-up's answers list tickets like anyone's do, so they fill the Ticket
results of the account it signs in as. That is why it has its own **warmup** account: the
demo tickets land there, not in a real person's list.

**The warmup account** was created with
`docker exec -it analytics_node_app node scripts/users.mjs add warmup "Warmup"` and is in
`db/accounts.json`, so full copies of OneTouch have it too. Its password is `warmup`, which
anyone could guess, and OneTouch is on a public address. Anyone who tries it gets in and
can ask the AI questions (each new question costs a little). After the presentation,
consider `docker exec analytics_node_app node scripts/users.mjs deactivate warmup` (and
`activate` before the next one), or a stronger password with `reset-password warmup` plus
the same value in `WARMUP_PASSWORD`.

Keep the computer plugged in, awake and, if possible, on a wired connection.
Cloudflare serves the dashboards' 9.4 MB of program files from its own cache, so your upload
speed matters less than you might expect.

### Home page and the AI assistant

The header is one row: the OneTouch logo and name, the signed-in person's name, the
**📈 Dashboards** button right next to it (green while the dashboards are showing), and
**Sign out** at the right. Clicking the logo or the name **OneTouch** goes back to Home from
anywhere, closing the AI chat or the dashboards drawer if one is open. On a phone,
Dashboards moves to a second line.

After signing in, people land on **Home**: "Welcome, *first name*!" in the top-left corner,
then the **💬 Any question about the data** card, then **Ticket results** and **Starred
tickets** (everything you've starred, newest first).

**The AI assistant** is reached from that card:

- **Try: How many open incidents are there by priority?** asks that question and opens the
  chat over the page with the answer. Ask anything else in plain English in the chat's own
  box, including follow-ups.
- **💬 Open chat** opens the chat, empty or with the conversation so far. Its label counts
  the questions asked, e.g. **Open chat (3)**.
- **🗑 Delete chat**, in the card and at the top of the chat, deletes the conversation. It
  asks first, then the questions and answers disappear, the assistant forgets the
  conversation, and the chat closes ("Chat deleted"). An answer still on its way is
  dropped. **New chat**, next to **Ask Claude**, does the same but keeps the chat open.
- **Minimize** (or Escape) closes the chat and keeps the conversation.

**Ticket results** is every ticket the AI assistant has shown you, newest first. When an
answer lists tickets, they appear at the top of the list automatically, highlighted, and a
note says how many ("28 tickets from this answer are now in Ticket results on Home"). Each
row shows the ticket's summary, when it was shown, and the question that showed it. A
ticket shown again moves back to the top. The list is kept with your account (the
`seen_tickets` table in `onetouch_auth`), so it is still there after a refresh, after
signing out and in, and on another computer. Each person has their own list, holding the
2,000 most recent tickets.

Click a ticket number (in Ticket results or Starred tickets) to see that ticket's full
record: every field, with **Open in Dashboards** for incidents, changes and requests, and
**← All ticket results** to go back. A ticket opened this way also joins the list ("Opened
from a ticket number"). The list downloads like any other table.

**🗑 Delete ticket results** (at the right of the list's summary line) empties the list. It
asks first, and the list is then gone on every computer. Starred tickets stay starred, and
new answers start filling the list again.

A ☆ appears next to every ticket number in OneTouch: in ticket results, in the AI assistant's
tables, and in the Dashboards toolbar on an incident, change or request record. Stars are
saved to each person's account (the `starred_tickets` table in `onetouch_auth`), so they
follow you to any computer that signs in to the same server. A full copy of the tool keeps its
own stars; they aren't in `db/accounts.json`.

**Star all.** Ticket results, and every AI answer that lists two or more tickets, have a
row of yellow buttons: **★ Star all 30 tickets**, plus one per type when the list mixes
them (**★ Star all 28 changes**, **★ Star all 3 incidents**, **★ Star 1 request**, ...). Once
they are all starred, a button reads "✓ 28 changes starred". In an AI answer, it stars the
tickets the answer lists (its ticket-number column), not related numbers in other columns
such as a task's parent request. It is one request however many tickets there are, and the
2,000-star limit still applies: anything past it is left unstarred and a note says so.

**🔗 Related tickets.** Under an AI answer, and under a ticket's record on Home, OneTouch
lists the "families" those tickets belong to. These come from the links stored in the
ServiceNow export; nothing is guessed:

| Family | The link in the data | How common |
|---|---|---|
| Parent incident and its child incidents | `incident.parent_incident` | 2,080 child incidents under 514 parents (up to 212 children each; one level only) |
| Bundle request and its child requests | `sc_req_item.parent` | 1,543 child requests under 974 bundles (e.g. "Start and Snooze Applications/Servers" → "Virtual Server - Stop") |
| Requests ordered together | `sc_req_item.request` (the REQ) | 125 orders hold several requests (up to 18) |
| A request and its catalog tasks | `sc_task.request_item` | 2,361 requests have several tasks (up to 7) |
| A change and the incidents it fixes or caused | `change_request.incident`, `incident.caused_by_change` | 100 changes name the incident they fix; 6 incidents name the change that caused them |
| Tickets under one problem record | `incident.problem`, `change_request.problem` | 64 problems, up to 870 incidents each (the PRB records themselves aren't in the export) |

For each family it shows:
- a plain-English line on what the link means (e.g. "a parent (master) incident groups
  incidents raised for the same issue … so they are worked and resolved together")
- **Same in all** — the values every member shares: state, priority or risk, team,
  server / system, subcategory, catalog item, location, assignee, summary, opened time
- **Different** — the fields where they differ, with how many have each value (e.g. "Team:
  ACN-INFRA-CLOUD-LINUX (3), ACN-SAP-BASIS (3)", "Opened: Sep 1, 1:07 AM to 1:18 AM",
  "Summary: 5 different summaries")
- the members, each with its role (Parent, Child, Task, Incident it fixes, …). The
  ticket you asked about is highlighted. Up to 25 are listed, but the comparison covers all.
- **Download this family as** — the family in any of the download formats. The file has two
  tables: **Members of *anchor*** (every member, not just the 25 shown: ticket, role, type,
  summary, state, priority / risk, team, opened) and **Same or different in *anchor***
  (each field, "Same in all *n*" or "Different", and the values with their counts). The
  *anchor* is the family's parent, order, request, change or problem number. Table names
  start that way so they stay distinct as Excel worksheet names, which are cut at 31
  characters. When there are several families, **Download all *n* families as** at the
  top puts all of them in one file. The file is named after the tickets it relates to,
  e.g. `one-touch-related-to-inc1794145-2026-10-22.xlsx`.

One ticket shows every family it is in. A list shows only the families that two or more of
its tickets share, so a long list isn't buried. A ticket with no links shows nothing extra.
The families also go to the AI with your next question, so follow-ups such as "show me the
others in that family" work. The AI also knows these links directly: "child incidents of
INC1813985", "the parent request of RITM0440458", and an incident's record shows its
**Parent Incident** and **Problem Record**.

In child incidents, the parent's server / system matches 94% of the time, the subcategory
95%, the location 90%, the team 82%, the priority 75% and the state 99%. The summary
text matches only 9% of the time, because each alert or report carries its own detail.
Only about half the children were opened after their parent: the parent is the "master"
someone picked to group them, not always the first.

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
2. Run `docker compose up -d`. This creates the reporting views and Metabase's read-only user.
3. Run:
   ```
   docker exec analytics_node_app node scripts/metabase-setup.mjs
   ```

Re-run step 3 any time. It rebuilds the dashboards in Metabase's "OneTouch ITIL"
collection and never touches anything else. The charts, and which drawer group each
dashboard sits in, are defined in `scripts/metabase-setup.mjs`. The data they read
is defined in `db/reporting-views.sql`.

**Caching.** The setup also tells Metabase to keep each chart's result instead of
recalculating it for every viewer, because the data never changes. With 30 people opening
the same dashboard at once, that took the wait from about 37 seconds to about 5. The
free edition only offers the "adaptive" policy, which keeps a result for 1,000,000 times
as long as its query took: about 14 hours for a 0.05-second chart, and about 11 days
for a 1-second one. The first person to open a chart after that waits the normal time,
and `npm run warmup` opens them all in advance. To switch caching on without rebuilding
the dashboards (which would change their links), run:
```
docker exec analytics_node_app node scripts/metabase-setup.mjs --cache-only
```

**Drilling down.** Click a bar, pie slice, line point, big number or blue table value
to open a detail page for it: a record (incident, change, request), a team, a server or
system, a site or brewery, a problem record, a catalog item, or a filtered list (e.g.
"Incidents · Priority: P2 - High"). Detail pages link onward too; on a record, use the
blue **Go to** row under it. OneTouch's toolbar shows where you are, with **← Back**.
A detail page's filter boxes (top left) suggest values as you type, so you can switch to
another team, ticket or item there. Clearing the last filter returns you to the dashboard.
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

To add many at once, use a CSV with the columns `Username, Display Name, Password` (PowerShell):

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
passwords themselves. Every copy loads it on start. Missing accounts are added, and an
account is only overwritten by a more recent change, so an old file never undoes a newer
password reset or deactivation.

## Coding helpers (Claude Code)

The repo includes two Claude Code subagents in `.claude/agents/`:

- **onetouch-developer** builds features. It knows how OneTouch fits together, how to run
  and test it, and the pitfalls this project has hit.
- **onetouch-reviewer** reviews a diff or branch for this project's risks (sign-in and data
  exposure, secrets, Claude API rules, setup that breaks on other machines). It is read-only.

In Claude Code, ask for them by name (e.g. "use onetouch-reviewer on my branch"), or see
them with `/agents`.

## Branches and checks

Everyone works on their own branch (`Ventura`, `Luke`, `Q`) and brings changes into `main`
with a pull request. Before each commit:

```
npm run docs     # refresh this file's appendices from the code
npm run check    # syntax, shell scripts, docker-compose.yml, and this file (about 1 second)
```

---

# Part 2: Every feature, in detail

## 2.1 Sign-in

**The page.** Before you sign in, OneTouch shows only the sign-in page: the Molson Coors
logo, a box titled "Sign in to OneTouch", a **Molson Coors Email** field with
`@molsoncoors.com` printed after it, a **Password** field, and a **Continue with SSO**
button. Despite its label, that button signs in with the username and password stored in
OneTouch; it is not single sign-on.

- Type just the part before the `@`. Typing the whole address also works, because the
  server removes a trailing `@molsoncoors.com`. Usernames are not case-sensitive, and
  spaces around them are ignored.
- The **Microsoft Entra ID** button only shows "Microsoft Entra ID sign-in is not
  available yet. Use your email and password." The **Contact Support** link goes nowhere yet.
- After a failed attempt the password box is cleared and the error appears under it.

**What the server checks** (`POST /api/login`):

| Situation | What you see |
|---|---|
| Wrong username or password | "Incorrect email or password." The server takes the same time whether or not the username exists, so it never reveals which accounts exist. |
| 5 wrong passwords in a row on one account | That account is locked for 15 minutes: "This account is locked for 15 minutes after too many wrong passwords." A correct password resets the count. |
| 20 failed attempts from one address within 15 minutes, across any usernames | "Too many failed sign-in attempts. Please wait 15 minutes and try again." Through the Cloudflare tunnel, the visitor's real address is used (taken from Cloudflare's header, and only believed when the request really came through the tunnel). |
| Deactivated account | Treated as a wrong password. |
| Account database unreachable | "Sign-in is unavailable right now (the account database could not be reached)." |

**Sessions.** A successful sign-in returns a random 64-character token. The browser keeps
it in the tab's `sessionStorage`, so:

- Reloading the page keeps you signed in. Your name is fetched again (`/api/me`), and the
  chat starts empty.
- Closing the tab, or opening OneTouch in a new tab, means signing in again.
- A session lasts 12 hours. After that, or after a password reset or deactivation, the
  next action returns you to the sign-in page with "Your session has ended. Please sign
  in again."
- **Sign out** (top right) ends the session on the server, clears the chat from the screen
  so the next person on that computer can't see it, and shows the sign-in page.
- The server stores only a SHA-256 hash of each token, and only salted scrypt hashes of
  passwords, so a copy of the account database can't be used to sign in. Expired
  sessions are deleted every hour.

## 2.2 The page around the tabs

- **Header:** one row with the OneTouch logo and name (click either to go back to Home), the
  signed-in person's display name (or their username if they have none), the **📈 Dashboards**
  button next to it, and **Sign out** at the right. There is no separate Home button; the
  logo and name take its place.
- **Home** is the first page after signing in: "Welcome, *first name*!" in the top-left
  corner, the AI assistant's card (an example question, **Open chat**, **Delete chat**),
  then ticket results and starred tickets (see
  [Home page and the AI assistant](#home-page-and-the-ai-assistant) in Part 1).
- **Greetings** use the first word of the display name: "Welcome, *first name*!" on Home
  and "Hello, *first name*!" at the top of the chat.
- **Icons:** favicons, an Apple touch icon and a web-app manifest, so OneTouch can be
  pinned to a phone's home screen as "One Touch".

## 2.3 The AI Assistant (chat)

### Asking

On Home, click **💬 Open chat** (or the example question) in the "Any question about the
data" card. The chat opens over the page. Type a question in its box and press **Enter**
or click **Ask Claude**. **Minimize ▴** or Escape closes it and keeps the conversation;
**Open chat (*n*)** reopens it. **🗑 Delete chat** (at the top of the chat, or on Home)
deletes the conversation after a confirmation, and Claude forgets it too. If you send
another question before the first answer arrives, it waits its turn: questions in one
session always run in order.

**While it works**, a bubble shows each step as the server reaches it, with a running
clock: "📨 Sending your question…", "🧠 Understanding your question…" (Claude), "📊 Getting
the data…" (Cube), and for an empty result "🔎 Nothing matched; working out why…".
Finished steps stay listed with a ✓ and how long they took. Under each answer, a small line
says how long it took ("Answered in 2.9 s"). A new question usually takes 2–5 seconds,
almost all of it Claude; the data itself comes back in under a tenth of a second.

**Repeated questions are instant.** The data never changes, so when a question that
starts a conversation has been asked before, by anyone, OneTouch reuses Claude's earlier
translation (and, for an empty result, its explanation) and answers in about 0.1 seconds.
The bubble then shows "⚡ Asked before: reusing that answer…" and the answer says "⚡ Answered
in 0.1 s: this question was asked before". "The same question" means the same words,
ignoring capitals, spacing and a closing "?", asked about the same "today". Follow-up
questions depend on the conversation, so they always go to Claude. The server keeps the
last 500 such questions in memory; restarting it starts the list over.

### What happens to a question

1. **Claude translates it**, unless it is a repeated question (see above), in which case
   the earlier translation is reused and the steps below still run. The model is
   `claude-sonnet-5-5` unless `CLAUDE_MODEL` says otherwise, and it returns a structured JSON answer whose shape the API enforces: an `intent`, up
   to one query per table, a one-sentence restatement, and the list of assumptions made.
   The instructions (`business_logic.mjs`) describe the six tables, every column, the
   exact values coded columns hold, ITIL vocabulary, and worked examples. They are sent
   with prompt caching, so repeated questions cost less. Today's date is added to every
   question (or `ASSUME_TODAY`, see 2.9).
2. **The server checks Claude's answer** (`normalizeAndValidate`) before anything runs:
   - only known columns, the `count` measure, and these operators: equals, notEquals,
     contains, notContains, startsWith, endsWith, set, notSet, gt, gte, lt, lte;
   - each query uses columns from one table only, and each table appears at most once;
   - values for coded columns are corrected to their exact spelling (e.g. "p1" →
     `P1 - Critical`, "cancelled" → `Canceled` for changes), and each correction is added
     to the assumptions;
   - sorting only on selected columns;
   - lists without a limit get 50 rows; nothing returns more than 500.
   If the answer fails these checks, you see "I couldn't map that question onto the
   data: …", and Claude is told why on the next question.
3. **Cube runs each query** against the database, one per table, side by side. If Cube
   is still starting up, the server retries up to 3 times, 2 seconds apart.
4. **Empty results are explained** (see 2.4).
5. **Counts across several ticket types are merged** into one table with a column per
   type and a total (`combineResults`). For "top N" questions, the server ranks the
   merged totals, so it's a true top N across all types.

### The three kinds of answer

| Intent | When | What you see |
|---|---|---|
| `query` | The question fits the data | The results (below) |
| `clarify` | It can't be answered sensibly without one more detail, e.g. a person's real name (people are anonymized as "Individual 1234"), or a place that matches very different things | 🙋 and one short question back |
| `unsupported` | It needs something the data model doesn't have: averages, durations, resolution times, SLA %, joins between tables, or a period with no data | 🙋, a plain explanation, and the nearest question it *can* answer |

### What a result looks like

- **A title:** Claude's one-sentence restatement of what it fetched.
- **One number** ("how many open P1s") → a big number with the right noun ("12 incidents").
- **One record** with more than 4 fields (a ticket lookup) → a two-column field / value card.
- **A list or breakdown** → a table with a row count above it. Long text (descriptions,
  notes, plans) is cut at 120 characters, with the full text on hover.
- **Clickable ticket rows:** in a table that lists tickets, each row has a ▸ by its ticket
  number. Click the row (or focus it and press Enter or Space) and a detailed view opens
  under it:
  - the ticket's **full record**: every field, ☆ Star, **Open in Dashboards** for incidents,
    changes and requests, and a download
  - its **🔗 related tickets**: each family, with what the members share and where they
    differ, and the family downloads

  Click the row again or **▴ Close** to fold it away. Several rows can be open at once.
  While a row is open, the table shows in full instead of in a short scrolling box. The
  star in a row stars without opening it. **Open in Dashboards**, or a ticket number
  inside a family, closes the chat and shows that page.
- **Counts across ticket types** → one table: the grouping column, one column per type,
  a Total column and a Total row. Without grouping, it's a big total plus a row per type.
- **Lists across ticket types** → one titled table per type (25 rows each unless you
  ask for more).
- **Readable values:** column names in plain English ("Assigned Team", "Server / System",
  "Times Reassigned", "SLA Breached", "Parent Request (RITM)"), dates like
  "Aug 14, 2026, 8:44 AM", months like "August 2026", weeks like "Week 33 of 2026",
  true / false as Yes / No, empty values as "—", and counts with thousands separators.
- **How I read your question:** a collapsible list of every assumption Claude made (what
  "open" meant, which ticket types were included and why others were dropped, the exact
  dates used, values that were corrected).
- **🔗 Related tickets:** when the answer's tickets have parents, children or other linked
  tickets, the families they belong to, with what the members share and where they differ
  (see [Home page and the AI assistant](#home-page-and-the-ai-assistant)).
- **Star all:** when the answer lists two or more tickets, buttons to star them all, or all
  of one type (see [Home page and the AI assistant](#home-page-and-the-ai-assistant)).
  The tickets also go to Ticket results on Home.
- **Download as:** see 2.5.

### What it understands

The data is six ServiceNow tables. Four are **ticket types**: incidents (INC), changes
(CHG), requested items (RITM) and catalog tasks (SCTASK). The other two hold approval
records for changes and for requests.

- **"Tickets" means all four types.** "How many tickets came in last week" runs four
  queries and merges them. Approval records are included only when you ask about
  approvals. A request and the tasks created to fulfil it count as separate tickets.
- **Filters only go where they exist.** Priority, impact, urgency, category and channel
  exist only on incidents; type, risk, environment, outage and planned dates only on
  changes; catalog item on requests and tasks; team on incidents, changes (owning team)
  and tasks; location on incidents and requests. Types without the field are left out,
  and the assumptions say so.
- **Ticket numbers** (INC…, CHG…, RITM…, REQ…, SCTASK…) pick the table instantly, and a
  bare number shows that ticket's full record.
- **Answer shape:** "how many" → a count; "by / per / breakdown" → grouped counts;
  "top N / busiest / worst" → top N (10 by default); "trend / per month / weekly" → counts
  per day, week or month in date order; "show / list / which" → a list, newest first;
  "details / status of" → one record. "Percent / share" returns the counts and says
  percentages must be worked out from them.
- **Status words:** "open / backlog / pending / still open" → each type's open states;
  "closed / done" → each type's closed states ("resolved" alone → Resolved); "stuck /
  stale / aging" → open and older than 7 days; "on hold / waiting on the user / vendor";
  "reopened"; "bounced around / reassigned"; "failed / rolled back / caused an incident"
  for changes; "rejected"; "pending approval"; "fulfilled"; "SLA breached".
- **Priority words:** P1 / critical / sev1 / "on fire" → P1; P2 / high / urgent; "high
  priority" → P1 and P2; P3 / medium / normal; P4 / low / minor; impact words such as
  "enterprise-wide", "site down", "single user"; "was a P1 at some point"; "downgraded".
- **Time phrases:** "today", "yesterday", "last week" (Monday to Sunday), "this month",
  "last month", "last 30 days", "since July", "Q3", "YTD", "recently" (7 days); "resolved /
  closed / planned / went live in…" use those dates instead of the creation date. "Ever /
  all time" means no date filter.
- **Teams, places and things:** team nicknames map to the codes in the data ("wintel" →
  `WINTEL`, "service desk" → `ServiceDesk`, "Accenture" → `ACN-`, "TCS" → `TCS-`, and
  about 20 more). Brewery and office names, "HQ", "UK", "Canada" and "remote" map to
  locations. Server or app names match the configuration item. Plain words map to
  categories ("password / locked out", "printer", "VPN", "slow") and catalog items
  ("new laptop", "shared mailbox", "admin rights", "termination"). Channels such as "called
  in", "chat", "portal" and "monitoring alerts" are understood too.
- **Logic and typos:** and / or / not / except / at least, plus shorthand and typos
  ("incdent", "tkts", "chg's", "wrk in prog", "prio", "svr", "pw reset").
- **Dates outside the export:** the export covers roughly 1 June to 1 September 2026
  (incidents from 5 July 2026). A question entirely outside that is answered with the
  dates the data does cover; a partly overlapping one runs on the overlap and says which
  part has no data.

### Follow-up questions (conversation memory)

The server keeps your questions and Claude's answers for the session, and tells Claude
how many rows each answer returned. So follow-ups work: "same but for changes", "now by
month", "only the P1s", "what about last week", "show me the details of the first one".
Claude keeps the earlier filters unless you change them, and the assumptions say what
was carried over.

- **New chat** clears the screen and makes Claude forget the conversation.
- **Reloading the page** does the same.
- After **40 questions**, Claude starts fresh automatically, and a note says "This
  conversation got long, so Claude started fresh."
- Memory lives in the server's RAM: a server restart keeps you signed in but Claude
  forgets. Idle conversations are dropped after 12 hours.

### Errors you might see

| Message | Meaning |
|---|---|
| "I couldn't map that question onto the data: …" | Claude's query failed the checks; rephrase |
| "Claude API error (…)" | The Anthropic API refused or failed (key, quota, outage) |
| "The assistant declined to translate that request." | Claude refused |
| "The translation was cut off; try a shorter question." | The answer ran out of room |
| "Cube.dev is still initializing…" | Cube is starting; try again in a few seconds |
| "Could not talk to backend server orchestration framework." | The page couldn't reach the server |

## 2.4 Explanations for empty results

When a query finds nothing (no rows, or counts that are all zero), the server works out
why instead of just saying "no records" (`empty_results.mjs`):

1. For each empty query it looks up the table's total rows and its first and last date.
2. It removes the filters one at a time (up to 6) and counts what each removal brings
   back. Where something comes back, it groups those rows by the removed filter's column
   (dates by month, top 8 values) to show what the filter was hiding.
3. Claude turns those facts into 1 to 3 plain sentences that start with the direct
   answer, e.g. "There are no open P1 incidents right now: all 3 P1 incidents in the
   data are closed." If a table is empty because no data was loaded, it says so. It ends
   with a nearby question that would return data.
4. If everything was empty, that explanation replaces the tables. If only some ticket
   types were empty, the explanation goes under the tables. If Claude can't be reached,
   a plain fallback gives the dates the data covers.

## 2.5 Downloads

Every result with a table has a **Download as** menu and a **⬇ Download** button.
The file contains exactly what is on screen, with the same column names and formatting,
except that long text is never cut and counts stay real numbers.

| Format | What you get |
|---|---|
| Excel (.xlsx) | One worksheet per table, named after it. The header row is bold, shaded, frozen and has filters. Columns are sized to their content (up to 60 characters), counts use `#,##0`, very long text wraps, and the Total row is bold. |
| CSV (.csv) | UTF-8 with a byte-order mark, so Excel opens it correctly. Several tables are separated by a blank line, each under its title. |
| PDF (.pdf) | US Letter, landscape. Title, the question and the time it was generated, then each table with its row count, and "Page X of Y" at the bottom. Characters outside Western European ones show as "?". |
| Word (.docx) | Landscape, with the same headings. Tables use smaller text when they have more than 8 columns. |
| Rich Text (.rtf) | Opens in Word, WordPad, Pages and LibreOffice, with the same layout. |
| Plain Text (.txt) | Aligned columns. Values longer than 60 characters wrap inside their column, and numbers are right-aligned. |
| ZIP (.zip) / 7-Zip (.7z) | All six formats above in one archive. |

Files are named `one-touch-<the question>-<date>.<format>`, e.g.
`one-touch-how-many-open-p1s-2026-10-21.xlsx`. The date, and the "Generated" time inside
the file (e.g. "Oct 21, 2026, 9:11 PM CDT"), are in the downloader's own time zone, which
the browser sends with the request; without one they're in UTC, labelled as such. The home
page's ticket lists and a single ticket's record download the same way, and so does each
family under **🔗 Related tickets** (its members and the same / different comparison). A result too large to export (over
2 million cells) is refused. While the file is being made, the button says "Preparing
XLSX file…", then "Downloaded *file name*", or the error.

## 2.6 The Dashboards tab

**The drawer.** **☰ Dashboards** opens a side drawer listing the dashboards under their
group headings, each with a one-line description. On your first visit it opens by
itself. Pick one and the drawer closes. **Escape**, **✕** or a click outside also close
it. OneTouch remembers the last dashboard you viewed in this browser and opens it next time.

**The toolbar** shows the group, name and description of the dashboard on screen, and
the hint "Click a bar, slice, number or blue value for details". If no dashboards have
been set up yet, the tab says so and gives the command that creates them.

**About the numbers.** The export is a frozen snapshot, so "now", ages and "upcoming"
are measured from the newest record in it (1 September 2026), not from today. Weekly
charts use complete weeks only, because the first and last weeks of the export are
partial. Placeholder systems (`zzz`) count as "no system recorded".

### The ten dashboards

**Overview → IT Operations Overview.** The latest complete week across incidents,
changes and requests. Trend numbers compare it with the week before: incidents opened,
changes raised, requests opened, and SLA breaches per week. There are also counts of
open incidents, open requests, open catalog tasks and changes awaiting approval, plus
three charts: weekly volume of incidents, changes and requests; open work by age (under 1
day to over 30 days, stacked by type); and the teams with the most open work.

**Overview → Sites & Breweries.** Where the work comes from. Counts of sites with
incidents, incidents at breweries, changes affecting breweries, and breweries touched by
changes. Incidents and requests by site (top 12), a brewery scorecard, changes by
brewery (top 12), weekly incidents at the 5 busiest breweries, and brewery changes with
an outage in the next 14 days. A change that lists several breweries counts once for each.

**Incidents & Problems → Service Desk.** Incident management: open incidents, open more
than 7 days, average hours to resolve, and the share reassigned at least once. Opened vs.
resolved per week, open incidents by age, average hours to resolve by priority, open
incidents by team (top 10), monitoring alerts vs. people per week, ticket ping-pong
(reassignment by team), and problem candidates (the systems with the most incidents).

**Incidents & Problems → Problems & Major Incidents.** Incidents linked to a problem,
problem records with incidents, incidents closed with a workaround, and reopened
incidents. The problem records with the most incidents, weekly incidents for the 5
biggest problems, workarounds by subcategory (top 10), and recurring issues with no
problem record (the same system and issue type returning with nothing linking them). Also
the most used knowledge articles, incidents caused by changes, and P1 and P2 incidents.

**Incidents & Problems → Monitoring & Alerts.** Event management: monitoring alerts,
their share of all incidents, alerts closed within an hour (candidates for tuning or
auto-closing), and alerts with no system recorded. Alerts per day, the noisiest systems
(top 10), alerts by hour of day, how fast alerts close by type, teams receiving the most
alerts, and where alerts come from (the group that opened them, which usually identifies
the tool).

**Incidents & Problems → Workload & Channels.** Incidents raised by people (not
monitoring), the self-service share, and the share resolved without reassignment. Password
and account issues, people-raised incidents by hour of day and by day of week, weekly
incidents by channel, the channel mix, team workload, why open incidents are waiting
(state or on-hold reason), and open incidents per person (top 10; people are anonymized).

**Change → Change / CAB.** Changes in the export, the change success rate, the share
that were emergency or expedited, and changes starting in the next 7 days. Upcoming
Production changes (next 7 days), changes per week by type, changes by risk, change
approvals waiting by approver group, and failed changes and changes that caused incidents.

**Change → Change Risk & Business Impact.** Changes affecting breweries, changes
affecting SAP, changes needing an SAP transport, and changes flagged as a process failure.
Days of notice by change type (the median time between raising a change and its planned
start, with changes logged after work began counted separately), changes with an outage
per week by environment, the most changed systems (top 10), changes by category and
risk, SAP and brewery changes in the next 14 days, and the list of process failures.

**Requests → Requests.** Request fulfilment: open requests, open catalog tasks, the
catalog task SLA breach rate, and request approvals waiting. The most requested items
(top 10), requests opened vs. completed per week, fulfilment time for the most requested
items, SLA breaches by team, open catalog tasks by team and state, and request approvals
waiting by approver group.

**Requests → Automation & Self-service.** Where automation would save the most effort:
server start/stop requests (total and weekly average), requests completed within an
hour, and rejected or cancelled requests (effort spent on requests that never went
ahead). Automation candidates (high volume and slow to complete; high volume and done
within an hour suggests it's already automated), server start/stop requests per week,
password and account issues by channel (candidates for self-service reset), the most
rejected or cancelled items (top 10), and requests by order guide.

### Drill-down pages

Clicking a chart element or a blue value opens a detail page inside the same frame. The
toolbar then names it ("Team: TCS-Network-Voice", or for a list "Incidents · Priority:
P2 - High") and shows **← Back**, which steps back one page.

| Page | Opened by clicking | Shows |
|---|---|---|
| Incident | an incident number | the full record, a **Go to** row (team, system, site, problem, the change that caused it), and other incidents on the same system |
| Change | a change number | the full record, a **Go to** row (owning team, system, linked incident, linked problem), its approvals, incidents it caused, and breweries affected |
| Request | a RITM number | the full record, Go to, its catalog tasks and its approvals |
| Team | a team name | open incidents, average hours to resolve, open catalog tasks, approvals waiting on the team, incidents per week, systems it works on, issue types, open incidents per person, and changes it owns |
| Server / system | a system name | incidents, share from monitoring, open incidents, changes to it, incidents and changes per week, teams handling it, issue types, recent incidents |
| Site | a site or brewery | incidents, open incidents, requests, changes at the brewery, incidents per week, most requested items, and issue types |
| Problem | a problem record | linked incidents, how many are still open, systems affected, average hours to resolve, linked incidents per week, teams involved, and changes linked to the problem |
| Catalog item | an item name | requests, median hours to complete, share done within an hour, still open, opened vs. completed per week, requests by site, open requests, teams fulfilling it, and approval outcomes |
| Incidents list | a bar, slice or number about incidents | matching incidents with counts by team and by system. Filters: status, priority, subcategory, channel, source (monitoring or person), age bucket, open at least N days, hour of day, day of week, date, team, system, site, knowledge article, closed with a workaround, reopened, reassigned, status detail, assignee, raised by |
| Changes list | a chart about changes | matching changes with counts by owning team. Filters: status, type, risk, category, environment, outage, approval, affects SAP, needs SAP transport, affects breweries, process failure, emergency or expedited, starts within N days |
| Requests list | a chart about requests | matching requests with counts by item. Filters: status, catalog item, site, approval, outcome (rejected or cancelled), order guide |
| Catalog tasks list | a chart about tasks | matching tasks with counts by team. Filters: status, team, state, SLA (breached or met), catalog item |

**The filter boxes** at the top left of a detail page show what it's filtered on (e.g. **Team:
ACN-SAP-BASIS**). Click one and type to see the values that exist: team names, systems,
sites, ticket numbers, catalog items, priorities and so on. Typing matches anywhere in a value
and ignores capitals, so "network" finds "TCS-Network-Data". Pick one and click **Update
filter** to switch the page to it. Filters with only a few possible values (Open/Closed,
Yes/No, days of the week, SLA met or breached) show the whole list to pick from. Each filter
takes one value at a time.

**Clearing filters.** The **×** in a filter box removes that filter. On a list with several
filters the page stays, showing the broader list. When the last filter is cleared, the page
has nothing left to show, so OneTouch goes back to the dashboard it was opened from and
says "No filters left, so you're back on …". **← Back** then doesn't return to the empty page.

**How it works.** Metabase listens only on the server itself, so OneTouch passes its
public dashboard pages through (`/public/…`, `/app/…` and the public API, read-only, GET
only). That way the tab works from localhost, the network address, the tunnel and
remote mode alike. Metabase connects to the database as `metabase_reader`, which can read
only the `reporting` views. The dashboards are public links: anyone who has a link can
view that dashboard. `scripts/metabase-setup.mjs` checks every click target and filter
before it changes anything in Metabase, including that every filter says where its
suggestions come from: `distinct(...)` for values read from the reporting views (each
becomes a small "… suggestions" question that Metabase searches as people type), or
`fixed(...)` for a short list. Each run archives the previous dashboards and
creates new ones with new links, and `metabase-dashboards.json` is rewritten with them.

## 2.7 Accounts administration

`scripts/users.mjs` runs inside the app container:

| Command | What it does |
|---|---|
| `list` | Every account: username, display name, active, locked, created, last sign-in |
| `add <username> ["Display Name"]` | Creates an account and asks for the password without showing it. Usernames are 2–64 characters (letters, numbers, `.`, `_`, `-`) and stored in lower case. Passwords can't be empty or longer than 200 characters; there's no other rule. |
| `reset-password <username>` | Sets a new password, unlocks the account, and signs that person out everywhere |
| `deactivate <username>` / `activate <username>` | Blocks or allows sign-in. Deactivating signs them out everywhere. |
| `import <file.csv>` or `import -` | Adds everyone in a CSV (`Username, Display Name, Password`; Display Name optional). Existing usernames are skipped and their passwords left alone. `-` reads the CSV from standard input. |
| `export [file]` | Writes every account to `db/accounts.json` (hashes only) |
| `sync [file]` | Loads `db/accounts.json` by hand. The server also does this on every start. |

Add `--password-stdin` to `add` or `reset-password` to pipe the password in for automation.

**How the accounts file merges.** Missing accounts are added. An existing account is
overwritten only if the file's copy changed more recently, so an old file can't undo a
newer password reset or deactivation. Accounts not in the file are left alone. A newer
password or a deactivation from the file also ends that person's sessions.

**Separation.** Accounts live in their own database (`onetouch_auth`), which only the
`onetouch_app` login can open. That login can't open the analytics data, and nothing on the
analytics side (Cube, Metabase, Claude's queries) can read the accounts.

## 2.8 Remote mode

`npm run remote -- <server address>` (`remote.mjs`) serves the page from your own clone
and forwards `/api`, `/public` and `/app` to the server. It forwards only the
`Authorization`, `Content-Type` and `Accept` headers, waits up to 5 minutes for an
answer, and passes request bodies up to 25 MB (large downloads). A question's progress
steps are passed on as they arrive, so the chat shows them live; everything else is passed
on once it's complete. On start it checks that the server answers, and
it warns if the address is wrong. If port 8000 is taken, it says so and suggests
`REMOTE_PORT`.

## 2.9 Dates and "today"

Relative dates ("last month", "this week") are computed from today. The export ends
around 1 September 2026, so as time passes those phrases fall outside it. Set
`ASSUME_TODAY=2026-09-02` (any `YYYY-MM-DD`) in `.env` to pin "today" so they land
inside the data. Leave it empty to use the real date.

## 2.10 Logs

`docker logs --tail 50 analytics_node_app` shows what the app is doing:

| Starts with | Means |
|---|---|
| 💬 | A question arrived, with its turn number |
| 🧠 | Claude's token use: input, cached, output |
| ⚡ | A repeated question answered without Claude (its earlier translation reused) |
| 🤖 | Each Cube query that ran |
| 🙋 | A clarify or unsupported answer |
| 🔎 | Empty-result facts and the explanation given |
| 📥 | A download: format, file name, size |
| 🔐 | Sign-ins (with the address), sign-in failures, account database status, sessions cleaned up |
| 📊 | Metabase unreachable |
| ⚠️ / 📋 / ❌ | Validator rejections, failures, a missing API key |

## 2.11 Development tools

- **`npm run check`** (`scripts/check.mjs`): `node --check` on every JS file, shell
  script syntax and LF line endings, `docker-compose.yml` validated against
  `.env.example` (when Docker is installed), and whether this file matches the code.
  It takes about a second.
- **`npm run docs`** (`scripts/build-docs.mjs`): rewrites this file's appendices from the
  current files. A new file it doesn't know about makes the check fail until it's added
  to its lists.
- **Claude Code agents:** `onetouch-developer` and `onetouch-reviewer` (see Part 1).

---

# Part 3: Building it from scratch

This part rebuilds OneTouch, step by step, as it is on `main` today, for someone who
**cannot clone the repository**. Every file the project needs is printed in full in
[Appendix B](#appendix-b-every-file-in-full). The steps say which files to create when,
what each one does, and how to check that each stage works before you go on.

**Steps:** [tools](#step-1-install-the-tools) · [data and API key](#step-2-get-the-data-and-an-anthropic-api-key) · [project folder](#step-3-create-the-project-folder) · [packages](#step-4-the-node-package-list) · [settings](#step-5-the-settings-file) · [tables](#step-6-the-database-tables-and-the-csv-files) · [database scripts](#step-7-the-database-setup-scripts) · [Cube model](#step-8-the-cube-data-model) · [Docker](#step-9-the-docker-files) · [first start](#step-10-start-the-database-and-cube-and-check-them) · [translator](#step-11-the-translator-business-logic) · [empty results and downloads](#step-12-empty-result-explanations-and-downloads) · [sign-in](#step-13-accounts-and-sign-in) · [server and page](#step-14-the-web-server-and-the-page) · [full start](#step-15-start-everything) · [first account](#step-16-the-first-account-and-the-first-question) · [dashboards](#step-17-metabase-dashboards) · [remote mode](#step-18-remote-mode) · [sharing](#step-19-sharing-it-with-other-people) · [Claude Code helpers](#step-20-claude-code-helpers) · [checks and this guide](#step-21-checks-and-this-guide) · [git and branches](#step-22-put-it-in-git-and-recreate-the-branches)

**Shortcut.** If you have this file as `README.md`, you can write every file in
Appendix B to disk at once instead of copying them by hand. Save this as `extract.mjs`
next to `README.md` and run `node extract.mjs` inside the empty project folder:

```js
// Writes every file printed in Appendix B of README.md into the current folder
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const doc = readFileSync(process.argv[2] || 'README.md', 'utf8').replace(/\r\n/g, '\n');
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
    `/api/dashboards`, `/api/tickets/search`, `/api/stars`) needs a signed-in session.
  - `/api/tickets/search` → `tickets.mjs`; `/api/stars` (list, `PUT` to star, `DELETE`
    to unstar, and `PUT /api/stars` with a list of numbers to star many at once) → `stars.mjs`. `/api/seen-tickets` (the person's Ticket results with
    summaries; `POST` adds an opened record; `DELETE` empties the list) → `seen.mjs`. `/api/query` saves every ticket
    number in an answer's rows there before replying, and lists them as `shownTickets`.
  - `/api/query`: question → Claude (streaming, with prompt caching, conversation memory
    per session, up to 40 turns) → validator → Cube, one query per table in parallel →
    empty-result explanation → JSON for the page. Questions in one session run one at a time.
    A page that asks for `text/event-stream` gets a `progress` event per step (`understanding`,
    `cached`, `querying`, `explaining`) and then a `result` event. A question that opens a
    conversation and was asked before reuses the earlier translation (kept in memory, up to
    500), so it skips Claude; the reused answer still goes through the validator.
  - `/api/export` → `export.mjs`.
  - Passes Metabase's public dashboard pages through, so the Dashboards tab works wherever
    OneTouch does.
  - On start it creates the account and starred-ticket tables, loads `db/accounts.json`,
    and retries until Postgres is ready.
- `tickets.mjs` ([B.37](#b37)): the home page's ticket search. It finds INC, CHG, RITM,
  SCTASK and REQ numbers in whatever was typed and builds its own Cube queries from them
  (never from Claude's output). A single ticket's full record lists every column Cube has
  for it, skipping empty ones.
- `stars.mjs` ([B.38](#b38)): each person's starred tickets, in the `starred_tickets` table
  of `onetouch_auth` (at most 2,000 per person).
- `seen.mjs` ([B.42](#b42)): each person's Ticket results, every ticket they have been
  shown, in the `seen_tickets` table of `onetouch_auth`, with when and by which question
  (the 2,000 most recent per person).
- `relations.mjs` ([B.43](#b43)): related tickets. Given ticket numbers, it finds their
  families from the link columns (parent / child incidents, bundle / child requests, an
  order's requests, a request's tasks, a change and its incidents, a problem record). It
  says what each family's members share and where they differ, and `describeFamilies`
  sums them up for Claude. The page calls `POST /api/tickets/related` with `{ numbers,
  conversation }`; with `conversation: true`, the summary joins the conversation's
  `pendingNote`, queued behind the answer and only for that same conversation.
- `public/index.html` ([B.25](#b25)): the sign-in page, the header (logo and name, which go
  back to Home; the signed-in name; the Dashboards button; Sign out at the right), the Home tab (welcome, the AI assistant's card with an
  example question, Open chat and Delete chat, ticket results, starred tickets), the
  Dashboards tab with its drawer, and the chat panel.
- `public/style.css` ([B.26](#b26)): the styling.
- `public/app.js` ([B.27](#b27)): sign-in, ticket results and stars, the AI assistant
  chat (sending questions, turning the results into tables with English column names and
  readable values, "New chat", "Delete chat"), the download buttons, and the dashboard
  drawer with drill-down, **← Back** and the toolbar star.
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
3. **Background.** A wide photo (the repository uses a wheat field) saved as
   `public/login-background.jpg` fills the sign-in page behind the box. Without it the
   page shows a plain golden background.

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
  create `scripts/share.mjs` ([B.39](#b39)) and run `npm run share`. It starts OneTouch
  if needed, starts the Cloudflare tunnel from `docker-compose.yml`, waits until the link
  works from the internet, prints it and copies it to the clipboard. `--new` replaces the
  link and `--stop` stops sharing. The free link changes whenever the tunnel restarts, so
  run it again after every restart. With `TUNNEL_TOKEN` in `.env` it runs the permanent
  tunnel instead. [Sharing over the internet with Cloudflare](#sharing-over-the-internet-with-cloudflare)
  in Part 1 has the full setup.
- **Before a crowd:** create `scripts/warmup.mjs` ([B.40](#b40)) and its question list
  `scripts/warmup-questions.txt` ([B.41](#b41)), then run `npm run warmup`. See
  [Presentation day](#presentation-day-many-people-at-once) in Part 1.

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
- `README.md`: this file. Copy it in as it is; `npm run docs` regenerates everything
  from the "BEGIN GENERATED" line down.

Run `npm run check` now. Every line should pass.

## Step 22: Put it in git and recreate the branches

```
git add -A
git status            # .env, csv_data/ and node_modules/ must NOT be listed
git commit -m "OneTouch, rebuilt from README.md"
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

As of 2026-10-21, with `main` at PR #22:

| Branch | Compared with `main` | Missing |
|---|---|---|
| `main` | — | — |
| `Ventura` | same files as PR #20 | PRs #21–#22 (checks and this file) |
| `Luke` | 0 ahead, behind | PRs #14–#22: Metabase charts, better answers, Claude Code agents, dashboard drawer, dashboard drill-down, checks and docs |
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
| Oct 21 | PR #22 | The from-scratch guide (then in `documentation.md`) and `npm run docs` | 21 |
| Oct 21 | PR #23 | Everything moved into this README (`documentation.md` removed); Part 2, the feature reference | — |

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
- [B.37 `tickets.mjs`](#b37)
- [B.38 `stars.mjs`](#b38)
- [B.39 `scripts/share.mjs`](#b39)
- [B.40 `scripts/warmup.mjs`](#b40)
- [B.41 `scripts/warmup-questions.txt`](#b41)
- [B.42 `seen.mjs`](#b42)
- [B.43 `relations.mjs`](#b43)

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
    "remote": "node remote.mjs",
    "share": "node scripts/share.mjs",
    "warmup": "node scripts/warmup.mjs"
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

# Optional: permanent Cloudflare link. The token from the tunnel you create in the
# Cloudflare dashboard (route it to http://app:8000), and the address you gave it, which
# `npm run share` prints. See "Sharing over the internet with Cloudflare" in README.md.
TUNNEL_TOKEN=
ONETOUCH_PUBLIC_URL=

# Optional: the "warmup" account's password, so `npm run warmup` signs in without asking.
# Create the account first: docker exec -it analytics_node_app node scripts/users.mjs add warmup "Warmup"
WARMUP_PASSWORD=
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
    detailColumns: ['number', 'created', 'updated', 'resolved', 'closed', 'priority', 'impact', 'urgency', 'state', 'on_hold_reason', 'short_description', 'description', 'category', 'subcategory', 'assignment_group', 'assigned_to', 'affected_user', 'location', 'configuration_item', 'contact_type', 'close_code', 'close_notes', 'cause_code', 'reassignment_count', 'reopen_count', 'caused_by_change', 'parent_incident', 'problem', 'was_p1'],
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
    detailColumns: ['number', 'request', 'parent', 'opened', 'updated', 'closed', 'item', 'state', 'stage', 'approval', 'short_description', 'description', 'requested_for', 'opened_by', 'location', 'fulfilled_time'],
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
- Parent and child incidents: incident.parent_incident = the parent (master) INC number. A parent incident groups child incidents raised for the same issue (for example several monitoring alerts about one fault); children usually share the parent's server/system, subcategory and state, and are resolved together. 2,080 child incidents point to 514 parents; there is one level only (a parent has no parent of its own). "children / child incidents of INC…" → filter incident.parent_incident equals that number. "parent of INC…" → look up that incident; its parent_incident column holds the parent. "master / parent incidents" → group by incident.parent_incident with incident.count, filter parent_incident set.
- Problem records: incident.problem and change_request.problem hold a PRB number; every ticket linked to the same PRB shares that root cause investigation. The problem records themselves are not in the export.
- Bundle requests: sc_req_item.parent = the parent RITM. A bundle request (e.g. "Start and Snooze Applications/Servers") is split into child RITMs, one per part of the work (e.g. "Virtual Server - Stop"). "child requests of RITM…" → filter sc_req_item.parent equals that number.
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
→ {"intent":"query","queries":[{"entity":"incident","query":{"measures":[],"dimensions":["incident.number","incident.created","incident.updated","incident.resolved","incident.closed","incident.priority","incident.impact","incident.urgency","incident.state","incident.on_hold_reason","incident.short_description","incident.description","incident.category","incident.subcategory","incident.assignment_group","incident.assigned_to","incident.affected_user","incident.location","incident.configuration_item","incident.contact_type","incident.close_code","incident.close_notes","incident.cause_code","incident.reassignment_count","incident.reopen_count","incident.caused_by_change","incident.parent_incident","incident.problem","incident.was_p1"],"filters":[{"member":"incident.number","operator":"equals","values":["INC1814467"]}],"order":[],"limit":1}}],"message":"Full details for incident INC1814467.","assumptions":[]}

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

// The downloader's time zone, which the browser sends, so dates read in their
// own clock time; the server's would be UTC inside Docker. Unknown or missing: UTC.
function exportTimeZone(payload) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: String(payload.timeZone || '') }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

// "Generated Oct 21, 2026, 9:01 PM CDT"
function generatedLine(payload) {
  const when = new Date().toLocaleString('en-US', {
    timeZone: exportTimeZone(payload),
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  return `Generated ${when}`;
}

// Heading lines that open every document: title, the question, the date
function headerLines(payload) {
  const lines = [payload.title || 'One Touch export'];
  if (payload.question) lines.push(`Question: ${payload.question}`);
  lines.push(generatedLine(payload));
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
  // Today's date where the downloader is (late evening in Chicago is already tomorrow in UTC)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: exportTimeZone(payload), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return `one-touch-${slug}-${parts.year}-${parts.month}-${parts.day}`;
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
import * as stars from './stars.mjs';
import * as seen from './seen.mjs';
import { findTickets, ticketRecord, ticketSummaries, ticketNumbersIn, STARRABLE } from './tickets.mjs';
import { relatedFamilies, describeFamilies } from './relations.mjs';
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

app.use(['/api/query', '/api/export', '/api/conversation', '/api/me', '/api/dashboards', '/api/tickets', '/api/stars', '/api/seen-tickets'], requireLogin);

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

  return { parsed, usage: message.usage, memoryReset, userTurn, content: message.content };
}

// =====================================================================
// REPEATED QUESTIONS: the data never changes, so a question that opens a
// conversation and has been asked before (by anyone) reuses Claude's
// translation from then: it answers in a fraction of a second instead of
// a few. Follow-ups depend on the conversation, so they always go to Claude.
// A reused translation still goes through normalizeAndValidate every time.
// =====================================================================

const ANSWER_CACHE_SIZE = 500;
// key -> { userTurn, content, parsed, explanation }; Map order = least recently used first
const answerCache = new Map();

// Same question = same words, ignoring capitals, spacing and the closing "?",
// asked on the same "today" (the turn Claude saw carries the date) of the same model
function answerCacheKey(conversation, userPrompt) {
  if (conversation.messages.length || conversation.pendingNote) return null;
  const question = userPrompt.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s?.!]+$/, '');
  if (!question) return null;
  return JSON.stringify([CLAUDE_MODEL, referenceToday().toISOString().slice(0, 10), question]);
}

function cachedAnswer(key) {
  const entry = key && answerCache.get(key);
  if (entry) { answerCache.delete(key); answerCache.set(key, entry); } // now the most recently used
  return entry || null;
}

function rememberAnswer(key, entry) {
  answerCache.set(key, entry);
  if (answerCache.size > ANSWER_CACHE_SIZE) answerCache.delete(answerCache.keys().next().value);
}

// =====================================================================
// PROGRESS: a page that asks for text/event-stream gets each step as it
// happens ("understanding", "querying", ...) and then the answer, so the
// chat can show what's going on. Anything else gets the plain JSON answer.
// =====================================================================

function queryReply(req, res) {
  const streaming = (req.get('Accept') || '').includes('text/event-stream');
  if (streaming) {
    // no-transform / X-Accel-Buffering: proxies (Cloudflare included) pass each step on at once
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
  }
  const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  return {
    progress(stage) {
      if (streaming) event('progress', { stage });
    },
    send(status, body) {
      if (!streaming) return res.status(status).json(body);
      event('result', { status, ...body });
      res.end();
    },
  };
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
  const reply = queryReply(req, res);
  const run = session.queue.then(() => answerQuestion(session.conversation, userPrompt, reply, req.user));
  session.queue = run.catch(() => {});
  await run;
});

async function answerQuestion(conversation, userPrompt, reply, user) {
  const started = Date.now();
  // Set once Claude's answer is in the conversation; from then on, whatever
  // happens to the query is reported to Claude with the next question
  let remembered = false;
  const cacheKey = answerCacheKey(conversation, userPrompt);
  const cached = cachedAnswer(cacheKey);

  try {
    console.log(`\n💬 Processing prompt: "${userPrompt}" (turn ${conversation.turns + 1})`);

    let parsed, memoryReset = false, fresh = null;
    if (cached) {
      // The conversation gets the original question and Claude's original reply,
      // so follow-ups build on exactly the history Claude produced
      reply.progress('cached');
      conversation.messages.push(cached.userTurn, { role: 'assistant', content: cached.content });
      conversation.turns += 1;
      parsed = cached.parsed;
      console.log('⚡ Asked before: reusing the earlier translation (no Claude call)');
    } else {
      reply.progress('understanding');
      const t = await translateToQuery(conversation, userPrompt);
      ({ parsed, memoryReset } = t);
      fresh = { userTurn: t.userTurn, content: t.content, parsed };
      console.log(`🧠 tokens in=${t.usage.input_tokens} cached=${t.usage.cache_read_input_tokens ?? 0} out=${t.usage.output_tokens}`);
    }
    remembered = true;
    // Timing and whether Claude was skipped, for the page's "Answered in …" line
    const timing = () => ({ elapsedMs: Date.now() - started, fromCache: Boolean(cached) });

    const verdict = normalizeAndValidate(parsed);
    if (!verdict.ok) {
      console.warn('⚠️ Rejected by validator:', verdict.error, JSON.stringify(parsed));
      conversation.pendingNote = `it was rejected before running: ${verdict.error}`;
      return reply.send(400, {
        error: `I couldn't map that question onto the data: ${verdict.error}`,
        aiInterpretation: parsed,
      });
    }

    if (verdict.intent !== 'query') {
      // clarify / unsupported: nothing to run, hand the explanation back
      console.log(`🙋 ${verdict.intent}: ${verdict.message}`);
      if (fresh && cacheKey) rememberAnswer(cacheKey, fresh);
      return reply.send(200, {
        intent: verdict.intent,
        message: verdict.message,
        assumptions: verdict.assumptions,
        memoryReset,
        sections: [],
        results: [],
        ...timing(),
      });
    }

    // One Cube query per ticket type, run side by side
    reply.progress('querying');
    for (const q of verdict.queries) console.log(`🤖 Cube query [${q.entity}]:`, JSON.stringify(q.cubeQuery));
    const sections = await Promise.all(verdict.queries.map(async q => ({
      entity: q.entity,
      rows: await runCubeQuery(q.cubeQuery),
    })));
    // Nothing found: work out why (which filter emptied it, what dates the data
    // covers) and have Claude say so plainly, instead of a bare "no records".
    // A repeated question reuses the explanation it got the first time.
    const emptyQueries = verdict.queries.filter((_, i) => isEmptyResult(sections[i].rows));
    let explanation = cached?.explanation ?? null;
    if (emptyQueries.length && !explanation) {
      reply.progress('explaining');
      try {
        const facts = (await Promise.all(emptyQueries.map(q => diagnoseEmpty(q.entity, q.cubeQuery, runCubeQuery)))).flat();
        console.log('🔎 Empty result facts:\n   ' + facts.join('\n   '));
        explanation = await explainEmpty({ anthropic, model: CLAUDE_MODEL, question: userPrompt, searchedFor: verdict.message, facts });
        console.log(`🔎 Explained: ${explanation}`);
        if (cached) cached.explanation = explanation;
      } catch (error) {
        console.error('🔎 Could not diagnose the empty result:', error.message);
      }
    }
    if (!emptyQueries.length) explanation = null;
    conversation.pendingNote = describeResults(sections) + (explanation ? ` What the user was told about the empty result: ${explanation}` : '');

    // Counts across several ticket types become one table with a total column
    const combined = verdict.merge ? combineResults(verdict.merge, verdict.queries, sections) : null;

    // Only an answer that ran all the way through is worth reusing
    if (fresh && cacheKey) rememberAnswer(cacheKey, { ...fresh, explanation });

    // The tickets in this answer join the person's "Ticket results" on Home.
    // Saved before the answer goes out, so the page can show the list at once;
    // a failure here only costs the list, never the answer.
    const shownTickets = ticketNumbersIn(sections.flatMap(s => s.rows));
    if (shownTickets.length) {
      await seen.recordSeen(user.id, shownTickets, userPrompt)
        .catch(error => console.error('🎫 Could not remember the shown tickets:', error.message));
    }

    reply.send(200, {
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
      // Ticket numbers in this answer (now in the person's Ticket results)
      shownTickets,
      ...timing(),
    });

  } catch (error) {
    if (remembered) conversation.pendingNote = `it failed when run: ${error.message}`;
    if (error instanceof Anthropic.APIError) {
      console.error(`📋 Claude API error ${error.status}:`, error.message);
      return reply.send(502, { error: `Claude API error (${error.status}): ${error.message}` });
    }
    console.error('📋 Execution Failure Context:', error);
    reply.send(500, { error: `Server pipeline failed: ${error.message}` });
  }
}

// =====================================================================
// HOME PAGE: ticket search (see tickets.mjs) and each person's starred
// tickets (see stars.mjs)
// =====================================================================

// { text, record } -> the tickets the text names; with record: true and a
// single ticket found, also its full record
app.post('/api/tickets/search', async (req, res) => {
  const { text, record } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Type a ticket number to search for.' });
  if (text.length > 20000) return res.status(400).json({ error: 'That is too much text to search; paste at most a few hundred ticket numbers.' });

  try {
    const result = await findTickets(text, runCubeQuery);
    if (record && result.found.length === 1) {
      // Without the full record the page still shows the ticket's summary row
      result.record = await ticketRecord(result.found[0].number, runCubeQuery, {
        cubeUrl: process.env.CUBE_API_URL || 'http://localhost:4000/cubejs-api/v1/load',
        token: process.env.CUBE_API_TOKEN || 'super_secret_key_change_me_later',
      }).catch(error => {
        console.error(`🔎 Could not load the full record of ${result.found[0].number}:`, error.message);
        return null;
      });
    }
    console.log(`🔎 ${req.user.username} searched ${result.found.length} found, ${result.notFound.length} not found`);
    res.json(result);
  } catch (error) {
    console.error('🔎 Ticket search failed:', error.message);
    res.status(502).json({ error: `Could not search the tickets right now: ${error.message}` });
  }
});

// { numbers, conversation } -> { families }: the parent/child, order, task,
// change and problem families those tickets belong to (relations.mjs), with
// what each family's members share and where they differ. conversation: true
// (an AI answer's tickets) also tells Claude about them with the next question.
app.post('/api/tickets/related', async (req, res) => {
  const numbers = Array.isArray(req.body?.numbers) ? req.body.numbers.slice(0, 500).map(String) : [];
  if (!numbers.length) return res.status(400).json({ error: 'No ticket numbers to look at.' });
  try {
    const families = await relatedFamilies(numbers, runCubeQuery);
    if (req.body.conversation && families.length) {
      // Queued behind the answer that showed these tickets, and only for that
      // same conversation (not one started by "New chat" in the meantime)
      const session = req.session;
      const conversation = session.conversation;
      session.queue = session.queue.then(() => {
        if (session.conversation !== conversation) return;
        const note = `Related tickets OneTouch showed the user under that answer: ${describeFamilies(families)}`;
        conversation.pendingNote = conversation.pendingNote ? `${conversation.pendingNote} ${note}` : note;
      });
    }
    res.json({ families });
  } catch (error) {
    console.error('🔗 Could not find related tickets:', error.message);
    res.status(502).json({ error: `Could not look for related tickets right now: ${error.message}` });
  }
});

// Every ticket this person has been shown, newest first, with each one's
// summary, when it was shown, and the question that showed it
app.get('/api/seen-tickets', async (req, res) => {
  try {
    const list = await seen.listSeen(req.user.id);
    const summaries = await ticketSummaries(list.map(s => s.number), runCubeQuery);
    res.json({ tickets: list.filter(s => summaries.has(s.number)).map(s => ({ ...summaries.get(s.number), shownAt: s.shownAt, question: s.question })) });
  } catch (error) {
    console.error('🎫 Could not list the shown tickets:', error.message);
    res.status(503).json({ error: 'Your ticket results could not be loaded right now.' });
  }
});

// "Delete ticket results": empties this person's list (their stars stay)
app.delete('/api/seen-tickets', async (req, res) => {
  try {
    const deleted = await seen.clearSeen(req.user.id);
    console.log(`🎫 ${req.user.username} deleted their ticket results (${deleted})`);
    res.json({ ok: true, deleted });
  } catch (error) {
    console.error('🎫 Could not delete the ticket results:', error.message);
    res.status(503).json({ error: 'Your ticket results could not be deleted right now.' });
  }
});

// A ticket record someone opened (clicked a ticket number): it joins their Ticket results
app.post('/api/seen-tickets', async (req, res) => {
  const numbers = (Array.isArray(req.body?.numbers) ? req.body.numbers : []).map(n => String(n).toUpperCase()).filter(n => STARRABLE.test(n)).slice(0, 50);
  if (!numbers.length) return res.status(400).json({ error: 'No ticket numbers to remember.' });
  try {
    await seen.recordSeen(req.user.id, numbers, null);
    res.json({ ok: true });
  } catch (error) {
    console.error('🎫 Could not remember an opened ticket:', error.message);
    res.status(503).json({ error: 'That ticket could not be added to your ticket results right now.' });
  }
});

app.get('/api/stars', async (req, res) => {
  try {
    res.json({ stars: await stars.listStars(req.user.id) });
  } catch (error) {
    console.error('⭐ Could not list stars:', error.message);
    res.status(503).json({ error: 'Your starred tickets could not be loaded right now.' });
  }
});

// "Star all": { numbers } -> { starred: the ones starred now, full: some didn't fit under the limit }
app.put('/api/stars', async (req, res) => {
  const requested = Array.isArray(req.body?.numbers) ? req.body.numbers : [];
  const numbers = [...new Set(requested.map(n => String(n).toUpperCase()))].filter(n => STARRABLE.test(n)).slice(0, stars.MAX_STARS);
  if (!numbers.length) return res.status(400).json({ error: 'Only incident, change, request and task numbers can be starred.' });
  try {
    const starred = await stars.addStars(req.user.id, numbers);
    res.json({ starred, full: starred.length < numbers.length });
  } catch (error) {
    console.error('⭐ Could not star all:', error.message);
    res.status(503).json({ error: 'Those tickets could not be starred right now.' });
  }
});

app.put('/api/stars/:number', async (req, res) => {
  const number = String(req.params.number).toUpperCase();
  if (!STARRABLE.test(number)) return res.status(400).json({ error: 'Only incident, change, request and task numbers can be starred.' });
  try {
    if (!await stars.addStar(req.user.id, number)) {
      return res.status(409).json({ error: `You can star at most ${stars.MAX_STARS.toLocaleString()} tickets. Unstar some first.` });
    }
    res.json({ ok: true, number });
  } catch (error) {
    console.error('⭐ Could not star:', error.message);
    res.status(503).json({ error: 'That ticket could not be starred right now.' });
  }
});

app.delete('/api/stars/:number', async (req, res) => {
  const number = String(req.params.number).toUpperCase();
  try {
    await stars.removeStar(req.user.id, number);
    res.json({ ok: true, number });
  } catch (error) {
    console.error('⭐ Could not unstar:', error.message);
    res.status(503).json({ error: 'That ticket could not be unstarred right now.' });
  }
});

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
    await stars.ensureStarsSchema();
    await seen.ensureSeenSchema();
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
        <!-- Top left: the logo and name (back to Home), who's signed in, and Dashboards -->
        <div class="header-left">
            <h1 class="app-title">
                <button type="button" class="home-link" onclick="goHome()" title="Back to Home">
                    <img src="android-chrome-192x192.png" alt="" class="app-logo"> OneTouch
                </button>
            </h1>
            <span id="user-name" class="user-name"></span>
            <nav class="tab-navigation">
                <button class="tab-btn" data-tab="dashboard" onclick="switchTab('dashboard')">📈 Dashboards</button>
            </nav>
        </div>
        <button class="sign-out-btn" type="button" onclick="signOut()">Sign out</button>
    </header>

    <main class="app-content">
        <!-- HOME: welcome, ticket search and starred tickets -->
        <section id="home-view" class="view-panel active">
            <div class="home">
                <h2 class="home-welcome" id="home-welcome">Welcome!</h2>
                <!-- The AI assistant: an example question, and the open / delete chat buttons -->
                <div class="search-guide">
                    <div class="guide-card">
                        <span class="guide-title">💬 Any question about the data</span>
                        <span class="guide-text">In plain English. The AI assistant answers with a table you can download, and remembers the conversation for follow-ups.</span>
                        <button type="button" class="guide-example" data-example="How many open incidents are there by priority?">How many open incidents are there by priority?</button>
                        <div class="chat-controls">
                            <button type="button" class="home-action" id="open-chat-btn" onclick="toggleAssistant(true)"
                                    aria-controls="assistant-panel" aria-expanded="false">💬 Open chat</button>
                            <button type="button" class="home-action danger" id="delete-chat-btn" hidden onclick="deleteChat()">🗑 Delete chat</button>
                        </div>
                    </div>
                </div>

                <div class="home-modes" role="tablist" aria-label="Your tickets">
                    <button type="button" role="tab" class="home-mode active" data-mode="results" aria-selected="true" aria-controls="home-results" onclick="setHomeMode('results')">
                        <span class="home-mode-name">🎫 Ticket results</span>
                        <span class="home-mode-desc">Every ticket the AI assistant has shown you</span>
                    </button>
                    <button type="button" role="tab" class="home-mode" data-mode="starred" aria-selected="false" aria-controls="home-starred" onclick="setHomeMode('starred')">
                        <span class="home-mode-name">★ Starred tickets <span class="star-count" id="star-count">0</span></span>
                        <span class="home-mode-desc">Saved to your account</span>
                    </button>
                </div>

                <div class="home-panel" id="home-results" role="tabpanel">
                    <div class="home-result" id="ticket-results" aria-live="polite"></div>
                </div>

                <div class="home-panel" id="home-starred" role="tabpanel" hidden>
                    <div class="home-result" id="starred-result" aria-live="polite"></div>
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
                    <!-- On an incident, change or request record: star it -->
                    <button type="button" class="star-btn labelled" id="dashboard-star" hidden></button>
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

        <!-- AI ASSISTANT, opened from the bar in the header; floats over any page -->
        <div class="assistant-backdrop" id="assistant-backdrop" onclick="toggleAssistant(false)"></div>
        <section class="assistant-panel" id="assistant-panel" aria-label="AI Assistant">
            <div class="assistant-head">
                <span class="assistant-title">💬 AI Assistant</span>
                <div class="assistant-head-actions">
                    <button type="button" class="assistant-delete" onclick="deleteChat()" title="Delete this conversation: its questions and answers disappear and the assistant forgets it">🗑 Delete chat</button>
                    <button type="button" class="assistant-minimize" onclick="toggleAssistant(false)" title="Close the chat (the conversation is kept; Open chat on Home brings it back)">Minimize ▴</button>
                </div>
            </div>
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
    gap: 16px;
}

.app-header h1 { margin: 0; font-size: 1.25rem; }
.app-title { display: flex; align-items: center; }
/* The logo and "OneTouch": a button back to Home */
.home-link {
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    border-radius: 6px;
    padding: 2px 4px 2px 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
}
/* Only with a mouse: on touch screens a tapped link would keep its hover color */
@media (hover: hover) {
    .home-link:hover { color: #c6f6e5; }
}
.home-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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

/* Top left, one row: logo and name (Home), who's signed in, then Dashboards */
.header-left { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; min-width: 0; }
.tab-navigation { display: flex; }
.tab-navigation .tab-btn {
    background: transparent;
    border: 1px solid #4a5568;
    border-radius: 6px;
    color: #cbd5e0;
    padding: 5px 12px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    white-space: nowrap;
}
.tab-navigation .tab-btn:hover { color: white; border-color: #a0aec0; }

.sign-out-btn {
    background: transparent;
    border: 1px solid #4a5568;
    border-radius: 6px;
    color: #cbd5e0;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 0.9rem;
    flex-shrink: 0;
}
.sign-out-btn:hover { color: white; border-color: #a0aec0; }

/* While the dashboards are showing */
.tab-navigation .tab-btn.active {
    color: white;
    background: var(--accent);
    border-color: var(--accent);
}

.app-content { flex: 1; position: relative; overflow: hidden; }

.view-panel {
    display: none;
    position: absolute;
    width: 100%;
    height: 100%;
}

.view-panel.active { display: flex; }


/* The full conversation, dropped down over whichever page is showing */
.assistant-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(26, 32, 44, 0.35);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
    z-index: 10;
}
.assistant-backdrop.open { opacity: 1; pointer-events: auto; }
.assistant-panel {
    position: absolute;
    top: 12px;
    bottom: 16px;
    left: 50%;
    width: min(1200px, calc(100% - 32px));
    display: flex;
    flex-direction: column;
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.22);
    overflow: hidden;
    z-index: 11;
    opacity: 0;
    transform: translate(-50%, -12px);
    visibility: hidden;
    /* Hidden only after the fade, but visible (and focusable) at once on open */
    transition: opacity 0.15s, transform 0.15s, visibility 0s linear 0.15s;
}
.assistant-panel.open {
    opacity: 1;
    transform: translate(-50%, 0);
    visibility: visible;
    transition: opacity 0.15s, transform 0.15s, visibility 0s;
}
.assistant-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    font-weight: 700;
}
.assistant-head-actions { display: flex; gap: 8px; }
.assistant-minimize,
.assistant-delete {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
}
.assistant-minimize:hover { background: var(--bg-primary); }
.assistant-delete { color: #c53030; }
.assistant-delete:hover { background: #fff5f5; border-color: #feb2b2; }
.assistant-panel .chat-container {
    flex: 1;
    min-height: 0;
    max-width: none;
    height: auto;
    margin: 0;
    border: none;
    border-radius: 0;
}

@media (max-width: 900px) {
    .app-header { padding: 10px 16px; }
}

/* HOME PAGE: the welcome sits in the page's top-left corner */
#home-view { overflow-y: auto; }
.home {
    width: 100%;
    max-width: 1400px;
    padding: 24px 24px 40px;
    box-sizing: border-box;
}
.home-welcome { margin: 0 0 12px; font-size: 1.6rem; }

/* The AI assistant's card: what it does, an example question, open / delete chat */
.search-guide {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    margin-bottom: 20px;
    max-width: 720px;
}
.guide-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
}
.guide-title { font-weight: 700; }
.guide-text { font-size: 0.87rem; color: #4a5568; line-height: 1.45; }
.guide-example {
    align-self: flex-start;
    max-width: 100%;
    margin-top: 2px;
    background: #f3fbf8;
    border: 1px dashed var(--accent);
    border-radius: 6px;
    padding: 6px 10px;
    color: #0b7a5f;
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
    overflow-wrap: anywhere;
}
.guide-example::before { content: 'Try: '; color: #718096; }
.guide-example:hover { background: #e6f6f1; border-style: solid; }
.chat-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.home-action.danger { color: #c53030; }
.home-action.danger:hover { background: #fff5f5; border-color: #feb2b2; }

.home-modes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 16px;
    max-width: 720px;
}
.home-mode {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    color: var(--text);
    cursor: pointer;
    font: inherit;
}
.home-mode:hover { border-color: #a0aec0; }
.home-mode.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: #f3fbf8; }
.home-mode-name { font-weight: 700; }
.home-mode-desc { font-size: 0.82rem; color: #718096; }
.star-count {
    display: inline-block;
    min-width: 1.4em;
    padding: 0 6px;
    margin-left: 4px;
    border-radius: 999px;
    background: #edf2f7;
    font-size: 0.78rem;
    text-align: center;
}
.home-panel {
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
}
.home-status { margin: 0 0 10px; color: #4a5568; line-height: 1.5; }
.home-status:last-child { margin-bottom: 0; }
.home-status.error { color: #c53030; }
.home-actions { margin: 0 0 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
/* Ticket results: the summary line, with Delete ticket results at its right */
.results-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px 16px; }
.results-head .home-status { flex: 1 1 320px; margin-bottom: 0; }
.results-head .home-action { flex-shrink: 0; }
/* Ticket results: the rows from the latest answer */
.result-table tbody tr.fresh,
.result-table tbody tr.fresh:nth-child(even) { background: #fefcbf; }
.result-table tbody tr.fresh:hover { background: #faf089; }
.fresh-key { background: #fefcbf; border-radius: 4px; padding: 1px 6px; }
.home-action {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
}
.home-action:hover { background: var(--bg-primary); }
.table-wrap.tall { max-height: 640px; }

/* One ticket's heading: type, number, star, link to its dashboard record */
.ticket-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.ticket-type {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #718096;
}
.ticket-number { font-size: 1.3rem; font-weight: 700; }
.ticket-summary { margin: 6px 0 12px; color: #4a5568; }
.ticket-cell { white-space: nowrap; }
.ticket-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: #2b6cb0;
    cursor: pointer;
}
.ticket-link:hover { text-decoration: underline; }

/* STARS: next to any ticket number, wherever it shows */
.star-btn {
    background: none;
    border: none;
    padding: 0 4px;
    margin-left: 4px;
    font-size: 1.05rem;
    line-height: 1;
    color: #a0aec0;
    cursor: pointer;
    vertical-align: baseline;
}
.star-btn:hover { color: #d69e2e; }
.star-btn.on { color: #d69e2e; }
.star-btn.labelled {
    margin-left: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
}
.star-btn.labelled.on { color: #975a16; background: #fefcbf; border-color: #ecc94b; }
.dashboard-toolbar .star-btn.labelled { flex-shrink: 0; margin-left: auto; }

/* TICKET ROWS IN AI ANSWERS: click to open the full record and related tickets */
.result-table tbody tr.expandable { cursor: pointer; }
.result-table tbody tr.expandable:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.result-table tbody tr.expanded,
.result-table tbody tr.expanded:nth-child(even) { background: #e6f6f1; }
.expand-caret { display: inline-block; width: 1em; color: #a0aec0; transition: transform 0.15s; }
tr.expanded .expand-caret { transform: rotate(90deg); color: var(--accent); }
/* The opened view: under its row, kept in sight when the table scrolls sideways */
.result-table tbody tr.row-detail,
.result-table tbody tr.row-detail:nth-child(even),
.result-table tbody tr.row-detail:hover { background: #f7fafc; }
.result-table tr.row-detail > td { padding: 0; border-bottom: 2px solid var(--accent); }
.row-detail-body {
    position: sticky;
    left: 0;
    box-sizing: border-box;
    width: min(1100px, calc(100vw - 120px));
    padding: 12px 16px 16px;
    border-left: 3px solid var(--accent);
}
.row-detail-close {
    float: right;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
}
.row-detail-close:hover { background: var(--panel-bg); }
/* A table with an opened row shows in full, instead of in a short scrolling box */
.table-wrap:has(tr.row-detail) { max-height: none; }

/* RELATED TICKETS: under an AI answer, and under a ticket's record on Home */
.related { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
.related-title { font-weight: 700; margin-bottom: 8px; }
.related-loading { margin: 12px 0 0; color: #718096; font-size: 0.85rem; }
.family { margin-bottom: 16px; padding: 12px 14px; background: var(--panel-bg); border: 1px solid var(--border); border-left: 3px solid #4299e1; border-radius: 6px; }
.family-title { font-weight: 600; }
.family-why { margin: 4px 0 8px; color: #4a5568; font-size: 0.87rem; line-height: 1.45; }
.family-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 0 0 6px; font-size: 0.85rem; line-height: 1.5; }
.same-label, .differ-label { font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 7px; border-radius: 4px; }
.same-label { background: #e6fffa; color: #0b7a5f; }
.differ-label { background: #fffaf0; color: #b7791f; }
.fact b { font-weight: 600; color: #4a5568; }
.family-more { margin: 6px 0 0; color: #718096; font-size: 0.8rem; }
.family .table-wrap { max-height: 320px; margin-top: 8px; }
/* "Download all N families as" above the families */
.related > .download-bar { margin: 0 0 12px; }
/* The ticket (or tickets) the question was about, in each family */
.result-table tbody tr.focus,
.result-table tbody tr.focus:nth-child(even) { background: #ebf8ff; }
.result-table tbody tr.focus td:first-child { box-shadow: inset 3px 0 0 #4299e1; }

/* "Star all": under an AI answer's table, and above Ticket results */
.star-all-bar { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.star-many {
    background: #fffff0;
    border: 1px solid #ecc94b;
    border-radius: 6px;
    padding: 5px 10px;
    color: #975a16;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
}
.star-many:hover:not(:disabled) { background: #fefcbf; }
.star-many:disabled { background: transparent; border-color: var(--border); color: #718096; cursor: default; }

.toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translate(-50%, 20px);
    background: #1a202c;
    color: white;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 0.9rem;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s, transform 0.2s;
    z-index: 50;
    max-width: calc(100% - 32px);
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }

@media (max-width: 700px) {
    .home { padding: 16px 16px 32px; }
    .home-modes { grid-template-columns: minmax(0, 1fr); }
}

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

/* While a question is being answered: finished steps above the current one */
.query-progress { min-width: 260px; }
.progress-done { color: #718096; font-size: 0.85rem; }
.progress-current { font-weight: 600; }
.progress-time { margin-left: 6px; color: #a0aec0; font-size: 0.8rem; font-weight: 400; font-variant-numeric: tabular-nums; }

/* RESULT TABLES */
.ai-msg.wide { max-width: 100%; width: 100%; box-sizing: border-box; }
/* "Answered in 2.8 s" under each answer */
.result-timing { margin-top: 8px; color: #a0aec0; font-size: 0.78rem; }

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
  /* Wheat photo filling the screen; the color shows while it loads */
  background: #c8973f url("login-background.jpg") center / cover no-repeat;
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

// Signed in: the home page, with this person's starred tickets
function showApp(signedIn) {
    document.body.classList.toggle('signed-out', !signedIn);
    if (signedIn) {
        switchTab('home');
        loadStars();
    } else {
        document.getElementById('login-email').focus();
    }
}

// The signed-in person's name, shown in the header and the greetings
// (their display name, or their username if they don't have one)
let currentUserName = '';
let currentUsername = '';

function setCurrentUser(user) {
    currentUserName = user ? (user.displayName || user.username || '') : '';
    currentUsername = user ? (user.username || '') : '';
    document.getElementById('user-name').textContent = currentUserName;
    renderGreetings();
    // Each person's home page opens on the search they used last
    if (currentUsername) setHomeMode(rememberedHomeMode());
}

// Just the first name: "Cassidy Sotelo" -> "Welcome, Cassidy!" on the home
// page and "Hello, Cassidy!" at the top of the chat
function renderGreetings() {
    const firstName = currentUserName.trim().split(/\s+/)[0];
    document.getElementById('home-welcome').textContent = firstName ? `Welcome, ${firstName}!` : 'Welcome!';
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
    // The next person to sign in on this computer must not see this person's
    // chat, searches or stars
    toggleAssistant(false);
    clearChat();
    setCurrentUser(null);
    resetHome();
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

// Bumped whenever the chat is cleared, so an answer still on its way for the
// old conversation is dropped instead of landing in the new one
let chatEpoch = 0;

// Back to just the greeting (with the signed-in person's name)
function clearChat() {
    chatEpoch += 1;
    document.getElementById('chat-log').innerHTML = WELCOME_HTML;
    forgetRemovedExports();
    renderGreetings();
    updateChatControls();
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

// "Delete chat": after a confirmation, the questions and answers disappear,
// Claude forgets the conversation, and the chat closes
async function deleteChat() {
    if (!document.querySelector('#chat-log .user-msg')) {
        toggleAssistant(false);
        return;
    }
    if (!confirm('Delete this chat? Its questions and answers disappear, and the AI assistant forgets the conversation.')) return;
    clearChat();
    toggleAssistant(false);
    await resetConversation();
    showToast('Chat deleted');
}

// The logo and the name "OneTouch": back to Home from anywhere, closing
// whatever is open on top (the chat, the dashboards drawer)
function goHome() {
    toggleAssistant(false);
    toggleDashboardDrawer(false);
    switchTab('home');
    document.getElementById('home-view').scrollTop = 0;
}

// Pages: Home (the logo) and Dashboards (its button); the AI assistant opens over either
function switchTab(viewName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === viewName));
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${viewName}-view`));
    if (viewName === 'dashboard') loadDashboards();
    // Stars may have changed elsewhere (the chat, a dashboard, another computer)
    if (viewName === 'home') {
        if (homeMode === 'starred') showStarred();
        else showTicketResults(true);
    }
}

// =====================================================================
// AI ASSISTANT: the chat opens over the page from Home's "Any question about
// the data" card (Open chat, or its example question). Minimize closes it and
// keeps the conversation; Delete chat removes it.
// =====================================================================

function assistantOpen() {
    return document.getElementById('assistant-panel').classList.contains('open');
}

// Opens or closes the conversation (no argument: the opposite of now)
function toggleAssistant(open) {
    const panel = document.getElementById('assistant-panel');
    const willOpen = typeof open === 'boolean' ? open : !assistantOpen();
    panel.classList.toggle('open', willOpen);
    document.getElementById('assistant-backdrop').classList.toggle('open', willOpen);
    document.getElementById('open-chat-btn').setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
        const chatLog = document.getElementById('chat-log');
        chatLog.scrollTop = chatLog.scrollHeight;
        document.getElementById('user-prompt').focus();
    } else if (panel.contains(document.activeElement)) {
        document.getElementById('open-chat-btn').focus();
    }
    updateChatControls();
}

// Asks a question as if typed into the chat, opening it to show the answer
function askAssistant(question) {
    toggleAssistant(true);
    document.getElementById('user-prompt').value = question;
    sendPrompt();
}

// Home's chat buttons: Open chat says how many questions the conversation has,
// and Delete chat appears once there is something to delete
function updateChatControls() {
    const asked = document.querySelectorAll('#chat-log .user-msg').length;
    document.getElementById('open-chat-btn').textContent = asked ? `💬 Open chat (${asked})` : '💬 Open chat';
    document.getElementById('delete-chat-btn').hidden = !asked;
}

// =====================================================================
// DASHBOARDS TAB: the Metabase dashboards made by scripts/metabase-setup.mjs,
// shown through the OneTouch server (so they work from any address)
// =====================================================================

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

// Loads the drawer once; resolves true when the dashboards are there.
// Shared, so the tab and "Open in Dashboards" never load it twice.
let dashboardsLoading = null;
function loadDashboards() {
    if (!dashboardsLoading) {
        dashboardsLoading = buildDashboards().then(ok => {
            if (!ok) dashboardsLoading = null; // try again next time
            return ok;
        });
    }
    return dashboardsLoading;
}

async function buildDashboards() {
    const picker = document.getElementById('dashboard-picker');
    const message = document.getElementById('dashboard-message');
    try {
        const response = await fetch(`${API_BASE}/api/dashboards`, { headers: authHeaders() });
        if (handleUnauthorized(response)) return false;
        const { dashboards, details = [] } = await response.json();
        for (const d of dashboards) dashboardPages.main.set(pageId(d.path), d);
        for (const d of details) dashboardPages.details.set(pageId(d.path), d);
        if (!dashboards.length) {
            message.textContent = 'No dashboards yet. Whoever runs this OneTouch server can create them with: ' +
                'docker exec analytics_node_app node scripts/metabase-setup.mjs';
            document.getElementById('dashboard-drawer-toggle').hidden = true;
            return false;
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

        const remembered = dashboards.find(d => d.key === rememberedDashboard());
        showDashboard(remembered || dashboards[0]);
        // First visit: open the drawer so people see everything that's there
        if (!remembered) toggleDashboardDrawer(true);
        return true;
    } catch (err) {
        message.textContent = 'Could not load the dashboards. Please try again.';
        console.error(err);
        return false;
    }
}

// The record pages a ticket number can open (built by scripts/metabase-setup.mjs)
const RECORD_PAGES = { INC: 'incident-detail', CHG: 'change-detail', RITM: 'request-detail' };

// Home page -> that ticket's record in the Dashboards tab
async function openInDashboards(number) {
    toggleAssistant(false); // opened from a ticket inside the chat: show the page behind it
    switchTab('dashboard');
    if (!await loadDashboards()) return;
    const key = RECORD_PAGES[(number.match(/^[A-Z]+/) || [])[0]];
    const page = [...dashboardPages.details.values()].find(d => d.key === key);
    if (!page) return;
    toggleDashboardDrawer(false);
    openDashboardPath(`${page.path}?number=${encodeURIComponent(number)}#titled=false&bordered=false`);
}

// Moves the frame to a page the way a click inside it would, so ← Back
// returns to the dashboard underneath. A frame still loading its first
// dashboard moves once that has loaded.
let pendingFramePath = null;
function frameHasPage() {
    try {
        return Boolean(pageId(document.getElementById('dashboard-frame').contentWindow.location.pathname));
    } catch { return false; }
}
function openDashboardPath(path) {
    if (frameHasPage()) document.getElementById('dashboard-frame').contentWindow.location.assign(`${API_BASE}${path}`);
    else pendingFramePath = path;
}
document.getElementById('dashboard-frame').addEventListener('load', () => {
    if (!pendingFramePath || !frameHasPage()) return;
    const path = pendingFramePath;
    pendingFramePath = null;
    // Not during the load event itself: a page moved before it has finished
    // loading replaces its history entry, and ← Back would then leave OneTouch
    setTimeout(() => document.getElementById('dashboard-frame').contentWindow.location.assign(`${API_BASE}${path}`), 50);
});

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
        // Every filter cleared (the × in the filter box): the page has nothing to
        // show, so go back to the dashboard it was opened from. replace(), so ← Back
        // doesn't return to the empty page.
        const values = new URLSearchParams(where.search);
        if (!detail.params.some(p => values.get(p.slug))) {
            const home = currentMainDashboard || [...dashboardPages.main.values()][0];
            if (home) {
                frame.contentWindow.location.replace(`${API_BASE}${home.path}#bordered=false&titled=false`);
                showToast(`No filters left, so you're back on ${home.name}`);
                return;
            }
        }
        setDashboardHeading(currentMainDashboard ? currentMainDashboard.name : '', detailPageLabel(detail, where.search), '', true);
    }

    // An incident, change or request record can be starred from the toolbar
    const star = document.getElementById('dashboard-star');
    const number = detail && detail.params.some(p => p.slug === 'number')
        ? String(new URLSearchParams(where.search).get('number') || '').toUpperCase() : '';
    star.hidden = !STARRABLE.test(number);
    if (!star.hidden) {
        star.dataset.star = number;
        paintStar(star);
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

// Escape closes whatever is open on top: the conversation, then the drawer
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (assistantOpen()) toggleAssistant(false);
    else if (document.getElementById('dashboard-drawer').classList.contains('open')) toggleDashboardDrawer(false);
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

    // Shows each step while the answer is worked out, with a running clock
    const progress = startQueryProgress();
    const epoch = chatEpoch;

    try {
        // text/event-stream: the server reports each step as it happens
        const response = await fetch(`${API_BASE}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeaders() },
            body: JSON.stringify({ userPrompt: userPromptText })
        });

        if (handleUnauthorized(response)) {
            progress.finish();
            return;
        }

        const data = await readQueryResponse(response, stage => progress.step(stage));
        const seconds = progress.finish();
        if (epoch !== chatEpoch) return; // the chat was deleted or restarted meanwhile

        if (data.memoryReset) {
            appendMessage('system-msg', 'This conversation got long, so Claude started fresh. Earlier questions are no longer remembered.');
        }

        if (data.error) {
            appendMessage('ai-msg', `❌ Error: ${escapeHtml(data.error)}`);
            return;
        }

        // Clarification or unsupported question: show the explanation only
        if (data.intent === 'clarify' || data.intent === 'unsupported') {
            appendMessage('ai-msg', `🙋 ${escapeHtml(data.message || 'I need a little more detail to run that.')}` + answerTimingHtml(seconds, data.fromCache));
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

        // Star every ticket the answer lists, or all of one type
        html += starAllHtml(answerTicketNumbers(data));

        // Offer the same tables as a download in any of the export formats
        const tables = buildExportTables(data);
        if (tables.length) {
            html += downloadBarHtml(registerExport({
                title: data.message || 'One Touch results',
                question: userPromptText,
                tables,
            }));
        }

        const answerId = appendMessage('ai-msg wide', html + answerTimingHtml(seconds, data.fromCache));

        // Parent / child tickets and others linked to the ones in this answer, under it
        const primary = answerTicketNumbers(data);
        if (primary.length) showRelated(document.getElementById(answerId), primary, true);

        // The tickets in this answer pop up in Ticket results on Home
        if (data.shownTickets && data.shownTickets.length) ticketsShown(data.shownTickets);

    } catch (err) {
        progress.finish();
        if (epoch !== chatEpoch) return;
        appendMessage('ai-msg', `❌ Could not reach the OneTouch server, or the answer was cut off. Please try again.`);
        console.error(err);
    }
}

// =====================================================================
// PROGRESS: what the server is doing with the question, step by step
// =====================================================================

// [while it runs, once it's done]
const QUERY_STEPS = {
    sending: ['📨 Sending your question…', 'Sent your question'],
    understanding: ['🧠 Understanding your question…', 'Understood your question'],
    cached: ['⚡ Asked before: reusing that answer…', 'Reused the earlier answer (no AI wait)'],
    querying: ['📊 Getting the data…', 'Got the data'],
    explaining: ['🔎 Nothing matched; working out why…', 'Worked out why'],
};

// A chat bubble listing finished steps (with how long each took) and the
// current one with a running clock. finish() removes it and returns the total seconds.
function startQueryProgress() {
    const started = performance.now();
    const steps = []; // { stage, at }
    const id = appendMessage('ai-msg query-progress', '');
    const bubble = document.getElementById(id);
    const secs = ms => `${(ms / 1000).toFixed(1)} s`;

    function render() {
        const now = performance.now();
        bubble.innerHTML = steps.map((s, i) => {
            const end = steps[i + 1] ? steps[i + 1].at : now;
            return i < steps.length - 1
                ? `<div class="progress-done">✓ ${escapeHtml(QUERY_STEPS[s.stage][1])} <span class="progress-time">${secs(end - s.at)}</span></div>`
                : `<div class="progress-current">${escapeHtml(QUERY_STEPS[s.stage][0])} <span class="progress-time">${secs(now - started)}</span></div>`;
        }).join('');
    }

    function step(stage) {
        if (!QUERY_STEPS[stage] || steps.some(s => s.stage === stage)) return;
        steps.push({ stage, at: performance.now() });
        render();
    }

    step('sending');
    const timer = setInterval(render, 100);
    return {
        step,
        finish() {
            clearInterval(timer);
            bubble.remove();
            updateChatControls();
            return (performance.now() - started) / 1000;
        },
    };
}

// The server's answer: server-sent events, a "progress" event per step and then
// the "result". A refusal before the question starts (e.g. a 400) is plain JSON.
async function readQueryResponse(response, onStep) {
    if (!(response.headers.get('Content-Type') || '').includes('text/event-stream')) {
        return response.json();
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    for (;;) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        // Events end with a blank line
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const name = (block.match(/^event: (.*)$/m) || [])[1];
            const data = (block.match(/^data: (.*)$/m) || [])[1];
            if (!data) continue;
            if (name === 'progress') onStep(JSON.parse(data).stage);
            else if (name === 'result') result = JSON.parse(data);
        }
        if (done) break;
    }
    if (!result) throw new Error('The answer was cut off.');
    return result;
}

// "Answered in 2.8 s", or for a repeated question "⚡ Answered in 0.2 s …"
function answerTimingHtml(seconds, fromCache) {
    const time = `${seconds.toFixed(1)} s`;
    return fromCache
        ? `<div class="result-timing">⚡ Answered in ${time}: this question was asked before, so the AI step was skipped</div>`
        : `<div class="result-timing">Answered in ${time}</div>`;
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
    parent_incident: 'Parent Incident',
    problem: 'Problem Record',
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
    // A ticket number gets a star next to it
    return `<td${cls}>${escapeHtml(text)}${starFor(raw)}</td>`;
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
            return `<tr><th>${escapeHtml(columnLabel(c))}</th><td${cls}>${escapeHtml(text)}${starFor(rows[0][c])}</td></tr>`;
        }).join('');
        return `<div class="table-wrap"><table class="result-table detail"><tbody>${body}</tbody></table></div>`;
    }

    // Everything else: a normal table with a header row. A row with a ticket number
    // opens, on click, into that ticket's full record and related tickets.
    const head = columns.map(c => {
        const cls = c.endsWith('.count') ? ' class="num"' : '';
        return `<th${cls}>${escapeHtml(columnLabel(c))}</th>`;
    }).join('');
    const numberColumn = columns.find(c => c.endsWith('.number'));
    const body = rows.map(r => {
        const number = numberColumn && STARRABLE.test(String(r[numberColumn])) ? String(r[numberColumn]) : null;
        if (!number) return `<tr>${columns.map(c => cellHtml(c, r[c], true)).join('')}</tr>`;
        const cells = columns.map(c => c === numberColumn
            ? `<td class="ticket-cell"><span class="expand-caret" aria-hidden="true">▸</span>${escapeHtml(number)}${starButtonHtml(number)}</td>`
            : cellHtml(c, r[c], true)).join('');
        return `<tr class="expandable" data-expand="${escapeHtml(number)}" tabindex="0" aria-expanded="false"` +
            ` title="Click to see ${escapeHtml(number)}'s full record and related tickets">${cells}</tr>`;
    }).join('');
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

// Downloads whose bar is gone (chat cleared, a newer search) are dropped
function forgetRemovedExports() {
    for (const id of exportPayloads.keys()) {
        if (!document.getElementById(id)) exportPayloads.delete(id);
    }
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

function downloadBarHtml(exportId, label = 'Download as') {
    const options = EXPORT_OPTIONS.map(([group, items]) =>
        `<optgroup label="${escapeHtml(group)}">` +
        items.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('') +
        `</optgroup>`
    ).join('');
    return `<div class="download-bar" id="${exportId}">` +
        `<label for="${exportId}-format">${escapeHtml(label)}</label>` +
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
            // The browser's time zone: the file's "Generated" time and date use it
            body: JSON.stringify({ ...payload, format, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
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
    updateChatControls();
    return uniqueId;
}

// =====================================================================
// STARRED TICKETS: kept with each person's account on the server, so they
// follow them to any computer. Any ticket number shown anywhere (search
// results, the assistant's tables, a dashboard record) can be starred.
// =====================================================================

const STARRABLE = /^(INC|CHG|RITM|SCTASK)\d{7}$/;
const starredTickets = new Map(); // number -> when it was starred, newest first
let starsLoading = null;

// Fetches this person's stars (again); everything already on screen is repainted
function loadStars() {
    if (!sessionTokenValue) return Promise.resolve();
    if (!starsLoading) {
        const token = sessionTokenValue;
        starsLoading = (async () => {
            try {
                const response = await fetch(`${API_BASE}/api/stars`, { headers: authHeaders() });
                if (handleUnauthorized(response)) return;
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
                if (token !== sessionTokenValue) return; // signed out meanwhile
                starredTickets.clear();
                for (const s of data.stars) starredTickets.set(s.number, s.starredAt);
                refreshStarButtons();
            } catch (err) {
                console.error('Could not load starred tickets:', err);
            } finally {
                starsLoading = null;
            }
        })();
    }
    return starsLoading;
}

function starFace(on, labelled) {
    return (on ? '★' : '☆') + (labelled ? (on ? ' Starred' : ' Star') : '');
}

function starButtonHtml(number, labelled = false) {
    const on = starredTickets.has(number);
    const label = `${on ? 'Unstar' : 'Star'} ${number}`;
    return `<button type="button" class="star-btn${labelled ? ' labelled' : ''}${on ? ' on' : ''}" data-star="${escapeHtml(number)}"` +
        ` aria-pressed="${on}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${starFace(on, labelled)}</button>`;
}

// A star after a value, if the value is a ticket number
function starFor(raw) {
    const value = String(raw ?? '');
    return STARRABLE.test(value) ? starButtonHtml(value) : '';
}

function paintStar(button) {
    const number = button.dataset.star;
    const on = starredTickets.has(number);
    const label = `${on ? 'Unstar' : 'Star'} ${number}`;
    button.textContent = starFace(on, button.classList.contains('labelled'));
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
    button.title = label;
    button.setAttribute('aria-label', label);
}

function refreshStarButtons() {
    document.querySelectorAll('.star-btn[data-star]').forEach(paintStar);
    document.querySelectorAll('.star-many').forEach(paintStarMany);
    document.getElementById('star-count').textContent = starredTickets.size.toLocaleString();
}

// ---------------------------------------------------------------------
// "Star all": every ticket in a list, or all of one type in it
// ---------------------------------------------------------------------

const KIND_NOUNS = { INC: ['incident', 'incidents'], CHG: ['change', 'changes'], RITM: ['request', 'requests'], SCTASK: ['catalog task', 'catalog tasks'] };
const kindOf = number => (number.match(/^[A-Z]+/) || [''])[0];

// The bar: "★ Star all 30 tickets", then one button per type when the list mixes
// types. Nothing for fewer than two tickets (each row has its own star).
function starAllHtml(numbers) {
    const list = [...new Set(numbers)].filter(n => STARRABLE.test(n));
    if (list.length < 2) return '';
    const byKind = new Map();
    for (const n of list) {
        if (!byKind.has(kindOf(n))) byKind.set(kindOf(n), []);
        byKind.get(kindOf(n)).push(n);
    }
    const buttons = [starManyButtonHtml(list, byKind.size === 1 ? kindOf(list[0]) : '')];
    if (byKind.size > 1) for (const [kind, nums] of byKind) buttons.push(starManyButtonHtml(nums, kind));
    return `<div class="star-all-bar">${buttons.join('')}</div>`;
}

// "28 changes", "1 incident", "30 tickets"
function starManyWhat(numbers, kind) {
    const nouns = KIND_NOUNS[kind] || ['ticket', 'tickets'];
    return `${numbers.length.toLocaleString()} ${nouns[numbers.length === 1 ? 0 : 1]}`;
}

// "★ Star all 28 changes", or once they all are, "✓ 28 changes starred"
function starManyState(numbers, kind) {
    const what = starManyWhat(numbers, kind);
    const done = numbers.every(n => starredTickets.has(n));
    return { done, text: done ? `✓ ${what} starred` : (numbers.length === 1 ? `★ Star ${what}` : `★ Star all ${what}`) };
}

// The numbers are ticket numbers (checked by starAllHtml), so they need no escaping
function starManyButtonHtml(numbers, kind) {
    const s = starManyState(numbers, kind);
    return `<button type="button" class="star-many" data-star-many="${numbers.join(',')}" data-kind="${kind}"${s.done ? ' disabled' : ''}>${escapeHtml(s.text)}</button>`;
}

function paintStarMany(button) {
    const s = starManyState(button.dataset.starMany.split(','), button.dataset.kind);
    button.textContent = s.text;
    button.disabled = s.done;
}

// Stars them in one request; the screen changes at once, and back if the server says no
async function starMany(numbers, what) {
    const toAdd = numbers.filter(n => STARRABLE.test(n) && !starredTickets.has(n));
    if (!toAdd.length) return;
    const now = new Date().toISOString();
    for (const n of toAdd) starredTickets.set(n, now);
    refreshStarButtons();
    try {
        const response = await fetch(`${API_BASE}/api/stars`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ numbers: toAdd }),
        });
        if (handleUnauthorized(response)) return;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        const starred = new Set(data.starred);
        const leftOut = toAdd.filter(n => !starred.has(n));
        for (const n of leftOut) starredTickets.delete(n);
        refreshStarButtons();
        showToast(leftOut.length
            ? `★ Starred ${(toAdd.length - leftOut.length).toLocaleString()}; ${leftOut.length.toLocaleString()} more would pass the limit of 2,000 starred tickets. Unstar some first.`
            : `★ Starred ${what}`);
    } catch (err) {
        for (const n of toAdd) starredTickets.delete(n);
        refreshStarButtons();
        showToast(`❌ ${err.message}`);
    }
}

// The tickets an AI answer is about: its ticket-number column, not related
// numbers in other columns (e.g. a task's parent request)
function answerTicketNumbers(data) {
    const sections = data.sections && data.sections.length ? data.sections : [{ rows: data.results || [] }];
    const numbers = [];
    for (const s of sections) {
        for (const row of s.rows) {
            for (const [member, value] of Object.entries(row)) {
                if (member.endsWith('.number') && STARRABLE.test(String(value))) numbers.push(String(value));
            }
        }
    }
    return numbers;
}

// Changes on screen at once, and back again if the server says no
async function setStarred(number, on) {
    if (!STARRABLE.test(number) || starredTickets.has(number) === on) return true;
    const before = starredTickets.get(number);
    if (on) starredTickets.set(number, new Date().toISOString());
    else starredTickets.delete(number);
    refreshStarButtons();
    try {
        const response = await fetch(`${API_BASE}/api/stars/${encodeURIComponent(number)}`, {
            method: on ? 'PUT' : 'DELETE',
            headers: authHeaders(),
        });
        if (handleUnauthorized(response)) return false;
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `The server answered ${response.status}.`);
        }
        return true;
    } catch (err) {
        if (on) starredTickets.delete(number);
        else starredTickets.set(number, before);
        refreshStarButtons();
        showToast(`❌ ${err.message}`);
        return false;
    }
}

// A short message at the bottom of the screen
let toastTimer = null;
function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

// =====================================================================
// HOME PAGE: the latest ticket search from the search bar, and your
// starred tickets
// =====================================================================

const HOME_MODES = ['results', 'starred'];
let homeMode = 'results';
// Each search bumps its counter, so an older, slower answer can't replace a newer one
const homeRuns = { results: 0, starred: 0 };

// The list each person had open last, remembered in this browser
function homeModeKey() {
    return `onetouch-home-mode:${currentUsername}`;
}
function rememberedHomeMode() {
    try { return localStorage.getItem(homeModeKey()) || 'results'; } catch { return 'results'; }
}

// Shows one of Home's lists and loads it (quiet: refresh it without a "Loading…")
function setHomeMode(mode, quiet = false) {
    if (!HOME_MODES.includes(mode)) mode = 'results';
    homeMode = mode;
    document.querySelectorAll('.home-mode').forEach(b => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    for (const m of HOME_MODES) document.getElementById(`home-${m}`).hidden = m !== mode;
    if (currentUsername) {
        try { localStorage.setItem(homeModeKey(), mode); } catch { /* not remembered; that's fine */ }
    }
    if (mode === 'starred') showStarred();
    else showTicketResults(quiet);
}

// Signing out leaves nothing of this person's on the page
function resetHome() {
    for (const m of HOME_MODES) homeRuns[m] += 1;
    latestShown = new Set();
    openedRecord = null;
    document.getElementById('ticket-results').innerHTML = NO_TICKET_RESULTS_HTML;
    document.getElementById('starred-result').innerHTML = '';
    starredTickets.clear();
    refreshStarButtons();
    setHomeMode('results');
    forgetRemovedExports();
}

// -> { found, notFound, ignored, tooMany, record? }, or null if the session ended
async function searchTickets(text, record = false) {
    const response = await fetch(`${API_BASE}/api/tickets/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text, record }),
    });
    if (handleUnauthorized(response)) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
    return data;
}

// The columns of every ticket list; the getters give the text people read
const TICKET_COLUMNS = [
    ['Ticket', t => t.number],
    ['Type', t => t.type],
    ['Summary', t => t.summary],
    ['State', t => t.state],
    ['Priority / Risk', t => t.level],
    ['Team', t => t.team],
    ['Assigned To / Requested For', t => t.person],
    ['Opened', t => t.opened ? formatValue('ticket.opened', t.opened) : ''],
];
const STARRED_COLUMN = ['Starred', t => formatStarredAt(starredTickets.get(t.number))];

function formatStarredAt(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime())
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// Ticket numbers open the ticket; every row has a star. Rows whose number is
// in `highlight` (e.g. the latest answer's tickets) get `highlightClass`.
function ticketTableHtml(tickets, columns = TICKET_COLUMNS, highlight = new Set(), highlightClass = 'fresh') {
    const head = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('');
    const body = tickets.map(t => (highlight.has(t.number) ? `<tr class="${highlightClass}">` : '<tr>') + columns.map(([label, get], i) => {
        if (i === 0) {
            return `<td class="ticket-cell"><button type="button" class="ticket-link" data-ticket="${escapeHtml(t.number)}"` +
                ` title="Open ${escapeHtml(t.number)}">${escapeHtml(t.number)}</button>${starButtonHtml(t.number)}</td>`;
        }
        const text = String(get(t) || '');
        if (label === 'Summary' && text.length > 120) {
            return `<td title="${escapeHtml(text)}">${escapeHtml(text.slice(0, 117))}…</td>`;
        }
        return `<td>${escapeHtml(text || '—')}</td>`;
    }).join('') + '</tr>').join('');
    return `<div class="table-wrap"><table class="result-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function ticketDownloadHtml(tickets, title, columns = TICKET_COLUMNS) {
    return downloadBarHtml(registerExport({
        title,
        tables: [{
            title: null,
            columns: columns.map(([label]) => ({ label })),
            rows: tickets.map(t => columns.map(([, get]) => String(get(t) || ''))),
            footer: null,
        }],
    }));
}

// One ticket: its heading, a star, a link to its dashboard record, and every field it has
function ticketCardHtml(t, record) {
    const dashboardButton = RECORD_PAGES[t.kind]
        ? `<button type="button" class="home-action" data-open-dashboard="${escapeHtml(t.number)}">Open in Dashboards ↗</button>` : '';
    let html = `<div class="ticket-head">` +
        `<span class="ticket-type">${escapeHtml(t.type)}</span>` +
        `<span class="ticket-number">${escapeHtml(t.number)}</span>` +
        starButtonHtml(t.number, true) + dashboardButton +
        `</div>` +
        (t.summary ? `<div class="ticket-summary">${escapeHtml(t.summary)}</div>` : '');

    if (!record) return html + ticketTableHtml([t]) + ticketDownloadHtml([t], t.number);

    const fields = Object.entries(record.fields);
    const body = fields.map(([member, value]) => {
        const cls = LONG_TEXT.has(splitMember(member).column) ? ' class="long"' : '';
        return `<tr><th>${escapeHtml(columnLabel(member))}</th><td${cls}>${escapeHtml(formatValue(member, value))}${starFor(value)}</td></tr>`;
    }).join('');
    html += `<div class="table-wrap tall"><table class="result-table detail"><tbody>${body}</tbody></table></div>`;
    html += downloadBarHtml(registerExport({
        title: `${t.type} ${t.number}`,
        tables: [{
            title: null,
            columns: [{ label: 'Field' }, { label: 'Value' }],
            rows: fields.map(([member, value]) => [columnLabel(member), String(exportValue(member, value))]),
            footer: null,
        }],
    }));
    return html;
}


// Runs one search into one result box, showing progress and errors there.
// quiet: keep what's showing until the new content is ready (background refresh).
async function runHomeSearch(mode, outId, work, quiet = false) {
    const run = ++homeRuns[mode];
    const out = document.getElementById(outId);
    if (!quiet) out.innerHTML = '<p class="home-status">Loading…</p>';
    try {
        const html = await work();
        if (run !== homeRuns[mode] || html === null) return;
        out.innerHTML = html;
    } catch (err) {
        if (run !== homeRuns[mode]) return;
        out.innerHTML = `<p class="home-status error">❌ ${escapeHtml(err.message)}</p>`;
        console.error(err);
    }
    forgetRemovedExports();
}

// =====================================================================
// TICKET RESULTS: every ticket the person has been shown, newest first: the
// tickets in the AI assistant's answers (the server records them as it
// answers) and records they opened. Kept with their account, so the list is
// there after a refresh, signing out, or on another computer.
// =====================================================================

const NO_TICKET_RESULTS_HTML = '<p class="home-status">Tickets in the AI assistant\'s answers show up here automatically, ' +
    'and stay here after you refresh or sign out. Click a ticket number to see its full record.</p>';

let latestShown = new Set(); // the latest answer's tickets, highlighted in the list
let openedRecord = null;     // a ticket whose full record is showing instead of the list

const SHOWN_COLUMNS = [
    ['Shown', t => formatShownAt(t.shownAt)],
    ['From', t => t.question || 'Opened from a ticket number'],
];

// "Oct 22, 1:05 PM"
function formatShownAt(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime())
        ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}

// The list (or the record someone opened). quiet: refresh without a "Loading…".
function showTicketResults(quiet = false) {
    const out = document.getElementById('ticket-results');
    if (!sessionTokenValue) { out.innerHTML = NO_TICKET_RESULTS_HTML; return; }
    if (openedRecord) return showOpenedRecord(openedRecord);
    return runHomeSearch('results', 'ticket-results', async () => {
        const response = await fetch(`${API_BASE}/api/seen-tickets`, { headers: authHeaders() });
        if (handleUnauthorized(response)) return null;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        const tickets = data.tickets || [];
        if (!tickets.length) return NO_TICKET_RESULTS_HTML;
        const columns = [...TICKET_COLUMNS, ...SHOWN_COLUMNS];
        const fresh = tickets.filter(t => latestShown.has(t.number)).length;
        return '<div class="results-head">' +
            `<p class="home-status">${tickets.length.toLocaleString()} ${tickets.length === 1 ? 'ticket' : 'tickets'} shown to you, newest first. ` +
            (fresh ? `<span class="fresh-key">Highlighted: the ${fresh.toLocaleString()} from your latest question.</span> ` : '') +
            'Click a ticket number to see its full record.</p>' +
            `<button type="button" class="home-action danger" onclick="deleteTicketResults(${tickets.length})">🗑 Delete ticket results</button></div>` +
            starAllHtml(tickets.map(t => t.number)) +
            ticketTableHtml(tickets, columns, latestShown) + ticketDownloadHtml(tickets, 'Ticket results', columns);
    }, quiet);
}

// A ticket number someone clicked: its full record, with the way back to the list.
// Opening it counts as being shown, so it joins the list.
function openTicketRecord(number) {
    openedRecord = number;
    toggleAssistant(false); // clicked inside the chat (e.g. in a related family): show Home
    switchTab('home');
    setHomeMode('results');
    if (STARRABLE.test(number)) {
        fetch(`${API_BASE}/api/seen-tickets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ numbers: [number] }),
        }).catch(err => console.error('Could not add the ticket to Ticket results:', err));
    }
    document.getElementById('home-view').scrollTop = 0;
}

async function showOpenedRecord(number) {
    await runHomeSearch('results', 'ticket-results', async () => {
        const data = await searchTickets(number, true);
        if (!data) return null;
        const back = '<div class="home-actions"><button type="button" class="home-action" onclick="closeTicketRecord()">← All ticket results</button></div>';
        if (!data.found.length) return back + `<p class="home-status">${escapeHtml(number)} is not in the data.</p>`;
        if (data.found.length === 1) return back + ticketCardHtml(data.found[0], data.record);
        return back + ticketTableHtml(data.found);
    });
    // Its parent / child tickets and other linked ones, under the record
    const out = document.getElementById('ticket-results');
    if (openedRecord === number && out.querySelector('.ticket-head')) showRelated(out, [number], false);
}

// =====================================================================
// RELATED TICKETS: the families the server finds from the links in the data
// (parent / child incidents, bundle and child requests, an order's requests,
// a request's tasks, a change and its incidents, a problem record), with what
// the members share and where they differ
// =====================================================================

const FAMILY_COLUMNS = [
    ['Ticket', t => t.number],
    ['Role', t => t.role],
    ['Summary', t => t.summary],
    ['State', t => t.state],
    ['Priority / Risk', t => t.level],
    ['Team', t => t.team],
    ['Opened', t => t.opened ? formatValue('ticket.opened', t.opened) : ''],
];

// "Team ACN-INFRA-CLOUD-LINUX (3), ACN-SAP-BASIS (3)", "Opened Sep 1, 1:07 AM to 1:18 AM"
function familyFact(fact) {
    if (fact.range) return `${formatValue('ticket.opened', fact.range[0])} to ${formatValue('ticket.opened', fact.range[1])}`;
    if (fact.note) return fact.note;
    if (fact.values) {
        return fact.values.map(v => `${v.value} (${v.count.toLocaleString()})`).join(', ') + (fact.others ? `, and ${fact.others.toLocaleString()} more` : '');
    }
    const value = fact.field === 'Opened' ? formatValue('ticket.opened', fact.value) : String(fact.value);
    return value.length > 100 ? `${value.slice(0, 97)}…` : value;
}

const FAMILY_MEMBERS_SHOWN = 25; // listed on screen; downloads hold every member
const FAMILY_EXPORT_COLUMNS = [...FAMILY_COLUMNS.slice(0, 2), ['Type', t => t.type], ...FAMILY_COLUMNS.slice(2)];

// A family as download tables: every member, then what they share and where they differ.
// Titles start with what the table is and the family's anchor number, because
// Excel cuts worksheet names at 31 characters ("Members of PRB0051839 (96 tick…").
function familyExportTables(f) {
    return [
        {
            title: `Members of ${f.anchor} (${f.title})`,
            columns: FAMILY_EXPORT_COLUMNS.map(([label]) => ({ label })),
            rows: f.members.map(t => FAMILY_EXPORT_COLUMNS.map(([, get]) => String(get(t) || ''))),
            footer: null,
        },
        {
            title: `Same or different in ${f.anchor} (${f.title})`,
            columns: [{ label: 'Field' }, { label: 'Same or different' }, { label: 'Value' }],
            rows: [
                ...f.same.map(fact => [fact.field, `Same in all ${f.total.toLocaleString()}`, familyFact(fact)]),
                ...f.differ.map(fact => [fact.field, 'Different', familyFact(fact)]),
            ],
            footer: null,
        },
    ].filter(table => table.rows.length);
}

// "Related to INC1813970", or "Related to INC1, INC2, INC3 and 4 more"
function relatedToLabel(focus) {
    const list = [...focus];
    return `Related to ${list.slice(0, 3).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`;
}

// `focus`: the tickets the question or record was about, marked in each family
function relatedHtml(families, focus) {
    const about = relatedToLabel(focus);
    // Several families: one file with all of them, besides each family's own
    const all = families.length > 1
        ? downloadBarHtml(registerExport({ title: `Related tickets: ${families.length} families`, question: about, tables: families.flatMap(familyExportTables) }),
            `Download all ${families.length} families as`)
        : '';
    return '<div class="related"><div class="related-title">🔗 Related tickets</div>' + all + families.map(f => {
        const facts = list => list.map(fact => `<span class="fact"><b>${escapeHtml(fact.field)}:</b> ${escapeHtml(familyFact(fact))}</span>`).join('');
        const same = f.same.length
            ? `<div class="family-line"><span class="same-label">Same in all ${f.total.toLocaleString()}</span>${facts(f.same)}</div>` : '';
        const differ = f.differ.length
            ? `<div class="family-line"><span class="differ-label">Different</span>${facts(f.differ)}</div>` : '';
        const shown = f.members.slice(0, FAMILY_MEMBERS_SHOWN);
        const more = f.members.length > shown.length
            ? `<p class="family-more">Showing ${shown.length.toLocaleString()} of ${f.members.length.toLocaleString()}; the comparison above and the download cover all of them.</p>` : '';
        const download = downloadBarHtml(registerExport({ title: f.title, question: about, tables: familyExportTables(f) }), 'Download this family as');
        return `<section class="family"><div class="family-title">${escapeHtml(f.title)}</div>` +
            `<p class="family-why">${escapeHtml(f.why)}</p>${same}${differ}` +
            ticketTableHtml(shown, FAMILY_COLUMNS, focus, 'focus') + more + download + '</section>';
    }).join('') + '</div>';
}

// Adds "Related tickets" to the end of `container` (an AI answer, or a record on
// Home) once the server has looked; nothing at all if there are none.
// conversation: true also tells the AI about them with the next question.
async function showRelated(container, numbers, conversation) {
    const slot = document.createElement('div');
    slot.className = 'related-slot';
    slot.innerHTML = '<p class="related-loading">🔗 Looking for related tickets…</p>';
    container.appendChild(slot);
    try {
        const response = await fetch(`${API_BASE}/api/tickets/related`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ numbers, conversation }),
        });
        if (handleUnauthorized(response)) return;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        if (!slot.isConnected) return; // the chat was cleared, or another record opened
        if (!data.families.length) { slot.remove(); return; }
        slot.innerHTML = relatedHtml(data.families, new Set(numbers));
        // Keep the newest answer in view, as the chat does for new messages
        const chatLog = document.getElementById('chat-log');
        if (chatLog.contains(slot) && chatLog.lastElementChild === container) chatLog.scrollTop = chatLog.scrollHeight;
    } catch (err) {
        slot.remove();
        console.error('Could not look for related tickets:', err);
    }
}

function closeTicketRecord() {
    openedRecord = null;
    showTicketResults();
}

// "Delete ticket results": after a confirmation, the whole list goes, on every
// computer. Stars are separate and stay; new answers fill the list again.
async function deleteTicketResults(count) {
    const what = `${count.toLocaleString()} ${count === 1 ? 'ticket' : 'tickets'}`;
    if (!confirm(`Delete your ticket results? The list of ${what} is cleared on every computer you use. Your starred tickets stay starred.`)) return;
    try {
        const response = await fetch(`${API_BASE}/api/seen-tickets`, { method: 'DELETE', headers: authHeaders() });
        if (handleUnauthorized(response)) return;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `The server answered ${response.status}.`);
        latestShown = new Set();
        openedRecord = null;
        await showTicketResults();
        showToast('Ticket results deleted');
    } catch (err) {
        showToast(`❌ ${err.message}`);
    }
}

// An AI answer showed these tickets (the server has already saved them): they
// go to the top of Ticket results, highlighted, and Home shows that list
function ticketsShown(numbers) {
    latestShown = new Set(numbers);
    openedRecord = null;
    setHomeMode('results', true);
    showToast(`🎫 ${numbers.length.toLocaleString()} ${numbers.length === 1 ? 'ticket' : 'tickets'} from this answer ${numbers.length === 1 ? 'is' : 'are'} now in Ticket results on Home`);
}

// Newest star first. Unstarring here leaves the row (with an empty star) until
// the list is opened again, so a slip of the mouse is easy to undo.
function showStarred() {
    return runHomeSearch('starred', 'starred-result', async () => {
        await loadStars();
        const numbers = [...starredTickets.keys()];
        if (!numbers.length) {
            return '<p class="home-status">No starred tickets yet. Click ☆ next to any ticket number: in your ticket results, ' +
                'in the AI assistant\'s answers, or on an incident, change or request record in Dashboards. ' +
                'Your stars are saved to your account, so they are here on any computer you sign in from.</p>';
        }
        const data = await searchTickets(numbers.join(' '));
        if (!data) return null;
        const columns = [...TICKET_COLUMNS, STARRED_COLUMN];
        const missing = data.notFound.length
            ? `<p class="home-status">Not in the data any more: ${escapeHtml(data.notFound.join(', '))}</p>` : '';
        return `<p class="home-status">${numbers.length.toLocaleString()} starred ${numbers.length === 1 ? 'ticket' : 'tickets'}, newest first.</p>` +
            ticketTableHtml(data.found, columns) + missing + ticketDownloadHtml(data.found, 'Starred tickets', columns);
    });
}

// One listener for every star, ticket link and record button, wherever it was drawn
document.addEventListener('click', e => {
    const star = e.target.closest('.star-btn[data-star]');
    if (star) { setStarred(star.dataset.star, !starredTickets.has(star.dataset.star)); return; }

    const many = e.target.closest('.star-many');
    if (many) {
        const numbers = many.dataset.starMany.split(',');
        starMany(numbers, starManyWhat(numbers, many.dataset.kind));
        return;
    }

    const ticket = e.target.closest('[data-ticket]');
    if (ticket) { openTicketRecord(ticket.dataset.ticket); return; }

    // Home's example question is asked in the chat
    const example = e.target.closest('[data-example]');
    if (example) { askAssistant(example.dataset.example); return; }

    const record = e.target.closest('[data-open-dashboard]');
    if (record) { openInDashboards(record.dataset.openDashboard); return; }

    const close = e.target.closest('.row-detail-close');
    if (close) { toggleTicketRow(close.closest('tr.row-detail').previousElementSibling); return; }

    // A ticket's row in an AI answer: open (or fold away) its full record and
    // related tickets. Buttons and menus inside the row keep their own jobs.
    const row = e.target.closest('tr.expandable');
    if (row && !e.target.closest('button, a, select, input, label')) toggleTicketRow(row);
});

// The same from the keyboard: Enter or Space on a focused ticket row
document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr.expandable')) {
        e.preventDefault();
        toggleTicketRow(e.target);
    }
});

// =====================================================================
// TICKET ROWS IN AI ANSWERS: a click opens a detailed view under the row:
// the ticket's full record, then its related tickets (families)
// =====================================================================

function toggleTicketRow(row) {
    const open = row.nextElementSibling;
    if (open && open.classList.contains('row-detail')) {
        open.remove();
        row.classList.remove('expanded');
        row.setAttribute('aria-expanded', 'false');
        return;
    }
    const number = row.dataset.expand;
    const detail = document.createElement('tr');
    detail.className = 'row-detail';
    const cell = document.createElement('td');
    cell.colSpan = row.cells.length;
    cell.innerHTML = `<div class="row-detail-body"><button type="button" class="row-detail-close">▴ Close</button>` +
        `<div class="row-detail-content"><p class="home-status">Loading ${escapeHtml(number)}…</p></div></div>`;
    detail.appendChild(cell);
    row.after(detail);
    row.classList.add('expanded');
    row.setAttribute('aria-expanded', 'true');
    loadTicketDetail(cell.querySelector('.row-detail-content'), number);
}

async function loadTicketDetail(box, number) {
    try {
        const data = await searchTickets(number, true);
        if (!data || !box.isConnected) return;
        if (!data.found.length) {
            box.innerHTML = `<p class="home-status">${escapeHtml(number)} is not in the data.</p>`;
            return;
        }
        box.innerHTML = ticketCardHtml(data.found[0], data.record);
        showRelated(box, [number], false);
    } catch (err) {
        if (box.isConnected) box.innerHTML = `<p class="home-status error">❌ ${escapeHtml(err.message)}</p>`;
        console.error(err);
    }
}

// =====================================================================
// START: a token from earlier in this tab skips the sign-in page; if it
// has expired, the first API call returns 401 and brings the page back
// =====================================================================

document.getElementById('ticket-results').innerHTML = NO_TICKET_RESULTS_HTML;
showApp(Boolean(sessionTokenValue));
loadCurrentUser();

// A reload empties the chat on screen, so Claude forgets it too
resetConversation();
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

// Filter suggestions: as people type in a filter box, Metabase offers the
// values that exist (team names, ticket numbers, ...), so they can switch to
// another team or ticket from the box itself. A filter's `values` say where
// they come from: distinct([expression, view, condition?], ...) reads them
// from the reporting views (one or several, merged); fixed(...) lists them.
const distinct = (...sources) => ({
  sql: sources.map(([expr, view, where]) =>
    `SELECT DISTINCT ${expr} AS "Value" FROM reporting.${view} WHERE ${expr} IS NOT NULL${where ? ` AND ${where}` : ''}`,
  ).join('\nUNION\n') + '\nORDER BY 1',
});
const fixed = (...values) => ({ list: values });
const YES_NO = fixed('Yes', 'No');
const OPEN_CLOSED = fixed('Open', 'Closed');

// Expressions a filter matches on, shared by its condition and its suggestions
const OPEN_OR_CLOSED_EXPR = "CASE WHEN is_open THEN 'Open' ELSE 'Closed' END";
const AGE = 'substr(age_bucket, 4)';
const HOUR = "to_char(created_at, 'HH24')";
const WEEKDAY = "to_char(created_at, 'Dy')";
const WAITING = "(CASE WHEN state = 'On Hold' THEN 'On hold: ' || coalesce(on_hold_reason, 'no reason given') ELSE state END)";
const OPENED_BY = "coalesce(opened_by_group, 'Not recorded')";
const RISK = "coalesce(nullif(risk, ''), 'Not set')";
const ENVIRONMENT = "coalesce(environment, 'Not set')";
const GUIDE = "coalesce(order_guide, 'Ordered directly (no guide)')";

// Lists: every filter is optional; Metabase leaves out a [[...]] part when
// its filter is empty. Each entry: [slug, label, SQL condition, suggestions].
const listParams = filters => filters.map(([slug, name, , values]) => ({ slug, name, values }));
const listWhere = filters => `WHERE true\n${filters.map(([, , cond]) => `  [[AND ${cond}]]`).join('\n')}`;
const OPEN_OR_CLOSED = slug => `${OPEN_OR_CLOSED_EXPR} = {{${slug}}}`;

const INCIDENT_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status'), OPEN_CLOSED],
  ['priority', 'Priority', 'priority = {{priority}}', distinct(['priority', 'incidents'])],
  ['subcategory', 'Subcategory', 'subcategory = {{subcategory}}', distinct(['subcategory', 'incidents'])],
  ['channel', 'Reported via', 'contact_type = {{channel}}', distinct(['contact_type', 'incidents'])],
  ['source', 'Source', 'source = {{source}}', distinct(['source', 'incidents'])],
  ['age', 'Open for', `is_open AND ${AGE} = {{age}}`, distinct([AGE, 'incidents', 'is_open'])],
  ['older_than', 'Open at least (days)', 'age_days >= CAST({{older_than}} AS numeric)', fixed('1', '3', '7', '14', '30', '60', '90')],
  ['hour', 'Hour of day', `${HOUR} = {{hour}}`, distinct([HOUR, 'incidents'])],
  ['weekday', 'Day of week', `${WEEKDAY} = {{weekday}}`, fixed('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')],
  // Chart clicks send dates as 2026-08-17T00:00:00Z
  ['date', 'Date', 'created_at::date = CAST(left({{date}}, 10) AS date)', distinct(["to_char(created_at, 'YYYY-MM-DD')", 'incidents'])],
  ['team', 'Team', 'assignment_group = {{team}}', distinct(['assignment_group', 'incidents'])],
  ['system', 'Server / system', 'configuration_item = {{system}}', distinct(['configuration_item', 'incidents'])],
  ['site', 'Site', 'location = {{site}}', distinct(['location', 'incidents'])],
  ['kb', 'Knowledge article', 'kb_article = {{kb}}', distinct(['kb_article', 'incidents'])],
  ['workaround', 'Closed with a workaround', "closed_with_workaround = ({{workaround}} = 'Yes')", YES_NO],
  ['reopened', 'Reopened', "(reopen_count > 0) = ({{reopened}} = 'Yes')", YES_NO],
  ['reassigned', 'Reassigned', "was_reassigned = ({{reassigned}} = 'Yes')", YES_NO],
  ['waiting', 'Status detail', `is_open AND ${WAITING} = {{waiting}}`, distinct([WAITING, 'incidents', 'is_open'])],
  ['assignee', 'Assigned to', 'assigned_to = {{assignee}}', distinct(['assigned_to', 'incidents'])],
  ['opened_by', 'Raised by', `${OPENED_BY} = {{opened_by}}`, distinct([OPENED_BY, 'incidents'])],
];

const CHANGE_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status'), OPEN_CLOSED],
  ['type', 'Type', 'type = {{type}}', distinct(['type', 'changes'])],
  ['risk', 'Risk', `${RISK} = {{risk}}`, distinct([RISK, 'changes'])],
  ['category', 'Category', 'sub_type = {{category}}', distinct(['sub_type', 'changes'])],
  ['environment', 'Environment', `${ENVIRONMENT} = {{environment}}`, distinct([ENVIRONMENT, 'changes'])],
  ['outage', 'Outage', "has_outage = ({{outage}} = 'Yes')", YES_NO],
  ['approval', 'Approval', 'approval = {{approval}}', distinct(['approval', 'changes'])],
  ['sap', 'Affects SAP', "affects_sap = ({{sap}} = 'Yes')", YES_NO],
  ['transport', 'Needs SAP transport', "needs_sap_transport = ({{transport}} = 'Yes')", YES_NO],
  ['brewery', 'Affects breweries', "affects_brewery = ({{brewery}} = 'Yes')", YES_NO],
  ['process_failure', 'Process failure', "process_failure = ({{process_failure}} = 'Yes')", YES_NO],
  ['urgent', 'Emergency or expedited', "is_emergency_or_expedited = ({{urgent}} = 'Yes')", YES_NO],
  ['starts_within', 'Starts within (days)', "state <> 'Canceled' AND planned_start >= (SELECT as_of FROM reporting.data_as_of) AND planned_start < (SELECT as_of FROM reporting.data_as_of) + make_interval(days => CAST({{starts_within}} AS int))", fixed('1', '3', '7', '14', '30')],
];

const REQUEST_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status'), OPEN_CLOSED],
  ['item', 'Catalog item', 'item = {{item}}', distinct(['item', 'requests'])],
  ['site', 'Site', 'location = {{site}}', distinct(['location', 'requests'])],
  ['approval', 'Approval', 'approval = {{approval}}', distinct(['approval', 'requests'])],
  ['outcome', 'Outcome', "{{outcome}} = 'Rejected or cancelled' AND (approval = 'Rejected' OR state = 'Closed Cancelled')", fixed('Rejected or cancelled')],
  ['guide', 'Order guide', `${GUIDE} = {{guide}}`, distinct([GUIDE, 'requests'])],
];

const TASK_FILTERS = [
  ['status', 'Status', OPEN_OR_CLOSED('status'), OPEN_CLOSED],
  ['team', 'Team', 'assignment_group = {{team}}', distinct(['assignment_group', 'catalog_tasks'])],
  ['state', 'State', 'state = {{state}}', distinct(['state', 'catalog_tasks'])],
  ['sla', 'SLA', "CASE WHEN sla_breached THEN 'Breached' ELSE 'Met' END = {{sla}}", fixed('Breached', 'Met')],
  ['item', 'Catalog item', 'item = {{item}}', distinct(['item', 'catalog_tasks'])],
];

// Single-item pages: the suggestions cover everything the page itself matches on
const TEAM_VALUES = distinct(['assignment_group', 'incidents'], ['assignment_group', 'catalog_tasks'], ['owner_group', 'changes'], ['approver_group', 'approvals']);
const SYSTEM_VALUES = distinct(['configuration_item', 'incidents'], ['configuration_item', 'changes']);
const SITE_VALUES = distinct(['location', 'incidents'], ['location', 'requests'], ['brewery', 'change_breweries']);
const PROBLEM_VALUES = distinct(['problem', 'incidents'], ['linked_problem', 'changes']);
const ITEM_VALUES = distinct(['item', 'requests'], ['item', 'catalog_tasks']);

// Full-width record view, and the clickable "Go to" row under it
const RECORD = { display: 'object', w: 24, h: 12 };
const GO_TO = { display: 'table', w: 24, h: 3 };

const DETAILS = [
  {
    key: 'incident-detail',
    name: 'Incident',
    params: [{ slug: 'number', name: 'Incident', values: distinct(['number', 'incidents']) }],
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
    params: [{ slug: 'number', name: 'Change', values: distinct(['number', 'changes']) }],
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
    params: [{ slug: 'number', name: 'Request', values: distinct(['number', 'requests']) }],
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
    params: [{ slug: 'team', name: 'Team', values: TEAM_VALUES }],
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
    params: [{ slug: 'system', name: 'Server / system', values: SYSTEM_VALUES }],
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
    params: [{ slug: 'site', name: 'Site', values: SITE_VALUES }],
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
    params: [{ slug: 'problem', name: 'Problem', values: PROBLEM_VALUES }],
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
    params: [{ slug: 'item', name: 'Catalog item', values: ITEM_VALUES }],
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
    for (const p of def.params || []) {
      if (!p.values?.sql && !p.values?.list?.length) throw new Error(`"${def.name}": filter "${p.slug}" needs suggestions (distinct(...) or fixed(...)).`);
    }
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

// A filter, with its suggestions: values read from the data become a small
// query Metabase searches as people type; a fixed list is offered to pick from.
// One value at a time, because each filter fills a single {{variable}}.
async function filterParameter(p, def, databaseId, collectionId) {
  const parameter = { id: `p_${p.slug}`, name: p.name, slug: p.slug, type: 'string/=', sectionId: 'string', isMultiSelect: false };
  if (p.values.list) {
    return { ...parameter, values_source_type: 'static-list', values_source_config: { values: p.values.list }, values_query_type: 'list' };
  }
  const source = await api('POST', '/api/card', {
    name: `${def.name}: ${p.name} suggestions`,
    description: `The values the "${p.name}" filter on "${def.name}" suggests as people type.`,
    collection_id: collectionId,
    display: 'table',
    visualization_settings: {},
    dataset_query: { type: 'native', native: { query: p.values.sql, 'template-tags': {} }, database: databaseId },
  });
  return {
    ...parameter,
    values_source_type: 'card',
    values_source_config: { card_id: source.id, value_field: ['field', 'Value', { 'base-type': 'type/Text' }] },
    values_query_type: 'search',
  };
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
  const parameters = [];
  for (const p of def.params || []) parameters.push(await filterParameter(p, def, databaseId, collectionId));
  await api('PUT', `/api/dashboard/${shell.id}`, { parameters, dashcards });
  console.log(`Built "${def.name}"${def.params ? ' (detail page)' : ''}: ${def.cards.length} charts.`);
}

// Keep chart results instead of recalculating them for every viewer: the data
// never changes, and 30 people opening one dashboard at once otherwise means
// 30 copies of every query. The free edition only has the "adaptive" policy
// (results kept for multiplier × how long the query took), so the multiplier
// is huge: a 0.05 s chart stays about 14 hours, a 1 s chart about 11 days.
const CACHE_MULTIPLIER = 1_000_000;

async function enableCaching() {
  await api('PUT', '/api/setting/enable-query-caching', { value: true });
  await api('PUT', '/api/cache', { model: 'root', model_id: 0, strategy: { type: 'ttl', multiplier: CACHE_MULTIPLIER, min_duration_ms: 0 } });
  console.log('Chart results are cached (open each dashboard once to fill the cache; npm run warmup does all of them).');
}

// ---------------------------------------------------------------------

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !READER_PASSWORD) {
    throw new Error('Set METABASE_ADMIN_EMAIL, METABASE_ADMIN_PASSWORD and METABASE_DB_PASSWORD in .env, ' +
      'then run `docker compose up -d` so the app container sees them.');
  }
  // --cache-only: just switch result caching on, leaving the dashboards (and their links) as they are
  if (process.argv.includes('--cache-only')) {
    await waitForMetabase();
    await signIn();
    await enableCaching();
    return;
  }
  checkDefinitions();
  await waitForMetabase();
  await signIn();
  await api('PUT', '/api/setting/enable-public-sharing', { value: true });
  await enableCaching();
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
    // A question's progress steps (server-sent events) go on as they arrive,
    // so the chat shows them live; everything else is passed on whole
    if ((upstream.headers.get('content-type') || '').includes('text/event-stream')) {
      res.flushHeaders();
      for await (const chunk of upstream.body) res.write(chunk);
      return res.end();
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
| `server.mjs` | Express app (port 8000): sign-in routes, `/api/query` (one-shot translator with per-session conversation memory), `/api/export`, `/api/tickets/search` and `/api/stars` (home page), dashboards list, and a pass-through of Metabase public-dashboard pages |
| `tickets.mjs` | Home page ticket search: parses INC/CHG/RITM/SCTASK/REQ numbers and builds its own Cube queries from them (never from model output); full records use Cube's `/meta` column list |
| `relations.mjs` | Related tickets: from the link columns only (incident.parent_incident, sc_req_item.parent / request, sc_task.request_item, change_request.incident, incident.caused_by_change, *.problem), the families a ticket is in, with `same` / `differ` comparisons and every member (the page lists 25 but downloads all, via `familyExportTables` in app.js); one ticket gets all its families, a list only families 2+ of its tickets share. `POST /api/tickets/related` (conversation: true adds `describeFamilies` to Claude's pendingNote) |
| `stars.mjs` | Each person's starred tickets, in `onetouch_auth` (`starred_tickets`, created on start); `addStars` stars many at once ("Star all", `PUT /api/stars`) up to `MAX_STARS` |
| `seen.mjs` | Each person's "Ticket results": every ticket shown to them (`seen_tickets`, created on start). `/api/query` records the ticket numbers in each answer (`ticketNumbersIn`) before replying and returns them as `shownTickets`; `GET /api/seen-tickets` returns the list with summaries (`ticketSummaries`); `DELETE /api/seen-tickets` empties it ("Delete ticket results") |
| `business_logic.mjs` | Everything Claude knows about the data: `ENTITY_CATALOG`, `buildSystemPrompt()` (sections A-E), `OUTPUT_SCHEMA`, and `normalizeAndValidate()`, which every Claude-built query passes through before Cube |
| `empty_results.mjs` | When a query returns nothing: re-runs it minus one filter at a time, then Claude explains why |
| `export.mjs` | Tables -> pdf/docx/xlsx/csv/txt/rtf, and zip/7z bundles (7-Zip) |
| `auth.mjs` | Accounts and sessions in the `onetouch_auth` Postgres DB (its own role `onetouch_app`); scrypt hashes; `db/accounts.json` export/sync |
| `remote.mjs` | "Remote mode" for clones: serves `public/` on localhost and forwards `/api`, `/public`, `/app` to a OneTouch server |
| `public/` | The single-page UI (`index.html`, `app.js`, `style.css`); no build step. Home has the AI assistant's card (example question, Open chat, Delete chat; the chat opens as a panel over the page; ticket rows in its answers open in place into the record plus related tickets via `toggleTicketRow`), ticket results (a clicked ticket's record) and starred tickets; Dashboards is the other tab. Delete chat resets the server conversation and bumps `chatEpoch` so a late answer is dropped |
| `db/` | `init-auth.sh`, `init-reporting.sh`, `reporting-views.sql` (typed `reporting.*` views for Metabase), `accounts.json` |
| `scripts/users.mjs` | Account admin CLI (add, import CSV, export, sync, ...) |
| `scripts/warmup.mjs` | `npm run warmup`: before a crowd, asks every question in `scripts/warmup-questions.txt` (so each is answered from the repeated-question cache) and opens every dashboard (filling Metabase's result cache); lists anything that failed |
| `scripts/share.mjs` | `npm run share`: starts the stack and a Cloudflare tunnel (free, or permanent with `TUNNEL_TOKEN`), checks the link from outside via public DNS, prints and copies it; `--new`, `--stop` |
| `scripts/metabase-setup.mjs` | Builds the Metabase dashboards (the `DASHBOARDS` list, each with its drawer `group`) and the drill-down pages clicks open (`DETAILS`; each chart's `click` / table's `links` say where a click goes) via Metabase's API; every filter needs suggestions (`distinct(...)` from the reporting views, or `fixed(...)`); turns on result caching (`--cache-only` does just that); checks every link and filter before changing anything; rerunnable (new links each run). Writes `metabase-dashboards.json`, which the Dashboards tab reads; `public/app.js` returns to the main dashboard when a detail page's filters are all cleared |
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
- New npm dependencies need `package.json` and `package-lock.json` updated; the README (Part 1) should say when collaborators must rebuild (`docker compose up -d --build -V`).
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
// 4. README.md's appendix matches the code (scripts/build-docs.mjs --check)
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

const docs = run('README.md', process.execPath, ['scripts/build-docs.mjs', '--check']);
console.log(`README.md: ${docs ? 'up to date' : 'out of date'}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
```

<a id="b36"></a>
### B.36 `scripts/build-docs.mjs`

```js
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
];

// Not copied in, and why (shown in the appendix)
const SKIPPED = {
  'README.md': 'this file',
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
```

<a id="b37"></a>
### B.37 `tickets.mjs`

```js
// =====================================================================
// TICKET LOOKUP: the home page's ticket search and the starred list.
// Every Cube query here is built by this file from numbers that matched
// TICKET_PATTERN, never from model output, so nothing unchecked reaches Cube.
// =====================================================================

// What each prefix is, which cube holds it, and which of its columns fill
// the summary table (summary / state / level / team / person / opened)
export const TICKET_KINDS = {
  INC: {
    cube: 'incident', label: 'Incident',
    fields: { summary: 'short_description', state: 'state', level: 'priority', team: 'assignment_group', person: 'assigned_to', opened: 'created' },
    lead: ['number', 'short_description', 'state', 'priority', 'assignment_group', 'assigned_to', 'created', 'resolved', 'closed', 'configuration_item', 'location', 'category', 'subcategory', 'contact_type'],
  },
  CHG: {
    cube: 'change_request', label: 'Change',
    fields: { summary: 'short_description', state: 'state', level: 'risk', team: 'owner_group', person: 'requested_by', opened: 'created' },
    lead: ['number', 'short_description', 'state', 'type', 'risk', 'approval', 'owner_group', 'requested_by', 'created', 'planned_start_date', 'planned_end_date', 'configuration_item', 'environment'],
  },
  RITM: {
    cube: 'sc_req_item', label: 'Request',
    // Requests have no team or priority; the catalog item stands in for a missing summary
    fields: { summary: 'short_description', item: 'item', state: 'state', person: 'requested_for', opened: 'opened', parent: 'request' },
    lead: ['number', 'short_description', 'item', 'state', 'stage', 'approval', 'requested_for', 'opened_by', 'opened', 'closed', 'request', 'location'],
  },
  SCTASK: {
    cube: 'sc_task', label: 'Catalog task',
    fields: { summary: 'short_description', state: 'state', team: 'assignment_group', person: 'assigned_to', opened: 'created', parent: 'request_item' },
    lead: ['number', 'short_description', 'state', 'assignment_group', 'assigned_to', 'created', 'sla_flag', 'request_item', 'request', 'item'],
  },
};

// A REQ is an order: searching one brings up the requests (RITMs) inside it
const ORDER_PREFIX = 'REQ';

// "INC1814467", "inc 1814467", "CHG-1100215", or a bare "1814467" (tried as every type)
const TICKET_PATTERN = /\b(INC|CHG|RITM|SCTASK|REQ)?[\s-]?(\d{7})\b/gi;
// What can be starred: one ticket, not an order
export const STARRABLE = /^(INC|CHG|RITM|SCTASK)\d{7}$/;

export const MAX_SEARCH_NUMBERS = 200;

// Text -> { wanted: [{ input, candidates }], ignored: [words that aren't ticket numbers] }
export function parseTicketNumbers(text) {
  const wanted = [];
  const seen = new Set();
  for (const [, prefix, digits] of String(text).matchAll(TICKET_PATTERN)) {
    const input = prefix ? prefix.toUpperCase() + digits : digits;
    if (seen.has(input)) continue;
    seen.add(input);
    const prefixes = prefix ? [prefix.toUpperCase()] : [...Object.keys(TICKET_KINDS), ORDER_PREFIX];
    wanted.push({ input, candidates: prefixes.map(p => p + digits) });
  }
  const ignored = String(text).replace(TICKET_PATTERN, ' ').split(/[\s,;|]+/).filter(w => /[a-z0-9]/i.test(w));
  return { wanted, ignored: [...new Set(ignored)].slice(0, 20) };
}

export const prefixOf = number => number.match(/^[A-Z]+/)[0];

// One Cube row -> the summary the ticket tables show (also used by relations.mjs)
export function toTicket(prefix, row) {
  const { cube, label, fields } = TICKET_KINDS[prefix];
  const value = key => (fields[key] ? row[`${cube}.${fields[key]}`] ?? '' : '');
  return {
    number: row[`${cube}.number`],
    kind: prefix,
    type: label,
    summary: value('summary') || value('item'),
    state: value('state'),
    level: value('level'),
    team: value('team'),
    person: value('person'),
    opened: value('opened'),
    parent: value('parent'),
  };
}

// The summary rows for some numbers of one type (or the RITMs of some REQs)
async function lookUp(prefix, numbers, runQuery) {
  const kind = TICKET_KINDS[prefix === ORDER_PREFIX ? 'RITM' : prefix];
  const filterColumn = prefix === ORDER_PREFIX ? 'request' : 'number';
  const dimensions = [...new Set(['number', ...Object.values(kind.fields)])].map(c => `${kind.cube}.${c}`);
  const rows = await runQuery({
    dimensions,
    filters: [{ member: `${kind.cube}.${filterColumn}`, operator: 'equals', values: numbers }],
    order: { [`${kind.cube}.number`]: 'asc' },
    limit: 5000,
  });
  return rows.map(r => toTicket(prefix === ORDER_PREFIX ? 'RITM' : prefix, r));
}

// Text with ticket numbers -> the tickets found, in the order they were asked for.
// -> { found: [ticket], notFound: [input], ignored: [word], tooMany: bool }
export async function findTickets(text, runQuery) {
  const parsed = parseTicketNumbers(text);
  const wanted = parsed.wanted.slice(0, MAX_SEARCH_NUMBERS);

  const byPrefix = new Map();
  for (const w of wanted) {
    for (const n of w.candidates) {
      const p = prefixOf(n);
      if (!byPrefix.has(p)) byPrefix.set(p, []);
      byPrefix.get(p).push(n);
    }
  }
  const looked = await Promise.all([...byPrefix].map(async ([p, numbers]) => [p, await lookUp(p, numbers, runQuery)]));

  const byNumber = new Map();
  const byOrder = new Map();
  for (const [p, tickets] of looked) {
    for (const t of tickets) {
      if (p === ORDER_PREFIX) {
        if (!byOrder.has(t.parent)) byOrder.set(t.parent, []);
        byOrder.get(t.parent).push(t);
      } else {
        byNumber.set(t.number, t);
      }
    }
  }

  const found = [];
  const notFound = [];
  const listed = new Set();
  for (const w of wanted) {
    const hits = w.candidates.flatMap(n => byNumber.get(n) || byOrder.get(n) || []);
    if (!hits.length) notFound.push(w.input);
    for (const t of hits) {
      if (listed.has(t.number)) continue;
      listed.add(t.number);
      found.push(t);
    }
  }
  return { found, notFound, ignored: parsed.ignored, tooMany: parsed.wanted.length > MAX_SEARCH_NUMBERS };
}

// Summaries for a list of exact ticket numbers (e.g. everything someone has
// been shown), without the search's 200-number limit -> Map(number -> ticket)
export async function ticketSummaries(numbers, runQuery) {
  const byPrefix = new Map();
  for (const n of new Set(numbers)) {
    if (!STARRABLE.test(n)) continue;
    const p = prefixOf(n);
    if (!byPrefix.has(p)) byPrefix.set(p, []);
    byPrefix.get(p).push(n);
  }
  const looked = await Promise.all([...byPrefix].map(([p, list]) => lookUp(p, list, runQuery)));
  return new Map(looked.flat().map(t => [t.number, t]));
}

// The ticket numbers anywhere in a set of result rows, in the order they appear
export function ticketNumbersIn(rows) {
  const found = new Set();
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === 'string' && STARRABLE.test(value)) found.add(value);
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------
// One ticket's full record: every column its cube has, leading with the
// ones people look at first, and leaving out the empty ones
// ---------------------------------------------------------------------

let cubeColumns = null; // Promise<Map<cube, [member]>>, from Cube's /meta

function loadCubeColumns(cubeUrl, token) {
  if (!cubeColumns) {
    cubeColumns = (async () => {
      const response = await fetch(cubeUrl.replace(/\/load$/, '/meta'), { headers: { Authorization: token } });
      if (!response.ok) throw new Error(`Cube /meta answered ${response.status}`);
      const { cubes } = await response.json();
      return new Map(cubes.map(c => [c.name, c.dimensions.map(d => d.name)
        // created_day / opened_week / planned_start_month repeat a date already shown in full
        .filter(name => !/_(day|week|month)$/.test(name))]));
    })();
    cubeColumns.catch(() => { cubeColumns = null; }); // try again next time
  }
  return cubeColumns;
}

export async function ticketRecord(number, runQuery, { cubeUrl, token }) {
  const prefix = prefixOf(number);
  const kind = TICKET_KINDS[prefix];
  if (!kind) return null;
  const members = (await loadCubeColumns(cubeUrl, token)).get(kind.cube) || [];
  const lead = kind.lead.map(c => `${kind.cube}.${c}`).filter(m => members.includes(m));
  const ordered = [...lead, ...members.filter(m => !lead.includes(m))];

  const [row] = await runQuery({
    dimensions: ordered,
    filters: [{ member: `${kind.cube}.number`, operator: 'equals', values: [number] }],
    limit: 1,
  });
  if (!row) return null;
  const fields = {};
  for (const m of ordered) {
    const v = row[m];
    if (v !== null && v !== undefined && String(v).trim() !== '') fields[m] = v;
  }
  return { cube: kind.cube, fields };
}
```

<a id="b38"></a>
### B.38 `stars.mjs`

```js
// =====================================================================
// STARRED TICKETS: each person's starred tickets, kept with their account
// in the onetouch_auth database, so they follow them to any computer
// =====================================================================

import { pool } from './auth.mjs';

// Plenty for a watch list; stops one account filling the table
export const MAX_STARS = 2000;

// Safe to run every start (after auth.ensureSchema, which creates users)
export async function ensureStarsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS starred_tickets (
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number      text NOT NULL,
      starred_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, number)
    );
  `);
}

// Newest first
export async function listStars(userId) {
  const { rows } = await pool.query(
    'SELECT number, starred_at FROM starred_tickets WHERE user_id = $1 ORDER BY starred_at DESC, number',
    [userId]);
  return rows.map(r => ({ number: r.number, starredAt: r.starred_at.toISOString() }));
}

// -> true if starred (or already was), false if the list is full
export async function addStar(userId, number) {
  const { rows } = await pool.query(
    `INSERT INTO starred_tickets (user_id, number)
     SELECT $1, $2 WHERE (SELECT count(*) FROM starred_tickets WHERE user_id = $1) < $3
     ON CONFLICT DO NOTHING RETURNING number`,
    [userId, number, MAX_STARS]);
  if (rows.length) return true;
  const existing = await pool.query('SELECT 1 FROM starred_tickets WHERE user_id = $1 AND number = $2', [userId, number]);
  return existing.rows.length > 0;
}

// "Star all": stars as many of these as fit under MAX_STARS, in the order given.
// -> the ones that are starred now (any missing from it didn't fit)
export async function addStars(userId, numbers) {
  const { rows: [{ count }] } = await pool.query(
    'SELECT count(*)::int AS count FROM starred_tickets WHERE user_id = $1', [userId]);
  const room = Math.max(MAX_STARS - count, 0);
  if (room) {
    await pool.query(
      `INSERT INTO starred_tickets (user_id, number)
       SELECT $1, u.number FROM unnest($2::text[]) WITH ORDINALITY AS u(number, i)
        WHERE NOT EXISTS (SELECT 1 FROM starred_tickets s WHERE s.user_id = $1 AND s.number = u.number)
        ORDER BY u.i LIMIT $3
       ON CONFLICT DO NOTHING`,
      [userId, numbers, room]);
  }
  const { rows } = await pool.query(
    'SELECT number FROM starred_tickets WHERE user_id = $1 AND number = ANY($2::text[])', [userId, numbers]);
  return rows.map(r => r.number);
}

export async function removeStar(userId, number) {
  await pool.query('DELETE FROM starred_tickets WHERE user_id = $1 AND number = $2', [userId, number]);
}
```

<a id="b39"></a>
### B.39 `scripts/share.mjs`

```js
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

// The tunnel ID inside a token (base64 JSON: { a: account, t: tunnel, s: secret })
function tunnelIdOf(tokenText) {
  try {
    return JSON.parse(Buffer.from(tokenText, 'base64').toString('utf8')).t || null;
  } catch {
    return null;
  }
}

// Anything else on this computer running the same tunnel, such as the
// `docker run cloudflare/cloudflared … --token …` command or the Windows
// service from Cloudflare's install screen. Cloudflare splits visitors across
// all of a tunnel's connectors, and those can't reach app:8000, so the
// visitors sent to them get "error code: 502".
function strayConnectors(tunnelId, ownContainer) {
  const found = [];
  const ids = docker(['ps', '-q'], { quiet: true }).stdout.split(/\s+/).filter(Boolean);
  if (ids.length) {
    const r = docker(['inspect', '-f', '{{.Name}}|{{join .Args " "}} {{join .Config.Env " "}}', ...ids], { quiet: true });
    for (const line of r.stdout.split('\n').filter(Boolean)) {
      const name = line.slice(1, line.indexOf('|'));
      if (name === ownContainer) continue;
      const tokens = line.match(/eyJ[A-Za-z0-9_=+/-]+/g) || [];
      if (tokens.some(t => tunnelIdOf(t) === tunnelId)) found.push(`the Docker container "${name}". Remove it with:\n      docker rm -f ${name}`);
    }
  }
  if (process.platform === 'win32' && spawnSync('sc', ['query', 'cloudflared'], { encoding: 'utf8' }).status === 0) {
    found.push('the "cloudflared" Windows service. Remove it in an administrator PowerShell with:\n' +
      '      & "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe" service uninstall');
  }
  return found;
}

// A few more requests after the first success: if another connector (even one
// on another computer) shares the tunnel, some of them fail
async function failedChecks(url, tries = 6) {
  let failed = 0;
  for (let i = 0; i < tries; i++) if (!await reachableFromOutside(url)) failed++;
  return failed;
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
const failed = link && works ? await failedChecks(link) : 0;
const strays = token ? strayConnectors(tunnelIdOf(token), tunnel.container) : [];
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
if (strays.length) {
  console.log('\n⚠ Something else on this computer is also running your tunnel, so some');
  console.log('  visitors get "error code: 502". Only this project\'s Docker setup should run it:');
  for (const s of strays) console.log(`  - ${s}`);
}
if (failed) {
  console.log(`\n⚠ ${failed} of 6 test visits failed. If nothing is listed above, another computer may be`);
  console.log('  running your tunnel: check its "Connectors" in the Cloudflare dashboard (Zero Trust');
  console.log('  → Networks → Tunnels) and remove any that are not this computer\'s Docker.');
}
console.log('='.repeat(64) + '\n');
```

<a id="b40"></a>
### B.40 `scripts/warmup.mjs`

```js
// Gets OneTouch ready for a crowd (e.g. a presentation): asks every question in
// scripts/warmup-questions.txt once, so each is answered instantly for everyone
// afterwards, and opens every dashboard once, so Metabase has every chart's
// result ready. It also works as a check that everything still works: anything
// that fails is listed at the end.
//
//   npm run warmup                         this computer's OneTouch (localhost)
//   npm run warmup -- https://onetouch.fyi  another OneTouch server
//   ... -- --user jsmith                    sign in as someone else (asks for the password)
//   ... -- --user jsmith --password-stdin   password from stdin instead of a prompt
//
// It signs in as the "warmup" account, with WARMUP_PASSWORD from .env (or asks
// for the password), so the demo tickets its answers list land in that
// account's Ticket results rather than a real person's. Run it on the day
// itself, and don't restart OneTouch afterwards: a restart forgets the
// remembered questions, and they are tied to the date.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
dotenv.config({ quiet: true });

const base = (process.argv.slice(2).find(a => /^https?:\/\//.test(a)) || `http://localhost:${process.env.APP_PORT || 8000}`).replace(/\/+$/, '');
const QUESTIONS_FILE = 'scripts/warmup-questions.txt';
// The account the warm-up signs in as (create it with: users.mjs add warmup "Warmup")
const WARMUP_USER = 'warmup';
const secs = ms => `${(ms / 1000).toFixed(1)} s`;

function stop(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

// Reads a line from the terminal without echoing what is typed
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('No terminal to type a password into.'));
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

// The "warmup" account (password: WARMUP_PASSWORD in .env, or asked for);
// --user <name> signs in as someone else, --password-stdin reads the password from stdin
async function signIn() {
  const args = process.argv.slice(2);
  const username = args.includes('--user') ? args[args.indexOf('--user') + 1] : WARMUP_USER;
  let password;
  if (args.includes('--password-stdin')) password = await readStdin();
  else if (username === WARMUP_USER && process.env.WARMUP_PASSWORD) password = process.env.WARMUP_PASSWORD;
  else password = await promptHidden(`Password for ${username}: `);
  console.log(`Signing in as ${username}.`);
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const data = await r.json().catch(() => ({}));
  if (!data.token) stop(data.error || `Sign-in failed (${r.status}).`);
  return data.token;
}

// A one-line summary of an answer: rows found, or what went wrong
function describe(data) {
  if (data.error) return { ok: false, text: data.error };
  if (data.intent !== 'query') return { ok: true, text: `Claude asked for more detail (${data.intent})` };
  const rows = data.combined ? data.combined.rows.length : (data.sections || []).reduce((n, s) => n + s.rows.length, 0);
  return { ok: true, text: data.allEmpty ? 'nothing found (explanation ready)' : `${rows.toLocaleString()} ${rows === 1 ? 'row' : 'rows'}` };
}

// Opens a dashboard the way a browser does: its layout, then every chart's data
async function openDashboard(dashboardPath) {
  const uuid = dashboardPath.split('/').pop();
  const dash = await (await fetch(`${base}/api/public/dashboard/${uuid}`)).json();
  const cards = (dash.dashcards || []).filter(dc => dc.card_id);
  const results = await Promise.all(cards.map(async dc => {
    const r = await fetch(`${base}/api/public/dashboard/${uuid}/dashcard/${dc.id}/card/${dc.card_id}?parameters=[]`);
    const body = await r.json().catch(() => ({}));
    return r.ok && body.status !== 'failed';
  }));
  return { charts: cards.length, failed: results.filter(ok => !ok).length };
}

// ---------------------------------------------------------------------

try {
  await fetch(base, { signal: AbortSignal.timeout(10000) });
} catch {
  stop(`OneTouch is not answering at ${base}. Start it first (npm run share, or docker compose up -d).`);
}

const questions = readFileSync(QUESTIONS_FILE, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
console.log(`Warming up ${base}: ${questions.length} questions from ${QUESTIONS_FILE}, then every dashboard.\n`);
const token = await signIn();
const auth = { Authorization: `Bearer ${token}` };
const started = performance.now();
const problems = [];

console.log('\nQuestions (⚡ = was already ready):');
for (const question of questions) {
  // A fresh conversation each time: only a conversation's first question is remembered for everyone
  await fetch(`${base}/api/conversation/reset`, { method: 'POST', headers: auth });
  const t0 = performance.now();
  let data;
  try {
    const r = await fetch(`${base}/api/query`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ userPrompt: question }) });
    data = await r.json();
  } catch (err) {
    data = { error: err.message };
  }
  const d = describe(data);
  if (!d.ok) problems.push(`"${question}": ${d.text}`);
  console.log(`  ${!d.ok ? '✗' : data.fromCache ? '⚡' : '✓'} ${question}  (${d.text}, ${secs(performance.now() - t0)})`);
}
await fetch(`${base}/api/conversation/reset`, { method: 'POST', headers: auth });

console.log('\nDashboards:');
const list = await (await fetch(`${base}/api/dashboards`, { headers: auth })).json();
if (!list.dashboards?.length) problems.push('No dashboards found (has scripts/metabase-setup.mjs been run?)');
for (const d of list.dashboards || []) {
  const t0 = performance.now();
  try {
    const r = await openDashboard(d.path);
    if (r.failed) problems.push(`Dashboard "${d.name}": ${r.failed} of ${r.charts} charts failed`);
    console.log(`  ${r.failed ? '✗' : '✓'} ${d.name}  (${r.charts} charts${r.failed ? `, ${r.failed} failed` : ''}, ${secs(performance.now() - t0)})`);
  } catch (err) {
    problems.push(`Dashboard "${d.name}": ${err.message}`);
    console.log(`  ✗ ${d.name}  (${err.message})`);
  }
}

await fetch(`${base}/api/logout`, { method: 'POST', headers: auth });

console.log('\n' + '='.repeat(64));
console.log(`Done in ${secs(performance.now() - started)}.`);
if (problems.length) {
  console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} to look at before people arrive:`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log('Everything worked. These questions now answer instantly for everyone when asked with');
  console.log(`the same words (see ${QUESTIONS_FILE}), and every dashboard opens from Metabase's cache.`);
}
console.log("Don't restart OneTouch before the presentation: a restart forgets the remembered questions.");
console.log('='.repeat(64) + '\n');
```

<a id="b41"></a>
### B.41 `scripts/warmup-questions.txt`

```
# Questions `npm run warmup` asks before a presentation, one per line.
# Each becomes instant for everyone afterwards when asked with the same words
# (capitals, spacing and a closing "?" don't matter). Lines starting with # are
# skipped. The data runs from June 2026 (incidents from early July) to 1 September
# 2026, so name months rather than saying "last month".

# Incidents
How many open incidents are there by priority?
Which assignment groups have the most open incidents?
List the P1 incidents opened in August 2026
How many incidents were opened each week in August 2026?
What are the most common incident subcategories?
Which servers or systems have the most incidents?
How many incidents were reopened?
Show me incident INC1814467

# Changes
How many changes are there by type?
How many changes were created in August 2026 by risk?
List the emergency changes
Which changes caused incidents?
Show me change CHG1101321

# Requests and catalog tasks
What are the top 5 most requested catalog items?
How many requests were opened each month?
Show open catalog tasks that breached SLA
Which teams have the most open catalog tasks?

# Across ticket types
How many incidents, changes and requests were opened in August 2026?
How many requests and incidents were opened each week in August 2026?

# Nothing found: OneTouch works out why and says so
Show me changes owned by the TCS-ServiceDesk-L1-NA-WE team

# Outside the data's dates: Claude says what the export covers
How many incidents were opened in January 2026?
```

<a id="b42"></a>
### B.42 `seen.mjs`

```js
// =====================================================================
// SHOWN TICKETS: every ticket each person has been shown (in the AI
// assistant's answers, or opened as a record), kept with their account in
// the onetouch_auth database, so Home's "Ticket results" survives a refresh,
// signing out, and another computer
// =====================================================================

import { pool } from './auth.mjs';

// The most recent ones are kept; older ones drop off
export const MAX_SEEN = 2000;

// Safe to run every start (after auth.ensureSchema, which creates users)
export async function ensureSeenSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seen_tickets (
      user_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number         text NOT NULL,
      last_shown_at  timestamptz NOT NULL DEFAULT now(),
      question       text,
      PRIMARY KEY (user_id, number)
    );
    CREATE INDEX IF NOT EXISTS seen_tickets_recent_idx ON seen_tickets (user_id, last_shown_at DESC);
  `);
}

// Records that these tickets were just shown, with the question that showed
// them (null: opened directly). Shown again, a ticket moves back to the top.
export async function recordSeen(userId, numbers, question = null) {
  if (!numbers.length) return;
  await pool.query(
    `INSERT INTO seen_tickets (user_id, number, question)
     SELECT $1, n, $3 FROM unnest($2::text[]) AS n
     ON CONFLICT (user_id, number) DO UPDATE SET last_shown_at = now(), question = EXCLUDED.question`,
    [userId, numbers, question]);
  await pool.query(
    `DELETE FROM seen_tickets WHERE user_id = $1 AND number NOT IN (
       SELECT number FROM seen_tickets WHERE user_id = $1 ORDER BY last_shown_at DESC, number LIMIT $2)`,
    [userId, MAX_SEEN]);
}

// "Delete ticket results": the person's whole list (their stars are separate). -> how many
export async function clearSeen(userId) {
  const { rowCount } = await pool.query('DELETE FROM seen_tickets WHERE user_id = $1', [userId]);
  return rowCount;
}

// Newest first
export async function listSeen(userId) {
  const { rows } = await pool.query(
    `SELECT number, last_shown_at, question FROM seen_tickets
      WHERE user_id = $1 ORDER BY last_shown_at DESC, number`,
    [userId]);
  return rows.map(r => ({ number: r.number, shownAt: r.last_shown_at.toISOString(), question: r.question }));
}
```

<a id="b43"></a>
### B.43 `relations.mjs`

```js
// =====================================================================
// RELATED TICKETS: the "families" a ticket belongs to, from the link columns
// in the export (nothing guessed), and what each family's members have in
// common and where they differ:
//
//   parent-incident  incident.parent_incident: a parent (master) incident and the
//                    child incidents raised for the same issue (one level only)
//   bundle-request   sc_req_item.parent: a bundle request and its child requests
//   order            sc_req_item.request: requests ordered together in one REQ
//   request-tasks    sc_task.request_item: a request and the tasks that fulfil it
//   change-incident  change_request.incident (the incident a change fixes) and
//                    incident.caused_by_change (incidents a change caused)
//   problem          incident.problem / change_request.problem: tickets linked to
//                    the same problem record (the PRB itself isn't in the export)
//
// One ticket gets every family it is in. A list of tickets gets only the
// families that two or more of them share, so a long list isn't buried.
// Every Cube query here is built from ticket numbers checked against
// TICKET_NUMBER, never from model output.
// =====================================================================

import { TICKET_KINDS, toTicket, prefixOf } from './tickets.mjs';

const TICKET_NUMBER = /^(INC|CHG|RITM|SCTASK)\d{7}$/;
const MAX_TICKETS = 500;      // tickets looked at per request
const MEMBER_LIMIT = 1000;    // members fetched per query (the largest problem has 870 incidents)
const MAX_FAMILIES = 6;

// Columns fetched besides the summary ones: the links, and the fields compared
const EXTRA = {
  INC: { system: 'configuration_item', subcategory: 'subcategory', location: 'location', parentIncident: 'parent_incident', problem: 'problem', causedByChange: 'caused_by_change' },
  CHG: { system: 'configuration_item', fixesIncident: 'incident', problem: 'problem' },
  RITM: { item: 'item', location: 'location', order: 'request', parentRequest: 'parent' },
  SCTASK: { item: 'item', requestItem: 'request_item' },
};

// Compared across a family's members; each applies to some ticket types only.
// (Each member's role already says its type, so type isn't compared.)
const COMPARE = [
  ['State', ['INC', 'CHG', 'RITM', 'SCTASK'], t => t.state],
  ['Priority / risk', ['INC', 'CHG'], t => t.level],
  ['Team', ['INC', 'CHG', 'SCTASK'], t => t.team],
  ['Server / system', ['INC', 'CHG'], t => t.system],
  ['Subcategory', ['INC'], t => t.subcategory],
  ['Catalog item', ['RITM', 'SCTASK'], t => t.item],
  ['Location', ['INC', 'RITM'], t => t.location],
  ['Assigned to / requested for', ['INC', 'CHG', 'RITM', 'SCTASK'], t => t.person],
];

// "zzz" is the export's placeholder for "no server / system"
const clean = v => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === 'zzz' ? '' : s;
};

// Tickets of one type matching every [column, values] filter, with their link columns
async function queryTickets(prefix, filters, runQuery) {
  if (filters.some(([, values]) => !values.length)) return [];
  const { cube, fields } = TICKET_KINDS[prefix];
  const columns = [...new Set(['number', ...Object.values(fields), ...Object.values(EXTRA[prefix])])];
  const rows = await runQuery({
    dimensions: columns.map(c => `${cube}.${c}`),
    filters: filters.map(([column, values]) => ({ member: `${cube}.${column}`, operator: 'equals', values })),
    order: { [`${cube}.number`]: 'asc' },
    limit: MEMBER_LIMIT,
  });
  return rows.map(row => {
    const t = toTicket(prefix, row);
    for (const [key, column] of Object.entries(EXTRA[prefix])) t[key] = clean(row[`${cube}.${column}`]);
    return t;
  });
}

// What all members share, and where they differ (counts of each value)
function compare(members) {
  const same = [];
  const differ = [];
  for (const [field, kinds, get] of COMPARE) {
    const present = members.filter(m => kinds.includes(m.kind));
    if (present.length < 2) continue;
    const counts = new Map();
    for (const m of present) {
      const v = clean(get(m)) || 'not set';
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    if (counts.size === 1) {
      const [value] = counts.keys();
      if (value !== 'not set') same.push({ field, value });
    } else {
      const values = [...counts].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
      differ.push({ field, values: values.slice(0, 4), others: Math.max(values.length - 4, 0) });
    }
  }
  const summaries = new Set(members.map(m => clean(m.summary)).filter(Boolean));
  if (summaries.size === 1) same.push({ field: 'Summary', value: [...summaries][0] });
  else if (summaries.size > 1) differ.push({ field: 'Summary', note: summaries.size === members.length ? 'each one is different' : `${summaries.size} different summaries` });
  const opened = members.map(m => clean(m.opened)).filter(Boolean).sort();
  if (opened.length > 1) {
    if (opened[0] === opened.at(-1)) same.push({ field: 'Opened', value: opened[0] });
    else differ.push({ field: 'Opened', range: [opened[0], opened.at(-1)] });
  }
  return { same, differ };
}

// A linked ticket that isn't in the export still gets a row, marked as such
const missing = (number, type) => ({ number, kind: prefixOf(number), type, summary: 'Not in this export', state: '', level: '', team: '', person: '', opened: '', missing: true });

function family(kind, anchor, title, why, members, wanted) {
  const unique = [...new Map(members.map(m => [m.number, m])).values()];
  const touched = unique.filter(m => wanted.has(m.number)).length;
  const real = unique.filter(m => !m.missing);
  // Members the question was about first, then the anchor, then by when they were opened
  const ordered = [...unique].sort((a, b) =>
    (wanted.has(b.number) - wanted.has(a.number)) || ((b.number === anchor) - (a.number === anchor)) || clean(a.opened).localeCompare(clean(b.opened)));
  return {
    kind, anchor, title, why, touched, total: unique.length,
    // All of them (the page lists the first 25; downloads and the comparison use all)
    members: ordered.map(({ number, kind: k, type, role, summary, state, level, team, opened, missing: gone }) =>
      ({ number, kind: k, type, role, summary, state, level, team, opened, missing: Boolean(gone) })),
    ...compare(real),
  };
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const role = (t, label) => ({ ...t, role: label });

export async function relatedFamilies(numbers, runQuery) {
  const wantedList = [...new Set(numbers.map(n => String(n).toUpperCase()))].filter(n => TICKET_NUMBER.test(n)).slice(0, MAX_TICKETS);
  if (!wantedList.length) return [];
  const wanted = new Set(wantedList);
  const single = wantedList.length === 1;
  const of = prefix => wantedList.filter(n => prefixOf(n) === prefix);

  // The tickets asked about, with their links
  const [incs, chgs, ritms, tasks] = await Promise.all([
    queryTickets('INC', [['number', of('INC')]], runQuery),
    queryTickets('CHG', [['number', of('CHG')]], runQuery),
    queryTickets('RITM', [['number', of('RITM')]], runQuery),
    queryTickets('SCTASK', [['number', of('SCTASK')]], runQuery),
  ]);

  // Everything the families need, in one round of queries
  const parentIncidents = [...new Set([...incs.map(t => t.parentIncident).filter(Boolean), ...incs.map(t => t.number)])];
  const problems = [...new Set([...incs, ...chgs].map(t => t.problem).filter(Boolean))];
  const changeNumbers = [...new Set([...chgs.map(t => t.number), ...incs.map(t => t.causedByChange).filter(Boolean)])];
  const orders = [...new Set(ritms.map(t => t.order).filter(Boolean))];
  const parentRequests = [...new Set([...ritms.map(t => t.parentRequest).filter(Boolean), ...ritms.map(t => t.number)])];
  const requestItems = [...new Set([...ritms.map(t => t.number), ...tasks.map(t => t.requestItem).filter(Boolean)])];
  const [childIncs, parentIncs, problemIncs, problemChgs, fixChanges, causedIncs, changes, fixedIncs,
    orderRitms, childRitms, parentRitms, taskRitms, taskSiblings] = await Promise.all([
    queryTickets('INC', [['parent_incident', parentIncidents]], runQuery),
    queryTickets('INC', [['number', parentIncidents]], runQuery),
    queryTickets('INC', [['problem', problems]], runQuery),
    queryTickets('CHG', [['problem', problems]], runQuery),
    queryTickets('CHG', [['incident', incs.map(t => t.number)]], runQuery),
    queryTickets('INC', [['caused_by_change', changeNumbers]], runQuery),
    queryTickets('CHG', [['number', changeNumbers]], runQuery),
    queryTickets('INC', [['number', chgs.map(t => t.fixesIncident).filter(Boolean)]], runQuery),
    queryTickets('RITM', [['request', orders]], runQuery),
    queryTickets('RITM', [['parent', parentRequests]], runQuery),
    queryTickets('RITM', [['number', parentRequests]], runQuery),
    queryTickets('RITM', [['number', requestItems]], runQuery),
    queryTickets('SCTASK', [['request_item', requestItems]], runQuery),
  ]);
  const byNumber = list => new Map(list.map(t => [t.number, t]));
  const families = [];

  // Parent incident and its children
  const parentsByNumber = byNumber(parentIncs);
  for (const p of parentIncidents) {
    const children = childIncs.filter(c => c.parentIncident === p);
    if (!children.length) continue;
    const parent = parentsByNumber.get(p) || missing(p, 'Incident');
    families.push(family('parent-incident', p,
      `Parent incident ${p} and its ${plural(children.length, 'child incident', 'child incidents')}`,
      `${p} is a parent (master) incident: it groups incidents raised for the same issue, such as several alerts or reports about one fault, so they are worked and resolved together.`,
      [role(parent, 'Parent'), ...children.map(c => role(c, 'Child'))], wanted));
  }

  // Problem record
  for (const prb of problems) {
    const linked = [...problemIncs.filter(t => t.problem === prb).map(t => role(t, 'Incident')), ...problemChgs.filter(t => t.problem === prb).map(t => role(t, 'Change'))];
    if (linked.length < 2) continue;
    families.push(family('problem', prb,
      `${plural(linked.length, 'ticket', 'tickets')} linked to problem ${prb}`,
      `These tickets were all linked to problem ${prb}, the investigation into their shared root cause. The problem record itself isn't in this export.`,
      linked, wanted));
  }

  // Change <-> incident: the incident a change fixes, and incidents it caused
  const changesByNumber = byNumber([...changes, ...fixChanges]);
  const fixedByNumber = byNumber(fixedIncs);
  for (const c of new Set([...changeNumbers, ...fixChanges.map(t => t.number)])) {
    const change = changesByNumber.get(c) || missing(c, 'Change');
    const fixes = change.fixesIncident ? [fixedByNumber.get(change.fixesIncident) || incs.find(t => t.number === change.fixesIncident) || missing(change.fixesIncident, 'Incident')] : [];
    const caused = causedIncs.filter(t => t.causedByChange === c);
    if (!fixes.length && !caused.length) continue;
    const parts = [fixes.length ? `raised to fix ${fixes[0].number}` : '', caused.length ? `the cause of ${plural(caused.length, 'incident', 'incidents')}` : ''].filter(Boolean);
    families.push(family('change-incident', c,
      `Change ${c}: ${parts.join(', and ')}`,
      fixes.length && caused.length ? `${c} was raised to fix an incident, and other incidents name it as their cause.`
        : fixes.length ? `${c} was raised to fix incident ${fixes[0].number}.` : `These incidents name change ${c} as their cause.`,
      [role(change, 'Change'), ...fixes.map(t => role(t, 'Incident it fixes')), ...caused.map(t => role(t, 'Incident it caused'))], wanted));
  }

  // Requests ordered together
  for (const order of orders) {
    const together = orderRitms.filter(t => t.order === order);
    if (together.length < 2) continue;
    families.push(family('order', order,
      `${plural(together.length, 'request', 'requests')} ordered together in ${order}`,
      `${order} is one order (REQ); each request (RITM) in it is a separate item that was ordered at the same time.`,
      together.map(t => role(t, 'Request')), wanted));
  }

  // Bundle request and its child requests
  const parentRitmsByNumber = byNumber(parentRitms);
  for (const p of parentRequests) {
    const children = childRitms.filter(t => t.parentRequest === p);
    if (!children.length) continue;
    const parent = parentRitmsByNumber.get(p) || missing(p, 'Request');
    families.push(family('bundle-request', p,
      `Request ${p} and its ${plural(children.length, 'child request', 'child requests')}`,
      `${p} is a bundle request; it was split into child requests, one for each part of the work (for example one per server to start or stop).`,
      [role(parent, 'Parent request'), ...children.map(c => role(c, 'Child request'))], wanted));
  }

  // A request and the catalog tasks that fulfil it
  const taskRitmsByNumber = byNumber(taskRitms);
  for (const r of requestItems) {
    const itsTasks = taskSiblings.filter(t => t.requestItem === r);
    if (!itsTasks.length) continue;
    const request = taskRitmsByNumber.get(r) || missing(r, 'Request');
    families.push(family('request-tasks', r,
      `Request ${r} and its ${plural(itsTasks.length, 'catalog task', 'catalog tasks')}`,
      `Catalog tasks are the pieces of work that fulfil request ${r}; each is done by a fulfilment team.`,
      [role(request, 'Request'), ...itsTasks.map(t => role(t, 'Task'))], wanted));
  }

  // One ticket: every family it is in. A list: families two or more of them share.
  return families
    .filter(f => (single ? f.touched >= 1 : f.touched >= 2))
    .sort((a, b) => (b.touched - a.touched) || (b.total - a.total))
    .slice(0, MAX_FAMILIES);
}

// One line per family, for Claude: what the next question can build on
export function describeFamilies(families) {
  return families.map(f => {
    const same = f.same.filter(s => s.field !== 'Summary').map(s => `${s.field} ${s.value}`).join(', ');
    const differ = f.differ.map(d => d.field).join(', ');
    return `${f.title}${same ? `; all share ${same}` : ''}${differ ? `; they differ in ${differ}` : ''}.`;
  }).join(' ');
}
```

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
| `public/login-background.jpg` | wheat-field photo filling the sign-in page behind the box | 4,306,193 | `08413dbddeada9ff…` |
| `molsoncoorslogo.png` | unused copy of public/molsoncoorslogo.png | 17,266 | `3337f757109fc033…` |
| `microsoftlogo.png` | unused copy of the Microsoft logo, 447×447 | 1,273 | `d08ad38884617b08…` |
| `microsoftlogo (1).png` | unused copy of public/microsoftlogo.png | 2,317 | `20479b072c51b6c4…` |

## Appendix D: files not copied here

| File | Why |
|---|---|
| `README.md` | this file |
| `package-lock.json` | written by `npm install`; the versions it pins are in the table above |
| `db/accounts.json` | everyone's usernames and password hashes; make your own accounts instead (step 16) |

<!-- END GENERATED -->
