# Deploying to Hugging Face Spaces (Docker SDK)

This Next.js NOC app runs as-is on a HuggingFace Docker Space. ~$0/mo,
no Azure/AWS/Vercel needed, public URL out of the box.

## What HF gives you for free

- 2 vCPU, 16 GB RAM container (way more than this app needs)
- Always-warm runtime (no cold starts on Docker Spaces)
- Public HTTPS endpoint at `https://<user>-<space-name>.hf.space`
- Auto-rebuild on every git push to the Space's git remote
- 50 GB image quota
- Optional `/data` persistent volume ($5/mo, optional — not needed for this app)

## Setup (≈3 minutes, one time)

### 1. Create the Space

Go to <https://huggingface.co/new-space> and fill in:

| Field | Value |
|---|---|
| Name | `owl-noc` (or whatever) |
| License | MIT |
| Space SDK | **Docker** (not Streamlit / Gradio) |
| Hardware | CPU basic (free) |
| Visibility | Public |

After creation you land on the empty Space. Note the URL pattern —
e.g. `https://huggingface.co/spaces/consgicody/owl-noc`.

### 2. Get a write token

- <https://huggingface.co/settings/tokens> → **New token**
- Type: **Write**
- Copy the value. You'll paste it as the password when git prompts.

### 3. Add the HF Space as a git remote and push

```bash
cd /path/to/asos-tools-ui

git remote add hf https://huggingface.co/spaces/<your-user>/owl-noc

# First push — will prompt for username (your HF username) + password (the
# write token from step 2).
git push hf main
```

That's it. HF detects the Dockerfile, builds the image, and within a few
minutes you'll see "App is running" on the Space. The live URL is
`https://<your-user>-owl-noc.hf.space`.

## How the Space knows what to do

The repo's [`README.md`](README.md) starts with a YAML frontmatter that
HuggingFace parses to configure the Space:

```yaml
---
title: OWL — Observation Watch Log
emoji: 🦉
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 3000
pinned: true
license: mit
---
```

Key fields:
- `sdk: docker` — tells HF to build the `Dockerfile`
- `app_port: 3000` — the port `next start` (via `server.js`) listens on

Nothing else is needed. No `Procfile`, no `app.py`, no shimming.

## Optional Space environment variables

Set these under **Settings → Variables and secrets** on the Space page.
All are optional; the app degrades cleanly when any is absent.

| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Public origin used by server-component absolute fetches. Set to `https://<your-user>-<space>.hf.space` after creation. |
| `FAA_NOTAM_CLIENT_ID` | Enables per-station NOTAM correlation (free FAA developer account). |
| `FAA_NOTAM_CLIENT_SECRET` | Paired with the above. |
| `OPENAI_API_KEY` *(or `ANTHROPIC_API_KEY`)* | Enables the AI Brief endpoint. Without a key, the button is disabled but the rest of the app works. |
| `IEM_API_BASE` | Override the IEM endpoint for testing. |
| `AWC_API_BASE` | Override the AWC endpoint for testing. |

## Future pushes

```bash
git push hf main
```

That's it. HF rebuilds the image automatically; the live URL stays the
same. Build takes ~3-5 min; the previous revision keeps serving until the
new one is ready.

## Why not just use Streamlit on HF?

The existing `consgicody/asos-tools` Streamlit Space is the *reference
implementation*. The Next.js app is a separate, more advanced build:
real-time globe, command palette (⌘K), per-station METAR decoder,
satellite imagery aggregator (NASA GIBS / Sentinel-2 / Landsat), and
proper rate-limited fetching across 13 upstream feeds. Both can coexist
on different HF Spaces.

## Cost comparison (vs. previously on Azure Container Apps)

| Resource | HF Space | Azure ACA |
|---|---|---|
| Compute | $0/mo | ~$5–20/mo (with min replicas = 1) |
| Container Registry | $0 (HF builds in-place) | $5/mo (Basic ACR) |
| Public HTTPS | included | included |
| Custom domain | not on free tier | requires Front Door (~$35/mo) |
| WAF | basic CDN-level only | Front Door Premium (extra) |
| **Net** | **$0/mo** | **~$10–60/mo** depending on tier |

For a public read-only NOC dashboard, HF wins on every dimension that
matters here.
