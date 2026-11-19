# Moving OneTouch's hosting from the laptop to the home PC

**Who reads this:** the Claude Code agent on Ventura's **laptop** (the computer hosting
onetouch.fyi today) and the one on Ventura's **home PC** (taking over). Ventura carries the
files between them on a USB stick. Each part says which computer it is for. Do the parts in
order, and stop to tell Ventura if any check fails. Don't guess your way past a failed check.

The end state:
- The **home PC** hosts onetouch.fyi.
- The **laptop** keeps a full copy as a **standby**: its tunnel is off, and it can take over
  in about 30 seconds if the PC fails (Part E).

## Rules (both computers)

1. **The tunnel runs on one computer at a time. Never both.**
   - Both computers use the same Cloudflare tunnel token. If both run `onetouch_tunnel_named`,
     Cloudflare splits visitors between them.
   - Each computer has its own database, so people get signed out at random, and changes land
     on one computer or the other.
   - Always stop the tunnel on one computer before starting it on the other.
2. **Never run `docker compose up` on the PC before Part B's restore.** On empty volumes it builds
   a fresh database from the CSVs and re-deals the teams. That loses everyone's email address,
   the Milwaukee Brewers, the demo tickets and every assignment (it happened on Nov 5).
3. **Never print secrets.** That means `.env`'s values, passwords, tokens and sign-in links.
   Refer to `.env` variables by name only.
4. **Never `docker compose down -v`, and never `docker volume rm`, on the laptop.** Its volumes
   are the original and the fallback. On the PC, only do it as Troubleshooting says.
5. Use **PowerShell** for the commands here. (Git Bash rewrites the `C:\…:/out` paths that
   `docker run -v` needs.)
6. Don't send a test 🚩 problem report on the live site: it emails the real admins. Tests only
   use `tester1` / `tester2` or `test.*` accounts, never real people's.
7. After finishing, add a short entry to `CLAUDE.local.md`'s chat log and update its "Where
   things stand" section. It travels with the folder, so the PC's agent reads it too.

## What the site is made of

| Thing | Where | Moves how |
|---|---|---|
| Code, `docker-compose.yml`, `model/`, `db/`, `public/` | this folder | the folder copy |
| `.env` (every password and key, `TUNNEL_TOKEN` included) | this folder, git-ignored | the folder copy (hidden file) |
| `csv_data/` (the ServiceNow export, 130 MB) | this folder, git-ignored | the folder copy |
| `.cache/answers.json` (saved AI answers) | this folder, git-ignored | the folder copy |
| `db/accounts.json`, `CLAUDE.local.md` | this folder | the folder copy |
| Postgres data: accounts, emails, teams, assignments, the Brewers, demo tickets, notifications, chats, the ticket tables | Docker volume `onetouch-teqsolutions_pgdata` (~310 MB) | `pgdata.tgz` |
| Metabase's own data (dashboards, embedding settings) | Docker volume `onetouch-teqsolutions_mbdata` (~14 MB) | `mbdata.tgz` |
| `node_modules/` | this folder | **not copied**: the app image installs its own |

- **Containers:** `analytics_postgres`, `analytics_cube`, `analytics_metabase`,
  `analytics_node_app` and `onetouch_tunnel_named` (plus `db-setup`, which runs once and exits).
- **Compose project:** `onetouch-teqsolutions`, named after the folder, so **the folder must keep
  the name `OneTouch-TEQSolutions` on the PC**.
- **`routes-app-1` on the laptop belongs to another project.** Leave it alone.
- **Ports** are all 127.0.0.1-only (8000 app, 5432 Postgres, 4000 Cube, 3000 Metabase).
- The tunnel only dials out, so the PC's router needs no port forwarding.
- Nothing in the code or `.env` names the computer. `APP_URL` and `ONETOUCH_PUBLIC_URL` stay
  `https://onetouch.fyi`.

---

## Part A: on the laptop, make the copy

The site is down for 1–2 minutes during step 3. Tell Ventura first. Do this when nobody is
using it, and not on presentation day.

**1. Folders.** Find the USB stick's drive letter (`Get-Volume`; ask Ventura if unsure). Then:

```powershell
$repo = 'C:\Users\VenturaPerez\Documents\GitHub\OneTouch-TEQSolutions'
$usb  = 'E:\'                     # <- the USB stick's drive letter
$work = Join-Path $env:TEMP 'onetouch-transfer'
New-Item -ItemType Directory -Force $work | Out-Null
Set-Location $repo
```

**2. Write down what's there now**, for the PC to compare against:

