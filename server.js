/**
 * server.js — DemoReel Express backend (v3)
 * Agent-first demo video studio with comprehensive REST API
 * + Persistent storage: Supabase (PostgreSQL) + Cloudflare R2
 * + Claude script gen + ElevenLabs VO + Shotstack assembly + X post gen
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { record, VIEWPORTS } = require('./recorder');
const { generateScript } = require('./scriptGen');
const { generateVoiceover, getVoiceList, cleanupOldAudio } = require('./voiceover');
const { TRACK_METADATA } = require('./musicGen');
const { Storage } = require('./storage');
const { assembleDemo, pollShotstack } = require('./shotstackAssembler');
const { generateXPost } = require('./xPostGen');

// Multer config for screen recording uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: '/tmp',
    filename: (req, file, cb) => {
      const ext = file.mimetype.includes('mp4') ? 'mp4' : 'webm';
      cb(null, `upload-${uuidv4()}.${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are accepted'));
  },
});

// Multer for multi-clip reel (any field starting with clip_)
const reelUpload = multer({
  storage: multer.diskStorage({
    destination: '/tmp',
    filename: (req, file, cb) => cb(null, `reel-clip-${uuidv4()}.webm`),
  }),
  limits: { fileSize: 2000 * 1024 * 1024 }, // 2GB total
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/') || file.fieldname.startsWith('clip_')) cb(null, true);
    else cb(null, true); // accept all from reel
  },
});

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Storage Init ─────────────────────────────────────────────────────────────
const storage = new Storage();

// ─── Job Store (in-memory fallback) ──────────────────────────────────────────
// { id: { status, progress, progressPercent, outputPath, error, createdAt, metadata, videoUrl, thumbnailUrl } }
const jobs = new Map();
const MAX_CONCURRENT = 3;

function getActiveJobCount() {
  let count = 0;
  for (const [, job] of jobs) {
    if (job.status === 'processing' || job.status === 'queued') count++;
  }
  return count;
}

// Cleanup old jobs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > 60 * 60 * 1000) {
      if (job.outputPath) {
        try { fs.unlinkSync(job.outputPath); } catch {}
      }
      if (job.thumbPath) {
        try { fs.unlinkSync(job.thumbPath); } catch {}
      }
      jobs.delete(id);
    }
  }
  cleanupOldAudio();
}, 5 * 60 * 1000);

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// CORS for agent access
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function jobResponse(id, job) {
  return {
    id,
    status: job.status,
    progress: job.progressPercent || 0,
    progressMessage: job.progress || '',
    estimatedTime: job.estimatedTime || null,
    downloadUrl: job.status === 'completed'
      ? (job.videoUrl || `/api/download/${id}`)
      : null,
    videoUrl: job.videoUrl || null,
    thumbnailUrl: job.thumbnailUrl || null,
    error: job.error || null,
    metadata: job.metadata || {
      duration: null,
      fileSize: null,
      resolution: null,
      scenes: 0,
    },
  };
}

function getFileSize(filePath) {
  try { return fs.statSync(filePath).size; } catch { return null; }
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || null;
}

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    jobs: jobs.size,
    storage: {
      db: storage.dbAvailable,
      r2: storage.r2Available,
    },
  });
});

// ─── GET /api/health ─────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    jobs: jobs.size,
    activeJobs: getActiveJobCount(),
    storage: {
      db: storage.dbAvailable,
      r2: storage.r2Available,
    },
  });
});

// ─── GET /api/presets ────────────────────────────────────────────────────────
app.get('/api/presets', (req, res) => {
  res.json({
    music: TRACK_METADATA,
    voices: getVoiceList(),
    viewports: Object.entries(VIEWPORTS).map(([id, size]) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      width: size.width,
      height: size.height,
    })),
    speeds: [
      { id: 'slow',    name: 'Slow',    description: 'Smooth, leisurely scroll' },
      { id: 'medium',  name: 'Medium',  description: 'Balanced pacing' },
      { id: 'fast',    name: 'Fast',    description: 'Energetic, snappy scroll' },
      { id: 'blazing', name: '⚡ Blazing', description: 'Ultra-fast, high energy' },
    ],
    themes: [
      { id: 'dark',  name: '🌙 Dark',  description: 'Dark color scheme' },
      { id: 'light', name: '☀️ Light', description: 'Light color scheme' },
    ],
    templates: [
      {
        id: 'product-demo',
        name: 'Product Demo',
        description: 'Full product showcase with voiceover',
        config: {
          viewport: 'desktop', speed: 'medium', duration: 30, theme: 'dark',
          cursor: true, music: { track: 'upbeat-tech', volume: 0.25 },
          script: { mode: 'auto', purpose: 'product-demo', tone: 'professional' },
          export: { format: 'mp4', quality: 'high', resolution: '1080p' },
        },
      },
      {
        id: 'landing-page',
        name: 'Landing Page Showcase',
        description: 'Elegant scroll through a landing page',
        config: {
          viewport: 'desktop', speed: 'slow', duration: 20, theme: 'dark',
          cursor: false, music: { track: 'corporate-clean', volume: 0.3 },
          script: { mode: 'none' },
          export: { format: 'mp4', quality: 'high', resolution: '1080p' },
        },
      },
      {
        id: 'social-teaser',
        name: 'Social Media Teaser',
        description: '15-second fast teaser for social posts',
        config: {
          viewport: 'mobile', speed: 'fast', duration: 15, theme: 'dark',
          cursor: false, music: { track: 'playful-bounce', volume: 0.35 },
          script: { mode: 'auto', purpose: 'teaser', tone: 'exciting' },
          export: { format: 'mp4', quality: 'high', aspectRatio: '9:16', resolution: '1080p' },
        },
      },
      {
        id: 'app-walkthrough',
        name: 'App Walkthrough',
        description: 'Technical walkthrough with tutorial narration',
        config: {
          viewport: 'desktop', speed: 'medium', duration: 45, theme: 'dark',
          cursor: true, music: { track: 'chill-lofi', volume: 0.2 },
          script: { mode: 'auto', purpose: 'tutorial', tone: 'technical' },
          export: { format: 'mp4', quality: 'ultra', resolution: '1080p' },
        },
      },
    ],
    exportFormats: ['mp4', 'webm'],
    qualities: ['low', 'medium', 'high', 'ultra'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3'],
    resolutions: ['720p', '1080p'],
  });
});

// ─── POST /api/record ────────────────────────────────────────────────────────
app.post('/api/record', async (req, res) => {
  const {
    url,
    viewport = 'desktop',
    customViewport = null,
    theme = 'dark',
    speed = 'medium',
    duration = 30,
    cursor = true,
    scrollTarget = 'auto',
    hideScrollbar = true,
    interactions = [],
    script: scriptOpts = {},
    music: musicOpts = {},
    branding = {},
    privacy = {},
    protection = {},
    export: exportOpts = {},
  } = req.body;

  // Validate URL
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Only http/https URLs allowed' });
    }
  } catch (e) {
    return res.status(400).json({ error: `Invalid URL: ${e.message}` });
  }

  // Validate viewport
  const validViewports = ['mobile', 'tablet', 'desktop', 'widescreen', 'custom'];
  if (!validViewports.includes(viewport)) {
    return res.status(400).json({ error: `Invalid viewport. Use: ${validViewports.join(', ')}` });
  }

  if (viewport === 'custom' && (!customViewport || !customViewport.width || !customViewport.height)) {
    return res.status(400).json({ error: 'customViewport.width and .height required for custom viewport' });
  }

  // Check concurrency
  if (getActiveJobCount() >= MAX_CONCURRENT) {
    return res.status(429).json({
      error: 'Max concurrent recordings reached. Try again shortly.',
      retryAfter: 30,
    });
  }

  const id = uuidv4();
  const outputPath = `/tmp/demoreel-${id}.mp4`;
  const thumbPath = `/tmp/demoreel-${id}-thumb.jpg`;
  const vp = viewport === 'custom' ? customViewport : VIEWPORTS[viewport];
  const durationNum = Math.max(5, Math.min(120, Number(duration) || 30));

  // Resolve music
  let musicTrack = false;
  let musicVolume = 0.3;
  if (musicOpts && musicOpts.track && musicOpts.track !== 'none') {
    musicTrack = musicOpts.track;
    musicVolume = typeof musicOpts.volume === 'number' ? musicOpts.volume : 0.3;
  } else if (req.body.music === true) {
    musicTrack = 'upbeat-tech';
  }

  const jobConfig = {
    viewport, theme, speed, duration: durationNum,
    cursor: Boolean(cursor), music: musicOpts, branding, privacy, protection, export: exportOpts,
  };

  const job = {
    status: 'processing',
    progress: 'Initializing...',
    progressPercent: 5,
    outputPath: null,
    thumbPath: null,
    videoUrl: null,
    thumbnailUrl: null,
    error: null,
    createdAt: Date.now(),
    estimatedTime: durationNum + 15,
    metadata: {
      duration: null,
      fileSize: null,
      resolution: `${vp.width}x${vp.height}`,
      scenes: 0,
    },
  };

  jobs.set(id, job);

  // Create job record in Supabase (non-blocking)
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || null;
  storage.createJob(id, parsedUrl.href, jobConfig, ip, ua).catch(() => {});

  // Start recording in background
  (async () => {
    try {
      await record({
        url: parsedUrl.href,
        speed,
        viewport,
        customViewport,
        theme,
        cursor: Boolean(cursor),
        duration: durationNum,
        music: musicTrack,
        musicVolume,
        scrollTarget,
        hideScrollbar: Boolean(hideScrollbar),
        interactions: Array.isArray(interactions) ? interactions : [],
        branding,
        privacy,
        protection,
        export: exportOpts,
        outputPath,
        onProgress: (msg) => {
          const j = jobs.get(id);
          if (!j) return;
          j.progress = msg;
          if (msg.includes('browser')) j.progressPercent = 10;
          else if (msg.includes('Loading')) j.progressPercent = 20;
          else if (msg.includes('interact')) j.progressPercent = 30;
          else if (msg.includes('Scroll')) j.progressPercent = 50;
          else if (msg.includes('Encoding')) j.progressPercent = 75;
          else if (msg.includes('ffmpeg')) j.progressPercent = 85;
          else if (msg.includes('Done')) j.progressPercent = 100;
        },
      });

      const j = jobs.get(id);
      if (!j) return;

      const fileSize = getFileSize(outputPath);
      j.status = 'completed';
      j.outputPath = outputPath;
      j.progress = 'Done!';
      j.progressPercent = 100;
      j.metadata.fileSize = fileSize;

      // Generate thumbnail
      const thumbGenPath = await storage.generateThumbnail(outputPath, thumbPath);
      j.thumbPath = thumbGenPath;

      // Upload to R2
      const [videoUrl, thumbnailUrl] = await Promise.all([
        storage.uploadVideo(id, outputPath),
        thumbGenPath ? storage.uploadThumbnail(id, thumbGenPath) : Promise.resolve(null),
      ]);

      j.videoUrl = videoUrl;
      j.thumbnailUrl = thumbnailUrl;

      // Update Supabase
      storage.updateJob(id, {
        status: 'completed',
        video_url: videoUrl,
        video_size_bytes: fileSize,
        thumbnail_url: thumbnailUrl,
      }).catch(() => {});

    } catch (err) {
      console.error(`[job ${id}] Error:`, err.message);
      const j = jobs.get(id);
      if (j) {
        j.status = 'failed';
        j.error = err.message;
        j.progress = 'Failed';
        j.progressPercent = 0;
      }
      storage.updateJob(id, {
        status: 'failed',
        error: err.message,
      }).catch(() => {});
    }
  })();

  res.status(202).json(jobResponse(id, jobs.get(id)));
});

// ─── GET /api/status/:id ──────────────────────────────────────────────────────
app.get('/api/status/:id', async (req, res) => {
  // Check in-memory first (active jobs)
  const memJob = jobs.get(req.params.id);
  if (memJob) {
    return res.json(jobResponse(req.params.id, memJob));
  }

  // Fall back to Supabase for historical jobs
  const dbJob = await storage.getJob(req.params.id);
  if (dbJob) {
    return res.json({
      id: dbJob.id,
      status: dbJob.status,
      progress: dbJob.status === 'completed' ? 100 : 0,
      progressMessage: dbJob.status,
      estimatedTime: null,
      downloadUrl: dbJob.video_url || (dbJob.status === 'completed' ? `/api/download/${dbJob.id}` : null),
      videoUrl: dbJob.video_url || null,
      thumbnailUrl: dbJob.thumbnail_url || null,
      error: dbJob.error || null,
      metadata: {
        duration: dbJob.duration_seconds,
        fileSize: dbJob.video_size_bytes,
        resolution: dbJob.config?.resolution || null,
        scenes: 0,
      },
    });
  }

  return res.status(404).json({ error: 'Job not found' });
});

// ─── GET /api/download/:id ────────────────────────────────────────────────────
app.get('/api/download/:id', async (req, res) => {
  // Check in-memory first
  const memJob = jobs.get(req.params.id);
  if (memJob) {
    if (memJob.status !== 'completed') {
      return res.status(202).json({ error: 'Not ready yet', status: memJob.status });
    }
    // If R2 URL available, redirect
    if (memJob.videoUrl) {
      return res.redirect(302, memJob.videoUrl);
    }
    // Serve from /tmp
    if (!memJob.outputPath || !fs.existsSync(memJob.outputPath)) {
      return res.status(410).json({ error: 'File expired or missing' });
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="demoreel-${req.params.id.slice(0, 8)}.mp4"`);
    return res.sendFile(memJob.outputPath);
  }

  // Check Supabase for historical jobs
  const dbJob = await storage.getJob(req.params.id);
  if (dbJob) {
    if (dbJob.video_url) {
      return res.redirect(302, dbJob.video_url);
    }
    return res.status(410).json({ error: 'Video expired — no longer available in storage' });
  }

  return res.status(404).json({ error: 'Job not found' });
});

// ─── GET /api/history ─────────────────────────────────────────────────────────
app.get('/api/history', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);

  if (!storage.dbAvailable) {
    // Return from in-memory as fallback
    const arr = [];
    for (const [id, job] of jobs.entries()) {
      arr.push({
        id,
        url: job.url || null,
        status: job.status,
        video_url: job.videoUrl || null,
        thumbnail_url: job.thumbnailUrl || null,
        video_size_bytes: job.metadata?.fileSize || null,
        duration_seconds: job.metadata?.duration || null,
        created_at: new Date(job.createdAt).toISOString(),
        completed_at: job.status === 'completed' ? new Date().toISOString() : null,
        error: job.error || null,
      });
    }
    arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return res.json({
      jobs: arr.slice(offset, offset + limit),
      total: arr.length,
      limit,
      offset,
      source: 'memory',
    });
  }

  const history = await storage.getHistory(limit, offset);
  res.json({
    jobs: history,
    limit,
    offset,
    source: 'database',
  });
});

// ─── GET /api/stats ───────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  if (!storage.dbAvailable) {
    // Compute from in-memory
    let completed = 0, failed = 0, active = 0, totalBytes = 0;
    for (const [, job] of jobs) {
      if (job.status === 'completed') { completed++; totalBytes += job.metadata?.fileSize || 0; }
      else if (job.status === 'failed') failed++;
      else if (job.status === 'processing' || job.status === 'queued') active++;
    }
    return res.json({
      total_jobs: jobs.size,
      completed,
      failed,
      active,
      total_bytes: totalBytes,
      avg_duration: null,
      last_job_at: null,
      source: 'memory',
    });
  }

  const stats = await storage.getStats();
  res.json({ ...(stats || {}), source: 'database' });
});

// ─── GET /api/audio/:filename ─────────────────────────────────────────────────
app.get('/api/audio/:filename', (req, res) => {
  const audioPath = path.join(__dirname, 'public', 'audio', req.params.filename);
  if (!fs.existsSync(audioPath)) {
    return res.status(404).json({ error: 'Audio file not found' });
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.sendFile(audioPath);
});

// ─── POST /api/script/generate ───────────────────────────────────────────────
app.post('/api/script/generate', async (req, res) => {
  const { url, purpose = 'product-demo', duration = 30, tone = 'professional' } = req.body;

  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    new URL(url); // validate
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const validPurposes = ['product-demo', 'tutorial', 'showcase', 'teaser'];
  const validTones = ['professional', 'casual', 'exciting', 'technical'];

  if (!validPurposes.includes(purpose)) {
    return res.status(400).json({ error: `Invalid purpose. Use: ${validPurposes.join(', ')}` });
  }

  try {
    const result = await generateScript({ url, purpose, duration: Number(duration), tone });
    res.json(result);
  } catch (err) {
    if (err.message.includes('GEMINI_API_KEY')) {
      return res.status(503).json({ error: 'Script generation unavailable: GEMINI_API_KEY not configured' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/voiceover/generate ────────────────────────────────────────────
app.post('/api/voiceover/generate', async (req, res) => {
  const { script, voice = 'alloy', provider = 'elevenlabs' } = req.body;

  if (!script || typeof script !== 'string' || !script.trim()) {
    return res.status(400).json({ error: 'script text is required' });
  }

  if (script.length > 5000) {
    return res.status(400).json({ error: 'Script too long (max 5000 characters)' });
  }

  try {
    const result = await generateVoiceover({ script, voice, provider });
    res.json({
      audioUrl: result.audioUrl,
      duration: result.duration,
      audioId: result.audioId,
    });
  } catch (err) {
    if (err.message.includes('ELEVENLABS_API_KEY')) {
      return res.status(503).json({ error: 'Voiceover unavailable: ELEVENLABS_API_KEY not configured' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/docs ────────────────────────────────────────────────────────────
app.get('/api/docs', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  res.json({
    openapi: '3.0.0',
    info: {
      title: 'DemoReel API',
      version: '2.0.0',
      description: 'Agent-friendly demo video studio. Record any webpage as a polished scroll-through video with optional voiceover, music, and branding.',
    },
    servers: [{ url: baseUrl }],
    endpoints: {
      'GET /health': {
        description: 'Health check',
        response: { status: 'ok', version: '2.0.0', jobs: 0, storage: { db: true, r2: true } },
      },
      'GET /api/presets': {
        description: 'List all available presets (music, voices, viewports, templates)',
        response: 'Returns { music[], voices[], viewports[], templates[], speeds[], themes[] }',
      },
      'POST /api/record': {
        description: 'Start a new recording job',
        body: {
          url: { type: 'string', required: true, description: 'URL to record' },
          viewport: { type: 'string', default: 'desktop', enum: ['mobile', 'tablet', 'desktop', 'widescreen', 'custom'] },
          customViewport: { type: 'object', description: '{ width, height } — required if viewport=custom' },
          theme: { type: 'string', default: 'dark', enum: ['dark', 'light'] },
          speed: { type: 'string', default: 'medium', enum: ['slow', 'medium', 'fast', 'blazing'] },
          duration: { type: 'number', default: 30, description: 'Max duration in seconds (5-120)' },
          cursor: { type: 'boolean', default: true, description: 'Show glowing cursor' },
          scrollTarget: { type: 'string', default: 'auto', description: 'auto|body|css-selector' },
          hideScrollbar: { type: 'boolean', default: true },
          interactions: {
            type: 'array',
            description: 'Actions to perform before recording',
            items: {
              examples: [
                { type: 'click', selector: '.button' },
                { type: 'type', selector: '#search', text: 'hello' },
                { type: 'wait', ms: 1000 },
                { type: 'scroll-to', selector: '#features' },
                { type: 'hover', selector: '.nav-item' },
              ],
            },
          },
          music: {
            type: 'object',
            properties: {
              track: { type: 'string', description: 'Track ID from /api/presets or "none"' },
              volume: { type: 'number', description: '0.0 to 1.0', default: 0.3 },
            },
          },
          branding: {
            type: 'object',
            properties: {
              showBadge: { type: 'boolean', description: 'Show "Made with DemoReel" badge' },
            },
          },
          privacy: {
            type: 'object',
            description: 'Privacy protection — blur sensitive content',
            properties: {
              blur: { type: 'array', items: { type: 'string' }, description: 'CSS selectors to blur' },
              autoDetect: { type: 'boolean', default: true },
              blurStrength: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
            },
          },
          protection: {
            type: 'object',
            description: 'Anti-clone protection',
            properties: {
              fingerprint: { type: 'boolean', default: true },
              watermark: { type: 'boolean', default: false },
              watermarkText: { type: 'string', default: 'Made with DemoReel' },
            },
          },
          export: {
            type: 'object',
            properties: {
              format: { type: 'string', enum: ['mp4', 'webm'], default: 'mp4' },
              quality: { type: 'string', enum: ['low', 'medium', 'high', 'ultra'], default: 'high' },
              resolution: { type: 'string', enum: ['720p', '1080p'], default: '1080p' },
            },
          },
        },
        response: {
          id: 'uuid',
          status: 'processing',
          progress: 5,
          progressMessage: 'Initializing...',
          estimatedTime: 45,
          downloadUrl: null,
          videoUrl: null,
          thumbnailUrl: null,
          error: null,
          metadata: { duration: null, fileSize: null, resolution: '1280x720', scenes: 0 },
        },
      },
      'GET /api/status/:id': {
        description: 'Poll job status — checks in-memory first, then Supabase for historical jobs',
        response: 'Same as POST /api/record response. status: queued|processing|completed|failed',
      },
      'GET /api/download/:id': {
        description: 'Download completed video — redirects to R2 URL if available, else serves from /tmp',
        response: 'Redirects to video/mp4 or JSON error',
      },
      'GET /api/history': {
        description: 'Paginated job history from Supabase',
        query: { limit: 'max 200, default 50', offset: 'default 0' },
        response: '{ jobs[], total, limit, offset, source }',
      },
      'GET /api/stats': {
        description: 'Aggregate stats: total jobs, sizes, durations',
        response: '{ total_jobs, completed, failed, active, total_bytes, avg_duration, last_job_at, source }',
      },
      'POST /api/script/generate': {
        description: 'AI-powered script generation via Gemini (requires GEMINI_API_KEY)',
        body: {
          url: { type: 'string', required: true },
          purpose: { type: 'string', enum: ['product-demo', 'tutorial', 'showcase', 'teaser'], default: 'product-demo' },
          duration: { type: 'number', default: 30 },
          tone: { type: 'string', enum: ['professional', 'casual', 'exciting', 'technical'], default: 'professional' },
        },
        response: { script: 'narration text...', sections: [{ text: '...', scrollPercent: 0 }] },
      },
      'POST /api/voiceover/generate': {
        description: 'Generate voiceover audio via ElevenLabs (requires ELEVENLABS_API_KEY)',
        body: {
          script: { type: 'string', required: true },
          voice: { type: 'string', default: 'alloy' },
          provider: { type: 'string', default: 'elevenlabs', enum: ['elevenlabs'] },
        },
        response: { audioUrl: '/api/audio/uuid.mp3', duration: 28.5 },
      },
      'GET /api/audio/:filename': {
        description: 'Serve generated audio files',
        response: 'audio/mpeg binary',
      },
    },
    agentUsage: {
      description: 'Recommended agent workflow',
      steps: [
        '1. POST /api/record with your URL and options → receive { id }',
        '2. Poll GET /api/status/:id every 2-3 seconds until status==="completed"',
        '3. Use downloadUrl or videoUrl from status response (R2 link if available)',
        '4. GET /api/history to list past recordings with thumbnails',
        '5. GET /api/stats for aggregate metrics',
        '6. Optionally: generate script first via POST /api/script/generate',
        '7. Optionally: generate voiceover via POST /api/voiceover/generate',
      ],
    },
  });
});

// ─── Serve audio files from public/audio ─────────────────────────────────────
app.use('/audio', express.static(path.join(__dirname, 'public', 'audio')));

// ─── Dashboard route ─────────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ─── Extension popup (hosted UI — updates without reinstall) ─────────────────
app.get('/extension-popup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'extension-popup.html'));
});

// ─── Recording page (full-tab recorder with timer + stop button) ─────────────
app.get('/record', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'record.html'));
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW v3 ENDPOINTS: Screen Recording Upload + Assembly Pipeline + X Post
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/upload-recording
 * Accept a screen recording file upload + description → run full pipeline
 * Body (multipart): recording (video file), description, title, purpose, tone, duration, voice
 */
