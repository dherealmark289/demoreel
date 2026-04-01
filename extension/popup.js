/**
 * DemoReel Recorder — popup.js v2
 * Single clip + Multi-clip reel recording
 */

const DEFAULT_SERVER = 'https://demoreel-production.up.railway.app';

let serverUrl = DEFAULT_SERVER;
let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let recordingBlob = null;

// Reel state
let reelClips = []; // [{name, blob, size}]
let reelMediaRecorder = null;
let reelStream = null;
let reelChunks = [];

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved server URL
  const cfg = await chrome.storage.local.get(['serverUrl', 'recentJobs', 'autoOpen']);
  if (cfg.serverUrl) {
    serverUrl = cfg.serverUrl;
    document.getElementById('cfg-server').value = serverUrl;
  }
  if (cfg.autoOpen !== undefined) {
    document.getElementById('cfg-autoopen').checked = cfg.autoOpen;
  }

  // Wire settings save
  document.getElementById('cfg-server').addEventListener('change', (e) => {
    serverUrl = e.target.value.trim().replace(/\/$/, '') || DEFAULT_SERVER;
    chrome.storage.local.set({ serverUrl });
  });
  document.getElementById('cfg-autoopen').addEventListener('change', (e) => {
    chrome.storage.local.set({ autoOpen: e.target.checked });
  });
  document.getElementById('cfg-watermark').addEventListener('change', (e) => {
    chrome.storage.local.set({ watermark: e.target.checked });
  });

  // Recent jobs
  renderRecentJobs(cfg.recentJobs || []);

  // Cursor pill clicks
  document.querySelectorAll('#cursor-pills .pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#cursor-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
    });
  });

  // Wires
  document.getElementById('s-start').addEventListener('click', singleStart);
  document.getElementById('s-stop').addEventListener('click', singleStop);
  document.getElementById('s-generate').addEventListener('click', singleGenerate);
  document.getElementById('s-discard').addEventListener('click', singleDiscard);
  document.getElementById('s-region').addEventListener('change', handleRegionToggle);
});

// ── Tab Switcher ──────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const names = ['single', 'reel', 'settings'];
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-panel').forEach((p, i) => {
    const names = ['tab-single', 'tab-reel', 'tab-settings'];
    p.classList.toggle('active', p.id === `tab-${name}`);
  });
}

// ── SINGLE CLIP ───────────────────────────────────────────────────
function sSetStatus(text, state) {
  document.getElementById('s-status').textContent = text;
  const dot = document.getElementById('s-dot');
  dot.className = 'dot ' + (state || '');
}
function sShow(id) {
  ['s-pre', 's-recording', 's-describe', 's-result'].forEach(x => {
    const el = document.getElementById(x);
    if (el) el.classList.toggle('hidden', x !== id);
  });
}

async function singleStart() {
  try {
    sSetStatus('Requesting screen access...', '');
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: document.getElementById('s-cursor').checked ? 'always' : 'never' },
      audio: false,
    });

    recordedChunks = [];
    const mimeType = getSupportedMime();
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      recordingBlob = new Blob(recordedChunks, { type: mimeType });
      sSetStatus(`Recorded ${formatSize(recordingBlob.size)}`, 'ready');
      sShow('s-describe');
    };
    stream.getVideoTracks()[0].addEventListener('ended', () => singleStop());
    mediaRecorder.start(500);
    sSetStatus('Recording...', 'recording');
    sShow('s-recording');
  } catch (err) {
    sSetStatus(err.name === 'NotAllowedError' ? 'Permission denied' : err.message, '');
  }
}

function singleStop() {
  if (mediaRecorder?.state !== 'inactive') mediaRecorder?.stop();
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  sSetStatus('Processing...', 'processing');
}

async function singleGenerate() {
  const desc = document.getElementById('s-desc').value.trim();
  const title = document.getElementById('s-title').value.trim();
  if (!desc) { document.getElementById('s-desc').focus(); return; }
  if (!recordingBlob) return;

  const btn = document.getElementById('s-generate');
  btn.disabled = true; btn.textContent = '⏳ Uploading...';
  sSetStatus('Uploading to DemoReel...', 'processing');

  try {
    const fd = new FormData();
    fd.append('recording', recordingBlob, 'recording.webm');
    fd.append('description', desc);
    fd.append('title', title || desc.slice(0, 50));
    fd.append('voice', document.getElementById('s-voice').value);
    fd.append('tone', document.getElementById('s-tone').value);
    fd.append('purpose', 'product-demo');
    fd.append('duration', '30');

    const res = await fetch(`${serverUrl}/api/upload-recording`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const { id } = await res.json();

    saveJob(id, title || desc.slice(0, 30));
    document.getElementById('s-jobid').textContent = `Job: ${id}`;
    document.getElementById('s-watch').href = `${serverUrl}/?job=${id}`;
    sShow('s-result');
    sSetStatus('Pipeline running!', 'processing');

    const cfg = await chrome.storage.local.get(['autoOpen']);
    if (cfg.autoOpen !== false) chrome.tabs.create({ url: `${serverUrl}/?job=${id}` });

  } catch (err) {
    sSetStatus('Upload failed: ' + err.message, '');
  } finally {
    btn.disabled = false; btn.textContent = '🚀 Generate Demo Video';
  }
}

function singleDiscard() {
  recordingBlob = null; recordedChunks = [];
  document.getElementById('s-desc').value = '';
  document.getElementById('s-title').value = '';
  sShow('s-pre');
  sSetStatus('Ready to record', 'ready');
}

async function handleRegionToggle() {
  if (!document.getElementById('s-region').checked) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.postMessage({ type: 'DEMOREEL_REGION_SELECT' }, '*'),
    });
    window.close(); // close popup to let user interact with page
  }
}