```powershell
$counts = @(
  docker exec analytics_postgres psql -U admin -d onetouch_auth -tAc "select 'users', count(*) from users union all select 'teams', count(*) from teams union all select 'team_members', count(*) from team_members union all select 'ticket_assignments', count(*) from ticket_assignments union all select 'users_with_email', count(*) from users where email is not null"
  docker exec analytics_postgres psql -U admin -d analytics_db -tAc "select 'incident', count(*) from incident union all select 'change_request', count(*) from change_request union all select 'sc_req_item', count(*) from sc_req_item union all select 'sc_task', count(*) from sc_task"
)
$counts | Set-Content -Encoding utf8 (Join-Path $work 'counts.txt')
$counts
```

On 2026-11-18 these were:
- users 42, teams 7, team_members 37, ticket_assignments 59136, users_with_email 29
- incident 23341, change_request 1970, sc_req_item 17502, sc_task 16323

Newer numbers are fine. The PC must match **this run's** `counts.txt`.

**3. Stop the site, copy the two volumes, and start it again.** Stopping first makes the copy
consistent: Postgres and Metabase's H2 file must not be written to during the copy.

```powershell
docker compose stop
docker run --rm -v onetouch-teqsolutions_pgdata:/v -v "${work}:/out" alpine tar czf /out/pgdata.tgz -C /v .
docker run --rm -v onetouch-teqsolutions_mbdata:/v -v "${work}:/out" alpine tar czf /out/mbdata.tgz -C /v .
docker compose up -d
docker compose --profile tunnel-named up -d tunnel-named
Get-ChildItem $work          # pgdata.tgz (~60-120 MB), mbdata.tgz, counts.txt
```

**4. Check the laptop came back.** Before going on, all of these must hold:
- `docker compose ps` shows the four services running.
- `docker logs analytics_node_app --tail 20` ends with "Account database ready (… accounts)".
- `(Invoke-WebRequest https://onetouch.fyi -UseBasicParsing).Content -match 'Sign in to OneTouch'` is `True`.

**5. Copy everything to the USB stick.** Skip `node_modules` and `eval-results`. Robocopy copies
hidden files such as `.env`. An exit code of 0–7 means success; 8 or more is a failure.

```powershell
robocopy $repo (Join-Path $usb 'OneTouch-TEQSolutions') /E /XD node_modules eval-results /R:1 /W:1 /NFL /NDL
robocopy $work (Join-Path $usb 'onetouch-transfer') /E /R:1 /W:1 /NFL /NDL
Test-Path (Join-Path $usb 'OneTouch-TEQSolutions\.env')    # must be True
Remove-Item -Recurse -Force $work
```

**6. Tell Ventura:**
- The stick now holds every secret and everyone's email addresses and password hashes.
  Keep it with you, and wipe it after Part B.
- **Anything changed on the live site from now until Part C is lost**, because the PC starts
  from this copy. Avoid assigning, moving tickets or changing settings in between, or redo
  Part A.

---

## Part B: on the home PC, set it up

**1. Install the prerequisites**, if they're missing (ask Ventura before installing anything):
- **Docker Desktop for Windows (WSL 2 backend).** Virtualization must be on in the BIOS.
  Check with `docker version` and `docker compose version`.
- In Docker Desktop's Settings → General, turn on **"Start Docker Desktop when you sign in"**.
- **16 GB of RAM** is comfortable. The stack uses about 1.7 GB (Metabase ~0.9 GB).

**2. Copy the folder off the stick** to a local folder that isn't synced by OneDrive or
Dropbox. Keep the name `OneTouch-TEQSolutions`.

```powershell
$usb  = 'E:\'                     # <- the USB stick's drive letter on this PC
$repo = 'C:\OneTouch\OneTouch-TEQSolutions'
$work = Join-Path $usb 'onetouch-transfer'
robocopy (Join-Path $usb 'OneTouch-TEQSolutions') $repo /E /R:1 /W:1 /NFL /NDL
Set-Location $repo
Test-Path .env; Test-Path csv_data\incident.csv; Test-Path db\accounts.json   # all True
```

**3. Check nothing of OneTouch's exists here yet.** `docker volume ls` must show **no**
`onetouch-teqsolutions_pgdata` or `_mbdata`, and `docker ps -a` no `analytics_*` containers.
- If they exist, stop and ask Ventura. They may be an older copy that the restore would mix
  into.
- If they came from a mistaken `docker compose up`, see Troubleshooting.

**4. Restore the two volumes.** Do this before any `docker compose up` (rule 2).

```powershell
docker volume create onetouch-teqsolutions_pgdata
docker volume create onetouch-teqsolutions_mbdata
docker run --rm -v onetouch-teqsolutions_pgdata:/v -v "${work}:/in" alpine tar xzf /in/pgdata.tgz -C /v
docker run --rm -v onetouch-teqsolutions_mbdata:/v -v "${work}:/in" alpine tar xzf /in/mbdata.tgz -C /v
```

**5. Build and start everything except the tunnel.** The first build pulls the images and runs
`npm install` in the app image; allow 5–15 minutes.

