/**
 * server.js — DemoReel Express backend
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { record } = require('./recorder');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory job store: { id: { status, outputPath, error, createdAt } }
const jobs = new Map();

// Cleanup old jobs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > 60 * 60 * 1000) { // 1 hour
      if (job.outputPath) {
        try { fs.unlinkSync(job.outputPath); } catch {}
      }
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── POST /api/record ───────────────────────────────────────────────────────
app.post('/api/record', async (req, res) => {
  const {
    url,
    speed = 'medium',
    viewport = 'desktop',
    theme = 'dark',
    cursor = true,
    duration = 30,
    music = false,
  } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  // Basic URL validation
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http/https URLs allowed');
    }
  } catch (e) {
    return res.status(400).json({ error: `Invalid URL: ${e.message}` });
  }

  const id = uuidv4();
  const outputPath = `/tmp/demoreel-${id}.mp4`;

  jobs.set(id, {
    status: 'recording',
    progress: 'Starting...',
    outputPath: null,
    error: null,
    createdAt: Date.now(),
  });

  // Start recording in background
  (async () => {
    try {
      await record({
        url: parsedUrl.href,
        speed,
        viewport,
        theme,
        cursor: Boolean(cursor),
        duration: Number(duration),
        music: Boolean(music),
        outputPath,
        onProgress: (msg) => {
          const job = jobs.get(id);
          if (job) job.progress = msg;
        },
      });

      const job = jobs.get(id);
      if (job) {
        job.status = 'done';
        job.outputPath = outputPath;
        job.progress = 'Done!';
      }
    } catch (err) {
      console.error(`[job ${id}] Error:`, err.message);
      const job = jobs.get(id);
      if (job) {
        job.status = 'error';
        job.error = err.message;
        job.progress = 'Failed';
      }
    }
  })();

  res.json({ id, status: 'recording' });
});

// ─── GET /api/status/:id ─────────────────────────────────────────────────────
app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({
    id: req.params.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    downloadUrl: job.status === 'done' ? `/api/download/${req.params.id}` : null,
  });
});

// ─── GET /api/download/:id ───────────────────────────────────────────────────
app.get('/api/download/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'done') return res.status(202).json({ error: 'Not ready yet', status: job.status });
  if (!job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(410).json({ error: 'File expired or missing' });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="demoreel-${req.params.id.slice(0, 8)}.mp4"`);
  res.sendFile(job.outputPath);
});

// ─── GET /api/health ─────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, jobs: jobs.size });
});

app.listen(PORT, () => {
  console.log(`🎬 DemoReel running on port ${PORT}`);
});
