# DemoReel v2 Roadmap

## ✅ v2.0 — Agent-First Demo Studio (Shipped)

### Core
- [x] **REST API** — full OpenAPI-documented endpoint set
- [x] **Job queue** — concurrent recording with status polling
- [x] **Smart scroll detection** — auto-detects inner scrollable containers
- [x] **Pre-recording interactions** — click, type, hover, wait, scroll-to
- [x] **Viewport presets** — mobile, tablet, desktop, widescreen, custom

### Wizard UI
- [x] 5-step wizard: URL → Style → Script → Music → Export
- [x] Template quick-select (product-demo, landing-page, social-teaser, app-walkthrough)
- [x] Live API hint code block
- [x] Localhost notice

### Music Library
- [x] **6 pre-generated tracks** via ffmpeg synthesis (no CDN deps)
  - upbeat-tech, corporate-clean, cinematic-reveal, chill-lofi, dramatic-tension, playful-bounce
- [x] In-browser preview player
- [x] Per-track volume control

### AI Integrations
- [x] **Gemini script generation** — fetch URL, analyze, write narration
- [x] **ElevenLabs voiceover** — 6 voice presets, multilingual v2
- [x] Script mode: auto | manual | none

### Privacy & Protection
- [x] **Privacy blur** — CSS selectors + auto-detect API keys/emails/passwords
- [x] **Invisible fingerprint** — unique per-render noise + metadata embed
- [x] **Visible watermark** badge (toggleable)
- [x] **Signature visual identity** — branded cursor, scroll easing, entry animation

### CLI Tool
- [x] `demoreel record <url>` — local Playwright mode
- [x] `demoreel record <url> --server <url>` — remote API mode
- [x] `demoreel script <url>` — AI script generation
- [x] `demoreel presets` — list all available presets
- [x] Template flags: `--template social-teaser`
- [x] Localhost / file:// / LAN URL support
- [x] `--blur` privacy flag, `--watermark`, `--fingerprint`
- [x] `npm install -g demoreel` compatible (`bin` in package.json)

---

## 🚧 v2.1 — Planned

### X/Twitter Integration
- [ ] `POST /api/post/twitter` — upload MP4 + post tweet with caption
- [ ] `demoreel record <url> --post-to twitter --caption "..."` 
- [ ] Schedule posts: `--schedule "2024-01-01T09:00:00Z"`
- [ ] Requires: TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET

### Export Enhancements
- [ ] 9:16 aspect ratio crop (for Reels/TikTok/Stories)
- [ ] GIF export (via ffmpeg palette)
- [ ] WebM output (already in API, needs ffmpeg path)
- [ ] 4K support

### Advanced Interactions
- [ ] Wait-for-selector interaction type
- [ ] Screenshot at specific scroll position
- [ ] Multi-page recording (follow links)

### Voiceover Sync
- [ ] Auto-sync voiceover to scroll speed
- [ ] Timed captions overlay (SRT burned in)

### Monetization Tiers
- [ ] **Free** — 3 recordings/mo, watermark, 720p
- [ ] **Pro** ($19/mo) — unlimited, voiceover, music, 1080p
- [ ] **Agency** ($49/mo) — batch API, custom branding, 4K, white-label

---

## 🔮 v3.0 — Future

- [ ] Loudly / Mubert API integration for AI-generated music
- [ ] AI scene detection (auto-zoom on interesting elements)
- [ ] Clip editor (trim, reorder scenes)
- [ ] Transcript editing (like Tella)
- [ ] Interactive walkthrough export (Supademo-style)
- [ ] Salesforce / HubSpot embed integration
- [ ] Batch recording queue (process 10 URLs at once)
- [ ] GitHub Actions integration for CI demo generation
