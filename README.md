# Clip Generator (private fork of OpenShorts)

Turns a long video (upload or YouTube URL) into vertical 9:16 clips: transcribes it, has
Gemini pick the strongest 15–60s moments, cuts them, reframes to follow the speaker,
burns animated karaoke-style subtitles, and adds subtle zooms/pans plus an AI-written
hook line — then serves the finished clips for download.

This is a **private, single-user, self-hosted** tool. It is a reduced fork of
[mutonby/openshorts](https://github.com/mutonby/openshorts) (MIT) — see
[CLAUDE.md](CLAUDE.md) for the full spec this fork was built against.

## What changed vs. upstream OpenShorts

Upstream is a 3-in-1 SaaS platform (Clip Generator + AI Shorts UGC actors + YouTube
Studio) with multi-user auth, billing and a hosted/self-hosted BYOK split. This fork
keeps **only the Clip Generator** and strips the rest:

- **Removed**: `cloud/` (multi-user auth, billing, managed API keys), AI Shorts /
  UGC actor generation (`saasshorts.py`), YouTube Studio thumbnails/titles
  (`thumbnail.py`), video dubbing via ElevenLabs (`translate.py`), the MCP agent
  server, S3-backed storage/gallery (`s3_uploader.py`), and social auto-publishing
  (`/api/social/*`). None of these are needed for a private single-user tool, and
  `AWS_S3_*` / ElevenLabs / fal.ai / Upload-Post integrations are explicitly out of
  scope per `CLAUDE.md`.
- **Security**: `GEMINI_API_KEY` now lives **only** in the server's `.env`. Upstream's
  self-host mode lets the browser paste a key into `localStorage` and send it via an
  `X-Gemini-Key` header (BYOK); that whole flow is gone. The frontend only ever asks
  the server "is a key configured?" (`geminiConfigured` in `/api/config`) and shows a
  read-only status — there is no way to set a key from the browser.
- **Storage**: all clips and intermediate files live on local disk; nothing is
  uploaded to S3. A retention sweep (`CLEANUP_RETENTION_HOURS`, default 48h) deletes
  the original source, intermediate audio, and finished job directories on a timer —
  see `cleanup_jobs()` and `CLEANUP_RETENTION_HOURS` in `app.py`.
- **Kept as-is**: the actual clip pipeline (`yt-dlp` → `faster-whisper` →
  `PySceneDetect` → Gemini moment detection → `FFmpeg` cut → MediaPipe/YOLOv8 vertical
  reframing) and, notably, the **Remotion-based `render-service`** for burning
  animated captions, zooms/pans and hook text. `CLAUDE.md` originally described plain
  FFmpeg+libass for this; upstream actually implements it with a dedicated Remotion
  renderer, and this fork deliberately kept that instead of rewriting it — it's a
  working, more capable implementation of the same requirement.
- **Deployment**: added `docker-compose.prod.yml`, a `Caddyfile` (HTTPS via Let's
  Encrypt + HTTP basic auth), and `DEPLOY.md` for a Contabo VPS — none of that existed
  upstream in this form.

## Architecture

Four containers in production (`docker-compose.prod.yml`):

```
Caddy (:80/:443, basic auth) ──/api,/videos,/thumbnails,/health──▶ backend (FastAPI)
                              └──everything else───────────────▶ frontend (nginx, static SPA build)
backend ──HTTP──▶ renderer (Remotion, subtitles/hook/effects rendering)
```

Locally in dev (`docker-compose.yml`) it's the same three app services without Caddy,
with the frontend running Vite's dev server (HMR) instead of a static nginx build.

## Run it locally

Requirements: Docker + Docker Compose. A [Gemini API key](https://aistudio.google.com/app/apikey).

```bash
cp .env.example .env
# edit .env — at minimum set GEMINI_API_KEY
docker compose up --build
```

- Frontend (dev, hot reload): http://localhost:5175
- Backend API: http://localhost:8000 (docs at `/docs`)
- Renderer: http://localhost:3100

First build downloads the Whisper/YOLO models and installs the full ML stack
(torch, mediapipe, ultralytics) — expect several minutes on the first run.

## Structure (what's left after the strip)

```
app.py, main.py            FastAPI app + pipeline entrypoint (Clip Generator only)
clip_selection.py, gemini_worker.py, transcribe_backends.py, reframe_v2.py,
subtitles.py, hooks.py, ...   pipeline stages
dashboard/                  React + Vite frontend (SPA, no marketing/pricing pages)
render-service/, remotion/  Remotion-based subtitle/effects renderer
cli/                        Standalone CLI client for the API
tests/                      pytest suite (billing/AI-Shorts/MCP-only tests removed)
Caddyfile, caddy/           Reverse proxy: TLS + basic auth
docker-compose.yml          Local dev stack
docker-compose.prod.yml     VPS production stack
DEPLOY.md                   Step-by-step Contabo VPS deployment guide
```

## Tests

```bash
pip install -r requirements.txt
pytest
```

## Deploying

See [DEPLOY.md](DEPLOY.md) for the full walkthrough (Contabo VPS, Docker install,
Caddy/HTTPS, basic auth, going live on `youtube.omarpumariega.com`).

## Phase 2 (not implemented, architecturally left open)

Per `CLAUDE.md`, these are intentionally **not** built yet, but nothing here should
need rewriting to add them later:

- **Scheduled social publishing** — upstream's `/api/social/*` routes and the
  Upload-Post integration were removed rather than adapted; re-adding a publish step
  would plug into the same point where a finished job's clips become available
  (`jobs[job_id]['result']` in `app.py`), as a new optional post-processing stage.
- **Background music / audio ducking** and **b-roll/stock insertion** — would slot
  into the existing edit/effects pipeline (`edit_builder.py`, `/api/effects/generate`)
  as additional layers alongside the current subtitles/hook/zoom layers.
- **Multi-user / client management** — deliberately not re-added; this is a
  single-operator tool protected by Caddy basic auth, not an app-level login system.
