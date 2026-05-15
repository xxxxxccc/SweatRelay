---
name: sweatrelay
description: Drive SweatRelay to bridge Chinese cycling platforms (Onelap, etc.) into Strava and supported device platforms. Use when the user wants to sync rides, watch a folder for new FIT files, schedule periodic syncs, import Onelap rides to COROS/Garmin via the GUI, or troubleshoot sync failures.
---

# SweatRelay CLI / GUI

A local training sync console. The CLI (`sweatrelay`) uploads activity files to Strava and pulls activities from Chinese platforms that don't sync natively. The GUI also imports Onelap activities into COROS and Garmin Connect, syncs local planned workouts to Intervals.icu / Garmin China, and can run scheduled Onelap syncs to only the target platforms the user selected. Designed to be driven by humans **and** AI agents — CLI output is plain, predictable, and exit codes are honest.

## When to use this skill

- The user mentions Strava, Onelap (顽鹿), COROS, Garmin, uploading FIT/GPX/TCX files, or syncing rides between China-region apps and supported targets
- The user wants to watch a folder for new ride files and auto-upload them
- The user wants to set up periodic background sync from Onelap to selected targets
- The user wants to sync local planned workouts to Intervals.icu or Garmin China
- The user is troubleshooting upload failures, duplicates, or rate limits

Do NOT call this skill for:
- General Strava/Garmin analytics or activity viewing — `sweatrelay` only writes/imports
- Garmin Connect → Strava syncing — Garmin's official integration handles that

## Install (only if `sweatrelay` is missing)

Supported platforms: **macOS Apple Silicon** and **Windows x64**. Intel Mac / Linux must build from source.

```sh
# macOS (Apple Silicon)
curl -fsSL https://raw.githubusercontent.com/xxxxxccc/SweatRelay/main/scripts/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/xxxxxccc/SweatRelay/main/scripts/install.ps1 | iex

# Homebrew (once a tap exists)
brew install xxxxxccc/sweatrelay/sweatrelay
```

Verify: `sweatrelay --version`

## Required environment

Set these once (or have the user export them in their shell rc):

| Variable | Purpose |
|---|---|
| `SWEATRELAY_PASSPHRASE` | Master passphrase for the local AES-GCM credential file. Required for every command. Loss = re-auth from scratch. |
| `STRAVA_CLIENT_ID` | From <https://www.strava.com/settings/api>. The Strava app's Authorization Callback Domain must be `localhost`. |
| `STRAVA_CLIENT_SECRET` | Same source. |

Optional:

| Variable | Purpose |
|---|---|
| `SWEATRELAY_HOME` | Override config dir (default `$XDG_CONFIG_HOME/sweatrelay` or `~/.config/sweatrelay`). |

## Commands

### `sweatrelay auth strava`
Run once. Spins a loopback HTTP server, opens the browser, captures the OAuth code, exchanges for tokens, encrypts to disk. **Requires user to click through the browser** — agents should announce this and wait.

### `sweatrelay auth onelap`
Run once. Prompts for Onelap account + password (no echo). Stores them encrypted. Eagerly tries a login to surface bad credentials. Agents should pass account/password via stdin **only** when explicitly authorized; otherwise instruct the user to run interactively.

### `sweatrelay upload <file>`
One-shot upload of a single `.fit` / `.gpx` / `.tcx` file to Strava. Idempotent: re-uploading the same file logs `Already synced` and exits 0.

### `sweatrelay watch <dir> [--process-existing]`
Long-running. Watches `<dir>` for new FIT/GPX/TCX files; uploads each as it lands. `Ctrl-C` to stop. Use for "drop your code-meter exports here" workflows. With `--process-existing`, also uploads files already present at startup.

### `sweatrelay sync onelap [--since <when>]`
Pulls Onelap activities and uploads any not yet synced. `--since today` (default), `--since YYYY-MM-DD`, or `--since all`.

### `sweatrelay schedule "<cron>" sync onelap [--tz Asia/Shanghai]`
Long-running daemon. Standard 5-field cron. Example: `"*/30 * * * *"` = every 30 min. CLI scheduled sync uploads Onelap to Strava. GUI scheduled sync can additionally target COROS and Garmin based on the user's checkboxes; its daily preset is 23:30 to avoid syncing while a night ride is still in progress.

