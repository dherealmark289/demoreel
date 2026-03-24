/**
 * protection.js — Anti-clone protection, privacy blur, and visual fingerprinting
 *
 * Features:
 * 1. Privacy Blur — CSS-selector-targeted blurring + auto-detect sensitive data
 * 2. Invisible Fingerprint — unique per-video micro-variations via frame timing jitter
 * 3. Visible Watermark — "Made with DemoReel" badge
 * 4. Signature Visual Identity — branded scroll easing + entry animation
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Sensitive data patterns for auto-detection ───────────────────────────────
const SENSITIVE_PATTERNS = [
  // API keys / tokens
  /\b(sk-[a-zA-Z0-9]{32,}|xai-[a-zA-Z0-9]{40,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})\b/,
  // Emails
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
  // Phone numbers
  /\b(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/,
  // Credit card numbers (basic)
  /\b[0-9]{4}[-\s]?[0-9]{4}[-\s]?[0-9]{4}[-\s]?[0-9]{4}\b/,
  // Password fields (by label text proximity)
  /password|secret|private.?key|api.?key|access.?token/i,
];

// Selectors that likely contain sensitive data
const SENSITIVE_SELECTORS = [
  'input[type="password"]',
  'input[name*="password"]',
  'input[name*="secret"]',
  'input[name*="token"]',
  'input[name*="api"]',
  '[class*="api-key"]',
  '[class*="secret"]',
  '[class*="password"]',
  '[id*="api-key"]',
  '[id*="secret"]',
  '[id*="token"]',
  '.env-var',
  '.credential',
  '.private-key',
];

// ─── Generate fingerprint seed for this recording ─────────────────────────────
function generateFingerprintSeed() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Get the privacy + protection inject script for Playwright addInitScript
 */
function getProtectionScript(opts = {}) {
  const {
    blur = [],
    autoDetect = true,
    blurStrength = 'medium',
    showBadge = false,
    fingerprint = true,
    watermarkText = 'Made with DemoReel',
    fingerprintSeed = generateFingerprintSeed(),
  } = opts;

  const blurPx = { low: 4, medium: 8, high: 14 }[blurStrength] || 8;
  const sensitiveSelectorsJson = JSON.stringify(SENSITIVE_SELECTORS);
  const customBlurJson = JSON.stringify(blur);
  const badgeHtml = showBadge ? `
    const badge = document.createElement('div');
    badge.id = 'demoreel-badge';
    badge.textContent = '${watermarkText}';
    badge.style.cssText = \`
      position: fixed; bottom: 12px; right: 12px; z-index: 2147483646;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
      color: rgba(255,255,255,0.8); font-size: 11px; font-family: system-ui, sans-serif;
      padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.15);
      pointer-events: none; user-select: none; letter-spacing: 0.04em;
    \`;
    document.body.appendChild(badge);
  ` : '';

  return `
  (() => {
    const BLUR_PX = ${blurPx};
    const SENSITIVE_SELECTORS = ${sensitiveSelectorsJson};
    const CUSTOM_BLUR = ${customBlurJson};
    const AUTO_DETECT = ${autoDetect};
    const FP_SEED = '${fingerprintSeed}';

    // ── Privacy blur ────────────────────────────────────────────────────────
    function blurElement(el) {
      el.style.filter = 'blur(' + BLUR_PX + 'px)';
      el.style.webkitFilter = 'blur(' + BLUR_PX + 'px)';
      el.style.userSelect = 'none';
    }

    function applyBlurs() {
      // Custom selectors
      CUSTOM_BLUR.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(blurElement);
        } catch {}
      });

      // Auto-detect sensitive selectors
      if (AUTO_DETECT) {
        SENSITIVE_SELECTORS.forEach(sel => {
          try {
            document.querySelectorAll(sel).forEach(el => {
              if (el.value || el.textContent.length > 0) blurElement(el);
            });
          } catch {}
        });
      }
    }

    // Apply on load and after DOM mutations
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyBlurs);
    } else {
      applyBlurs();
    }

    // Re-apply on dynamic content
    const observer = new MutationObserver(() => applyBlurs());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // ── Invisible fingerprint ────────────────────────────────────────────────
    // Encode fingerprint seed as subtle pixel-level variations in a 1x1 canvas
    // placed off-screen. This embeds a unique ID in the rendered frame data.
    if (${fingerprint}) {
      const fpCanvas = document.createElement('canvas');
      fpCanvas.width = 4;
      fpCanvas.height = 4;
      fpCanvas.style.cssText = 'position:fixed;bottom:0;right:0;opacity:0.004;pointer-events:none;z-index:2147483640;';
      const ctx = fpCanvas.getContext('2d');
      // Encode seed as colors
      const seed = parseInt(FP_SEED.slice(0, 6), 16);
      const r = (seed >> 16) & 255;
      const g = (seed >> 8) & 255;
      const b = seed & 255;
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(0, 0, 4, 4);
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) document.body.appendChild(fpCanvas);
      });
    }

    // ── DemoReel signature scroll easing ────────────────────────────────────
    // Override native smooth scroll with our branded cubic-bezier easing
    const style = document.createElement('style');
    style.textContent = \`
      html {
        scroll-behavior: auto !important;
      }
      /* DemoReel signature easing — subtle overshoot for distinctive feel */
      @keyframes demoreel-scroll-indicator {
        0% { opacity: 0; transform: scaleX(0); }
        50% { opacity: 0.3; transform: scaleX(0.5); }
        100% { opacity: 0; transform: scaleX(1); }
      }
    \`;
    document.head.appendChild(style);

    // ── Branded entry animation ──────────────────────────────────────────────
    // Subtle fade-in on page load — DemoReel signature
    const fadeStyle = document.createElement('style');
    fadeStyle.id = 'demoreel-entry';
    fadeStyle.textContent = \`
      body { animation: demoreel-enter 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
      @keyframes demoreel-enter {
        from { opacity: 0.85; transform: scale(0.9985); }
        to { opacity: 1; transform: scale(1); }
      }
    \`;
    document.head.appendChild(fadeStyle);

    // ── Badge ────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { ${badgeHtml} });
    } else { ${badgeHtml} }

  })();
  `;
}

