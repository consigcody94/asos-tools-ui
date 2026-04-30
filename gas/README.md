# OWL — Google Apps Script Back-End (5-Minute Setup)

A redundant copy of the OWL operations brain that runs on Google's
infrastructure. If the Proxmox LXC, Cloudflare tunnel, or Next.js app
goes dark, this script keeps watching the ASOS network, NDBC buoys,
AWC hazards, and NHC storms — writing everything into a Google Sheet
and emailing an AI-generated shift-change brief on a schedule.

**One file. No GCP project. No service accounts. No libraries.**

---

## What you get

| Function     | Cadence  | What it writes                                  |
|--------------|----------|-------------------------------------------------|
| `runScan`    | 5 min    | `Stations` sheet — per-station status row       |
| `runBuoys`   | 15 min   | `Buoys` sheet — latest NDBC obs                 |
| `runHazards` | 10 min   | `Hazards` sheet — SIGMETs, NHC storms, SWPC     |
| `runDigest`  | 4 hr     | Emails an AI brief to `BRIEF_RECIPIENTS`        |
| `rotateLogs` | daily    | Caps `History` sheet at 10 000 rows             |

Plus a JSON web-app endpoint that mirrors `/api/health`, `/api/scan`,
`/api/buoys`, `/api/hazards`, `/api/ai-brief` so any external monitor
can poll **either** the Next app or the Apps Script with no client-
side branching.

---

## Setup — click-by-click

### 1. Create the Sheet (30 sec)

1. Go to <https://sheets.new>.
2. Rename it **OWL Network Status**.
3. Leave the default tab named `Sheet1` — the script auto-creates the
   tabs it needs (`Stations`, `Buoys`, `Hazards`, `History`, `Health`,
   `Briefs`).

### 2. Open the bound Apps Script (15 sec)

1. In the Sheet: **Extensions → Apps Script**.
2. A new tab opens with `Code.gs` and a default `myFunction()` stub.
3. Delete everything in `Code.gs`.

### 3. Paste the OWL script (30 sec)

1. Open `gas/Code.gs` from this repo.
2. Copy the entire file.
3. Paste it into the Apps Script editor over the empty `Code.gs`.
4. Click the **disk** icon (or `⌘S` / `Ctrl-S`) to save.

### 4. Add the manifest (45 sec)

The manifest controls timezone, OAuth scopes, and the web-app
deployment behaviour. Without it, the script will work but the web-
app will refuse anonymous traffic.

1. In the Apps Script editor, click the **gear** icon (Project
   Settings) on the left rail.
2. Tick **"Show 'appsscript.json' manifest file in editor"**.
3. Go back to the **Editor** (the `< >` icon).
4. Open `appsscript.json` (now visible in the file list).
5. Replace its contents with `gas/appsscript.json` from this repo.
6. Save.

### 5. Set Script Properties (1 min)

Project Settings → **Script Properties** → **Add script property**.
Add these four:

| Key                | Example value                              |
|--------------------|--------------------------------------------|
| `OPENAI_API_KEY`   | `ollama_…` or `sk-…`                       |
| `OPENAI_BASE_URL`  | `https://ollama.com/v1`                    |
| `AI_BRIEF_MODEL`   | `glm-5.1` (or `gpt-4o-mini`, `llama3.1`…)  |
| `BRIEF_RECIPIENTS` | `you@example.com,ops@example.com`          |

Optional — only set if you want to deviate from defaults:

| Key             | Default                       | Notes                                |
|-----------------|-------------------------------|--------------------------------------|
| `ASOS_STATIONS` | 30-station shortlist (in code) | Comma-separated IDs to scan instead  |
| `OWL_CONTACT`   | `owl-monitor@example.com`     | Embedded in the NWS User-Agent       |
| `BRIEF_SUBJECT` | `OWL — Network Brief`         | Email subject prefix                 |

### 6. First run + authorisation (1 min)

1. In the Apps Script editor, choose function **`installTriggers`**
   from the dropdown next to the **Run** button.