```powershell
docker compose up -d --build
docker compose ps
```

- `db-setup` should have exited with code 0. The other four should be running.
- **Don't start the tunnel yet.** The laptop still has it.

**6. Check the PC's copy matches the laptop's.**

```powershell
docker logs analytics_node_app --tail 30
docker exec analytics_postgres psql -U admin -d onetouch_auth -tAc "select 'users', count(*) from users union all select 'teams', count(*) from teams union all select 'team_members', count(*) from team_members union all select 'ticket_assignments', count(*) from ticket_assignments union all select 'users_with_email', count(*) from users where email is not null"
docker exec analytics_postgres psql -U admin -d analytics_db -tAc "select 'incident', count(*) from incident union all select 'change_request', count(*) from change_request union all select 'sc_req_item', count(*) from sc_req_item union all select 'sc_task', count(*) from sc_task"
Get-Content (Join-Path $work 'counts.txt')
```

- **Every number must equal `counts.txt`.**
- The log must have "Account database ready" and **must not** have "👥 Set up … teams", which
  would mean it started on an empty database: stop and see Troubleshooting.

**7. Check the app on this PC**, at http://localhost:8000:
- `(Invoke-WebRequest http://localhost:8000 -UseBasicParsing).Content -match 'Sign in to OneTouch'` is `True`.
- `docker exec analytics_node_app npm test` passes.
- Ask Ventura to sign in at http://localhost:8000 in a browser and check four things:
  1. Home lists their tickets.
  2. A dashboard under Dashboards draws charts. This proves Metabase's data and embedding
     came across.
  3. 🧊 Architecture → 🩺 Health is green. "Public address" may be red until Part C.
  4. One AI question gets an answer.

---

## Part C: the switch (both computers, in this order)

1. **Laptop:** `docker compose stop tunnel-named`.
   - `docker ps` must no longer list `onetouch_tunnel_named`.
   - onetouch.fyi now shows a Cloudflare error. That's expected and lasts about a minute.
2. **PC:** `docker compose --profile tunnel-named up -d tunnel-named`.
   - `docker logs onetouch_tunnel_named --tail 20` should show "Registered tunnel connection"
     (usually 4 of them).
3. **Check from outside:**
   - **PC:** `(Invoke-WebRequest https://onetouch.fyi -UseBasicParsing).Content -match 'Sign in to OneTouch'` is `True`.
   - **Ventura:** open https://onetouch.fyi on a phone using **mobile data**, not home Wi-Fi,
     and sign in.
   - **Ventura:** in Cloudflare's dashboard (Zero Trust → Networks → Tunnels), the tunnel
     must show connectors from **one** computer only.
4. **Laptop:** leave everything else running or stopped as Ventura prefers. The laptop is now
   the standby. **Its tunnel stays off.**
5. **Both agents:** log it in `CLAUDE.local.md`. On the PC, "Where things stand" now says
   "Live on the home PC". On the laptop, "standby; tunnel off".
6. **Ventura:** delete `onetouch-transfer` and the copied folder from the USB stick.

**To undo the switch:** stop the PC's tunnel, then start the laptop's
(`docker compose --profile tunnel-named up -d tunnel-named`). The laptop is exactly as it was
at Part A, minus anything changed on the PC since.

---

## Part D: the home PC, ready for presentations (PC agent)

Ask Ventura before changing system settings. Explain each one.

- **Never sleep:** `powercfg /change standby-timeout-ac 0`, `powercfg /change hibernate-timeout-ac 0`,
  and `powercfg /change monitor-timeout-ac 30`. The screen may turn off; the PC must not.
- **No surprise reboots:** pause Windows Update for the week of the presentation (Settings →
  Windows Update → Pause), and set active hours around it.
- **After a reboot, Docker only starts once someone signs in to Windows.** Either Ventura
  signs in after any reboot, or sets up automatic sign-in (Ventura's call: it's a security
  trade-off).
  - The containers then come back by themselves (`restart: always`). The tunnel doesn't
    (`restart: "no"`): the **tunnel watch** starts it (see Part E, "The tunnel watch").
- **Network:** a wired connection beats Wi-Fi. Every visitor's page comes through the home
  upload speed; about 10 Mbps up is plenty for ~30 people.
- **Remote access** (Chrome Remote Desktop, Tailscale or similar): suggest it strongly. Without
  it, a problem during the presentation can't be fixed until someone is at the PC. Ventura
  sets it up; it needs their account sign-ins.
- **Don't open the stack's ports to the network.** They are 127.0.0.1-only on purpose.

---

## Part E: keeping the laptop as a standby

**Data drift:** the two databases are separate, and only the computer running the tunnel gets
changes. The standby is only as fresh as its last copy.

