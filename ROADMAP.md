# DemoReel v2 — Feature Roadmap

## Competitive Analysis Summary

### Competitors Reverse-Engineered

| Tool | Price | Key Features We Should Clone | Our Advantage |
|------|-------|------------------------------|---------------|
| **Screen.studio** | $29/mo | Auto-zoom on clicks, smooth cursor, cursor size adjustment, motion blur, backgrounds/branding, speed adjustment, webcam overlay | Web-based (no install), free tier, API-first |
| **Arcade.software** | $40+/mo | Interactive demos, AI voiceover, branching flows, collections, hotspots/callouts, embed anywhere, analytics | Simpler UX, open-source option, no vendor lock-in |
| **Tella** | $29/mo | Clip-based recording, speaker notes, AI filler-word removal, transitions, zoom effects, backgrounds, transcript editing | Automated (no manual recording needed) |
| **Supademo** | $27+/mo | AI voiceover (multilingual), text captions, translations, branching, interactive elements | URL → video is unique, faster workflow |
| **Storylane** | $40+/mo | AI Creation Suite, HTML editing, personalization, lead forms, Salesforce integration | No-code, instant results |
| **Navattic** | $40+/mo | AI voiceover, AI avatars, avatar cloning, HTML demos | Simpler, faster, cheaper |

---

## Feature Tiers

### 🟢 Tier 1 — Quick Wins (v2.0, ship this week)
*Low effort, high impact. Can implement with existing tech stack.*

1. **AI Script Generator**
   - User enters URL + topic/purpose → Gemini generates a voiceover script
   - "Describe what this product does in 30 seconds"
   - Script editor with sections matching scroll positions
   - **Implementation:** Gemini Flash API (free tier), textarea with section markers

2. **ElevenLabs Voiceover**
   - Convert script → professional voiceover audio
   - Voice picker (5-10 preset voices)
   - Auto-sync voiceover with scroll speed
   - **Implementation:** ElevenLabs API, match audio duration to video, ffmpeg merge

3. **Music Library (Pre-loaded)**
   - 8-12 built-in background tracks by mood: upbeat, cinematic, chill, corporate, dramatic, playful
   - Volume slider for music vs voiceover balance
   - **Implementation:** Generate with Suno or source royalty-free, bundle as MP3s, ffmpeg mix

4. **Auto-Zoom on Key Sections**
   - Detect headings, hero sections, CTAs → auto-zoom during scroll
   - Smooth Ken Burns zoom effect via CSS transform recording
   - **Implementation:** DOM analysis → inject CSS transforms at key scroll positions

5. **Branding/Watermark**
   - Add logo overlay (corner watermark)
   - Custom background color behind the browser frame
   - "Powered by DemoReel" badge (removable on paid tier)
   - **Implementation:** ffmpeg overlay filter

6. **Click Interaction Recording**
   - Click on specific elements during the scroll (tabs, dropdowns, modals)
   - User defines click targets in the UI
   - **Implementation:** Already have `--click` support, just need UI

### 🟡 Tier 2 — Differentiators (v2.5, next 2 weeks)
*Medium effort, creates real competitive moat.*

7. **Smart Scroll Detection**
   - Auto-detect inner scrollable containers (like we did with wiz-visuals-list)
   - Detect tabs/navigation → record each tab separately → stitch
   - Auto-detect and skip empty sections, cookie banners, popups
   - **Implementation:** DOM analysis script, enhanced recorder.js

8. **Scene-Based Editor (MaragakisAI-inspired)**
   - After recording, show timeline with scene thumbnails
   - Drag to reorder, trim, delete scenes
   - Add text overlays per scene
   - **Implementation:** ffmpeg scene detection, simple timeline UI, canvas-based editor

9. **Multiple Export Formats**
   - MP4 (default), GIF (short clips), WebM
   - Aspect ratios: 16:9, 9:16 (Reels/TikTok), 1:1 (Instagram)
   - Resolution: 720p, 1080p, 4K
   - **Implementation:** ffmpeg encoding presets

10. **Template Gallery**
    - Pre-built recording templates for common use cases:
      - Product demo (scroll + zoom on features)
      - Landing page showcase (full-page scroll)
      - App walkthrough (click through tabs)
      - Social media teaser (fast scroll, music, 15s)
    - **Implementation:** Saved config presets in DB/JSON

