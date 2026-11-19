<#
  Makes this computer the one serving https://onetouch.fyi, but only when no
  other computer is. Only one computer may run the Cloudflare tunnel at a time
  (MOVING-HOSTS.md rule 1): two would split visitors between two databases.

  Run from PowerShell in the OneTouch folder:

    powershell -ExecutionPolicy Bypass -File scripts\take-over.ps1
        Take over now (the standby laptop, when the live computer is down).
        Waits until onetouch.fyi has had no computer connected for a full
        minute, then starts the stack and the tunnel. Refuses if another
        computer is serving it.

    powershell -ExecutionPolicy Bypass -File scripts\take-over.ps1 -InstallWatch
        On the live computer (the home PC) only: runs -Watch at every sign-in.
    powershell -ExecutionPolicy Bypass -File scripts\take-over.ps1 -RemoveWatch
        Undoes -InstallWatch.

    -Watch   (what the sign-in task runs; keeps running)
        Starts the tunnel when no computer is connected, restarts it if it dies,
        stops it when this computer has lost the internet for 30 s or another
        computer is serving the site. So after a power cut, the PC stays off
        while the laptop serves, and takes over again once the laptop stops.

  How it tells: Cloudflare answers 530 when no tunnel is connected. OneTouch's
  pages carry X-OneTouch-Host (server.mjs), which differs between computers.
  Log: %LOCALAPPDATA%\OneTouch\tunnel-watch.log

  Phone notifications (ntfy.sh, free app): what the watch does (started after a
  restart, tunnel started or stopped, another computer serving, app not
  answering) and how a take-over ended. Messages sent while offline wait and go
  out once the internet is back. They only name this computer and what
  happened, never anything from OneTouch's data.
    powershell -ExecutionPolicy Bypass -File scripts\take-over.ps1 -SetupNotify
        Makes a private topic for this computer (saved in
        %LOCALAPPDATA%\OneTouch\ntfy-topic.txt, not in .env or git), sends a
        test and prints the topic to subscribe to in the ntfy app. Run it again
        with -Topic <name> to use an existing topic (e.g. the same on the laptop).
    -TestNotify  sends one test notification.
  No topic file: no notifications.
#>
param(
  [switch]$Watch,
  [switch]$InstallWatch,
  [switch]$RemoveWatch,
  [switch]$SetupNotify,
  [switch]$TestNotify,
  [string]$Topic = ''
)

$ErrorActionPreference = 'Continue'
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
$Site = 'https://onetouch.fyi/'
$Local = 'http://localhost:8000/'
$Tunnel = 'onetouch_tunnel_named'
$TaskName = 'OneTouch tunnel watch'
$LogDir = Join-Path $env:LOCALAPPDATA 'OneTouch'
New-Item -ItemType Directory -Force $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'tunnel-watch.log'

function Write-Log([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message"
  Write-Host $line
  try {
    if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) { Move-Item $LogFile "$LogFile.old" -Force }
    Add-Content -Path $LogFile -Value $line -Encoding utf8
  } catch {}
}

# ---------------------------------------------------------------- phone notifications (ntfy.sh)
$TopicFile = Join-Path $LogDir 'ntfy-topic.txt'
$script:Pending = New-Object System.Collections.ArrayList

# Queues a notification and tries to send everything waiting. Plain ASCII only
# (Windows PowerShell 5.1 sends bodies and headers as Latin-1).
function Send-Push([string]$Title, [string]$Message, [string]$Priority = 'default', [string]$Tags = '') {
  if (-not (Test-Path $TopicFile)) { return }
  if ($script:Pending.Count -ge 20) { $script:Pending.RemoveAt(0) }
  [void]$script:Pending.Add(@{
    Title = "$Title ($env:COMPUTERNAME)"; Message = $Message; Priority = $Priority; Tags = $Tags
    At = (Get-Date -Format 'MMM d, h:mm:ss tt')
  })
  Send-PendingPushes
}

