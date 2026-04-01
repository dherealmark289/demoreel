/**
 * DemoReel Pro — popup.js
 * Projects dashboard + 4-step wizard + Reel builder
 */

const DEFAULT_SERVER = 'https://demoreel-production.up.railway.app';
let serverUrl = DEFAULT_SERVER;

// Recording state
let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let recordingBlob = null;
let recordingTimerInterval = null;
let recordingSeconds = 0;

// Reel state
let reelClips = [];
let reelMediaRecorder = null;
let reelStream = null;
let reelChunks = [];

// Wizard state
let currentStep = 1;
let autoRefreshTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = await chrome.storage.local.get(['serverUrl', 'autoOpen', 'autoRefresh']);
  if (cfg.serverUrl) { serverUrl = cfg.serverUrl; document.getElementById('cfg-server').value = serverUrl; }
  if (cfg.autoOpen !== undefined) document.getElementById('cfg-autoopen').checked = cfg.autoOpen;
  if (cfg.autoRefresh !== undefined) document.getElementById('cfg-autorefresh').checked = cfg.autoRefresh !== false;

  // Check server connectivity and update banner
  checkConnection();

  // Settings listeners
  document.getElementById('cfg-server').addEventListener('change', e => {
    serverUrl = (e.target.value.trim() || DEFAULT_SERVER).replace(/\/$/, '');
    chrome.storage.local.set({ serverUrl });
  });
  document.getElementById('cfg-autoopen').addEventListener('change', e => chrome.storage.local.set({ autoOpen: e.target.checked }));
  document.getElementById('cfg-autorefresh').addEventListener('change', e => {
    chrome.storage.local.set({ autoRefresh: e.target.checked });
    if (e.target.checked) startAutoRefresh(); else stopAutoRefresh();
  });

  // Speed sliders
  document.getElementById('opt-speed').addEventListener('input', e => {
    document.getElementById('opt-speed-val').textContent = parseFloat(e.target.value).toFixed(1);
  });
  document.getElementById('reel-speed').addEventListener('input', e => {
    document.getElementById('reel-speed-val').textContent = parseFloat(e.target.value).toFixed(1);
  });

  // Cursor pills
  document.querySelectorAll('#cursor-pills .pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#cursor-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
    });
  });

  // Record buttons
  document.getElementById('rec-start-btn').addEventListener('click', startRecording);
  document.getElementById('rec-stop-btn').addEventListener('click', stopRecording);

  // Region toggle
  document.getElementById('opt-region').addEventListener('change', handleRegionToggle);

  // Load projects
  loadProjects();
  if (document.getElementById('cfg-autorefresh').checked) startAutoRefresh();
});

// ── NAV ───────────────────────────────────────────────────────────
function switchNav(name) {
  ['projects', 'wizard', 'reel', 'settings'].forEach(n => {
    document.getElementById(`nav-${n}`)?.classList.toggle('active', n === name);
    document.getElementById(`panel-${n}`)?.classList.toggle('active', n === name);
  });
  if (name === 'projects') loadProjects();
}

