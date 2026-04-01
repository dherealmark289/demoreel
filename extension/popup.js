/**
 * DemoReel Pro — popup.js
 * Single clip + Reel with: auto-blur, chapters, speed control, webcam, region select
 */

const DEFAULT_SERVER = 'https://demoreel-production.up.railway.app';
let serverUrl = DEFAULT_SERVER;
let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let recordingBlob = null;
let selectedRegion = null;
let webcamStream = null;

// Reel state
let reelClips = [];
let reelMediaRecorder = null;
let reelStream = null;
let reelChunks = [];

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = await chrome.storage.local.get(['serverUrl', 'autoOpen']);
  if (cfg.serverUrl) serverUrl = cfg.serverUrl;
  if (cfg.autoOpen !== undefined) document.getElementById('cfg-autoopen').checked = cfg.autoOpen;

  document.getElementById('cfg-server').addEventListener('change', e => {
    serverUrl = (e.target.value.trim() || DEFAULT_SERVER).replace(/\/$/, '');
    chrome.storage.local.set({ serverUrl });
  });
  document.getElementById('cfg-autoopen').addEventListener('change', e => {
    chrome.storage.local.set({ autoOpen: e.target.checked });
  });

  // Speed sliders
  document.getElementById('s-speed').addEventListener('input', e => {
    document.getElementById('s-speed-val').textContent = e.target.value;
  });
  document.getElementById('reel-speed').addEventListener('input', e => {
    document.getElementById('reel-speed-val').textContent = e.target.value;
  });

  // Buttons
  document.getElementById('s-start').addEventListener('click', singleStart);
  document.getElementById('s-stop').addEventListener('click', singleStop);
  document.getElementById('s-generate').addEventListener('click', singleGenerate);
  document.getElementById('s-discard').addEventListener('click', singleDiscard);
  document.getElementById('s-region').addEventListener('change', handleRegionToggle);
  document.getElementById('s-webcam').addEventListener('change', handleWebcamToggle);
});

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

async function handleRegionToggle() {
  if (!document.getElementById('s-region').checked) {
    selectedRegion = null;
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.postMessage({ type: 'DEMOREEL_REGION_SELECT' }, '*'),
    });
  }
}

async function handleWebcamToggle() {
  if (!document.getElementById('s-webcam').checked) {
    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
      webcamStream = null;
    }
    return;
  }
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240 },
      audio: false,
    });
  } catch (err) {
    document.getElementById('s-webcam').checked = false;
    sSetStatus('Webcam access denied', '');
  }
}

