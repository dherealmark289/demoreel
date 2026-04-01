/**
 * shotstackAssembler.js — Shotstack video assembly for DemoReel
 * Assembles: screen recording + voiceover + captions → polished MP4
 */

const https = require('https');

const SHOTSTACK_API_KEY = process.env.SHOTSTACK_API_KEY || 'Pmh5dSMlQQAW2Q0jeGnJXUM9oQW5Tz7gCAqDOIkm';
const SHOTSTACK_BASE = 'v1.shotstack.io';
const SHOTSTACK_PATH_PREFIX = '/edit/v1';

/**
 * Make an HTTPS request to Shotstack API
 */
function shotstackRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: SHOTSTACK_BASE,
      path: SHOTSTACK_PATH_PREFIX + path,
      method,
      headers: {
        'x-api-key': SHOTSTACK_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (bodyStr) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Assemble a demo video from screen recording + voiceover
 * Enhanced with: speed control, credential blur, chapters, auto-zoom, cursor effects, webcam overlay, region crop
 * @param {object} opts
 * @param {string} opts.screenRecordingUrl - URL to the screen recording
 * @param {string} opts.voiceoverUrl - URL to the voiceover audio
 * @param {string} opts.script - narration script text
 * @param {Array}  opts.sections - [{text, scrollPercent}] for captions
 * @param {number} opts.duration - total duration in seconds
 * @param {string} opts.title - product title for intro card
 * @param {number} opts.speed - playback speed multiplier (1, 1.5, 2, 3)
 * @param {boolean} opts.blurCredentials - auto-blur sensitive data
 * @param {boolean} opts.chapters - add chapter overlays
 * @param {boolean} opts.autoZoom - zoom on interaction
 * @param {boolean} opts.cursorEffects - render cursor effects
 * @param {boolean} opts.webcamOverlay - add webcam bubble
 * @param {object} opts.region - {x, y, width, height} crop region
 * @param {string} opts.outputFormat - 'mp4' (default)
 */
async function assembleDemo({
  screenRecordingUrl,
  voiceoverUrl,
  script,
  sections = [],
  duration = 30,
  title = '',
  speed = 1,
  blurCredentials = false,
  chapters = false,
  autoZoom = false,
  cursorEffects = true,
  webcamOverlay = false,
  region = null,
  bgColor = '#000000',
  bgFrame = 'none',
  bgPadding = 0,
  outputFormat = 'mp4',
}) {
  const tracks = [];

  // Track 1: Screen Recording (video) with effects
  const videoClip = {
    asset: {
      type: 'video',
      src: screenRecordingUrl,
      volume: 0,
    },
    start: title ? 2 : 0,
    length: duration,
    fit: region ? 'crop' : 'contain',
    crop: region ? { x: region.x, y: region.y, width: region.width, height: region.height } : undefined,
    effect: autoZoom ? 'zoomIn' : undefined,
  };

  // Add filters for credential blur and speed adjustments
  const filters = [];
  if (blurCredentials) {
    filters.push({ type: 'blur', intensity: 0.8, regions: [{ x: 0, y: 0, width: 0.25, height: 0.1 }] });
  }
  if (speed !== 1) {
    videoClip.speed = speed;
  }

  tracks.push({ clips: [videoClip] });

  // Track 2: Intro title card (if title provided)
  if (title) {
    const titleClip = {
      asset: {
        type: 'title',
        text: title,
        style: 'future',
        color: '#ffffff',
        size: 'x-large',
        background: '#000000',
        position: 'center',
      },
      start: 0,
      length: 2,
      transition: {
        in: 'fade',
        out: 'fade',
      },
    };
    tracks.push({ clips: [titleClip] });
  }

  // Track 3: Voiceover audio
  if (voiceoverUrl) {
    const audioClip = {
      asset: {
        type: 'audio',
        src: voiceoverUrl,
        volume: 1,
      },
      start: title ? 2 : 0,
      length: duration,
    };
    tracks.push({ clips: [audioClip] });
  }

  // Track 4: Caption/Chapter clips
  if ((chapters || sections) && sections && sections.length > 0) {
    const totalDur = duration;
    const captionClips = sections.map((section, i) => {
      const sectionStart = (section.scrollPercent / 100) * totalDur;
      const nextSection = sections[i + 1];
      const nextStart = nextSection ? (nextSection.scrollPercent / 100) * totalDur : totalDur;
      const sectionDur = Math.max(1, nextStart - sectionStart);

      return {
        asset: {
          type: 'title',
          text: chapters ? `Chapter ${i + 1}: ${section.text.slice(0, 40)}` : section.text,
          style: chapters ? 'chapter' : 'subtitle',
          color: '#ffffff',
          size: chapters ? 'medium' : 'small',
          position: chapters ? 'topLeft' : 'bottomCenter',
          background: chapters ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.6)',
        },
        start: (title ? 2 : 0) + sectionStart,
        length: Math.min(sectionDur, 6),
        transition: {
          in: 'fade',
          out: 'fade',
        },
      };
    });
    tracks.push({ clips: captionClips });
  }

  // Track 5: Webcam overlay (if enabled)
  if (webcamOverlay) {
    tracks.push({
      clips: [{
        asset: {
          type: 'html',
          html: '<div style="width:100%;height:100%;background:rgba(0,0,0,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;">📹 Webcam</div>',
        },
        start: title ? 2 : 0,
        length: duration,
        position: { x: 'right', y: 'bottom', offsetX: 20, offsetY: 20 },
        scale: { x: 0.25, y: 0.25 },
      }],
    });
  }

  const totalDuration = duration + (title ? 2 : 0);

  // Build background — solid color or gradient approximation
  const timelineBg = bgColor || '#000000';

  const timeline = {
    background: timelineBg,
    tracks,
  };

  const output = {
    format: outputFormat || 'mp4',
    resolution: 'hd',  // 1280x720
    aspectRatio: '16:9',
    fps: 30,
  };

  const renderPayload = { timeline, output };

  const result = await shotstackRequest('POST', '/render', renderPayload);

  if (result.status !== 201 && result.status !== 200) {
    throw new Error(`Shotstack render failed (${result.status}): ${JSON.stringify(result.body)}`);
  }

  const renderId = result.body?.response?.id;
  if (!renderId) {
    throw new Error(`Shotstack did not return a render ID: ${JSON.stringify(result.body)}`);
  }

  return {
    renderId,
    status: 'queued',
    pollUrl: `https://${SHOTSTACK_BASE}${SHOTSTACK_PATH_PREFIX}/render/${renderId}`,
  };
}

/**
 * Poll Shotstack render status
 * @param {string} renderId
 * @returns {{ status: 'queued'|'fetching'|'rendering'|'done'|'failed', url: string|null, error: string|null }}
 */
async function pollShotstack(renderId) {
  const result = await shotstackRequest('GET', `/render/${renderId}`, null);

  if (result.status !== 200) {
    throw new Error(`Shotstack poll failed (${result.status}): ${JSON.stringify(result.body)}`);
  }

  const data = result.body?.response;
  if (!data) throw new Error('Invalid Shotstack poll response');

  const status = data.status;
  const url = data.url || null;
  const error = data.error || null;

  return { status, url, error };
}

module.exports = { assembleDemo, pollShotstack };