### `sweatrelay status`
Prints config dir paths, stored credential keys, and the most recent ~20 sync records (timestamp, source, key, activity URL).

## GUI-only capabilities

- Data sources page: connect Strava, Onelap, Intervals.icu, COROS, and Garmin.
- Onelap → COROS / Garmin imports are GUI-only direct imports; they use each platform's current web/mobile import path and keep separate local sync records.
- Auto Sync page: file watcher still means local files → Strava; scheduled Onelap sync lets the user check only the desired targets: Strava, COROS, Garmin. The daily preset is 23:30.
- Training Plan page: edit local planned workouts, repeat steps, copy/paste sessions, estimate IF/TSS/load, then sync to Intervals.icu calendar.
- Garmin China: when connected, the GUI can sync local planned workouts directly to Garmin Connect without relying on Intervals.icu → Garmin.
- Training Load page: reads CTL/ATL/TSB/Ramp from Intervals.icu and applies SweatRelay's local rule engine for "too hard / suitable / recovery" guidance.

## Output conventions

Each successful operation emits one line per activity:

```
✓ Uploaded → https://www.strava.com/activities/<id>
↻ Already on Strava (duplicate of activity <id>) — recorded.
✓ Already synced → https://www.strava.com/activities/<id>
✗ Error[: for <key>]: <message>
```

Exit codes:

- `0` — at least one operation completed without unrecoverable error
- `1` — any operation failed; details on stderr

The `↻` and `✓ Already synced` lines are NOT errors — they are normal, idempotent outcomes. Agents must treat them as success.

## Typical agent workflows

### "Sync today's Onelap rides"
```sh
sweatrelay sync onelap --since today
```
Parse output lines; report count of `Uploaded` / `Already synced` / `Error` to the user. If `Error` mentions "rate limit" or `429`, wait 15 min and retry.

### "Set up CLI auto-sync"
1. Confirm Strava + Onelap are connected: `sweatrelay status` (look for both keys in `Credentials stored`)
2. If missing: instruct user to run `sweatrelay auth strava` and `sweatrelay auth onelap` interactively
3. Start daemon in user's preferred terminal: `sweatrelay schedule "*/30 * * * *" sync onelap --tz Asia/Shanghai`

### "Set up GUI scheduled sync to multiple targets"
1. Open the GUI Data Sources page and confirm Onelap plus the target platforms are connected.
2. Open Auto Sync.
3. Choose a frequency.
4. Check only the platforms the user wants SweatRelay to sync.
5. Save. Do not assume COROS/Garmin are enabled unless the user selected them.

### "Upload a manual export"
```sh
sweatrelay upload ~/Downloads/2026-04-22-ride.fit
```

### "Watch my code meter export folder"
```sh
sweatrelay watch ~/Documents/Garmin
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `No Strava tokens stored — run \`auth strava\` first` | First run, or `creds.enc` was deleted | Run `sweatrelay auth strava` |
| `Onelap account/password not stored` | Same, for Onelap | Run `sweatrelay auth onelap` |
| `Strava rate limit hit, retry in <ms>` | Hit 100 req/15min or 1000/day | Wait until next 15-min boundary |
| `duplicate of activity <id>` | Strava already has this ride (server-side dedupe via `external_id`) | Not an error; recorded as synced |
| `UploadTimeoutError` | Upload accepted but Strava processing took >60s | Re-run; or check Strava manually |
| `Onelap login failed` | Wrong password, captcha required, or upstream API changed | Re-run `auth onelap`; if persistent, fall back to `watch <dir>` workflow |
| `Garmin 已存在` / duplicate import | Garmin already has the ride | Not an error; recorded separately per Garmin region |
| Garmin import shows "already imported" but activity is missing | Old unconfirmed local record or region switch | Re-run with the current version; Garmin records are region-scoped and unconfirmed records no longer block retries |

## What NOT to do

- Don't suggest installing via `npm install -g` or `pnpm add -g`. The CLI is distributed as a self-contained binary; npm publication is not the supported path.
- Don't pass credentials on the command line. `auth onelap` reads from stdin precisely so they don't end up in shell history.
- Don't run `auth strava` without confirming the user is at the machine — it requires browser interaction.
- Don't recommend deleting `creds.enc` to "fix" issues. It will lose all stored tokens silently.
