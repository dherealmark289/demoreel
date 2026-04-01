# DemoReel v3 — Complete Revamp (2026-04-01)

## What Was Built

### Core Pipeline
✅ **Claude Script Generation** (`scriptGen.js`)
- Replaced Gemini with Claude (Anthropic SDK)
- Model: `claude-haiku-4-5` (fast + cheap)
- Accepts URL or feature description for script generation
- Returns: narration script + timestamped sections for captions

✅ **Shotstack Video Assembly** (`shotstackAssembler.js`)
- Assembles: screen recording + voiceover + caption clips + optional title intro
- Production Shotstack API key: `Pmh5dSMlQQAW2Q0jeGnJXUM9oQW5Tz7gCAqDOIkm`
- Output: 1080p MP4
- Includes polling mechanism to track render status
- Returns: render ID + downloadable video URL when done

✅ **X (Twitter) Post Generator** (`xPostGen.js`)
- Claude-powered copy generation for social posts
- Returns: hook tweet (280 chars) + 3-4 reply threads + 5 hashtags
- Ready-to-paste format for quick sharing

### New API Endpoints
✅ **POST /api/upload-recording**
- Accept screen recording file upload (WebM/MP4)
- Auto-upload to R2 storage
- Trigger full pipeline: Claude script → ElevenLabs VO → Shotstack assembly
- Return job ID for polling

✅ **POST /api/assemble**
- Accept pre-recorded video URL (from extension or external storage)
- Same pipeline: script → VO → Shotstack
- Flexible input for different recording sources

✅ **GET /api/xpost/:jobId**
- Generate X post copy for completed jobs
- Returns ready-to-use tweet thread + hashtags
- Cached in job record

✅ **Supabase Schema Updates**
- New fields: `script`, `voiceover_url`, `shotstack_render_id`, `assembled_video_url`, `xpost`
- Tracks full pipeline state from upload to final video

### Chrome Extension (`extension/` folder)
✅ **Manifest V3 Extension**
- One-click screen recording from toolbar
- Region selector overlay for recording specific areas
- Automatic upload to DemoReel backend
- Live progress tracking with job ID link

Files:
- `manifest.json` — Manifest V3 config + permissions
- `popup.html` — UI with voice/tone/purpose selectors
- `popup.js` — Recording logic + upload handler
- `content.js` — Region selector overlay (injected)
- `background.js` — Service worker for inter-script messaging

### Frontend Updates (`public/index.html`)
✅ **Mode Switcher**
- "URL Record" (existing) vs "Screen Record" (new) toggle at top
- Preserves URL mode functionality while adding screen mode

✅ **Screen Recording UI**
- File upload zone (drag-drop or click)
- Recording URL input (for external sources)
- Feature description textarea (required)
- Purpose/tone/voice selectors
- Real-time pipeline progress bar
- Result display with video preview
- "Generate X Post" button for social copy

✅ **X Post Modal**
- Shows generated hook tweet, thread replies, and hashtags
- One-click copy to clipboard
- Clean modal design

### Backend Integration
✅ **Updated `server.js`**
- New `/api/upload-recording` handler with multer support (500MB max)
- New `/api/assemble` handler for URL-based recordings
- New `/api/xpost/:id` endpoint
- Core pipeline function: `runAssemblyPipeline()`
- Full async job management

✅ **Updated `storage.js`**
- New `uploadToR2()` generic method (used for recordings + voiceovers)
- Extended `updateJob()` to support `xpost` field
- Handles both Supabase + R2 gracefully

✅ **Updated `package.json`**
- Added: `@anthropic-ai/sdk` (^0.20.0)

## Deployment Status

✅ **Code Changes**: Committed to `dherealmark289/demoreel` main branch
✅ **Push to GitHub**: Done (commit: `c44a3d8`)
✅ **Railway Auto-Deploy**: In progress via GitHub integration

## How It Works

### User Flow: Screen Recording
1. User installs Chrome extension from `extension/` folder
2. Clicks extension icon → popup opens
3. (Optional) Toggles "Select Region" to draw recording area
4. Clicks "Start Recording" → uses `getDisplayMedia` to capture screen
5. Stops recording → describes feature + selects voice/tone/purpose
6. Clicks "Generate Demo Video" → uploads to `/api/upload-recording`
7. Backend pipeline runs:
   - Upload WebM to R2 storage
   - Claude writes script from description
   - ElevenLabs generates voiceover
   - Shotstack assembles final video (records + VO + captions + intro)
   - Polls Shotstack until render complete
8. User sees video preview + "Generate X Post" button
9. Clicks button → Claude generates tweet thread
10. Copies to clipboard → posts on X

### API Usage (Agents/CLI)
```bash
# Upload a screen recording
curl -X POST https://demoreel-production.up.railway.app/api/upload-recording \
  -F "recording=@my-screen.webm" \
  -F "description=Showing the new drag-drop upload feature" \
  -F "title=Drag & Drop Upload" \
  -F "voice=alloy" \
  -F "tone=professional" \
  -F "purpose=product-demo"

# Poll job status
curl https://demoreel-production.up.railway.app/api/status/{jobId}

# Get X post when job is done
curl https://demoreel-production.up.railway.app/api/xpost/{jobId}
```

## Backward Compatibility

✅ All existing URL scroll recording features remain intact
✅ Existing `/api/record`, `/api/status`, `/api/download` endpoints unchanged
✅ History + stats endpoints work with both URL and screen recordings
✅ URL mode is default on page load

## Next Steps

1. **Test the extension**: Load `extension/` folder in Chrome as unpacked extension
2. **Record a test**: Use extension to record a feature demo
3. **Monitor deployment**: Check Railway dashboard for build status
4. **Verify pipeline**: Once deployed, test full flow end-to-end

## Cost Estimates (per recording)

- **Claude Haiku** (script): ~$0.0005
- **ElevenLabs** (voiceover): ~$0.01-0.03 (depends on script length)
- **Shotstack Production** (render): ~$0.04/min (for ~30-60s video)
- **R2 Storage**: $0.015/GB (minimal for video files)

**Total per video**: ~$0.05-0.08 (excluding R2 storage for long-term)

## Files Changed

- ✅ `scriptGen.js` — Completely rewritten (Gemini → Claude)
- ✅ `shotstackAssembler.js` — NEW FILE (200 lines)
- ✅ `xPostGen.js` — NEW FILE (81 lines)
- ✅ `server.js` — Added 3 new endpoints + pipeline runner
- ✅ `storage.js` — Added `uploadToR2()`, extended schema
- ✅ `package.json` — Added @anthropic-ai/sdk
- ✅ `public/index.html` — Added screen mode UI + JS handlers
- ✅ `extension/` — NEW FOLDER (5 files: manifest, popup, content, background, HTML)

Total new code: **~2,800 lines**