**Refresh the standby**, e.g. the night before a presentation, after the last changes:
1. Run Part A on the **PC**: copy from the live computer, with the PC's paths.
2. On the **laptop**:
   ```powershell
   docker compose stop
   docker run --rm -v onetouch-teqsolutions_pgdata:/v alpine sh -c "rm -rf /v/* /v/..?* /v/.[!.]*"
   docker run --rm -v onetouch-teqsolutions_mbdata:/v alpine sh -c "rm -rf /v/* /v/..?* /v/.[!.]*"
   ```
   Then restore as in Part B step 4, and `docker compose up -d` **without** the tunnel.
3. Compare the counts as in Part B step 6.
4. Code changes made on one computer go to the other by `git pull`, or by copying the changed
   files. **`.env` must stay identical on both.**

**The tunnel watch (`scripts\take-over.ps1`).** Built 2026-11-18 so a power cut can't end
with two tunnels.
- OneTouch's pages carry `X-OneTouch-Host`, which differs between computers. Cloudflare
  answers 530 when no tunnel is connected.
- **PC:** a sign-in task, "OneTouch tunnel watch", runs `take-over.ps1 -Watch` hidden.
  - Starts the tunnel only when onetouch.fyi has no computer connected.
  - Restarts it if it dies.
  - Stops it if the PC loses the internet for 30 s, or sees another computer serving.
  - Log: `%LOCALAPPDATA%\OneTouch\tunnel-watch.log`.
  - Install or remove it from the OneTouch folder, not `C:\WINDOWS\system32`:
    `powershell -ExecutionPolicy Bypass -File scripts\take-over.ps1 -InstallWatch` (or `-RemoveWatch`).
- **Laptop:** no watch. It only takes over by hand (below).

**Failover, if the PC stops working (power or internet out) during a presentation:**
1. **Laptop**, in PowerShell in its OneTouch folder, online (a phone hotspot is safest: venue
   networks may block the tunnel):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\take-over.ps1
   ```
   - It checks for a minute that no computer is connected, starts the stack and the tunnel,
     and says DONE when onetouch.fyi answers from the laptop.
   - It refuses if another computer is serving the site.
2. People have to sign in again. The data is as of the last refresh.
3. **When the PC comes back:** its watch sees the laptop serving and keeps its own tunnel off.
4. **To hand the site back to the PC:** on the laptop, run `docker compose stop tunnel-named`.
   The PC's watch takes over within about 20 s. Anything changed on the laptop meanwhile stays
   on the laptop.

Running both tunnels at once as "automatic backup" doesn't work. See rule 1.

---

## Presentation morning (on whichever computer is live)

1. `docker compose ps`: all running, and the tunnel only here.
2. `docker exec analytics_node_app npm run warmup`, then **don't restart the app** for the rest
   of the day. Saved answers count only for the date they were saved, in Chicago time.
3. 🧊 Architecture → 🩺 Health: all green.
4. https://onetouch.fyi on a phone on mobile data: sign in works.
5. If Claude might be unreachable, the README's "Presentation day" section covers
   `DEMO_MODE=offline`.
6. The Team tab's 🎬 card (Before a presentation, Demo day, After the presentation) is Ventura's
   to press, not the agent's.

---

## Troubleshooting

| What | Do |
|---|---|
| PC ran `docker compose up` before the restore (the log has "👥 Set up … teams") | Only on the **PC**: `docker compose down -v` (deletes the PC's new, wrong volumes), then Part B from step 3. Never do this on the laptop. |
| `db-setup` fails with `sh: …\r` or "not found" | The `.sh` files got Windows line endings. `.gitattributes` keeps them LF in git, but a copy can change them. Run `git checkout -- db/*.sh` (Git for Windows), or convert those files to LF, then `docker compose up -d` again. |
| Port 5432, 8000, 4000 or 3000 already in use | Another program on the PC uses it (often a local Postgres). Stop that program, or ask Ventura. Don't change the ports in `docker-compose.yml`. |
| Counts don't match `counts.txt` | The copy is incomplete or out of date. Redo Part A, then Part B (the troubleshooting row above first). |
| Dashboards are blank or say "embedding is not enabled" | The `mbdata` restore failed, or `.env`'s `METABASE_EMBEDDING_SECRET` differs. Compare `.env` on the two computers by hash only, e.g. `Get-FileHash .env`. Never print it. |
| AI answers fail | `.env`'s `ANTHROPIC_API_KEY` didn't come across, or the PC has no internet. 🩺 Health's Claude check says which. |
| onetouch.fyi flips between working and "Please sign in again" | Both tunnels are running. Stop one at once (rule 1). |
| The client's network blocks onetouch.fyi | Not a hosting problem. Moving computers doesn't change it (see `CLAUDE.local.md`, Nov 17). |
| Emails | Nothing to change: Brevo is called by API from whichever computer is live. `MAIL_ONLY_TO` in `.env` still applies. |
