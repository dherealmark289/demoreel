#!/usr/bin/env node
/**
 * cli.js — DemoReel CLI
 * Works in LOCAL mode (direct Playwright) or REMOTE mode (--server URL)
 *
 * Usage:
 *   demoreel record https://example.com -o demo.mp4
 *   demoreel record https://example.com --template social-teaser -o teaser.mp4
 *   demoreel script https://example.com --tone professional
 *   demoreel presets
 *   demoreel record https://example.com --server http://localhost:3000 -o demo.mp4
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// ─── Arg Parser (no external deps) ───────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { _: [] };
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('-')) { opts[key] = true; i++; }
      else { opts[key] = next; i += 2; }
    } else if (a.startsWith('-') && a.length === 2) {
      const key = a.slice(1);
      const next = args[i + 1];
      if (!next || next.startsWith('-')) { opts[key] = true; i++; }
      else { opts[key] = next; i += 2; }
    } else {
      opts._.push(a); i++;
    }
  }
  return opts;
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  blue: '\x1b[34m', cyan: '\x1b[36m', green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m',
  magenta: '\x1b[35m',
};
const clr = (color, text) => `${c[color]}${text}${c.reset}`;
const log = (...a) => console.log(...a);
const info = (msg) => log(`  ${clr('cyan', '›')} ${msg}`);
const ok = (msg) => log(`  ${clr('green', '✓')} ${msg}`);
const warn = (msg) => log(`  ${clr('yellow', '⚠')} ${msg}`);
const err = (msg) => { log(`  ${clr('red', '✗')} ${msg}`); process.exit(1); };

// ─── Help ─────────────────────────────────────────────────────────────────────
function showHelp() {
  log(`
${clr('bold', clr('blue', '🎬 DemoReel CLI'))} ${clr('gray', 'v2.0')}
${clr('gray', 'Record any webpage as a polished scroll-through video.')}

${clr('bold', 'USAGE')}
  demoreel ${clr('cyan', 'record')} <url> [options]
  demoreel ${clr('cyan', 'script')} <url> [options]
  demoreel ${clr('cyan', 'presets')}
  demoreel ${clr('cyan', 'help')}

${clr('bold', 'RECORD OPTIONS')}
  ${clr('yellow', '-o, --output')}        Output file path (default: ./demoreel-output.mp4)
  ${clr('yellow', '--speed')}             slow | medium | fast | blazing (default: medium)
  ${clr('yellow', '--viewport')}          mobile | tablet | desktop | widescreen (default: desktop)
  ${clr('yellow', '--theme')}             dark | light (default: dark)
  ${clr('yellow', '--duration')}          Max duration in seconds (default: 30)
  ${clr('yellow', '--cursor')}            Show glowing cursor (default: true)
  ${clr('yellow', '--no-cursor')}         Disable cursor
  ${clr('yellow', '--music')}             Music track ID or "none" (default: none)
  ${clr('yellow', '--music-volume')}      Music volume 0.0-1.0 (default: 0.3)
  ${clr('yellow', '--quality')}           low | medium | high | ultra (default: high)
  ${clr('yellow', '--format')}            mp4 | webm (default: mp4)
  ${clr('yellow', '--voiceover')}         Voiceover text (requires ELEVENLABS_API_KEY)
  ${clr('yellow', '--voice')}             Voice preset: alloy|echo|fable|onyx|nova|shimmer
  ${clr('yellow', '--blur')}              CSS selectors to blur (comma-separated)
  ${clr('yellow', '--watermark')}         Add "Made with DemoReel" badge
  ${clr('yellow', '--fingerprint')}       Embed invisible fingerprint (default: true)
  ${clr('yellow', '--template')}          product-demo | landing-page | social-teaser | app-walkthrough
  ${clr('yellow', '--server')}            Remote DemoReel server URL (enables remote mode)
  ${clr('yellow', '--scroll-target')}     CSS selector for scrollable container (default: auto)
  ${clr('yellow', '--interactions')}      JSON array of interactions (click/type/wait/scroll-to)
  ${clr('yellow', '--open')}              Open output in system viewer when done

${clr('bold', 'SCRIPT OPTIONS')}
  ${clr('yellow', '--tone')}              professional | casual | exciting | technical
  ${clr('yellow', '--purpose')}           product-demo | tutorial | showcase | teaser
  ${clr('yellow', '--duration')}          Target duration in seconds

${clr('bold', 'EXAMPLES')}
  ${clr('gray', '# Quick record')}
  demoreel record https://example.com -o demo.mp4

  ${clr('gray', '# Social teaser template (9:16, fast, 15s)')}
  demoreel record https://myapp.com --template social-teaser -o teaser.mp4

  ${clr('gray', '# Local dev server')}
  demoreel record http://localhost:3000 -o local-demo.mp4

  ${clr('gray', '# Local HTML file')}
  demoreel record file:///path/to/index.html -o demo.mp4

  ${clr('gray', '# With music + voiceover')}
  demoreel record https://example.com --music upbeat-tech --voice alloy --voiceover "Check this out!" -o demo.mp4

  ${clr('gray', '# Privacy blur')}
  demoreel record https://app.com --blur ".api-key,.password" -o demo.mp4

  ${clr('gray', '# Remote mode (use running DemoReel server)')}
  demoreel record https://example.com --server https://demoreel.railway.app -o demo.mp4

  ${clr('gray', '# Generate AI script for a URL')}
  demoreel script https://example.com --tone exciting --duration 30

  ${clr('gray', '# List all presets')}
  demoreel presets
`);
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function httpRequest(url, method, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
      timeout: 10000,
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Download binary file
function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const file = fs.createWriteStream(outputPath);
    lib.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (e) => { fs.unlink(outputPath, () => {}); reject(e); });
  });
}

// ─── Templates ────────────────────────────────────────────────────────────────
const TEMPLATES = {
  'product-demo':    { speed: 'medium', viewport: 'desktop', duration: 30, theme: 'dark',  cursor: true,  music: 'upbeat-tech',    musicVolume: 0.25, quality: 'high' },
  'landing-page':    { speed: 'slow',   viewport: 'desktop', duration: 20, theme: 'dark',  cursor: false, music: 'corporate-clean', musicVolume: 0.3,  quality: 'high' },
  'social-teaser':   { speed: 'fast',   viewport: 'mobile',  duration: 15, theme: 'dark',  cursor: false, music: 'playful-bounce',  musicVolume: 0.35, quality: 'high' },
  'app-walkthrough': { speed: 'medium', viewport: 'desktop', duration: 45, theme: 'dark',  cursor: true,  music: 'chill-lofi',      musicVolume: 0.2,  quality: 'ultra' },
};

// ─── Progress bar ─────────────────────────────────────────────────────────────
function progressBar(pct, width = 30) {
  const filled = Math.round((pct / 100) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `[${clr('blue', bar)}] ${clr('bold', pct + '%')}`;
}

// ─── Remote record mode ───────────────────────────────────────────────────────
async function remoteRecord(serverUrl, payload, outputPath) {
  info(`Using remote server: ${serverUrl}`);

  // Start job
  const startRes = await httpRequest(`${serverUrl}/api/record`, 'POST', payload);
  if (startRes.status !== 202 || startRes.body.error) {
    err(`Server error: ${startRes.body.error || startRes.status}`);
  }

  const jobId = startRes.body.id;
  info(`Job started: ${jobId}`);

  // Poll
  let lastMsg = '';
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await httpRequest(`${serverUrl}/api/status/${jobId}`, 'GET');
    const job = statusRes.body;

    const msg = job.progressMessage || '';
    const pct = job.progress || 0;
    if (msg !== lastMsg || pct > 0) {
      process.stdout.write(`\r  ${progressBar(pct)} ${clr('gray', msg.padEnd(30))}`);
      lastMsg = msg;
    }

    if (job.status === 'completed') {
      process.stdout.write('\n');
      ok('Recording complete!');
      info(`Downloading video...`);
      await downloadFile(`${serverUrl}${job.downloadUrl}`, outputPath);
      ok(`Saved to ${clr('green', outputPath)}`);
      return;
    }

    if (job.status === 'failed') {
      process.stdout.write('\n');
      err(`Recording failed: ${job.error}`);
    }
  }
}

// ─── Local record mode ────────────────────────────────────────────────────────
async function localRecord(url, opts, outputPath) {
  const { record } = require('./recorder');
  const { generateVoiceover } = require('./voiceover');
  const { applyPrivacyProtection } = require('./protection');

  info(`Recording (local mode): ${url}`);

  // Progress display
  let lastPct = 0;
  const onProgress = (msg) => {
    let pct = lastPct;
    if (msg.includes('browser')) pct = 10;
    else if (msg.includes('Loading')) pct = 20;
    else if (msg.includes('interact')) pct = 35;
    else if (msg.includes('Scroll')) pct = 55;
    else if (msg.includes('Encoding')) pct = 75;
    else if (msg.includes('ffmpeg')) pct = 85;
    else if (msg.includes('Done')) pct = 100;
    lastPct = pct;
    process.stdout.write(`\r  ${progressBar(pct)} ${clr('gray', msg.slice(0, 40).padEnd(40))}`);
  };

  const musicTrack = opts.music && opts.music !== 'none' ? opts.music : false;

  await record({
    url,
    speed: opts.speed || 'medium',
    viewport: opts.viewport || 'desktop',
    theme: opts.theme || 'dark',
    cursor: opts.cursor !== false,
    duration: parseInt(opts.duration) || 30,
    music: musicTrack,
    musicVolume: parseFloat(opts.musicVolume) || 0.3,
    scrollTarget: opts.scrollTarget || 'auto',
    hideScrollbar: true,
    interactions: opts.interactions || [],
    branding: {
      showBadge: opts.watermark === true,
    },
    privacy: {
      blur: opts.blur ? opts.blur.split(',').map(s => s.trim()) : [],
      autoDetect: opts.autoDetect !== false,
    },
    protection: {
      fingerprint: opts.fingerprint !== false,
    },
    export: {
      quality: opts.quality || 'high',
      format: opts.format || 'mp4',
    },
    outputPath,
    onProgress,
  });

  process.stdout.write('\n');
}

// ─── Command: presets ─────────────────────────────────────────────────────────
async function cmdPresets(opts) {
  const serverUrl = opts.server;
  if (serverUrl) {
    const res = await httpRequest(`${serverUrl}/api/presets`, 'GET');
    console.log(JSON.stringify(res.body, null, 2));
    return;
  }

  // Local
  const { TRACK_METADATA } = require('./musicGen');
  const { getVoiceList } = require('./voiceover');

  log('\n' + clr('bold', '🎵 Music Tracks'));
  TRACK_METADATA.forEach(t => log(`  ${clr('cyan', t.id.padEnd(22))} ${clr('gray', t.mood.padEnd(14))} ${t.description}`));

  log('\n' + clr('bold', '🎤 Voices'));
  getVoiceList().forEach(v => log(`  ${clr('cyan', v.id.padEnd(10))} ${clr('gray', v.name.padEnd(10))} ${v.style}`));

  log('\n' + clr('bold', '📐 Viewports'));
  ['mobile (375×667)', 'tablet (768×1024)', 'desktop (1280×720)', 'widescreen (1920×1080)']
    .forEach(v => log(`  ${clr('cyan', '•')} ${v}`));

  log('\n' + clr('bold', '🎨 Templates'));
  Object.entries(TEMPLATES).forEach(([id, cfg]) =>
    log(`  ${clr('cyan', id.padEnd(18))} speed=${cfg.speed}, ${cfg.viewport}, ${cfg.duration}s, music=${cfg.music}`)
  );
  log('');
}

// ─── Command: script ─────────────────────────────────────────────────────────
async function cmdScript(opts) {
  const url = opts._[1];
  if (!url) err('URL required. Usage: demoreel script <url>');

  const serverUrl = opts.server;
  const payload = {
    url,
    purpose: opts.purpose || 'product-demo',
    duration: parseInt(opts.duration) || 30,
    tone: opts.tone || 'professional',
  };

  if (serverUrl) {
    const res = await httpRequest(`${serverUrl}/api/script/generate`, 'POST', payload);
    if (res.body.error) err(res.body.error);
    console.log('\n' + clr('bold', '📝 Generated Script:\n'));
    console.log(res.body.script);
    return;
  }

  // Local
  const { generateScript } = require('./scriptGen');
  info(`Generating script for ${url}...`);
  try {
    const result = await generateScript(payload);
    log('\n' + clr('bold', '📝 Generated Script:\n'));
    log(result.script);
    if (result.sections && result.sections.length > 0) {
      log('\n' + clr('bold', '📍 Sections:'));
      result.sections.forEach(s => log(`  ${clr('gray', String(s.scrollPercent + '%').padEnd(6))} ${s.text.slice(0, 80)}${s.text.length > 80 ? '…' : ''}`));
    }
  } catch (e) {
    err(e.message);
  }
}

// ─── Command: record ──────────────────────────────────────────────────────────
async function cmdRecord(opts) {
  const url = opts._[1];
  if (!url) err('URL required. Usage: demoreel record <url> -o output.mp4');

  // Validate URL (allow localhost, file://, LAN)
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    const allowedProtocols = ['http:', 'https:', 'file:'];
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      err(`URL protocol not supported. Use http://, https://, or file://`);
    }
  } catch {
    err(`Invalid URL: ${url}`);
  }

  // Apply template if specified
  let templateConfig = {};
  if (opts.template) {
    templateConfig = TEMPLATES[opts.template];
    if (!templateConfig) err(`Unknown template: "${opts.template}". Try: demoreel presets`);
    info(`Template: ${opts.template}`);
  }

  // Merge template + CLI opts (CLI overrides template)
  const merged = { ...templateConfig, ...opts };

  const outputPath = opts.o || opts.output || `demoreel-output-${Date.now()}.mp4`;
  const absOutput = path.isAbsolute(outputPath) ? outputPath : path.join(process.cwd(), outputPath);

  log(`\n  ${clr('bold', clr('blue', '🎬 DemoReel Recording'))}`);
  info(`URL:      ${url}`);
  info(`Viewport: ${merged.viewport || 'desktop'}`);
  info(`Speed:    ${merged.speed || 'medium'}`);
  info(`Duration: ${merged.duration || 30}s`);
  info(`Music:    ${merged.music || 'none'}`);
  info(`Output:   ${absOutput}`);
  log('');

  const serverUrl = merged.server;

  // Parse interactions if given as JSON string
  let interactions = [];
  if (merged.interactions) {
    try { interactions = JSON.parse(merged.interactions); }
    catch { warn('Could not parse --interactions JSON, ignoring.'); }
  }

  const payload = {
    url: parsedUrl.href,
    viewport: merged.viewport || 'desktop',
    speed: merged.speed || 'medium',
    theme: merged.theme || 'dark',
    duration: parseInt(merged.duration) || 30,
    cursor: merged['no-cursor'] ? false : (merged.cursor !== false),
    music: {
      track: merged.music || 'none',
      volume: parseFloat(merged.musicVolume || merged['music-volume']) || 0.3,
    },
    branding: { showBadge: Boolean(merged.watermark) },
    privacy: {
      blur: merged.blur ? merged.blur.split(',').map(s => s.trim()) : [],
      autoDetect: merged.autoDetect !== false,
    },
    protection: { fingerprint: merged.fingerprint !== false },
    export: {
      quality: merged.quality || 'high',
      format: merged.format || 'mp4',
    },
    interactions,
    scrollTarget: merged.scrollTarget || merged['scroll-target'] || 'auto',
  };

  try {
    if (serverUrl) {
      await remoteRecord(serverUrl, payload, absOutput);
    } else {
      await localRecord(parsedUrl.href, {
        ...merged,
        interactions,
        scrollTarget: merged.scrollTarget || merged['scroll-target'],
      }, absOutput);
    }

    ok(`Done! Video saved to: ${clr('green', clr('bold', absOutput))}`);

    // Show file size
    if (fs.existsSync(absOutput)) {
      const size = fs.statSync(absOutput).size;
      info(`File size: ${(size / 1024 / 1024).toFixed(1)}MB`);
    }

    // Open if requested
    if (merged.open) {
      const { exec } = require('child_process');
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${opener} "${absOutput}"`);
    }
  } catch (e) {
    err(`Recording failed: ${e.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  const cmd = opts._[0];

  if (!cmd || cmd === 'help' || opts.help || opts.h) {
    showHelp();
    return;
  }

  if (cmd === 'presets' || cmd === 'list') {
    await cmdPresets(opts);
    return;
  }

  if (cmd === 'script') {
    await cmdScript(opts);
    return;
  }

  if (cmd === 'record') {
    await cmdRecord(opts);
    return;
  }

  // Shorthand: if first arg looks like a URL, treat as record
  if (cmd.startsWith('http') || cmd.startsWith('file://')) {
    opts._.unshift('record');
    await cmdRecord(opts);
    return;
  }

  err(`Unknown command: "${cmd}". Run "demoreel help" for usage.`);
}

main().catch(e => {
  console.error(clr('red', `Fatal: ${e.message}`));
  process.exit(1);
});