2. Click **Run**.
3. Google asks you to authorise the script. Click **Review
   permissions** → pick your account → **Advanced** → **Go to OWL
   (unsafe)** → **Allow**. (The "unsafe" warning is the standard
   message for any non-Google-verified script — read what scopes
   you're granting in `appsscript.json`.)
4. After auth, `installTriggers()` runs — it removes any old
   triggers, installs the five fresh ones, and logs the schedule.
5. Open **Executions** (left rail clock icon) — you should see
   `installTriggers` succeeded. Within 5 minutes, `runScan` will
   appear too.

### 7. Verify the data is flowing (1 min)

1. Switch back to the Sheet tab.
2. Within ~5 min, the `Stations` tab fills with one row per scanned
   ASOS station.
3. Within ~15 min, `Buoys` fills.
4. Within ~10 min, `Hazards` fills.
5. The `Health` tab shows a single row that updates after every run
   — last scan time, station count, error counters.

If a tab stays empty after 20 minutes, open **Executions** in the
Apps Script editor and read the failed run's log — every error
includes the failing URL and HTTP status.

### 8. (Optional) Deploy as web-app for external monitors

If you want a public JSON endpoint that mirrors the Next API:

1. Apps Script editor → **Deploy → New deployment**.
2. Gear icon next to "Select type" → **Web app**.
3. Description: `OWL fallback API`
4. Execute as: **Me**
5. Who has access: **Anyone with the link** (or "Anyone in your
   Workspace" if you want to keep it internal).
6. Click **Deploy**.
7. Copy the **Web app URL** that ends in `/exec`.

Test it:

```bash
URL="https://script.google.com/macros/s/AKfycb…/exec"
curl -s "$URL?path=health"   | jq .
curl -s "$URL?path=scan"     | jq '.counts'
curl -s "$URL?path=buoys"    | jq '.rows | length'
curl -s "$URL?path=hazards"  | jq '.rows | length'
curl -s "$URL?path=brief"    # AI brief on demand
```

The `/exec?path=…` shape mirrors `https://owl.example.com/api/<path>`
on the Next side, so a monitor can swap base URLs without touching
its query logic.

---

## Operating the back-end

### Run something on demand

In the Apps Script editor, pick the function from the dropdown and
click **Run**. Useful targets:

- `runScan` — force a scan immediately (writes to `Stations`).
- `runDigest` — sends the AI brief email right now.
- `showWebAppUrl` — prints the deployed `/exec` URL into the log so
  you don't have to re-open the Deploy panel.
- `removeTriggers` — strip every scheduled trigger (use this before
  re-running `installTriggers` if you suspect doubles).

### Adjust the cadence

Edit the constants at the top of `Code.gs`:

```js
var CADENCE_SCAN_MIN    = 5;
var CADENCE_BUOYS_MIN   = 15;
var CADENCE_HAZARDS_MIN = 10;
var CADENCE_DIGEST_HRS  = 4;
```

Save → re-run `installTriggers()`. Old triggers are wiped and the new
schedule replaces them.

### Switch the AI model

Change `AI_BRIEF_MODEL` in Script Properties. The script speaks the
OpenAI-compatible chat-completions API — so anything Ollama Cloud,
OpenAI, Anthropic-via-OpenAI-shim, or a local Ollama exposes will
work.

### Reduce or expand the station list

Set `ASOS_STATIONS` in Script Properties to a comma-separated list of
ICAO IDs (e.g. `KJFK,KLGA,KEWR,KBOS,KDCA`). Leave unset for the
built-in 30-station shortlist. The full ASOS network (~900 stations)
won't fit into a single Apps Script run — that's why the default is
a curated list.

---

## Why Apps Script as the redundancy layer

The Proxmox stack has eight moving pieces: Caddy, Authelia, Postgres,
Redis, Cloudflare Tunnel, systemd, Next.js, and the auto-puller. Any
one of them failing takes the user-facing app down. Apps Script has
one moving piece (Google) and a 99.9 % SLA, so the second source of
truth lives somewhere structurally independent of the first.

It also runs without the user holding the Mac open or a build
environment — push to main and the LXC auto-pulls, but if the LXC
is unreachable, the Sheet keeps writing rows.

---

## Troubleshooting

**"Authorization is required to perform that action."**
You skipped step 6. Re-run `installTriggers` and complete the OAuth
consent.

**`runScan` runs but `Stations` is empty.**
Open Executions, click the failed run, read the logged HTTP status.
The most common cause is `OPENAI_API_KEY` being unset *and* the
script bailing out early because the key is checked at the top of
`runDigest`. Scans don't need the key, so this should not block
them — but a half-set Properties record can confuse it. Re-add all
four properties and run again.

**Web-app `/exec?path=scan` returns "Authorization required".**
Re-deploy the web-app with **Anyone with the link** access (step 8
sub-step 5). Apps Script silently restricts new deployments to "Only
me" if you click through too fast.

**The brief email never arrives.**
Check `BRIEF_RECIPIENTS` is comma-separated with no spaces, then run
`runDigest` manually. The `Briefs` sheet logs every send (or
attempt) — if it's empty there, the trigger never fired; if it has
rows but you never got mail, check spam.

**`runScan` hits the 6-minute timeout.**
Reduce `ASOS_STATIONS` to fewer than 100 IDs, or lower
`CADENCE_SCAN_MIN` *won't help* — it's per-run cap, not a per-day
cap. The shortlist exists exactly because of this limit.

---

## File map

```
gas/
├── Code.gs            single-file back-end (~700 lines)
├── appsscript.json    manifest: timezone, scopes, web-app config
└── README.md          this file
```

Everything else (sheet schemas, trigger specifics, OpenAI request
shape) is documented inline in `Code.gs`.
