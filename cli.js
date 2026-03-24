#!/usr/bin/env node
/**
 * DemoReel CLI — Record polished demo videos from the command line
 * 
 * Usage:
 *   demoreel record <url> [options]     Record a website scroll video
 *   demoreel script <url> [options]     Generate a voiceover script
 *   demoreel presets                    List available presets
 *   demoreel post [options]             Post video to X/Twitter (coming soon)
 * 
 * Examples:
 *   demoreel record https://example.com -o demo.mp4
 *   demoreel record http://localhost:3000 --template social-teaser -o teaser.mp4
 *   demoreel record file:///path/to/index.html --speed blazing -o local.mp4
 *   demoreel record https://app.com --blur ".api-key,#secret" --music upbeat-tech
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ─── Argument parser ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { _: [], flags: {} };
  let i = 2; // skip node + script
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        args.flags[key] = true;
      } else {
        args.flags[key] = next;
        i++;
      }
    } else if (a.startsWith('-') && a.length === 2) {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        args.flags[key] = true;
      } else {
        args.flags[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
    i++;
  }
  return args;
}

// ─── Templates ──────────────────────────────────────────────────────────────
const TEMPLATES = {
  'social-teaser': {
    speed: 'blazing', duration: 15, viewport: 'desktop', theme: 'dark',
    cursor: true, hideScrollbar: true, music: { track: 'upbeat-tech', volume: 0.3 },
    export: { format: 'mp4', quality: 'high', aspectRatio: '16:9' },
  },
  'product-demo': {
    speed: 'medium', duration: 30, viewport: 'desktop', theme: 'dark',
    cursor: true, hideScrollbar: true, music: { track: 'corporate-clean', volume: 0.2 },
    export: { format: 'mp4', quality: 'high', aspectRatio: '16:9' },
  },
  'landing-page': {
    speed: 'slow', duration: 45, viewport: 'widescreen', theme: 'light',
    cursor: false, hideScrollbar: true, music: { track: 'cinematic-reveal', volume: 0.25 },
    export: { format: 'mp4', quality: 'ultra', aspectRatio: '16:9' },
  },
  'app-walkthrough': {
    speed: 'medium', duration: 60, viewport: 'desktop', theme: 'dark',
    cursor: true, hideScrollbar: true, music: { track: 'chill-lofi', volume: 0.2 },
    export: { format: 'mp4', quality: 'high', aspectRatio: '16:9' },
  },
  'tiktok-reel': {
    speed: 'blazing', duration: 15, viewport: 'mobile', theme: 'dark',
    cursor: true, hideScrollbar: true, music: { track: 'playful-bounce', volume: 0.35 },
    export: { format: 'mp4', quality: 'high', aspectRatio: '9:16' },
  },
};

const SPEED_MAP = { slow: { step: 3, delay: 0.02 }, medium: { step: 8, delay: 0.012 }, fast: { step: 20, delay: 0.006 }, blazing: { step: 55, delay: 0.003 } };
const VIEWPORT_MAP = { mobile: { w: 375, h: 667 }, tablet: { w: 768, h: 1024 }, desktop: { w: 1280, h: 720 }, widescreen: { w: 1920, h: 1080 } };

// ─── Local recording (uses Playwright directly) ────────────────────────────
async function recordLocal(url, opts) {
  let recorder;
  try {
    recorder = require('./recorder');
  } catch (e) {
    console.error('❌ recorder.js not found. Run from the demoreel directory or install globally.');
    process.exit(1);
  }
  
  const config = {
    url,
    viewport: opts.viewport || 'desktop',
    theme: opts.theme || 'dark',
    speed: opts.speed || 'fast',
    duration: parseInt(opts.duration) || 30,
    cursor: opts.cursor !== 'false' && opts.cursor !== false,
    scrollTarget: opts['scroll-target'] || 'auto',
    hideScrollbar: true,
    music: opts.music ? { track: opts.music, volume: parseFloat(opts['music-volume'] || '0.3') } : { track: 'none' },
    privacy: {},
    branding: { showBadge: opts.badge !== 'false' },
    export: {
      format: opts.format || 'mp4',
      quality: opts.quality || 'high',
    },
  };

  // Apply template if specified
  if (opts.template && TEMPLATES[opts.template]) {
    Object.assign(config, TEMPLATES[opts.template]);
    config.url = url;
  }

  // Privacy/blur
  if (opts.blur) {
    config.privacy.blur = opts.blur.split(',').map(s => s.trim());
  }
  if (opts['auto-detect'] !== 'false') {
    config.privacy.autoDetect = true;
  }

  const outputPath = opts.o || opts.output || 'recording.mp4';
  
  console.log(`\n🎬 DemoReel CLI\n`);
  console.log(`  URL:      ${url}`);
  console.log(`  Template: ${opts.template || 'custom'}`);
  console.log(`  Speed:    ${config.speed}`);
  console.log(`  Duration: ${config.duration}s`);
  console.log(`  Output:   ${outputPath}\n`);

  try {
    const result = await recorder.record(config);
    
    // Move/rename output
    if (result && result !== outputPath) {
      fs.copyFileSync(result, outputPath);
    }
    
    const stat = fs.statSync(outputPath);
    console.log(`\n✅ Saved: ${outputPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
  } catch (err) {
    console.error(`\n❌ Recording failed: ${err.message}`);
    process.exit(1);
  }
}

// ─── Remote recording (calls DemoReel API server) ──────────────────────────
async function recordRemote(url, opts) {
  const serverUrl = opts.server || 'http://localhost:3000';
  
  const config = {
    url,
    viewport: opts.viewport || 'desktop',
    theme: opts.theme || 'dark',
    speed: opts.speed || 'fast',
    duration: parseInt(opts.duration) || 30,
    cursor: opts.cursor !== 'false',
    music: opts.music ? { track: opts.music, volume: parseFloat(opts['music-volume'] || '0.3') } : undefined,
  };

  if (opts.template && TEMPLATES[opts.template]) {
    Object.assign(config, TEMPLATES[opts.template]);
    config.url = url;
  }

  console.log(`\n🎬 DemoReel CLI (remote: ${serverUrl})\n`);
  console.log(`  URL: ${url}`);
  console.log(`  Submitting recording job...\n`);

  const lib = serverUrl.startsWith('https') ? https : http;
  const body = JSON.stringify(config);

  // POST /api/record
  const jobRes = await new Promise((resolve, reject) => {
    const req = lib.request(`${serverUrl}/api/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (jobRes.error) {
    console.error(`❌ ${jobRes.error}`);
    process.exit(1);
  }

  const jobId = jobRes.id;
  console.log(`  Job ID: ${jobId}`);
  console.log(`  Status: ${jobRes.status}\n`);

  // Poll status
  let status = jobRes.status;
  while (status === 'queued' || status === 'processing') {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await new Promise((resolve, reject) => {
      lib.get(`${serverUrl}/api/status/${jobId}`, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
        });
      }).on('error', reject);
    });
    status = statusRes.status;
    if (statusRes.progress) process.stdout.write(`\r  Progress: ${statusRes.progress}%`);
  }

  console.log(`\n  Status: ${status}`);

  if (status !== 'completed') {
    console.error(`\n❌ Recording failed with status: ${status}`);
    process.exit(1);
  }

  // Download
  const outputPath = opts.o || opts.output || 'recording.mp4';
  console.log(`  Downloading → ${outputPath}...`);

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    lib.get(`${serverUrl}/api/download/${jobId}`, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(resolve); });
    }).on('error', reject);
  });

  const stat = fs.statSync(outputPath);
  console.log(`\n✅ Saved: ${outputPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
}

// ─── Commands ───────────────────────────────────────────────────────────────
async function cmdRecord(args) {
  const url = args._[1];
  if (!url) {
    console.error('Usage: demoreel record <url> [options]');
    process.exit(1);
  }

  const opts = args.flags;
  
  if (opts.server) {
    await recordRemote(url, opts);
  } else {
    await recordLocal(url, opts);
  }
}

function cmdPresets() {
  console.log('\n🎬 DemoReel Presets\n');
  
  console.log('📋 Templates:');
  for (const [id, t] of Object.entries(TEMPLATES)) {
    console.log(`  ${id.padEnd(20)} ${t.speed.padEnd(8)} ${t.duration}s  ${t.export.aspectRatio}  🎵 ${t.music.track}`);
  }

  console.log('\n🎵 Music tracks:');
  try {
    const { TRACK_METADATA } = require('./musicGen');
    TRACK_METADATA.forEach(t => {
      console.log(`  ${t.id.padEnd(22)} ${t.mood.padEnd(14)} ${t.duration}s`);
    });
  } catch {
    console.log('  (run from demoreel directory to see tracks)');
  }

  console.log('\n⚡ Speeds: slow | medium | fast | blazing');
  console.log('📱 Viewports: mobile | tablet | desktop | widescreen');
  console.log('🎨 Themes: dark | light');
  console.log('📐 Formats: mp4 | webm | gif');
  console.log('');
}

function cmdScript(args) {
  const url = args._[1];
  if (!url) {
    console.error('Usage: demoreel script <url> [--tone professional] [--duration 30]');
    process.exit(1);
  }
  console.log('⚠️  Script generation requires GEMINI_API_KEY. Use the web UI or API instead.');
  console.log(`   POST /api/script/generate {"url": "${url}", "duration": ${args.flags.duration || 30}}`);
}

function showHelp() {
  console.log(`
🎬 DemoReel — Automated website demo video recorder

Commands:
  demoreel record <url> [options]    Record a scroll-through video
  demoreel script <url> [options]    Generate voiceover script (AI)
  demoreel presets                   List templates, music, and options
  demoreel post [options]            Post to X/Twitter (coming soon)

Record options:
  -o, --output <file>      Output file (default: recording.mp4)
  --template <name>        Use a preset template (social-teaser, product-demo, etc.)
  --speed <speed>          Scroll speed: slow|medium|fast|blazing
  --viewport <size>        Viewport: mobile|tablet|desktop|widescreen
  --theme <theme>          Color scheme: dark|light
  --cursor                 Show glowing cursor (default: true)
  --duration <secs>        Max duration in seconds
  --music <track>          Background music track name
  --music-volume <0-1>     Music volume (default: 0.3)
  --blur <selectors>       CSS selectors to blur (comma-separated)
  --auto-detect            Auto-detect & blur sensitive data (default: true)
  --format <fmt>           Output format: mp4|webm|gif
  --quality <q>            Quality: low|medium|high|ultra
  --scroll-target <sel>    CSS selector for scroll container (default: auto)
  --server <url>           Use remote DemoReel server instead of local

Examples:
  # Quick social media teaser
  demoreel record https://myapp.com --template social-teaser -o tweet.mp4

  # Record localhost with blur
  demoreel record http://localhost:3000 --blur ".env-var,#api-key" -o demo.mp4

  # Record local HTML file
  demoreel record file:///home/dev/index.html -o local-demo.mp4

  # Full pipeline via remote server
  demoreel record https://app.com --server https://demoreel.up.railway.app -o out.mp4
  `);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0];

  switch (cmd) {
    case 'record': await cmdRecord(args); break;
    case 'script': cmdScript(args); break;
    case 'presets': cmdPresets(); break;
    case 'post': console.log('🚧 X/Twitter posting coming soon. Need API credentials.'); break;
    case 'help': case '--help': case '-h': showHelp(); break;
    default: showHelp();
  }
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
