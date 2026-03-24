/**
 * storage.js — Supabase + Cloudflare R2 storage layer for DemoReel
 * Graceful: falls back to in-memory if DB/R2 is unavailable
 */

const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS demoreel_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  config JSONB DEFAULT '{}',
  video_url TEXT,
  video_size_bytes BIGINT,
  duration_seconds FLOAT,
  thumbnail_url TEXT,
  script TEXT,
  voiceover_url TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_demoreel_jobs_created ON demoreel_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demoreel_jobs_status ON demoreel_jobs(status);
`;

class Storage {
  constructor() {
    this.dbAvailable = false;
    this.r2Available = false;
    this.pool = null;
    this.s3 = null;

    const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_URL;
    if (dbUrl) {
      try {
        this.pool = new Pool({
          connectionString: dbUrl,
          ssl: { rejectUnauthorized: false },
          max: 5,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
      } catch (e) {
        console.warn('[storage] pg Pool init failed:', e.message);
      }
    }

    const r2Endpoint = process.env.R2_ENDPOINT;
    const r2Key = process.env.R2_ACCESS_KEY_ID;
    const r2Secret = process.env.R2_SECRET_ACCESS_KEY;

    if (r2Endpoint && r2Key && r2Secret) {
      try {
        this.s3 = new S3Client({
          region: 'auto',
          endpoint: r2Endpoint,
          credentials: {
            accessKeyId: r2Key,
            secretAccessKey: r2Secret,
          },
        });
      } catch (e) {
        console.warn('[storage] S3Client init failed:', e.message);
      }
    }

    this.bucket = process.env.R2_BUCKET_NAME || 'maragakis-aii';
    this.publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  }

  async init() {
    // Init Supabase
    if (this.pool) {
      try {
        await this.pool.query(CREATE_TABLE_SQL);
        this.dbAvailable = true;
        console.log('[storage] ✅ Supabase connected, tables ready');
      } catch (e) {
        console.warn('[storage] ⚠️  Supabase unavailable, using in-memory fallback:', e.message);
        this.dbAvailable = false;
      }
    } else {
      console.log('[storage] ℹ️  No DATABASE_URL set — using in-memory fallback');
    }

    // Init R2
    if (this.s3) {
      try {
        // Quick connectivity check via a lightweight ListObjectsV2 (just 1 key)
        const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
        await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
        this.r2Available = true;
        console.log('[storage] ✅ Cloudflare R2 connected');
      } catch (e) {
        console.warn('[storage] ⚠️  R2 unavailable, videos will be served from /tmp:', e.message);
        this.r2Available = false;
      }
    } else {
      console.log('[storage] ℹ️  No R2 credentials set — videos served from /tmp');
    }
  }

  // ── Job CRUD ──────────────────────────────────────────────────────────────

  async createJob(id, url, config = {}, ip = null, ua = null) {
    if (!this.dbAvailable) return null;
    try {
      const res = await this.pool.query(
        `INSERT INTO demoreel_jobs (id, url, status, config, ip_address, user_agent)
         VALUES ($1, $2, 'queued', $3, $4, $5)
         RETURNING id`,
        [id, url, JSON.stringify(config), ip, ua]
      );
      return res.rows[0]?.id || null;
    } catch (e) {
      console.warn('[storage] createJob failed:', e.message);
      return null;
    }
  }

  async updateJob(id, updates = {}) {
    if (!this.dbAvailable) return;
    const fields = [];
    const values = [];
    let i = 1;

    const allowed = [
      'status', 'video_url', 'video_size_bytes', 'duration_seconds',
      'thumbnail_url', 'script', 'voiceover_url', 'error', 'completed_at',
    ];

    for (const key of allowed) {
      if (key in updates) {
        fields.push(`${key} = $${i++}`);
        values.push(updates[key]);
      }
    }

    if (updates.status === 'completed' && !('completed_at' in updates)) {
      fields.push(`completed_at = $${i++}`);
      values.push(new Date().toISOString());
    }

    if (fields.length === 0) return;
    values.push(id);

    try {
      await this.pool.query(
        `UPDATE demoreel_jobs SET ${fields.join(', ')} WHERE id = $${i}`,
        values
      );
    } catch (e) {
      console.warn('[storage] updateJob failed:', e.message);
    }
  }

  async getJob(id) {
    if (!this.dbAvailable) return null;
    try {
      const res = await this.pool.query(
        'SELECT * FROM demoreel_jobs WHERE id = $1',
        [id]
      );
      return res.rows[0] || null;
    } catch (e) {
      console.warn('[storage] getJob failed:', e.message);
      return null;
    }
  }

  async getHistory(limit = 50, offset = 0) {
    if (!this.dbAvailable) return [];
    try {
      const res = await this.pool.query(
        `SELECT id, url, status, video_url, video_size_bytes, duration_seconds,
                thumbnail_url, error, created_at, completed_at, config
         FROM demoreel_jobs
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [Math.min(limit, 200), offset]
      );
      return res.rows;
    } catch (e) {
      console.warn('[storage] getHistory failed:', e.message);
      return [];
    }
  }

  async getStats() {
    if (!this.dbAvailable) return null;
    try {
      const res = await this.pool.query(`
        SELECT
          COUNT(*)::int AS total_jobs,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'processing' OR status = 'queued')::int AS active,
          COALESCE(SUM(video_size_bytes) FILTER (WHERE status = 'completed'), 0)::bigint AS total_bytes,
          COALESCE(AVG(duration_seconds) FILTER (WHERE status = 'completed'), 0)::float AS avg_duration,
          MAX(created_at) AS last_job_at
        FROM demoreel_jobs
      `);
      return res.rows[0] || null;
    } catch (e) {
      console.warn('[storage] getStats failed:', e.message);
      return null;
    }
  }

  // ── R2 Upload ─────────────────────────────────────────────────────────────

  async uploadVideo(jobId, filePath) {
    if (!this.r2Available || !this.s3) return null;
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const key = `demoreel/${jobId}.mp4`;
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: 'video/mp4',
        CacheControl: 'public, max-age=86400',
      }));
      const url = `${this.publicUrl}/${key}`;
      console.log(`[storage] ✅ Video uploaded to R2: ${url}`);
      return url;
    } catch (e) {
      console.warn('[storage] uploadVideo failed:', e.message);
      return null;
    }
  }

  async uploadThumbnail(jobId, filePath) {
    if (!this.r2Available || !this.s3) return null;
    if (!fs.existsSync(filePath)) return null;
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const key = `demoreel/thumbs/${jobId}.jpg`;
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=86400',
      }));
      const url = `${this.publicUrl}/${key}`;
      console.log(`[storage] ✅ Thumbnail uploaded to R2: ${url}`);
      return url;
    } catch (e) {
      console.warn('[storage] uploadThumbnail failed:', e.message);
      return null;
    }
  }

  // ── Thumbnail generation helper ───────────────────────────────────────────

  async generateThumbnail(videoPath, outputPath) {
    const { execSync } = require('child_process');
    try {
      execSync(
        `ffmpeg -y -i "${videoPath}" -ss 2 -vframes 1 -vf scale=640:-1 "${outputPath}" 2>/dev/null`,
        { timeout: 15000 }
      );
      return fs.existsSync(outputPath) ? outputPath : null;
    } catch (e) {
      console.warn('[storage] generateThumbnail failed:', e.message);
      return null;
    }
  }
}

module.exports = { Storage };