async function singleStart() {
  try {
    sSetStatus('Requesting screen...', '');
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
  btn.disabled = true;
  btn.textContent = '⏳ Uploading...';
  sSetStatus('Uploading to DemoReel...', 'processing');

  try {
    const fd = new FormData();
    fd.append('recording', recordingBlob, 'recording.webm');
    fd.append('description', desc);
    fd.append('title', title || desc.slice(0, 50));
    fd.append('voice', document.getElementById('s-voice').value);
    fd.append('tone', document.getElementById('s-tone').value);
    fd.append('purpose', 'product-demo');
    fd.append('speed', document.getElementById('s-speed').value);
    fd.append('blurCredentials', document.getElementById('s-blur-creds').checked);
    fd.append('chapters', document.getElementById('s-chapters').checked);
    fd.append('autoZoom', document.getElementById('s-autozoom').checked);
    fd.append('cursor', document.getElementById('s-cursor').checked);
    fd.append('webcam', document.getElementById('s-webcam').checked);
    if (selectedRegion) fd.append('region', JSON.stringify(selectedRegion));

    const res = await fetch(`${serverUrl}/api/upload-recording`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const { id } = await res.json();

    document.getElementById('s-jobid').textContent = `Job: ${id}`;
    document.getElementById('s-watch').href = `${serverUrl}/?job=${id}`;
    sShow('s-result');

    const cfg = await chrome.storage.local.get(['autoOpen']);
    if (cfg.autoOpen !== false) chrome.tabs.create({ url: `${serverUrl}/?job=${id}` });

  } catch (err) {
    sSetStatus('Error: ' + err.message, '');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Generate Demo Video';
  }
}

function singleDiscard() {
  recordingBlob = null;
  recordedChunks = [];
  document.getElementById('s-desc').value = '';
  document.getElementById('s-title').value = '';
  sShow('s-pre');
  sSetStatus('Ready to record', 'ready');
}

// ── REEL ──────────────────────────────────────────────────────────
function renderReelClips() {
  const el = document.getElementById('reel-clips');
  if (!reelClips.length) {
    el.innerHTML = '<div style="color:#8b949e;text-align:center;padding:12px;">No clips yet.</div>';
    return;
  }
  el.innerHTML = reelClips.map((c, i) => `
    <div style="display:flex;align-items:center;gap:8px;background:#161b22;border:1px solid #30363d;border-radius:7px;padding:8px 10px;margin-bottom:6px;">
      <div style="background:#2563eb;color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:0.68rem;font-weight:700;flex-shrink:0;">${i + 1}</div>
      <div style="flex:1;color:#e6edf3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.78rem;">${c.name}</div>
      <div style="color:#8b949e;font-size:0.7rem;flex-shrink:0;">${formatSize(c.size)}</div>
      <div style="cursor:pointer;color:#8b949e;font-size:1rem;padding:0 2px;" onclick="reelRemoveClip(${i})">✕</div>
    </div>
  `).join('');
}

function reelRemoveClip(i) {
  reelClips.splice(i, 1);
  renderReelClips();
}

async function reelRecordClip() {
  try {
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
      document.getElementById('reel-record-btn').disabled = false;
    };
    reelStream.getVideoTracks()[0].addEventListener('ended', () => reelStopClip());
    reelMediaRecorder.start(500);
  } catch (err) {
    document.getElementById('reel-record-btn').disabled = false;
  }
}

function reelStopClip() {
  if (reelMediaRecorder?.state !== 'inactive') reelMediaRecorder?.stop();
  reelStream?.getTracks().forEach(t => t.stop());
  reelStream = null;
}

function reelAddUpload(event) {
  Array.from(event.target.files).forEach(f => {
    reelClips.push({ name: f.name, blob: f, size: f.size });
  });
  renderReelClips();
  event.target.value = '';
}

async function generateReel() {
  const warnEl = document.getElementById('reel-warn');
  warnEl.classList.add('hidden');

  const desc = document.getElementById('reel-desc').value.trim();
  if (!desc) { warnEl.textContent = '⚠️ Describe the reel.'; warnEl.classList.remove('hidden'); return; }
  if (reelClips.length < 2) { warnEl.textContent = '⚠️ Add at least 2 clips.'; warnEl.classList.remove('hidden'); return; }

  const btn = document.getElementById('reel-generate');
  btn.disabled = true;
  btn.textContent = '⏳ Uploading...';

  try {
    const fd = new FormData();
    reelClips.forEach((c, i) => fd.append(`clip_${i}`, c.blob));
    fd.append('description', desc);
    fd.append('sfx', document.getElementById('reel-sfx').value);
    fd.append('speed', document.getElementById('reel-speed').value);
    fd.append('voice', document.getElementById('reel-voice').value);
    fd.append('chapters', document.getElementById('reel-chapters').checked);

    const res = await fetch(`${serverUrl}/api/upload-reel`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const { id } = await res.json();

    document.getElementById('reel-jobid').textContent = `Job: ${id}`;
    document.getElementById('reel-watch').href = `${serverUrl}/?job=${id}`;
    document.getElementById('reel-result').classList.remove('hidden');

    const cfg = await chrome.storage.local.get(['autoOpen']);
    if (cfg.autoOpen !== false) chrome.tabs.create({ url: `${serverUrl}/?job=${id}` });

  } catch (err) {
    warnEl.textContent = '❌ ' + err.message;
    warnEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Generate Reel';
  }
}

function clearSettings() {
  if (confirm('Clear all extension data?')) {
    chrome.storage.local.clear();
    location.reload();
  }
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

// Listen for region select from content script
window.addEventListener('message', e => {
  if (e.source !== window) return;
  if (e.data?.type === 'DEMOREEL_REGION_SELECTED') {
    selectedRegion = e.data.region;
  } else if (e.data?.type === 'DEMOREEL_REGION_CANCELLED') {
    document.getElementById('s-region').checked = false;
  }
});