// ── PROJECTS ──────────────────────────────────────────────────────
async function loadProjects() {
  const list = document.getElementById('projects-list');
  const btn = document.getElementById('refresh-btn');
  if (btn) btn.textContent = '↻ Loading...';

  try {
    const res = await fetch(`${serverUrl}/api/history?limit=30`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobs = data.jobs || [];

    if (!jobs.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎬</div>
          <div>No projects yet.</div>
          <div style="margin-top:6px;font-size:0.72rem;">Click "✨ New Demo" to start!</div>
        </div>`;
      return;
    }

    list.innerHTML = jobs.map(job => renderProjectCard(job)).join('');
  } catch (err) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div>Could not load projects</div>
        <div style="margin-top:4px;font-size:0.7rem;">${err.message}</div>
      </div>`;
  } finally {
    if (btn) btn.textContent = '↻ Refresh';
  }
}

function renderProjectCard(job) {
  const d = job.created_at
    ? new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const sz = job.video_size_bytes ? (job.video_size_bytes / 1024 / 1024).toFixed(1) + ' MB' : '';
  const dur = job.duration_seconds ? Math.round(job.duration_seconds) + 's' : '';
  const shortUrl = (job.url || '').replace(/^https?:\/\//, '').slice(0, 40);
  const dlUrl = job.video_url || `${serverUrl}/api/download/${job.id}`;
  const ready = job.status === 'completed';
  const processing = job.status === 'processing' || job.status === 'queued';
  const pct = job.progress_percent || (processing ? 50 : ready ? 100 : 0);

  const statusClass = { completed: 'st-completed', processing: 'st-processing', queued: 'st-queued', failed: 'st-failed' }[job.status] || 'st-queued';
  const statusLabel = { completed: '✅ Done', processing: '⚙️ Processing', queued: '⏳ Queued', failed: '❌ Failed' }[job.status] || job.status;

  return `
    <div class="project-card">
      <div class="project-thumb">
        ${job.thumbnail_url ? `<img src="${job.thumbnail_url}" alt="" loading="lazy" onerror="this.style.display='none'">` : '🎬'}
        <div class="project-status ${statusClass}">${statusLabel}</div>
      </div>
      <div class="project-body">
        <div class="project-name">${shortUrl || job.id?.slice(0,16) || 'Recording'}</div>
        <div class="project-meta">
          ${d ? `<span>📅 ${d}</span>` : ''}
          ${dur ? `<span>⏱ ${dur}</span>` : ''}
          ${sz ? `<span>💾 ${sz}</span>` : ''}
        </div>
        ${processing ? `
          <div class="project-progress">
            <div class="project-progress-bar" style="width:${pct}%"></div>
          </div>
        ` : ''}
        <div class="project-actions">
          ${ready
            ? `<a class="pa-btn pa-dl" href="${dlUrl}" target="_blank">⬇ Download</a>
               <a class="pa-btn pa-open" href="${serverUrl}/dashboard?job=${job.id}" target="_blank">▶ Open</a>
               <a class="pa-btn pa-xpost" href="${serverUrl}/api/xpost/${job.id}" target="_blank" onclick="openXPost('${job.id}',event)">𝕏 Post</a>`
            : processing
              ? `<a class="pa-btn pa-open" href="${serverUrl}/dashboard?job=${job.id}" target="_blank">👁 Watch</a>
                 <div class="pa-btn pa-dim">⬇ Pending</div>`
              : `<div class="pa-btn pa-dim">⬇ Not ready</div>
                 <a class="pa-btn pa-open" href="${serverUrl}/dashboard?job=${job.id}" target="_blank">▶ Open</a>`
          }
        </div>
      </div>
    </div>`;
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    const projPanel = document.getElementById('panel-projects');
    if (projPanel?.classList.contains('active')) loadProjects();
  }, 15000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}

async function openXPost(jobId, e) {
  e.preventDefault();
  try {
    const res = await fetch(`${serverUrl}/api/xpost/${jobId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const text = d.fullPost || d.hook || '';
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {});
      alert(`X Post copied!\n\n${text.slice(0, 200)}...`);
    }
  } catch (err) {
    alert('Could not generate X post: ' + err.message);
  }
}

// ── WIZARD STEPS ──────────────────────────────────────────────────
function goToStep(n) {
  currentStep = n;
  for (let i = 1; i <= 4; i++) {
    const sp = document.getElementById(`step-${i}`);
    const ws = document.getElementById(`ws-${i}`);
    if (sp) sp.classList.toggle('active', i === n);
    if (ws) {
      ws.classList.remove('active', 'done');
      if (i < n) ws.classList.add('done');
      else if (i === n) ws.classList.add('active');
    }
  }
  if (n === 4) renderStep4Summary();
}

function renderStep4Summary() {
  const speed = document.getElementById('opt-speed').value;
  const cursor = document.querySelector('#cursor-pills .pill.active')?.dataset.val || 'smooth';
  const blur = document.getElementById('opt-blur').checked;
  const zoom = document.getElementById('opt-zoom').checked;
  const chapters = document.getElementById('opt-chapters').checked;
  const tone = document.getElementById('proj-tone').value;
  const voice = document.getElementById('proj-voice').options[document.getElementById('proj-voice').selectedIndex].text;
  const purpose = document.getElementById('proj-purpose').value;
  const title = document.getElementById('proj-title').value || '(no title)';
  const recSize = recordingBlob ? formatSize(recordingBlob.size) : 'Uploaded file';

  document.getElementById('step4-summary').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <div>📹 <strong>Recording</strong><br><span style="color:#8b949e;">${recSize}</span></div>
      <div>🎯 <strong>Purpose</strong><br><span style="color:#8b949e;">${purpose.replace(/-/g,' ')}</span></div>
      <div>✍️ <strong>Title</strong><br><span style="color:#8b949e;">${title}</span></div>
      <div>🗣 <strong>Voice</strong><br><span style="color:#8b949e;">${voice.split('—')[0].trim()}</span></div>
      <div>⚡ <strong>Speed</strong><br><span style="color:#8b949e;">${speed}x</span></div>
      <div>🖱 <strong>Cursor</strong><br><span style="color:#8b949e;">${cursor}</span></div>
      <div>🔐 <strong>Blur creds</strong><br><span style="color:${blur?'#86efac':'#8b949e'};">${blur?'Yes':'No'}</span></div>
      <div>📝 <strong>Chapters</strong><br><span style="color:${chapters?'#86efac':'#8b949e'};">${chapters?'Yes':'No'}</span></div>
    </div>
  `;
}

// ── RECORDING ─────────────────────────────────────────────────────
async function startRecording() {
  try {
    document.getElementById('rec-status').textContent = 'Requesting screen access...';
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' }, audio: false,
    });

    recordedChunks = [];
    const mimeType = getSupportedMime();
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      recordingBlob = new Blob(recordedChunks, { type: mimeType });
      clearInterval(recordingTimerInterval);
      document.getElementById('rec-dot').className = 'dot ready';
      document.getElementById('rec-idle').classList.add('hidden');
      document.getElementById('rec-active').classList.add('hidden');
      document.getElementById('rec-done').classList.remove('hidden');
      document.getElementById('rec-size').textContent = formatSize(recordingBlob.size);
      document.getElementById('rec-status').textContent = `Captured ${formatSize(recordingBlob.size)}`;
    };
    stream.getVideoTracks()[0].addEventListener('ended', stopRecording);
    mediaRecorder.start(500);

    // Timer
    recordingSeconds = 0;
    recordingTimerInterval = setInterval(() => {
      recordingSeconds++;
      const m = Math.floor(recordingSeconds / 60);
      const s = recordingSeconds % 60;
      document.getElementById('rec-timer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }, 1000);

    document.getElementById('rec-dot').className = 'dot recording';
    document.getElementById('rec-status').textContent = 'Recording...';
    document.getElementById('rec-idle').classList.add('hidden');
    document.getElementById('rec-active').classList.remove('hidden');
    document.getElementById('rec-done').classList.add('hidden');
  } catch (err) {
    document.getElementById('rec-status').textContent = err.name === 'NotAllowedError' ? 'Permission denied' : err.message;
  }
}

function stopRecording() {
  if (mediaRecorder?.state !== 'inactive') mediaRecorder?.stop();
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
}

function handleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  recordingBlob = file;
  document.getElementById('rec-idle').classList.add('hidden');
  document.getElementById('rec-active').classList.add('hidden');
  document.getElementById('rec-done').classList.remove('hidden');
  document.getElementById('rec-size').textContent = formatSize(file.size);
  document.getElementById('rec-status').textContent = `Loaded: ${file.name}`;
}

function discardRecording() {
  recordingBlob = null;
  recordedChunks = [];
  clearInterval(recordingTimerInterval);
  document.getElementById('rec-idle').classList.remove('hidden');
  document.getElementById('rec-active').classList.add('hidden');
  document.getElementById('rec-done').classList.add('hidden');
  document.getElementById('rec-dot').className = 'dot ready';
  document.getElementById('rec-status').textContent = 'Ready';
}

async function handleRegionToggle() {
  if (!document.getElementById('opt-region').checked) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.postMessage({ type: 'DEMOREEL_REGION_SELECT' }, '*'),
    });
    window.close();
  }
}

