# Deploying to the Contabo VPS

Target: Contabo Cloud VPS 6 (6 vCPU, 12GB RAM, 200GB SSD, no GPU), domain
`youtube.omarpumariega.com`. Everything runs CPU-only — no CUDA setup needed.

## 1. Point DNS at the VPS

Before anything else, create an **A record** for `youtube.omarpumariega.com` pointing
at the VPS's public IP, with your DNS provider. Caddy's automatic HTTPS (step 5) needs
this resolved *before* it can issue a Let's Encrypt certificate — give it a few
minutes to propagate.

## 2. SSH in and check what's already running

```bash
ssh <user>@<vps-ip>

# Confirm the OS (affects which Docker install command you use below)
cat /etc/os-release

# Ports already in use — 80/443 must be free (or handed off to Caddy) before
# this stack can bind them. Other projects on the box may already claim them.
sudo ss -tulpn
```

If something else is already bound to 80/443, either stop it, or put this stack's
Caddy behind that existing proxy instead (out of scope here — this guide assumes
Caddy owns 80/443 directly).

## 3. Install Docker + Compose (skip if already installed)

```bash
docker --version && docker compose version
```

If missing, on Debian/Ubuntu:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

(Docker Compose v2 ships as the `docker compose` plugin with the script above — no
separate install needed.)

## 4. Clone the repo and configure `.env`

```bash
sudo mkdir -p /opt/openshorts
sudo chown $USER:$USER /opt/openshorts
git clone https://github.com/OmarPumariega/openshorts.git /opt/openshorts
cd /opt/openshorts
git checkout clip-generator-only   # or whichever branch/tag you deploy from

cp .env.example .env
nano .env   # or vim/whatever's on the box
```

Fill in at minimum:

```
GEMINI_API_KEY=<your real key from https://aistudio.google.com/app/apikey>
MAX_CONCURRENT_JOBS=2
WHISPER_MODEL=small
CLEANUP_RETENTION_HOURS=48
BASIC_AUTH_USER=<pick a username>
BASIC_AUTH_PASSWORD=<pick a strong password>
DOMAIN=youtube.omarpumariega.com
```

`BASIC_AUTH_PASSWORD` stays **plain text** here — `caddy/docker-entrypoint.sh` hashes
it into bcrypt at container start, so Caddy never sees or stores the plaintext beyond
that. Don't commit `.env` (it's gitignored) or paste real values into `Caddyfile`.

## 5. Bring the stack up

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First build is slow (torch/mediapipe/ultralytics + the YOLO model download) — expect
10–20+ minutes on a 6 vCPU box with no GPU. Subsequent builds are cached.

## 6. Verify

```bash
docker compose -f docker-compose.prod.yml ps
# all four services should show healthy/running

docker compose -f docker-compose.prod.yml logs caddy -f
# watch for a successful Let's Encrypt certificate issuance, no TLS errors

curl -I https://youtube.omarpumariega.com
# expect: HTTP/2 401  (basic auth challenge, unauthenticated)

curl -I -u "<BASIC_AUTH_USER>:<BASIC_AUTH_PASSWORD>" https://youtube.omarpumariega.com
# expect: HTTP/2 200
```

Then open `https://youtube.omarpumariega.com` in a browser, enter the basic-auth
credentials, and run a short test video end to end (upload or paste a YouTube URL)
to confirm the full pipeline — transcription, moment detection, reframing, subtitle
burn, hook — works on the VPS's real CPU-only hardware. Watch
`docker compose -f docker-compose.prod.yml logs backend -f` while it runs.

If a video takes uncomfortably long, that's a `WHISPER_MODEL` / `MAX_CONCURRENT_JOBS`
tuning question, not a bug — `small` is the safe default for 6 vCPU/no GPU; only try
`medium` after checking `docker stats` shows headroom during a real job.

## 7. Confirm cleanup is actually running

The retention sweep runs inside the `backend` container on a timer
(`CLEANUP_RETENTION_HOURS`, default 48h). To sanity-check it without waiting two
days: temporarily set `CLEANUP_RETENTION_HOURS=0` in `.env`, `docker compose -f
docker-compose.prod.yml up -d backend` to restart just that service, run a test job,
and confirm its files under `./output` and `./uploads` disappear on the next sweep
cycle. Set it back to `48` (or your preferred value) afterward and restart again.

## Updating a deployed instance

```bash
cd /opt/openshorts
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Rolling back

```bash
git log --oneline -5      # find the previous commit/tag
git checkout <previous-ref>
docker compose -f docker-compose.prod.yml up -d --build
```
