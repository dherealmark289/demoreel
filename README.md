# DemoReel by Maragakis AI

**Paste a URL → get a polished scroll-through MP4 video. Automated. No install required.**

Like Screen.studio ($29/mo) but web-based, self-hosted, and free.

---

## Features

- 🎬 Playwright-powered scroll recording
- ✨ Glowing custom cursor overlay
- 📐 4 viewport sizes (mobile / tablet / desktop / widescreen)
- ⚡ 4 scroll speeds (slow → blazing)
- 🎵 Optional background music (generated via ffmpeg lavfi)
- 🌙 Dark / light theme support
- ⏱ Duration caps: 10s / 15s / 30s / 60s
- 📥 In-browser preview + one-click MP4 download
- 🧹 Auto-cleanup of files older than 1 hour

---

## Local Development

```bash
cd demoreel
npm install
node server.js
# → http://localhost:3000
```

Requires: `node >=18`, `ffmpeg`, `playwright` chromium installed.

Install playwright browser if not already:
```bash
npx playwright install chromium
```

---

## Deploy to Railway

### Option A: Railway Dashboard (easiest)
1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select the repo → Railway auto-detects the Dockerfile
4. Set env vars if needed (PORT is auto-set by Railway)
5. Done — your public URL will be something like `demoreel.up.railway.app`

### Option B: Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### Railway Resource Notes
- Recording is CPU/memory intensive — use at least the Hobby plan ($5/mo)
- Each recording job uses ~500MB RAM temporarily
- Videos are stored in `/tmp` and cleaned up after 1 hour
- For production use, consider adding a persistent volume or R2/S3 for storage

---

## API

### POST /api/record
```json
{
  "url": "https://example.com",
  "speed": "medium",        // slow|medium|fast|blazing
  "viewport": "desktop",    // mobile|tablet|desktop|widescreen
  "theme": "dark",          // dark|light
  "cursor": true,           // glowing cursor overlay
  "duration": 30,           // max seconds: 10|15|30|60
  "music": false            // add generated background music
}
```
Returns: `{ "id": "uuid", "status": "recording" }`

### GET /api/status/:id
Returns: `{ "id", "status", "progress", "error", "downloadUrl" }`

### GET /api/download/:id
Streams the MP4 file.

### GET /api/health
Returns: `{ "ok": true, "jobs": N }`

---

## File Structure

```
demoreel/
├── server.js      Express API + job management
├── recorder.js    Playwright scroll recorder + ffmpeg encoder
├── public/
│   └── index.html Frontend SPA (dark UI, pill options, preview)
├── Dockerfile     Production container
├── railway.json   Railway deploy config
├── package.json
└── .gitignore
```
