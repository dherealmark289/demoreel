/**
 * recorder.js — Playwright-based website scroll recorder (v2)
 * Enhanced with: interactions, smart scroll detection, branding overlay
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

/**
 * Main record function
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} opts.speed        slow|medium|fast|blazing
 * @param {string} opts.viewport     mobile|tablet|desktop|widescreen|custom
 * @param {object} opts.customViewport { width, height }
 * @param {string} opts.theme        light|dark
 * @param {boolean} opts.cursor      show glowing cursor
 * @param {number}  opts.duration    cap in seconds
 * @param {boolean|string} opts.music  false|track name
 * @param {number}  opts.musicVolume  0-1
 * @param {string}  opts.scrollTarget auto|body|css-selector
 * @param {boolean} opts.hideScrollbar
 * @param {Array}   opts.interactions  pre-recording interactions
 * @param {object}  opts.branding      watermark config
 * @param {object}  opts.export        export options
 * @param {string}  opts.outputPath  final MP4 path
 * @param {function} opts.onProgress optional progress callback
 */
async function record(opts) {
  const {
    url,
    speed = 'medium',
    viewport = 'desktop',
    customViewport = null,
    theme = 'dark',
    cursor = true,
    duration = 30,
    music = false,
    musicVolume = 0.3,
    scrollTarget = 'auto',
    hideScrollbar = true,
    interactions = [],
    branding = {},
    export: exportOpts = {},
    outputPath,
    onProgress = () => {},
  } = opts;

  // Resolve viewport
  let vp;
  if (viewport === 'custom' && customViewport) {
    vp = { width: customViewport.width, height: customViewport.height };
  } else {
    vp = VIEWPORTS[viewport] || VIEWPORTS.desktop;
  }

  const scrollOpts = SPEEDS[speed] || SPEEDS.medium;
  const durationCap = Math.max(5, Math.min(120, Number(duration) || 30));

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

    // Inject global styles + cursor
    await page.addInitScript(`
      (() => {
        const style = document.createElement('style');
        style.textContent = \`
          ${hideScrollbar ? '::-webkit-scrollbar { display: none !important; } * { scrollbar-width: none !important; }' : ''}
          ${cursor ? '* { cursor: none !important; }' : ''}
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
          left: 50%; top: 50%;
        \`;
        document.addEventListener('DOMContentLoaded', () => {
          if (document.body) document.body.appendChild(cur);
        });
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

    // Run pre-recording interactions
    if (interactions && interactions.length > 0) {
      onProgress('Running interactions...');
      for (const action of interactions) {
        try {
          if (action.type === 'click' && action.selector) {
            await page.click(action.selector, { timeout: 5000 });
          } else if (action.type === 'wait') {
            await page.waitForTimeout(action.ms || 500);
          } else if (action.type === 'type' && action.selector) {
            await page.fill(action.selector, action.text || '');
          } else if (action.type === 'scroll-to' && action.selector) {
            await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }, action.selector);
            await page.waitForTimeout(800);
          } else if (action.type === 'hover' && action.selector) {
            await page.hover(action.selector, { timeout: 5000 });
          }
        } catch (err) {
          console.warn(`[recorder] interaction failed (${action.type}): ${err.message}`);
        }
      }
      await page.waitForTimeout(500);
    }

    // Smart scroll detection
    const scrollInfo = await page.evaluate((targetSelector) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // If explicit selector given, use it
      if (targetSelector && targetSelector !== 'auto' && targetSelector !== 'body') {
        const el = document.querySelector(targetSelector);
        if (el) {
          const totalScroll = el.scrollHeight - el.clientHeight;
          return {
            mode: 'element',
            selector: targetSelector,
            totalScroll: Math.max(totalScroll, 0),
            centerX: vw / 2,
            centerY: vh / 2,
          };
        }
      }

      // Smart detection: body first
      const bodyScroll = document.body.scrollHeight - window.innerHeight;

      if (bodyScroll > vh * 1.5) {
        return {
          mode: 'body',
          selector: null,
          totalScroll: bodyScroll,
          centerX: vw / 2,
          centerY: vh / 2,
        };
      }

      // Scan for inner scrollable containers
      const allEls = Array.from(document.querySelectorAll('*'));
      let best = null;
      let bestScroll = vh * 0.5; // threshold

      for (const el of allEls) {
        const style = window.getComputedStyle(el);
        const overflow = style.overflow + style.overflowY;
        if (!overflow.includes('scroll') && !overflow.includes('auto')) continue;
        const scrollH = el.scrollHeight - el.clientHeight;
        if (scrollH > bestScroll) {
          bestScroll = scrollH;
          best = el;
        }
      }

      if (best) {
        // Build selector path
        let sel = best.id ? '#' + best.id : (best.className ? '.' + best.className.trim().split(/\s+/)[0] : best.tagName.toLowerCase());
        return {
          mode: 'element',
          selector: sel,
          totalScroll: bestScroll,
          centerX: vw / 2,
          centerY: vh / 2,
        };
      }

      // Fallback to body even if short
      return {
        mode: 'body',
        selector: null,
        totalScroll: Math.max(bodyScroll, 0),
        centerX: vw / 2,
        centerY: vh / 2,
      };
    }, scrollTarget);

    const totalScroll = scrollInfo.totalScroll;
    onProgress(`Scrolling ${totalScroll}px (${scrollInfo.mode})...`);

    // Move cursor to center area
    if (cursor) {
      await page.mouse.move(scrollInfo.centerX, scrollInfo.centerY);
      await page.waitForTimeout(200);
    }

    // Calculate scroll timing
    const stepsNeeded = totalScroll > 0 ? totalScroll / scrollOpts.step : 1;
    const estimatedMs = stepsNeeded * scrollOpts.delay;
    const capMs = durationCap * 1000 - 2000;
    const scaleFactor = estimatedMs > capMs ? capMs / estimatedMs : 1;
    const effectiveDelay = Math.max(scrollOpts.delay * scaleFactor, 1);

    // Smooth scroll loop
    let current = 0;
    const { step } = scrollOpts;

    while (current < totalScroll) {
      current = Math.min(current + step, totalScroll);

      if (scrollInfo.mode === 'element' && scrollInfo.selector) {
        await page.evaluate(({ sel, y }) => {
          const el = document.querySelector(sel);
          if (el) el.scrollTop = y;
        }, { sel: scrollInfo.selector, y: current });
      } else {
        await page.evaluate((scrollY) => window.scrollTo({ top: scrollY }), current);
      }

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

    // Determine music file path
    let musicFile = null;
    if (music && music !== false && music !== 'none') {
      const musicTrack = typeof music === 'string' ? music : 'upbeat-tech';
      const musicPath = path.join(__dirname, 'public', 'music', `${musicTrack}.mp3`);
      if (fs.existsSync(musicPath)) {
        musicFile = musicPath;
      } else {
        // Try without extension
        const mp3Files = fs.readdirSync(path.join(__dirname, 'public', 'music')).filter(f => f.endsWith('.mp3'));
        if (mp3Files.length > 0) musicFile = path.join(__dirname, 'public', 'music', mp3Files[0]);
      }
    }

    // Post-process with ffmpeg
    await ffmpegProcess({
      rawVideo,
      outputPath,
      rawDur,
      durationCap,
      musicFile,
      musicVolume: musicVolume || 0.3,
      vp,
      branding,
      exportOpts,
      onProgress,
    });

    onProgress('Done!');
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    setTimeout(() => {
      try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch {}
    }, 5000);
  }
}

/**
 * ffmpeg post-processing: trim, speed, music, branding, encode
 */
function ffmpegProcess({ rawVideo, outputPath, rawDur, durationCap, musicFile, musicVolume, vp, branding, exportOpts, onProgress }) {
  return new Promise((resolve, reject) => {
    const speed = rawDur > durationCap ? rawDur / durationCap : 1.0;
    const outDur = rawDur / speed;
    const fadeOutV = Math.max(outDur - 0.8, 1);
    const fadeOutA = Math.max(outDur - 1.0, 1);

    // Quality settings
    const quality = exportOpts.quality || 'high';
    const crfMap = { low: 32, medium: 26, high: 22, ultra: 18 };
    const crf = crfMap[quality] || 22;

    // Build video filter chain
    let vFilter = `[0:v]setpts=PTS/${speed},fade=t=in:st=0:d=0.2,fade=t=out:st=${fadeOutV}:d=0.6`;

    // Add badge overlay if requested
    if (branding && branding.showBadge) {
      // Add "Made with DemoReel" text overlay
      vFilter += `,drawtext=text='Made with DemoReel':fontsize=14:fontcolor=white@0.6:x=w-tw-10:y=h-th-10`;
    }

    vFilter += '[v]';

    const args = ['-y'];

    // Input: raw video
    args.push('-i', rawVideo);

    if (musicFile) {
      // Input: music file (looped)
      args.push('-stream_loop', '-1', '-i', musicFile);

      const musicFilter = `[1:a]volume=${musicVolume},atrim=0:${outDur + 1},afade=t=out:st=${fadeOutA}:d=0.8[music]`;
      const filterComplex = `${vFilter};${musicFilter}`;

      args.push(
        '-filter_complex', filterComplex,
        '-map', '[v]',
        '-map', '[music]',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
        '-pix_fmt', 'yuv420p', '-r', '30',
        '-c:a', 'aac', '-b:a', '128k',
        '-t', String(outDur + 0.5),
        '-movflags', '+faststart',
        outputPath
      );
    } else {
      args.push(
        '-filter_complex', vFilter,
        '-map', '[v]',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
        '-pix_fmt', 'yuv420p', '-r', '30',
        '-an',
        '-t', String(outDur + 0.5),
        '-movflags', '+faststart',
        outputPath
      );
    }

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

module.exports = { record, VIEWPORTS, SPEEDS };