// ── MULTI-CLIP REEL ───────────────────────────────────────────────
function renderReelClips() {
  const el = document.getElementById('reel-clips');
  if (!reelClips.length) {
    el.innerHTML = '<div class="clip-empty">No clips yet. Record or upload clips below.</div>';
    return;
  }
  el.innerHTML = reelClips.map((c, i) => `
    <div class="clip-item">
      <div class="clip-num">${i + 1}</div>
      <div class="clip-name" title="${c.name}">${c.name}</div>
      <div class="clip-size">${formatSize(c.size)}</div>
      <div class="clip-del" onclick="reelRemoveClip(${i})">✕</div>
    </div>
  `).join('');
}

function reelRemoveClip(i) {
  reelClips.splice(i, 1);
  renderReelClips();
}

async function reelRecordClip() {
  try {
    document.getElementById('reel-recording-bar').classList.remove('hidden');
    document.getElementById('reel-clip-num').textContent = reelClips.length + 1;
    document.getElementById('reel-record-btn').disabled = true;

    reelStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
    reelChunks = [];
    const mimeType = getSupportedMime();
    reelMediaRecorder = new MediaRecorder(reelStream, { mimeType });
    reelMediaRecorder.ondataavailable = e => { if (e.data?.size > 0) reelChunks.push(e.data); };
    reelMediaRecorder.onstop = () => {
      const blob = new Blob(reelChunks, { type: mimeType });
      reelClips.push({ name: `Clip ${reelClips.length + 1}`, blob, size: blob.size });
      renderReelClips();
      document.getElementById('reel-recording-bar').classList.add('hidden');
      document.getElementById('reel-record-btn').disabled = false;
    };
    reelStream.getVideoTracks()[0].addEventListener('ended', reelStopClip);
    reelMediaRecorder.start(500);
  } catch (err) {
    document.getElementById('reel-recording-bar').classList.add('hidden');
    document.getElementById('reel-record-btn').disabled = false;
  }
}

function reelStopClip() {
  if (reelMediaRecorder?.state !== 'inactive') reelMediaRecorder?.stop();
  reelStream?.getTracks().forEach(t => t.stop());
  reelStream = null;
}

function reelAddUpload(event) {
  const files = Array.from(event.target.files);
  files.forEach(f => {
    reelClips.push({ name: f.name, blob: f, size: f.size });
  });
  renderReelClips();
  event.target.value = '';
}

async function generateReel() {
  const warnEl = document.getElementById('reel-warn');
  warnEl.classList.add('hidden');

  const desc = document.getElementById('reel-desc').value.trim();
  if (!desc) { warnEl.textContent = '⚠️ Please describe the reel purpose.'; warnEl.classList.remove('hidden'); return; }
  if (reelClips.length < 2) { warnEl.textContent = '⚠️ Add at least 2 clips for a reel.'; warnEl.classList.remove('hidden'); return; }

  const btn = document.getElementById('reel-generate');
  btn.disabled = true; btn.textContent = '⏳ Uploading clips...';

  try {
    const fd = new FormData();
    reelClips.forEach((c, i) => fd.append(`clip_${i}`, c.blob, c.name.endsWith('.webm') ? c.name : c.name + '.webm'));
    fd.append('description', desc);
    fd.append('sfx', document.getElementById('reel-sfx').value);
    fd.append('cursor', getActivePill('cursor-pills'));
    fd.append('autoZoom', document.getElementById('reel-autozoom').checked);
    fd.append('voice', document.getElementById('reel-voice').value);
    fd.append('tone', document.getElementById('reel-tone').value);
    fd.append('clipCount', reelClips.length);

    const res = await fetch(`${serverUrl}/api/upload-reel`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const { id } = await res.json();

    saveJob(id, desc.slice(0, 30) + ' (reel)');
    document.getElementById('reel-jobid').textContent = `Job: ${id}`;
    document.getElementById('reel-watch').href = `${serverUrl}/?job=${id}`;
    document.getElementById('reel-result').classList.remove('hidden');

    const cfg = await chrome.storage.local.get(['autoOpen']);
    if (cfg.autoOpen !== false) chrome.tabs.create({ url: `${serverUrl}/?job=${id}` });

  } catch (err) {
    warnEl.textContent = '❌ ' + err.message;
    warnEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = '🚀 Generate Teaser Reel';
  }
}

// ── SETTINGS ──────────────────────────────────────────────────────
function renderRecentJobs(jobs) {
  const el = document.getElementById('recent-jobs');
  if (!jobs.length) { el.textContent = 'No jobs yet.'; return; }
  el.innerHTML = jobs.slice(0, 5).map(j => `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">${j.title}</span>
      <a href="${serverUrl}/?job=${j.id}" target="_blank" style="color:#60a5fa;font-size:0.7rem;flex-shrink:0;margin-left:6px;">→ Open</a>
    </div>
  `).join('');
}

async function clearJobs() {
  await chrome.storage.local.set({ recentJobs: [] });
  renderRecentJobs([]);
}

// ── HELPERS ───────────────────────────────────────────────────────
function getSupportedMime() {
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
}

function formatSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function getActivePill(containerId) {
  const active = document.querySelector(`#${containerId} .pill.active`);
  return active ? active.dataset.cursor : 'smooth';
}

async function saveJob(id, title) {
  const { recentJobs = [] } = await chrome.storage.local.get(['recentJobs']);
  recentJobs.unshift({ id, title, createdAt: Date.now() });
  chrome.storage.local.set({ recentJobs: recentJobs.slice(0, 20) });
}