11. **AI Music via External APIs**
    - **Loudly API** — AI-generated music, free tier with API key
    - **Mubert API** — Infinite AI soundtracks per mood/genre
    - **SOUNDRAW API** — Royalty-free AI music
    - Let user pick mood → generate custom track → overlay
    - **Implementation:** API integration, mood selector UI

12. **Webcam Bubble Overlay**
    - Record webcam circle in corner of the video
    - Or upload an avatar image
    - **Implementation:** Playwright can't do webcam, but can overlay a static avatar via ffmpeg

### 🔴 Tier 3 — Premium Features (v3.0, month 2)
*High effort, but this is where the money is.*

13. **Interactive Demo Mode (à la Arcade/Supademo)**
    - Output as an interactive HTML embed, not just video
    - Viewer can click through steps at their own pace
    - Hotspots, tooltips, guided tours
    - **Implementation:** Capture screenshots per scroll step → build interactive HTML viewer

14. **AI Narration with Avatar (à la Synthesia)**
    - AI-generated talking head presenting the demo
    - ElevenLabs voice + AI avatar lip sync
    - **Implementation:** HeyGen API or D-ID API for avatar, composite with ffmpeg

15. **Analytics Dashboard**
    - Track views, completions, drop-off points
    - Lead capture forms embedded in demos
    - **Implementation:** Simple analytics backend + dashboard page

16. **API & Embeds**
    - REST API for programmatic recording
    - Embeddable player widget for websites
    - Webhook on recording complete
    - **Implementation:** Express API already exists, add embed route + iframe code

17. **Batch Recording**
    - Upload CSV of URLs → batch process all → download zip
    - Useful for agencies recording multiple client sites
    - **Implementation:** Queue system, parallel workers

18. **Multi-Language Voiceover**
    - AI translate script → voiceover in 29+ languages
    - One recording → multiple language versions
    - **Implementation:** Gemini translate + ElevenLabs multilingual

---

## Audio Integration Plan

### Built-in Music Library (Tier 1)
Generate 12 tracks using Suno or source royalty-free:
| Mood | Style | Duration |
|------|-------|----------|
| Upbeat Tech | Electronic, energetic | 30s, 60s |
| Corporate Clean | Piano, light strings | 30s, 60s |
| Cinematic Reveal | Orchestral build | 30s, 60s |
| Chill Lo-fi | Mellow beats | 30s, 60s |
| Dramatic | Tension + resolve | 30s, 60s |
| Playful | Fun, bouncy | 30s, 60s |

### API Music (Tier 2)
Priority integration order:
1. **Loudly** — Free tier, AI generation, commercial license ✅
2. **Mubert** — Free render, infinite variety ✅
3. **SOUNDRAW** — Free generation, royalty-free ✅

### Voiceover Stack (Tier 1-2)
1. **ElevenLabs** — Primary TTS, high quality, we already have API key
2. **Gemini** — Script generation from URL content
3. Future: Voice cloning for brand consistency

---

## MaragakisAI-Inspired Flow

Take the best patterns from our video pipeline tool:

```
URL Input → AI Analysis → Script Generation → Voiceover → Recording → Assembly → Export
    ↓            ↓              ↓                ↓            ↓           ↓          ↓
 Paste URL   Gemini scans   AI writes       ElevenLabs   Playwright   ffmpeg     MP4/GIF
             page content   narration       generates     scrolls &   merges     download
             & structure    per section     audio         captures    all layers
```

### Key UX Elements to Borrow:
- **Wizard-style flow** (Topic → Script → Visuals → Voice → Review)
- **Scene-by-scene preview** before final render
- **Cost calculator** showing estimated API cost per video
- **Profit calculator** (for agencies: "Record 100 client demos → charge $X each")
- **Style presets** (Clean, Dark, Neon, Minimal, Corporate)

---

## Monetization Strategy

| Tier | Price | Limits |
|------|-------|--------|
| Free | $0 | 3 recordings/mo, watermark, 30s max, no voiceover |
| Pro | $19/mo | Unlimited recordings, no watermark, 60s, voiceover, music |
| Agency | $49/mo | Everything + batch recording, API access, custom branding |
| API | $0.10/recording | Pay-as-you-go for developers |

---

## Implementation Priority (This Week)

1. ✅ AI Script Generator (Gemini Flash)
2. ✅ ElevenLabs Voiceover integration
3. ✅ 6-track built-in music library
4. ✅ Branding/watermark option
5. ✅ Updated UI with wizard flow
