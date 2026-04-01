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
 * @param {object} opts
 * @param {string} opts.screenRecordingUrl - URL to the screen recording (mp4/webm)
 * @param {string} opts.voiceoverUrl - URL to the voiceover audio (mp3)
 * @param {string} opts.script - full narration script text
 * @param {Array}  opts.sections - [{text, scrollPercent}] for caption timing
 * @param {number} opts.duration - total duration in seconds
 * @param {string} opts.title - product/feature title for intro card
 * @param {string} opts.outputFormat - 'mp4' (default)
 */
async function assembleDemo({ screenRecordingUrl, voiceoverUrl, script, sections = [], duration = 30, title = '', outputFormat = 'mp4' }) {
  const tracks = [];

  // Track 1: Screen Recording (video)
  const videoClip = {
    asset: {
      type: 'video',
      src: screenRecordingUrl,
      volume: 0,
    },
    start: title ? 2 : 0,
    length: duration,
    fit: 'contain',
  };

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

  // Track 4: Caption clips (one per section)
  if (sections && sections.length > 0) {
    const totalDur = duration;
    const captionClips = sections.map((section, i) => {
      const sectionStart = (section.scrollPercent / 100) * totalDur;
      const nextSection = sections[i + 1];
      const nextStart = nextSection ? (nextSection.scrollPercent / 100) * totalDur : totalDur;
      const sectionDur = Math.max(1, nextStart - sectionStart);

      return {
        asset: {
          type: 'title',
          text: section.text,
          style: 'subtitle',
          color: '#ffffff',
          size: 'small',
          position: 'bottomCenter',
          background: 'rgba(0,0,0,0.6)',
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

  const totalDuration = duration + (title ? 2 : 0);

  const timeline = {
    background: '#000000',
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