app.post('/api/upload-recording', upload.single('recording'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No recording file uploaded. Use field name: recording' });
    }

    const {
      description = '',
      title = '',
      purpose = 'product-demo',
      tone = 'professional',
      duration = 30,
      voice = 'alloy',
      speed = '1',
      blurCredentials = 'false',
      chapters = 'false',
      autoZoom = 'false',
      cursor = 'true',
      webcam = 'false',
      region = null,
      bgColor = '#0d1117',
      bgStyle = 'dark-studio',
      bgFrame = 'none',
      bgPadding = '40',
    } = req.body;

    const id = uuidv4();

    // Upload to R2
    let recordingUrl = null;
    try {
      const fileBuffer = fs.readFileSync(file.path);
      const r2Key = `recordings/${id}.${file.path.endsWith('.mp4') ? 'mp4' : 'webm'}`;
      recordingUrl = await storage.uploadToR2(r2Key, fileBuffer, file.mimetype || 'video/webm');
    } catch (e) {
      console.warn('[upload-recording] R2 upload failed, using tmp path:', e.message);
      recordingUrl = null;
    }

    // Create job record
    const job = {
      status: 'processing',
      progress: 'Uploading recording...',
      progressPercent: 10,
      outputPath: file.path,
      recordingUrl,
      videoUrl: null,
      thumbnailUrl: null,
      error: null,
      createdAt: Date.now(),
      estimatedTime: parseInt(duration) + 30,
      metadata: { duration: null, fileSize: file.size, resolution: null, scenes: 0 },
      script: null,
      voiceoverUrl: null,
      shotstackRenderId: null,
      assembledVideoUrl: null,
      xpost: null,
    };

    jobs.set(id, job);
    storage.createJob(id, title || 'Screen Recording', { purpose, tone, duration, voice }, getClientIp(req), req.headers['user-agent']).catch(() => {});

    // Run pipeline async with all options
    let parsedRegion = null;
    try {
      parsedRegion = region ? JSON.parse(region) : null;
    } catch {}

    runAssemblyPipeline({
      id,
      job,
      recordingUrl: recordingUrl || `file://${file.path}`,
      description,
      title,
      purpose,
      tone,
      duration: parseInt(duration),
      voice,
      speed: parseFloat(speed) || 1,
      blurCredentials: blurCredentials === 'true',
      chapters: chapters === 'true',
      autoZoom: autoZoom === 'true',
      cursor: cursor === 'true',
      webcam: webcam === 'true',
      region: parsedRegion,
      bgColor,
      bgFrame,
      bgPadding: parseInt(bgPadding) || 40,
    });

    res.json({ id, status: 'processing', message: 'Recording uploaded. Pipeline started.' });
  } catch (err) {
    console.error('[upload-recording] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/assemble
 * Accept a recording URL + description → run full pipeline
 * Body (JSON): { recordingUrl, description, title, purpose, tone, duration, voice }
 */
app.post('/api/assemble', async (req, res) => {
  const {
    recordingUrl,
    description = '',
    title = '',
    purpose = 'product-demo',
    tone = 'professional',
    duration = 30,
    voice = 'alloy',
  } = req.body;

  if (!recordingUrl) {
    return res.status(400).json({ error: 'recordingUrl is required' });
  }

  const id = uuidv4();
  const job = {
    status: 'processing',
    progress: 'Starting assembly pipeline...',
    progressPercent: 5,
    outputPath: null,
    recordingUrl,
    videoUrl: null,
    thumbnailUrl: null,
    error: null,
    createdAt: Date.now(),
    estimatedTime: parseInt(duration) + 45,
    metadata: { duration: null, fileSize: null, resolution: null, scenes: 0 },
    script: null,
    voiceoverUrl: null,
    shotstackRenderId: null,
    assembledVideoUrl: null,
    xpost: null,
  };

  jobs.set(id, job);
  storage.createJob(id, recordingUrl, { purpose, tone, duration, voice }, getClientIp(req), req.headers['user-agent']).catch(() => {});

  runAssemblyPipeline({ id, job, recordingUrl, description, title, purpose, tone, duration: parseInt(duration), voice });

  res.json({ id, status: 'processing', message: 'Assembly pipeline started.' });
});

/**
 * GET /api/xpost/:id
 * Generate X post copy for a completed job
 */
app.get('/api/xpost/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Return cached xpost if available
  if (job.xpost) {
    return res.json(job.xpost);
  }

  if (!job.script) {
    return res.status(400).json({ error: 'No script available for this job. Run the assembly pipeline first.' });
  }

  try {
    const xpost = await generateXPost({
      script: job.script,
      title: job.metadata?.title || '',
      url: job.url || '',
      tone: job.metadata?.tone || 'professional',
    });
    job.xpost = xpost;
    storage.updateJob(req.params.id, { xpost: JSON.stringify(xpost) }).catch(() => {});
    res.json(xpost);
  } catch (err) {
    console.error('[xpost] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Core assembly pipeline: script → VO → Shotstack
 * Enhanced with: credential blur, chapters, speed control, region crop, webcam overlay
 */
async function runAssemblyPipeline({ id, job, recordingUrl, description, title, purpose, tone, duration, voice, speed = 1, blurCredentials = false, chapters = false, autoZoom = false, cursor = true, webcam = false, region = null, bgColor = '#0d1117', bgFrame = 'none', bgPadding = 40 }) {
  try {
    // Step 1: Generate script via Claude
    job.progress = 'Generating script with Claude...';
    job.progressPercent = 20;

    const { script, sections } = await generateScript({
      url: null,
      description,
      purpose,
      duration,
      tone,
    });

    job.script = script;
    job.progressPercent = 40;
    job.progress = 'Generating voiceover with ElevenLabs...';

    // Step 2: Generate voiceover
    let voiceoverUrl = null;
    try {
      const vo = await generateVoiceover({ script, voice, provider: 'elevenlabs' });
      voiceoverUrl = vo.audioUrl;
      job.voiceoverUrl = voiceoverUrl;

      // Upload VO to R2
      if (vo.audioPath) {
        try {
          const audioBuffer = fs.readFileSync(vo.audioPath);
          const r2Key = `voiceovers/${id}.mp3`;
          const r2Url = await storage.uploadToR2(r2Key, audioBuffer, 'audio/mpeg');
          voiceoverUrl = r2Url;
          job.voiceoverUrl = r2Url;
        } catch { /* use local URL */ }
      }
    } catch (voErr) {
      console.warn('[pipeline] VO generation failed:', voErr.message);
    }

    job.progressPercent = 60;
    job.progress = 'Assembling video with Shotstack...';

    // Step 3: Shotstack assembly with all enhancements
    const finalDuration = Math.round(duration / speed);
    const { renderId } = await assembleDemo({
      screenRecordingUrl: recordingUrl,
      voiceoverUrl: voiceoverUrl ? `https://demoreel-production.up.railway.app${voiceoverUrl}` : null,
      script,
      sections,
      duration: finalDuration,
      title,
      speed,
      blurCredentials,
      chapters,
      autoZoom,
      cursorEffects: cursor,
      webcamOverlay: webcam,
      region,
      bgColor,
      bgFrame,
      bgPadding,
    });

    job.shotstackRenderId = renderId;
    job.progress = 'Rendering video (Shotstack)...';
    job.progressPercent = 70;

    // Step 4: Poll Shotstack until done (max 5 min)
    let renderDone = false;
    let assembledUrl = null;
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const poll = await pollShotstack(renderId);

      if (poll.status === 'done') {
        assembledUrl = poll.url;
        renderDone = true;
        break;
      } else if (poll.status === 'failed') {
        throw new Error(`Shotstack render failed: ${poll.error}`);
      }

      job.progressPercent = 70 + Math.round((i / maxAttempts) * 25);
      job.progress = `Rendering (${poll.status})...`;
    }

    if (!renderDone) {
      throw new Error('Shotstack render timed out after 5 minutes');
    }

    // Done!
    job.status = 'completed';
    job.progress = 'Done!';
    job.progressPercent = 100;
    job.assembledVideoUrl = assembledUrl;
    job.videoUrl = assembledUrl;

    storage.updateJob(id, {
      status: 'completed',
      video_url: assembledUrl,
      script,
      voiceover_url: voiceoverUrl,
    }).catch(() => {});

    console.log(`[pipeline] Job ${id} completed. Video: ${assembledUrl}`);

  } catch (err) {
    console.error(`[pipeline] Job ${id} failed:`, err);
    job.status = 'failed';
    job.error = err.message;
    job.progressPercent = 0;
    storage.updateJob(id, { status: 'failed', error: err.message }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload-reel — Multi-clip reel assembly
// Body (multipart): clip_0, clip_1, ... + description, sfx, cursor, voice, tone
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/upload-reel', reelUpload.any(), async (req, res) => {
  try {
    const clips = (req.files || []).filter(f => f.fieldname.startsWith('clip_'));
    if (clips.length < 2) {
      return res.status(400).json({ error: 'At least 2 clips are required for a reel' });
    }

    const {
      description = '',
      sfx = 'whoosh',
      cursor = 'smooth',
      autoZoom = 'true',
      voice = 'alloy',
      tone = 'exciting',
    } = req.body;

    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }

    const id = uuidv4();
    const job = {
      status: 'processing',
      progress: 'Processing reel clips...',
      progressPercent: 5,
      outputPath: null,
      videoUrl: null,
      thumbnailUrl: null,
      error: null,
      createdAt: Date.now(),
      estimatedTime: clips.length * 20 + 60,
      metadata: { duration: null, fileSize: null, resolution: null, scenes: clips.length, type: 'reel' },
      script: null,
      voiceoverUrl: null,
      shotstackRenderId: null,
      assembledVideoUrl: null,
      xpost: null,
    };

    jobs.set(id, job);
    storage.createJob(id, `Reel: ${description.slice(0, 80)}`, { description, sfx, cursor, autoZoom, voice, tone }, getClientIp(req), req.headers['user-agent']).catch(() => {});

    // Upload clips to R2 and run reel pipeline
    runReelPipeline({ id, job, clips, description, sfx, cursor, autoZoom: autoZoom === 'true', voice, tone });

    res.json({ id, status: 'processing', message: `Reel pipeline started with ${clips.length} clips.` });

  } catch (err) {
    console.error('[upload-reel] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Generate SFX audio via ElevenLabs Sound Generation API
 */
async function generateSFX(prompt, durationSeconds = 2) {
  const https = require('https');
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVENLABS_API_KEY) return null;

  const sfxPrompts = {
    whoosh: 'fast whoosh transition sound effect, cinematic',
    cinematic: 'deep cinematic impact boom, dramatic',
    tech: 'UI click notification sound, clean digital beep',
    none: null,
  };

  const sfxPromptText = typeof prompt === 'string' && sfxPrompts[prompt] !== undefined
    ? sfxPrompts[prompt]
    : prompt;

  if (!sfxPromptText) return null;

  const body = JSON.stringify({
    text: sfxPromptText,
    duration_seconds: Math.min(durationSeconds, 5),
    prompt_influence: 0.3,
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.elevenlabs.io',
      path: '/v1/sound-generation',
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'audio/mpeg',
      },
    };

    const sfxPath = `/tmp/sfx-${uuidv4()}.mp3`;
    const writeStream = require('fs').createWriteStream(sfxPath);

    const req = https.request(options, (sfxRes) => {
      if (sfxRes.statusCode !== 200) {
        sfxRes.resume();
        console.warn(`[sfx] ElevenLabs SFX API returned ${sfxRes.statusCode}`);
        resolve(null);
        return;
      }
      sfxRes.pipe(writeStream);
      writeStream.on('finish', () => resolve(sfxPath));
    });

    req.on('error', (e) => { console.warn('[sfx] Error:', e.message); resolve(null); });
    req.write(body);
    req.end();

    setTimeout(() => { try { req.destroy(); } catch {} resolve(null); }, 15000);
  });
}

/**
 * Core reel assembly pipeline
 * Uploads clips → generates VO → adds SFX → Shotstack assembly
 */
async function runReelPipeline({ id, job, clips, description, sfx, cursor, autoZoom, voice, tone }) {
  const { execSync } = require('child_process');
  const https = require('https');

  try {
    job.progress = 'Uploading clips to storage...';
    job.progressPercent = 10;

    // Upload all clips to R2
    const clipUrls = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      try {
        const buf = fs.readFileSync(clip.path);
        const key = `reels/${id}/clip_${i}.webm`;
        const url = await storage.uploadToR2(key, buf, 'video/webm');
        clipUrls.push(url || `file://${clip.path}`);
      } catch {
        clipUrls.push(`file://${clip.path}`);
      }
      job.progressPercent = 10 + Math.round((i / clips.length) * 15);
    }

    job.progress = 'Generating reel script with Claude...';
    job.progressPercent = 25;

    // Generate script for the reel (shorter, punchier for teaser)
    const reelDuration = Math.min(clips.length * 10, 45);
    const { script, sections } = await generateScript({
      url: null,
      description: `REEL TEASER: ${description}. This is a ${clips.length}-clip product teaser, keep it punchy and exciting.`,
      purpose: 'teaser',
      duration: reelDuration,
      tone,
    });

    job.script = script;
    job.progressPercent = 40;
    job.progress = 'Generating voiceover...';

    // Generate voiceover
    let voiceoverUrl = null;
    try {
      const vo = await generateVoiceover({ script, voice, provider: 'elevenlabs' });
      voiceoverUrl = vo.audioUrl;
      job.voiceoverUrl = voiceoverUrl;

      if (vo.audioPath) {
        try {
          const buf = fs.readFileSync(vo.audioPath);
          const r2Url = await storage.uploadToR2(`reels/${id}/voiceover.mp3`, buf, 'audio/mpeg');
          if (r2Url) { voiceoverUrl = r2Url; job.voiceoverUrl = r2Url; }
        } catch {}
      }
    } catch (voErr) {
      console.warn('[reel-pipeline] VO failed:', voErr.message);
    }

    job.progress = 'Generating SFX transitions...';
    job.progressPercent = 50;

    // Generate SFX for transitions between clips
    let sfxUrl = null;
    if (sfx !== 'none') {
      const sfxPath = await generateSFX(sfx, 1.5);
      if (sfxPath) {
        try {
          const buf = fs.readFileSync(sfxPath);
          const r2Url = await storage.uploadToR2(`reels/${id}/sfx.mp3`, buf, 'audio/mpeg');
          sfxUrl = r2Url;
          try { fs.unlinkSync(sfxPath); } catch {}
        } catch {}
      }
    }

    job.progress = 'Assembling reel with Shotstack...';
    job.progressPercent = 60;

    // Build Shotstack reel timeline
    const clipDuration = reelDuration / clips.length;
    const tracks = [];

    // Video tracks: one clip per segment
    const videoClips = clipUrls.map((url, i) => ({
      asset: { type: 'video', src: url, volume: 0 },
      start: i * clipDuration,
      length: clipDuration,
      transition: i < clipUrls.length - 1 ? { in: 'fade', out: 'fade' } : { in: 'fade' },
      effect: autoZoom ? 'zoomIn' : undefined,
    }));
    tracks.push({ clips: videoClips });

    // SFX transitions between clips
    if (sfxUrl && clips.length > 1) {
      const sfxClips = [];
      for (let i = 1; i < clips.length; i++) {
        sfxClips.push({
          asset: { type: 'audio', src: sfxUrl, volume: 0.8 },
          start: i * clipDuration - 0.3,
          length: 1.5,
        });
      }
      tracks.push({ clips: sfxClips });
    }

    // Voiceover
    if (voiceoverUrl) {
      const voUrl = voiceoverUrl.startsWith('/api/')
        ? `https://demoreel-production.up.railway.app${voiceoverUrl}`
        : voiceoverUrl;
      tracks.push({ clips: [{ asset: { type: 'audio', src: voUrl, volume: 1 }, start: 0, length: reelDuration }] });
    }

    // Caption clips per section
    if (sections?.length) {
      const captionClips = sections.map((sec, i) => {
        const nextSec = sections[i + 1];
        const start = (sec.scrollPercent / 100) * reelDuration;
        const end = nextSec ? (nextSec.scrollPercent / 100) * reelDuration : reelDuration;
        return {
          asset: { type: 'title', text: sec.text, style: 'subtitle', color: '#ffffff', size: 'small', position: 'bottomCenter' },
          start,
          length: Math.min(end - start, 5),
          transition: { in: 'fade', out: 'fade' },
        };
      });
      tracks.push({ clips: captionClips });
    }

    // Title intro card
    tracks.push({ clips: [{
      asset: { type: 'title', text: description.slice(0, 60), style: 'future', color: '#ffffff', size: 'medium', background: '#000000', position: 'center' },
      start: 0, length: 2,
      transition: { in: 'fade', out: 'fade' },
    }]});

    const { assembleDemo, pollShotstack } = require('./shotstackAssembler');

    // Use direct Shotstack render for reel (custom timeline)
    const https2 = require('https');
    const shotstackPayload = {
      timeline: { background: '#000000', tracks },
      output: { format: 'mp4', resolution: 'hd', aspectRatio: '16:9', fps: 30 },
    };

    const renderRes = await new Promise((resolve, reject) => {
      const body = JSON.stringify(shotstackPayload);
      const opts = {
        hostname: 'v1.shotstack.io',
        path: '/edit/v1/render',
        method: 'POST',
        headers: {
          'x-api-key': process.env.SHOTSTACK_API_KEY || 'Pmh5dSMlQQAW2Q0jeGnJXUM9oQW5Tz7gCAqDOIkm',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };
      const req = https2.request(opts, (r) => {
        let data = '';
        r.on('data', d => { data += d; });
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (renderRes.status !== 201 && renderRes.status !== 200) {
      throw new Error(`Shotstack reel render failed (${renderRes.status}): ${JSON.stringify(renderRes.body)}`);
    }

    const renderId = renderRes.body?.response?.id;
    if (!renderId) throw new Error('No render ID from Shotstack');

    job.shotstackRenderId = renderId;
    job.progress = 'Rendering reel (Shotstack)...';
    job.progressPercent = 70;

    // Poll Shotstack
    let done = false;
    let finalUrl = null;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const poll = await pollShotstack(renderId);
      if (poll.status === 'done') { finalUrl = poll.url; done = true; break; }
      if (poll.status === 'failed') throw new Error(`Shotstack render failed: ${poll.error}`);
      job.progressPercent = 70 + Math.round((i / 60) * 25);
    }

    if (!done) throw new Error('Reel render timed out');

    job.status = 'completed';
    job.progress = 'Reel ready!';
    job.progressPercent = 100;
    job.assembledVideoUrl = finalUrl;
    job.videoUrl = finalUrl;

    storage.updateJob(id, { status: 'completed', video_url: finalUrl, script, voiceover_url: voiceoverUrl }).catch(() => {});
    console.log(`[reel-pipeline] Job ${id} done. URL: ${finalUrl}`);

    // Cleanup temp clip files
    clips.forEach(c => { try { fs.unlinkSync(c.path); } catch {} });

  } catch (err) {
    console.error(`[reel-pipeline] Job ${id} failed:`, err.message);
    job.status = 'failed';
    job.error = err.message;
    job.progressPercent = 0;
    storage.updateJob(id, { status: 'failed', error: err.message }).catch(() => {});
    clips.forEach(c => { try { fs.unlinkSync(c.path); } catch {} });
  }
}

// ─── Start Server ─────────────────────────────────────────────────────────────
async function start() {
  // Init storage (non-blocking if unavailable)
  await storage.init();

  app.listen(PORT, () => {
    console.log(`🎬 DemoReel v3 running on port ${PORT}`);
    console.log(`   Health:  http://localhost:${PORT}/health`);
    console.log(`   API:     http://localhost:${PORT}/api/docs`);
    console.log(`   UI:      http://localhost:${PORT}/`);
    console.log(`   DB:      ${storage.dbAvailable ? '✅ Supabase' : '⚠️  in-memory fallback'}`);
    console.log(`   Storage: ${storage.r2Available ? '✅ Cloudflare R2' : '⚠️  /tmp fallback'}`);

    // Ensure audio directory exists
    fs.mkdirSync(path.join(__dirname, 'public', 'audio'), { recursive: true });
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