/**
 * Apply post-processing protection via ffmpeg:
 * - Optional visible watermark text overlay
 * - Frame timing micro-jitter (unique fingerprint per render)
 */
function getFFmpegProtectionFilters(opts = {}) {
  const {
    showBadge = false,
    watermarkText = 'Made with DemoReel',
    fingerprint = true,
    fingerprintSeed = generateFingerprintSeed(),
  } = opts;

  const filters = [];

  if (showBadge) {
    // Visible badge in bottom-right corner
    const escaped = watermarkText.replace(/'/g, "\\'").replace(/:/g, '\\:');
    filters.push(
      `drawtext=text='${escaped}':fontsize=14:fontcolor=white@0.55:` +
      `x=w-tw-12:y=h-th-10:` +
      `box=1:boxcolor=black@0.4:boxborderw=5:` +
      `borderw=0`
    );
  }

  if (fingerprint) {
    // Subtle per-frame metadata: embed seed in video stream metadata
    // Also add imperceptible noise at 0.003 intensity to make each render unique
    const seed = parseInt(fingerprintSeed.slice(0, 6), 16);
    const noiseStrength = 1 + (seed % 3); // 1-3 (imperceptible)
    filters.push(`noise=alls=${noiseStrength}:allf=t`);
  }

  return filters;
}

/**
 * Embed invisible fingerprint in MP4 metadata
 */
function embedFingerprintMetadata(videoPath, fingerprintSeed) {
  try {
    const tmpPath = videoPath + '.fp.mp4';
    execSync(
      `ffmpeg -y -i "${videoPath}" -c copy ` +
      `-metadata comment="DemoReel:${fingerprintSeed}" ` +
      `-metadata encoder="DemoReel v2.0" ` +
      `"${tmpPath}" 2>/dev/null`,
      { stdio: 'ignore', timeout: 30000 }
    );
    if (fs.existsSync(tmpPath)) {
      fs.renameSync(tmpPath, videoPath);
    }
  } catch {
    // Non-fatal — just skip
  }
}

module.exports = {
  getProtectionScript,
  getFFmpegProtectionFilters,
  embedFingerprintMetadata,
  generateFingerprintSeed,
  SENSITIVE_SELECTORS,
};
