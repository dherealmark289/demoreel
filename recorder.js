/**
 * recorder.js — Playwright-based website scroll recorder
 * Mirrors the proven approach from record_v5.py / record_v6.py
 */

const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Viewport presets
const VIEWPORTS = {
  mobile:     { width: 375,  height: 667  },
  tablet:     { width: 768,  height: 1024 },
  desktop:    { width: 1280, height: 720  },
  widescreen: { width: 1920, height: 1080 },
};

// Scroll speed presets: [step px, delay ms]
const SPEEDS = {
  slow:    { step: 8,  delay: 20  },
  medium:  { step: 18, delay: 12  },
  fast:    { step: 35, delay: 5   },
  blazing: { step: 60, delay: 3   },
};

// Duration caps in seconds
const DURATION_CAPS = { 10: 10, 15: 15, 30: 30, 60: 60 };

/**
 * Main record function
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} opts.speed        slow|medium|fast|blazing
 * @param {string} opts.viewport     mobile|tablet|desktop|widescreen
 * @param {string} opts.theme        light|dark
 * @param {boolean} opts.cursor      show glowing cursor
 * @param {number}  opts.duration    cap in seconds
 * @param {boolean} opts.music       add music overlay
 * @param {string}  opts.outputPath  final MP4 path
 * @param {function} opts.onProgress optional progress callback (message)
 */
async function record(opts) {
  const {
    url,
    speed = 'medium',
    viewport = 'desktop',
    theme = 'dark',
    cursor = true,
    duration = 30,
    music = false,
    outputPath,
    onProgress = () => {},
  } = opts;

  const vp = VIEWPORTS[viewport] || VIEWPORTS.desktop;
  const scrollOpts = SPEEDS[speed] || SPEEDS.medium;
  const durationCap = DURATION_CAPS[duration] || 30;

  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'demoreel-'));
  onProgress('Launching browser...');

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 1,
      colorScheme: theme === 'dark' ? 'dark' : 'light',
      recordVideo: {
        dir: tmpdir,
        size: vp,
      },
    });

    const page = await context.newPage();

    // Inject scrollbar hide + optional glowing cursor
    await page.addInitScript(`
      (() => {
        const style = document.createElement('style');
        style.textContent = \`
          ::-webkit-scrollbar { display: none !important; }
          * { scrollbar-width: none !important; ${cursor ? 'cursor: none !important;' : ''} }
        \`;
        document.head.appendChild(style);
        ${cursor ? `
        const cur = document.createElement('div');
        cur.id = 'demoreel-cursor';
        cur.style.cssText = \`
          position: fixed; z-index: 2147483647; pointer-events: none;
          width: 26px; height: 26px; border-radius: 50%;
          background: rgba(255,255,255,0.93);
          border: 3px solid rgba(0,150,255,0.85);
          box-shadow: 0 0 14px rgba(0,150,255,0.6), 0 0 28px rgba(0,150,255,0.3);
          transform: translate(-50%, -50%);
          transition: left 0.04s linear, top 0.04s linear;
        \`;
        document.addEventListener('DOMContentLoaded', () => document.body.appendChild(cur));
        document.addEventListener('mousemove', e => {
          cur.style.left = e.clientX + 'px';
          cur.style.top = e.clientY + 'px';
        });
        ` : ''}
      })();
    `);

    onProgress('Loading page...');
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);

    // Get page scroll height
    const scrollInfo = await page.evaluate(() => {
      return {
        scrollHeight: document.body.scrollHeight,
        clientHeight: window.innerHeight,
        centerX: window.innerWidth / 2,
        centerY: window.innerHeight / 2,
      };
    });

    const totalScroll = Math.max(scrollInfo.scrollHeight - scrollInfo.clientHeight, 0);
    onProgress(`Scrolling ${totalScroll}px...`);

    // Move cursor to center area
    if (cursor) {
      await page.mouse.move(scrollInfo.centerX, scrollInfo.centerY);
      await page.waitForTimeout(200);
    }

    // Calculate if we need to cap scrolling by duration
    // Estimate frames: durationCap * 30fps, each step takes ~delay ms
    const stepsNeeded = totalScroll / scrollOpts.step;
    const estimatedMs = stepsNeeded * scrollOpts.delay;
    const capMs = durationCap * 1000 - 2000; // leave 2s for load/settle
    const scaleFactor = estimatedMs > capMs ? capMs / estimatedMs : 1;
    const effectiveDelay = Math.max(scrollOpts.delay * scaleFactor, 1);

    // Smooth scroll loop
    let current = 0;
    const { step } = scrollOpts;

    while (current < totalScroll) {
      current = Math.min(current + step, totalScroll);
      await page.evaluate((scrollY) => window.scrollTo({ top: scrollY }), current);

      if (cursor) {
        const jitterX = scrollInfo.centerX + (current % 24) - 12;
        const jitterY = scrollInfo.centerY + (current % 32) - 16;
        await page.mouse.move(jitterX, jitterY);
      }

      await page.waitForTimeout(effectiveDelay);
    }

    // Pause at bottom
    await page.waitForTimeout(800);

    await context.close();
    await browser.close();
    browser = null;

    // Find the webm file
    const files = fs.readdirSync(tmpdir).filter(f => f.endsWith('.webm'));
    if (!files.length) throw new Error('No video file recorded');

    const rawVideo = path.join(tmpdir, files[0]);

    // Get duration
    const rawDur = parseFloat(
      execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${rawVideo}"`).toString().trim()
    );
    onProgress(`Encoding (raw: ${rawDur.toFixed(1)}s)...`);

    // Post-process with ffmpeg
    await ffmpegProcess({ rawVideo, outputPath, rawDur, durationCap, music, vp, onProgress });

    onProgress('Done!');
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    // Cleanup tmpdir after small delay
    setTimeout(() => {
      try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch {}
    }, 5000);
  }
}