function Send-PendingPushes {
  if ($script:Pending.Count -eq 0 -or -not (Test-Path $TopicFile)) { return }
  $name = (Get-Content $TopicFile -TotalCount 1).Trim()
  if (-not $name) { return }
  while ($script:Pending.Count -gt 0) {
    $p = $script:Pending[0]
    $headers = @{ Title = $p.Title; Priority = $p.Priority }
    if ($p.Tags) { $headers['Tags'] = $p.Tags }
    try {
      Invoke-RestMethod -Method Post -Uri "https://ntfy.sh/$name" -Body "$($p.Message) (at $($p.At))" `
        -Headers $headers -TimeoutSec 10 -UseBasicParsing | Out-Null
      $script:Pending.RemoveAt(0)
    } catch { return }
  }
}

if ($SetupNotify) {
  if (-not $Topic) {
    $chars = 'abcdefghijkmnpqrstuvwxyz23456789'.ToCharArray()
    $Topic = 'onetouch-' + (-join (1..20 | ForEach-Object { $chars | Get-Random }))
  }
  if ($Topic -notmatch '^[A-Za-z0-9_-]{8,64}$') { Write-Host 'A topic is 8-64 letters, digits, - or _.'; exit 1 }
  Set-Content -Path $TopicFile -Value $Topic -Encoding ascii
  Send-Push 'OneTouch notifications are on' 'This computer will tell you here when its tunnel starts, stops or has trouble.' 'default' 'white_check_mark'
  if ($script:Pending.Count -gt 0) { Write-Host "Saved, but the test couldn't be sent (no internet?)." }
  Write-Host ''
  Write-Host 'In the ntfy app: + (Subscribe to topic), server ntfy.sh, topic:'
  Write-Host "    $Topic"
  Write-Host 'Keep it private: anyone with the topic can read these notifications.'
  exit 0
}
if ($TestNotify) {
  if (-not (Test-Path $TopicFile)) { Write-Host 'No topic yet: run with -SetupNotify first.'; exit 1 }
  Send-Push 'OneTouch test' 'Test notification from the tunnel watch script.' 'default' 'bell'
  if ($script:Pending.Count -gt 0) { Write-Host 'Could not reach ntfy.sh.'; exit 1 }
  Write-Host 'Sent.'
  exit 0
}

# What onetouch.fyi looks like from here:
#   served  : a OneTouch server answered (.HostId says which; empty if it's an older server)
#   none    : Cloudflare reached, no tunnel connected (530)
#   broken  : a tunnel is connected but nothing behind it answers (502 etc.)
#   offline : this computer can't reach Cloudflare
function Get-SiteState {
  $url = "${Site}?tunnel-check=$([DateTime]::UtcNow.Ticks)"
  try {
    $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 15 -Headers @{ 'Cache-Control' = 'no-cache' }
    return @{ State = 'served'; HostId = [string]$r.Headers['X-OneTouch-Host'] }
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if (-not $resp) { return @{ State = 'offline' } }
    $hostId = [string]$resp.Headers['X-OneTouch-Host']
    if ($hostId) { return @{ State = 'served'; HostId = $hostId } }
    $code = [int]$resp.StatusCode
    if ($code -eq 530) { return @{ State = 'none' } }
    return @{ State = 'broken'; Code = $code }
  } catch {
    return @{ State = 'offline' }
  }
}

function Get-LocalHostId {
  try {
    $r = Invoke-WebRequest $Local -UseBasicParsing -TimeoutSec 5
    return [string]$r.Headers['X-OneTouch-Host']
  } catch { return '' }
}

function Test-TunnelRunning {
  $id = docker ps -q --filter "name=^${Tunnel}$" --filter 'status=running' 2>$null
  return [bool]$id
}

function Wait-Docker([int]$Seconds) {
  $until = (Get-Date).AddSeconds($Seconds)
  while ($true) {
    docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return $true }
    if ($Seconds -gt 0 -and (Get-Date) -gt $until) { return $false }
    Start-Sleep -Seconds 5
  }
}

function Start-Tunnel {
  docker compose --profile tunnel-named up -d tunnel-named 2>&1 | ForEach-Object { "$_" } | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Stop-Tunnel {
  docker stop $Tunnel 2>&1 | Out-Null
}

# ---------------------------------------------------------------- the sign-in task
if ($InstallWatch) {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $action = New-ScheduledTaskAction -Execute $ps -WorkingDirectory $Repo `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Watch"
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Runs the OneTouch Cloudflare tunnel only when no other computer serves onetouch.fyi (scripts\take-over.ps1).' -Force | Out-Null
  Write-Log "Installed '$TaskName': runs at every sign-in of $env:USERNAME. Starting it now."
  Start-ScheduledTask -TaskName $TaskName
  exit 0
}
if ($RemoveWatch) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Log "Removed '$TaskName'. The tunnel is left as it is."
  exit 0
}

# ---------------------------------------------------------------- watch (the live computer)
if ($Watch) {
  Write-Log 'Watch started; waiting for Docker.'
  Wait-Docker 0 | Out-Null
  Write-Log 'Docker is up.'
  Send-Push 'OneTouch watch started' 'This computer signed in (after a restart or power cut) and its tunnel watch is running.' 'default' 'arrows_counterclockwise'
  $last = ''
  $offlineSince = $null
  $noneSince = $null
  $noneRunningSince = $null
  $brokenSince = $null
  $brokenTold = $false
  $failTold = $false
  while ($true) {
    if (-not (Wait-Docker 60)) { continue }
    Send-PendingPushes
    $running = Test-TunnelRunning
    $s = Get-SiteState
    $now = Get-Date
    if ($s.State -eq 'offline') { if (-not $offlineSince) { $offlineSince = $now } } else { $offlineSince = $null }
    if (-not ($running -and $s.State -eq 'broken')) { $brokenSince = $null }

    if (-not $running) {
      $noneRunningSince = $null
      if ($s.State -eq 'none') {
        if (-not $noneSince) { $noneSince = $now }
        # Two looks 10 s apart, so a computer that is just connecting isn't run over
        if (($now - $noneSince).TotalSeconds -ge 10) {
          Write-Log 'No computer is serving onetouch.fyi: starting the tunnel here.'
          if (Start-Tunnel) {
            Write-Log 'Tunnel started.'
            Send-Push 'OneTouch: tunnel started here' 'No computer was serving onetouch.fyi, so this computer started its tunnel.' 'default' 'rocket'
            $failTold = $false
          } else {
            Write-Log 'Starting the tunnel failed; trying again shortly.'
            if (-not $failTold) {
              Send-Push 'OneTouch: tunnel would not start' 'onetouch.fyi is down and this computer could not start its tunnel. It keeps trying; check Docker here or run take-over.ps1 on the laptop.' 'urgent' 'rotating_light'
              $failTold = $true
            }
          }
          $noneSince = $null
        }
      } else {
        $noneSince = $null
        $what = switch ($s.State) {
          'served'  { 'Another computer is serving onetouch.fyi: the tunnel stays off here.' }
          'broken'  { "A tunnel is connected elsewhere but its app isn't answering ($($s.Code)): the tunnel stays off here." }
          'offline' { "This computer can't reach Cloudflare: waiting." }
        }
        if ($what -ne $last) {
          Write-Log $what
          if ($s.State -eq 'served') { Send-Push 'OneTouch: another computer is serving' 'onetouch.fyi is served by another computer, so this one keeps its tunnel off. To hand it back, stop the tunnel on that computer.' 'default' 'information_source' }
          if ($s.State -eq 'broken') { Send-Push 'OneTouch: site not answering' "Another computer's tunnel is connected but its app answers $($s.Code). This one stays off; check that computer." 'high' 'warning' }
          $last = $what
        }
      }
    } else {
      $noneSince = $null
      if ($offlineSince -and ($now - $offlineSince).TotalSeconds -ge 30) {
        Write-Log 'Lost the internet for 30 s: stopping the tunnel here, so another computer can take over safely.'
        Stop-Tunnel; $offlineSince = $null; $last = ''
        Send-Push 'OneTouch: internet lost, tunnel stopped' 'This computer lost the internet for 30 s and stopped its tunnel. When it is back online it starts the tunnel again, unless another computer is serving by then.' 'high' 'warning'
      } elseif ($s.State -eq 'broken') {
        $noneRunningSince = $null
        if (-not $brokenSince) { $brokenSince = $now }
        if (-not $brokenTold -and ($now - $brokenSince).TotalSeconds -ge 60) {
          Write-Log "The tunnel is connected but the app has answered $($s.Code) for a minute."
          Send-Push 'OneTouch: app not answering' "The tunnel is up but onetouch.fyi has answered $($s.Code) for a minute. Check the app here: docker compose ps" 'urgent' 'rotating_light'
          $brokenTold = $true
        }
      } elseif ($s.State -eq 'served') {
        $noneRunningSince = $null
        if ($brokenTold) {
          Write-Log 'The app answers again.'
          Send-Push 'OneTouch: app answering again' 'onetouch.fyi answers normally again.' 'default' 'white_check_mark'
          $brokenTold = $false
        }
        $mine = Get-LocalHostId
        $others = @()
        if ($mine) {
          # A few looks: with two tunnels, Cloudflare may send some of them to the other computer
          foreach ($i in 1..3) {
            $t = if ($i -eq 1) { $s } else { Get-SiteState }
            if ($t.State -eq 'served' -and $t.HostId -ne $mine) { $others += $t.HostId }
          }
        }
        if ($others.Count -gt 0) {
          Write-Log 'Another computer is also serving onetouch.fyi: stopping the tunnel here (that computer keeps it).'
          Stop-Tunnel; $last = ''
          Send-Push 'OneTouch: two tunnels, stopped this one' 'Another computer was also serving onetouch.fyi, so this computer stopped its tunnel. That computer keeps the site.' 'high' 'warning'
        } elseif ($last -ne 'serving') {
          Write-Log 'onetouch.fyi is served by this computer.'; $last = 'serving'
        }
      } elseif ($s.State -eq 'none') {
        if (-not $noneRunningSince) { $noneRunningSince = $now }
        if (($now - $noneRunningSince).TotalSeconds -ge 90) {
          Write-Log "The tunnel runs here but isn't connected after 90 s: restarting it."
          docker restart $Tunnel 2>&1 | Out-Null
          Send-Push 'OneTouch: tunnel restarted' "This computer's tunnel was running but not connected for 90 s, so it was restarted." 'high' 'warning'
          $noneRunningSince = $null; $last = ''
        }
      } else { $noneRunningSince = $null }
    }
    Start-Sleep -Seconds 10
  }
}

# ---------------------------------------------------------------- take over now (by hand)
Write-Log 'Taking over onetouch.fyi on this computer.'
if (-not (Wait-Docker 300)) { Write-Log 'Docker is not running. Start Docker Desktop, then run this again.'; exit 1 }
if (Test-TunnelRunning) {
  Write-Log 'The tunnel is already running on this computer. Nothing to do.'
  exit 0
}

Write-Log 'Checking that no other computer serves onetouch.fyi (1 minute)...'
$until = (Get-Date).AddSeconds(60)
while ($true) {
  $s = Get-SiteState
  switch ($s.State) {
    'served'  { Write-Log 'STOP: another computer is serving onetouch.fyi right now. Stop its tunnel first (docker compose stop tunnel-named there), then run this again.'; exit 1 }
    'broken'  { Write-Log "STOP: another computer's tunnel is connected (its app answers $($s.Code)). Stop that tunnel first, then run this again."; exit 1 }
    'offline' { Write-Log "STOP: this computer can't reach Cloudflare. Connect it to the internet (a phone hotspot works), then run this again."; exit 1 }
  }
  if ((Get-Date) -ge $until) { break }
  Start-Sleep -Seconds 10
}
Write-Log 'No computer has been connected for a minute. Starting OneTouch here.'

docker compose up -d 2>&1 | ForEach-Object { "$_" } | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Log 'docker compose up failed. Run "docker compose up -d" to see why.'; exit 1 }
# One last look, in case another computer connected meanwhile
$s = Get-SiteState
if ($s.State -ne 'none') { Write-Log "STOP: onetouch.fyi changed to '$($s.State)' while starting. Not starting the tunnel."; exit 1 }
if (-not (Start-Tunnel)) { Write-Log 'Starting the tunnel failed. Run "docker compose --profile tunnel-named up -d tunnel-named" to see why.'; exit 1 }

# Without the sign-in task (the laptop), keep it running through crashes and reboots of this computer
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
  docker update --restart unless-stopped $Tunnel 2>&1 | Out-Null
}

Write-Log 'Tunnel started; waiting for onetouch.fyi to answer from here...'
$mine = ''
$until = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $until) {
  Start-Sleep -Seconds 5
  if (-not $mine) { $mine = Get-LocalHostId }
  $s = Get-SiteState
  if ($s.State -eq 'served' -and $mine -and $s.HostId -eq $mine) {
    Write-Log 'DONE: onetouch.fyi is served by this computer. People need to sign in again.'
    Send-Push 'OneTouch: taken over' 'onetouch.fyi is now served by this computer. People need to sign in again.' 'high' 'rocket'
    Write-Log 'To hand it back later: docker compose stop tunnel-named (here); the other computer takes over if its watch runs.'
    exit 0
  }
}
Write-Log 'The tunnel started, but onetouch.fyi has not answered from this computer within 2 minutes. Check: docker logs onetouch_tunnel_named --tail 20'
Send-Push 'OneTouch: take-over not finished' 'The tunnel started here, but onetouch.fyi has not answered from this computer within 2 minutes.' 'urgent' 'rotating_light'
exit 1