// ── GENERATE ──────────────────────────────────────────────────────
async function generateDemo() {
  const desc = document.getElementById('proj-desc').value.trim();
  if (!desc) {
    document.getElementById('gen-warn').textContent = '⚠️ Describe the feature in Step 3.';
    document.getElementById('gen-warn').classList.remove('hidden');
    return;
  }
  if (!recordingBlob) {
    document.getElementById('gen-warn').textContent = '⚠️ No recording found. Go back to Step 1.';
    document.getElementById('gen-warn').classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('gen-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Uploading...';
  document.getElementById('gen-warn').classList.add('hidden');

  try {
    const fd = new FormData();
    fd.append('recording', recordingBlob, 'recording.webm');
    fd.append('description', desc);
    fd.append('title', document.getElementById('proj-title').value.trim() || desc.slice(0, 50));
    fd.append('purpose', document.getElementById('proj-purpose').value);
    fd.append('tone', document.getElementById('proj-tone').value);
    fd.append('voice', document.getElementById('proj-voice').value);
    fd.append('speed', document.getElementById('opt-speed').value);
    fd.append('blurCredentials', document.getElementById('opt-blur').checked);
    fd.append('chapters', document.getElementById('opt-chapters').checked);
    fd.append('autoZoom', document.getElementById('opt-zoom').checked);
    fd.append('cursor', document.querySelector('#cursor-pills .pill.active')?.dataset.val || 'smooth');
    fd.append('webcam', document.getElementById('opt-webcam').checked);

    const res = await fetch(`${serverUrl}/api/upload-recording`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const { id } = await res.json();

    document.getElementById('gen-jobid').textContent = `Job ID: ${id}`;
    document.getElementById('gen-watch').href = `${serverUrl}/dashboard?job=${id}`;
    document.getElementById('gen-success').classList.remove('hidden');
    btn.classList.add('hidden');

    const cfg = await chrome.storage.local.get(['autoOpen']);
    if (cfg.autoOpen !== false) chrome.tabs.create({ url: `${serverUrl}/dashboard?job=${id}` });

  } catch (err) {
    document.getElementById('gen-warn').textContent = '❌ ' + err.message;
    document.getElementById('gen-warn').classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = '🚀 Generate Demo Video';
  }
}

function startOver() {
  recordingBlob = null; recordedChunks = [];
  discardRecording();
  document.getElementById('proj-title').value = '';
  document.getElementById('proj-desc').value = '';
  document.getElementById('gen-success').classList.add('hidden');
  document.getElementById('gen-btn').classList.remove('hidden');
  document.getElementById('gen-btn').disabled = false;
  document.getElementById('gen-btn').textContent = '🚀 Generate Demo Video';
  goToStep(1);
  switchNav('wizard');
}

// ── REEL ──────────────────────────────────────────────────────────
function renderReelClips() {
  const el = document.getElementById('reel-clip-list');
  if (!reelClips.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:0.75rem;padding:8px;">No clips yet</div>';
    return;
  }
  el.innerHTML = reelClips.map((c, i) => `
    <div style="display:flex;align-items:center;gap:6px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;margin-bottom:5px;font-size:0.75rem;">
      <span style="background:var(--accent);color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:0.65rem;flex-shrink:0;">${i+1}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name}</span>
      <span style="color:var(--muted);flex-shrink:0;">${formatSize(c.size)}</span>
      <span style="cursor:pointer;color:var(--muted);" onclick="reelRemove(${i})">✕</span>
    </div>`).join('');
}

function reelRemove(i) { reelClips.splice(i, 1); renderReelClips(); }

async function reelRecord() {
  try {
    document.getElementById('reel-rec-btn').disabled = true;
    reelStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
    reelChunks = [];
    const mime = getSupportedMime();
    reelMediaRecorder = new MediaRecorder(reelStream, { mimeType: mime });
    reelMediaRecorder.ondataavailable = e => { if (e.data?.size > 0) reelChunks.push(e.data); };
    reelMediaRecorder.onstop = () => {
      const blob = new Blob(reelChunks, { type: mime });
      reelClips.push({ name: `Clip ${reelClips.length + 1}`, blob, size: blob.size });
      renderReelClips();
      document.getElementById('reel-rec-btn').disabled = false;
    };
    reelStream.getVideoTracks()[0].addEventListener('ended', () => {
      if (reelMediaRecorder?.state !== 'inactive') reelMediaRecorder?.stop();
      reelStream?.getTracks().forEach(t => t.stop());
    });
    reelMediaRecorder.start(500);
  } catch { document.getElementById('reel-rec-btn').disabled = false; }
}

function reelAddFiles(e) {
  Array.from(e.target.files).forEach(f => reelClips.push({ name: f.name, blob: f, size: f.size }));
  renderReelClips();
  e.target.value = '';
}

async function generateReel() {
  const warnEl = document.getElementById('reel-warn');
  const desc = document.getElementById('reel-desc').value.trim();
  warnEl.classList.add('hidden');
  if (!desc) { warnEl.textContent = '⚠️ Add a reel description.'; warnEl.classList.remove('hidden'); return; }
  if (reelClips.length < 2) { warnEl.textContent = '⚠️ Need at least 2 clips.'; warnEl.classList.remove('hidden'); return; }

  const btn = document.querySelector('#panel-reel .btn-primary');
  btn.disabled = true; btn.textContent = '⏳ Uploading...';

  try {
    const fd = new FormData();
    reelClips.forEach((c, i) => fd.append(`clip_${i}`, c.blob));
    fd.append('description', desc);
    fd.append('sfx', document.getElementById('reel-sfx').value);
    fd.append('speed', document.getElementById('reel-speed').value);
    fd.append('voice', document.getElementById('reel-voice').value);

    const res = await fetch(`${serverUrl}/api/upload-reel`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const { id } = await res.json();

    document.getElementById('reel-jobid').textContent = `Job: ${id}`;
    document.getElementById('reel-watch').href = `${serverUrl}/dashboard?job=${id}`;
    document.getElementById('reel-success').classList.remove('hidden');

    const cfg = await chrome.storage.local.get(['autoOpen']);
    if (cfg.autoOpen !== false) chrome.tabs.create({ url: `${serverUrl}/dashboard?job=${id}` });
  } catch (err) {
    warnEl.textContent = '❌ ' + err.message; warnEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = '🚀 Generate Reel';
  }
}

function clearAll() {
  if (confirm('Clear all DemoReel extension data?')) { chrome.storage.local.clear(); location.reload(); }
}

// ── Dashboard Connection ──────────────────────────────────────────
function openDashboard() {
  chrome.tabs.create({ url: `${serverUrl}/dashboard` });
}

async function checkConnection() {
  const banner = document.getElementById('dashboard-banner');
  try {
    const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.status === 'ok') {
      // Connected — show green with DB/R2 status
      const dbOk = data.storage?.db;
      const r2Ok = data.storage?.r2;
      banner.style.background = 'rgba(22,163,74,0.1)';
      banner.style.borderBottomColor = 'rgba(22,163,74,0.25)';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;">
          <span style="width:7px;height:7px;background:#16a34a;border-radius:50%;display:inline-block;box-shadow:0 0 6px #16a34a;flex-shrink:0;"></span>
          <span style="color:#86efac;font-weight:600;">Connected</span>
          <span style="color:#8b949e;">· DB ${dbOk ? '✅' : '⚠️'} · R2 ${r2Ok ? '✅' : '⚠️'}</span>
        </div>
        <button onclick="openDashboard()" style="padding:5px 12px;background:linear-gradient(135deg,#2563eb,#7c3aed);border:none;border-radius:6px;color:#fff;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap;">📊 Dashboard →</button>
      `;
    }
  } catch {
    // Offline / wrong URL
    banner.style.background = 'rgba(220,38,38,0.1)';
    banner.style.borderBottomColor = 'rgba(220,38,38,0.25)';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;">
        <span style="width:7px;height:7px;background:#dc2626;border-radius:50%;display:inline-block;flex-shrink:0;"></span>
        <span style="color:#fca5a5;font-weight:600;">Not connected</span>
        <span style="color:#8b949e;">· Check Settings</span>
      </div>
      <button onclick="switchNav('settings')" style="padding:5px 12px;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:0.72rem;font-weight:700;cursor:pointer;">⚙️ Fix →</button>
    `;
  }
}

function getSupportedMime() {
  return ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
}
function formatSize(b) {
  return b > 1048576 ? (b/1048576).toFixed(1)+' MB' : Math.round(b/1024)+' KB';
}