/**
 * ffmpeg post-processing: trim, speed, music, encode
 */
function ffmpegProcess({ rawVideo, outputPath, rawDur, durationCap, music, vp, onProgress }) {
  return new Promise((resolve, reject) => {
    // Calculate playback speed to fit within durationCap
    const speed = rawDur > durationCap ? rawDur / durationCap : 1.0;
    const outDur = rawDur / speed;
    const fadeOutV = Math.max(outDur - 0.8, 1);
    const fadeOutA = Math.max(outDur - 1.0, 1);

    let filterComplex, inputArgs;

    if (music) {
      // Generate upbeat sine-wave music with ffmpeg lavfi
      // Two-tone synth: bass + melody layers
      const musicFilter = [
        // Bass pulse: 80Hz sine, pulsing at 2Hz rate
        `sine=frequency=80:sample_rate=44100,volume=0.4[bass]`,
        // Mid tone: 320Hz
        `sine=frequency=320:sample_rate=44100,volume=0.25[mid]`,
        // High sparkle: 640Hz
        `sine=frequency=640:sample_rate=44100,volume=0.15[hi]`,
        `[bass][mid]amix=inputs=2[bm]`,
        `[bm][hi]amix=inputs=2,atrim=0:${outDur + 1},afade=t=in:d=0.3,afade=t=out:st=${fadeOutA}:d=0.8[music]`,
      ].join(';');

      filterComplex =
        `[0:v]setpts=PTS/${speed},fade=t=in:st=0:d=0.2,fade=t=out:st=${fadeOutV}:d=0.6[v];` +
        musicFilter + `;` +
        `[v][music]`;

      inputArgs = [
        '-i', rawVideo,
        '-f', 'lavfi', '-i', `sine=frequency=80:sample_rate=44100`,
      ];
    } else {
      filterComplex =
        `[0:v]setpts=PTS/${speed},fade=t=in:st=0:d=0.2,fade=t=out:st=${fadeOutV}:d=0.6[v]`;

      inputArgs = ['-i', rawVideo];
    }

    const args = music
      ? [
          '-y',
          ...inputArgs,
          '-filter_complex', filterComplex,
          '-map', '[v]', '-map', '[music]',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
          '-pix_fmt', 'yuv420p', '-r', '30',
          '-c:a', 'aac', '-b:a', '128k',
          '-t', String(outDur + 0.5),
          '-movflags', '+faststart',
          outputPath,
        ]
      : [
          '-y',
          '-i', rawVideo,
          '-filter_complex', filterComplex,
          '-map', '[v]',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
          '-pix_fmt', 'yuv420p', '-r', '30',
          '-an',
          '-t', String(outDur + 0.5),
          '-movflags', '+faststart',
          outputPath,
        ];

    onProgress('Running ffmpeg...');
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-500)}`));
      } else {
        resolve();
      }
    });
  });
}

module.exports = { record };
