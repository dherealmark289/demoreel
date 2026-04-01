/**
 * DemoReel Pro — popup.js (CSP-compliant, zero inline handlers)
 */

const DEFAULT_SERVER = 'https://demoreel-production.up.railway.app';
let serverUrl = DEFAULT_SERVER;

// Recording
let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let recordingBlob = null;
let recTimerInterval = null;
let recSeconds = 0;

// Reel
let reelClips = [];
let reelMediaRecorder = null;
let reelStream = null;
let reelChunks = [];

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const cfg = await chrome.storage.local.get(['serverUrl', 'autoOpen']);
  if (cfg.serverUrl) { serverUrl = cfg.serverUrl; el('cfg-server').value = serverUrl; }
  if (cfg.autoOpen !== undefined) el('cfg-autoopen').checked = cfg.autoOpen;

  // Nav
  on('nav-projects',  'click', () => switchNav('projects'));
  on('nav-wizard',    'click', () => switchNav('wizard'));
  on('nav-reel',      'click', () => switchNav('reel'));
  on('nav-settings',  'click', () => switchNav('settings'));

  // Banner
  on('btn-dashboard', 'click', openDashboard);

  // Settings
  on('btn-open-dashboard', 'click', openDashboard);
  on('cfg-server', 'change', e => {
    serverUrl = (e.target.value.trim() || DEFAULT_SERVER).replace(/\/$/, '');
    chrome.storage.local.set({ serverUrl });
    checkConnection();
  });
  on('cfg-autoopen', 'change', e => chrome.storage.local.set({ autoOpen: e.target.checked }));
  on('btn-clear-all', 'click', () => {
    if (confirm('Clear all DemoReel data?')) { chrome.storage.local.clear(); location.reload(); }
  });

  // Projects
  on('btn-refresh', 'click', loadProjects);

  // Wizard step buttons
  on('rec-start-btn',   'click', startRecording);
  on('rec-stop-btn',    'click', stopRecording);
  on('upload-input',    'change', handleUpload);
  on('btn-discard',     'click', discardRecording);
  on('btn-step1-next',  'click', () => goToStep(2));
  on('btn-step2-back',  'click', () => goToStep(1));
  on('btn-step2-next',  'click', () => goToStep(3));
  on('btn-step3-back',  'click', () => goToStep(2));
  on('btn-step3-next',  'click', () => goToStep(4));
  on('btn-step4-back',  'click', () => goToStep(3));
  on('gen-btn',         'click', generateDemo);
  on('btn-view-projects','click',() => switchNav('projects'));
  on('btn-start-over',  'click', startOver);

  // Speed sliders
  on('opt-speed',  'input', e => el('opt-speed-val').textContent = parseFloat(e.target.value).toFixed(1));
  on('reel-speed', 'input', e => el('reel-speed-val').textContent = parseFloat(e.target.value).toFixed(1));

  // Region toggle
  on('opt-region', 'change', handleRegionToggle);

  // Reel
  on('reel-rec-btn',    'click', reelRecord);
  on('reel-file',       'change', reelAddFiles);
  on('reel-generate',   'click', generateReel);
  on('reel-upload-label', 'click', () => el('reel-file').click());

  // Init
  checkConnection();
  loadProjects();
  setInterval(() => {
    if (document.getElementById('panel-projects')?.classList.contains('active')) loadProjects(true);
  }, 15000);
});

// ── Helpers ───────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function on(id, ev, fn) { el(id)?.addEventListener(ev, fn); }
function fmt(bytes) { return bytes > 1048576 ? (bytes/1048576).toFixed(1)+' MB' : Math.round(bytes/1024)+' KB'; }
function mime() { return ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm'; }

// ── Nav ───────────────────────────────────────────────────────────
function switchNav(name) {
  ['projects','wizard','reel','settings'].forEach(n => {
    el(`nav-${n}`)?.classList.toggle('active', n === name);
    el(`panel-${n}`)?.classList.toggle('active', n === name);
  });
  if (name === 'projects') loadProjects();
}

// ── Dashboard / Connection ────────────────────────────────────────
function openDashboard() {
  chrome.tabs.create({ url: `${serverUrl}/dashboard` });
}

async function checkConnection() {
  const dot = el('banner-dot');
  const text = el('banner-text');
  const sub = el('banner-sub');
  const banner = el('dashboard-banner');
  try {
    const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const d = await res.json();
    if (d.status === 'ok') {
      dot.className = 'connected';
      dot.style.cssText = 'width:7px;height:7px;background:#16a34a;border-radius:50%;flex-shrink:0;box-shadow:0 0 6px #16a34a;';
      text.textContent = 'Connected';
      text.style.color = '#86efac';
      sub.textContent = `· DB ${d.storage?.db ? '✅' : '⚠️'} · R2 ${d.storage?.r2 ? '✅' : '⚠️'}`;
      banner.style.background = 'rgba(22,163,74,0.1)';
      banner.style.borderBottomColor = 'rgba(22,163,74,0.25)';
    }
  } catch {
    dot.style.cssText = 'width:7px;height:7px;background:#dc2626;border-radius:50%;flex-shrink:0;';
    text.textContent = 'Not connected';
    text.style.color = '#fca5a5';
    sub.textContent = '· Check Settings';
    banner.style.background = 'rgba(220,38,38,0.1)';
    banner.style.borderBottomColor = 'rgba(220,38,38,0.25)';
    el('btn-dashboard').textContent = '⚙️ Fix →';
    el('btn-dashboard').addEventListener('click', () => switchNav('settings'), { once: true });
  }
}

// ── Projects ──────────────────────────────────────────────────────
async function loadProjects(silent = false) {
  const list = el('projects-list');
  if (!silent) list.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    const res = await fetch(`${serverUrl}/api/history?limit=50`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const jobs = data.jobs || [];
    if (!jobs.length) {
      list.innerHTML = '<div class="empty-state">No projects yet.<br><br>Click ✨ New Demo to start!</div>';
      return;
    }
    list.innerHTML = jobs.map(job => {
      const d = job.created_at ? new Date(job.created_at).toLocaleDateString('en-US', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
      const sz = job.video_size_bytes ? fmt(job.video_size_bytes) : '';
      const name = (job.url || job.id || '').replace(/^https?:\/\//,'').slice(0,40);
      const ready = job.status === 'completed';
      const proc = ['processing','queued'].includes(job.status);
      const dlUrl = job.video_url || `${serverUrl}/api/download/${job.id}`;
      const pct = job.progress_percent || (ready ? 100 : proc ? 50 : 0);
      const sc = {completed:'st-completed',processing:'st-processing',queued:'st-queued',failed:'st-failed'}[job.status]||'st-queued';
      const sl = {completed:'✅ Done',processing:'⚙️...',queued:'⏳',failed:'❌'}[job.status]||job.status;
      return `<div class="project-card" data-id="${job.id}" data-url="${dlUrl}" data-ready="${ready}">
        <div class="project-thumb">
          ${job.thumbnail_url?`<img src="${job.thumbnail_url}" alt="" loading="lazy">`:'🎬'}
          <div class="p-status ${sc}">${sl}</div>
        </div>
        ${proc?`<div class="p-progress"><div class="p-progress-bar" style="width:${pct}%"></div></div>`:''}
        <div class="p-body">
          <div class="p-name">${name||'Recording'}</div>
          <div class="p-meta">${d?`<span>📅 ${d}</span>`:''} ${sz?`<span>💾 ${sz}</span>`:''}</div>
          <div class="p-actions">
            ${ready
              ?`<a class="pa pa-dl" href="${dlUrl}" target="_blank">⬇ Download</a>
                <a class="pa pa-open" href="${serverUrl}/dashboard?job=${job.id}" target="_blank">▶ Open</a>`
              :proc
                ?`<div class="pa pa-dim">⬇ Pending</div>
                  <a class="pa pa-open" href="${serverUrl}/dashboard?job=${job.id}" target="_blank">👁 Watch</a>`
                :`<div class="pa pa-dim">⬇ N/A</div>`
            }
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    if (!silent) list.innerHTML = `<div class="empty-state">⚠️ ${err.message}</div>`;
  }
}

// ── Wizard Steps ──────────────────────────────────────────────────
function goToStep(n) {
  for (let i = 1; i <= 4; i++) {
    el(`step-${i}`)?.classList.toggle('active', i === n);
    const ws = el(`ws-${i}`);
    if (ws) {
      ws.classList.remove('active','done');
      if (i < n) ws.classList.add('done');
      else if (i === n) ws.classList.add('active');
    }
  }
  if (n === 4) renderStep4Summary();
}

function renderStep4Summary() {
  const speed = el('opt-speed').value;
  const blur = el('opt-blur').checked;
  const zoom = el('opt-zoom').checked;
  const chapters = el('opt-chapters').checked;
  const tone = el('proj-tone').value;
  const voice = el('proj-voice').options[el('proj-voice').selectedIndex]?.text || '';
  const title = el('proj-title').value || '(no title)';
  const size = recordingBlob ? fmt(recordingBlob.size) : 'Uploaded';
  el('step4-summary').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <div>📹 <b>Recording</b><br><span style="color:#8b949e;">${size}</span></div>
      <div>✍️ <b>Title</b><br><span style="color:#8b949e;">${title}</span></div>
      <div>⚡ <b>Speed</b><br><span style="color:#8b949e;">${speed}x</span></div>
      <div>🗣 <b>Voice</b><br><span style="color:#8b949e;">${voice.split('—')[0].trim()}</span></div>
      <div>🔐 <b>Blur</b><br><span style="color:${blur?'#86efac':'#8b949e'};">${blur?'Yes':'No'}</span></div>
      <div>📝 <b>Chapters</b><br><span style="color:${chapters?'#86efac':'#8b949e'};">${chapters?'Yes':'No'}</span></div>
    </div>`;
}

// ── Recording ─────────────────────────────────────────────────────
async function startRecording() {
  try {
    el('rec-status').textContent = 'Requesting screen...';
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
    recordedChunks = [];
    const mimeType = mime();
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = onRecordStop;
    stream.getVideoTracks()[0].addEventListener('ended', stopRecording);
    mediaRecorder.start(500);
    recSeconds = 0;
    recTimerInterval = setInterval(() => {
      recSeconds++;
      const m = Math.floor(recSeconds/60), s = recSeconds%60;
      el('rec-timer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }, 1000);
    el('rec-dot').className = 'dot recording';
    el('rec-status').textContent = 'Recording...';
    el('rec-idle').classList.add('hidden');
    el('rec-active').classList.remove('hidden');
    el('rec-done').classList.add('hidden');
  } catch (err) {
    el('rec-status').textContent = err.name === 'NotAllowedError' ? 'Permission denied' : err.message;
  }
}

function stopRecording() {
  if (mediaRecorder?.state !== 'inactive') mediaRecorder?.stop();
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  clearInterval(recTimerInterval);
}

function onRecordStop() {
  recordingBlob = new Blob(recordedChunks, { type: mime() });
  el('rec-dot').className = 'dot ready';
  el('rec-status').textContent = `Captured ${fmt(recordingBlob.size)}`;
  el('rec-size').textContent = fmt(recordingBlob.size);
  el('rec-idle').classList.add('hidden');
  el('rec-active').classList.add('hidden');
  el('rec-done').classList.remove('hidden');
}

function handleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  recordingBlob = file;
  el('rec-size').textContent = fmt(file.size);
  el('rec-idle').classList.add('hidden');
  el('rec-active').classList.add('hidden');
  el('rec-done').classList.remove('hidden');
  el('rec-status').textContent = `Loaded: ${file.name}`;
}

function discardRecording() {
  recordingBlob = null; recordedChunks = [];
  clearInterval(recTimerInterval);
  el('rec-idle').classList.remove('hidden');
  el('rec-active').classList.add('hidden');
  el('rec-done').classList.add('hidden');
  el('rec-dot').className = 'dot ready';
  el('rec-status').textContent = 'Ready';
}

async function handleRegionToggle() {
  if (!el('opt-region').checked) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.postMessage({ type: 'DEMOREEL_REGION_SELECT' }, '*'),
    });
    window.close();
  }
}

// ── Generate ──────────────────────────────────────────────────────
async function generateDemo() {
  const desc = el('proj-desc').value.trim();
  const warnEl = el('gen-warn');
  warnEl.classList.add('hidden');
  if (!desc) { warnEl.textContent = '⚠️ Describe the feature in Step 3.'; warnEl.classList.remove('hidden'); return; }
  if (!recordingBlob) { warnEl.textContent = '⚠️ No recording. Go back to Step 1.'; warnEl.classList.remove('hidden'); return; }

  const btn = el('gen-btn');
  btn.disabled = true; btn.textContent = '⏳ Uploading...';

  try {
    const fd = new FormData();
    fd.append('recording', recordingBlob, 'recording.webm');
    fd.append('description', desc);
    fd.append('title', el('proj-title').value.trim() || desc.slice(0,50));
    fd.append('purpose', el('proj-purpose').value);
    fd.append('tone', el('proj-tone').value);
    fd.append('voice', el('proj-voice').value);
    fd.append('speed', el('opt-speed').value);
    fd.append('blurCredentials', el('opt-blur').checked);
    fd.append('chapters', el('opt-chapters').checked);
    fd.append('autoZoom', el('opt-zoom').checked);
    fd.append('webcam', el('opt-webcam').checked);

    const res = await fetch(`${serverUrl}/api/upload-recording`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error || `HTTP ${res.status}`);
    const { id } = await res.json();

    el('gen-jobid').textContent = `Job ID: ${id}`;
    el('gen-watch').href = `${serverUrl}/dashboard?job=${id}`;
    el('gen-success').classList.remove('hidden');
    btn.classList.add('hidden');

    const cfg = await chrome.storage.local.get(['autoOpen']);
    if (cfg.autoOpen !== false) chrome.tabs.create({ url: `${serverUrl}/dashboard?job=${id}` });

  } catch (err) {
    warnEl.textContent = '❌ ' + err.message; warnEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = '🚀 Generate Demo Video';
  }
}

function startOver() {
  discardRecording();
  el('proj-title').value = '';
  el('proj-desc').value = '';
  el('gen-success').classList.add('hidden');
  el('gen-btn').classList.remove('hidden');
  el('gen-btn').disabled = false;
  el('gen-btn').textContent = '🚀 Generate Demo Video';
  goToStep(1);
  switchNav('wizard');
}

// ── Reel ──────────────────────────────────────────────────────────
function renderReelClips() {
  const c = el('reel-clip-list');
  if (!reelClips.length) { c.innerHTML = '<div style="color:#8b949e;font-size:0.75rem;text-align:center;padding:8px;">No clips yet</div>'; return; }
  c.innerHTML = reelClips.map((clip, i) => `
    <div class="clip-item">
      <div class="clip-num">${i+1}</div>
      <div class="clip-name">${clip.name}</div>
      <div class="clip-size">${fmt(clip.size)}</div>
      <div class="clip-del" data-idx="${i}">✕</div>
    </div>`).join('');
  c.querySelectorAll('.clip-del').forEach(btn => {
    btn.addEventListener('click', () => { reelClips.splice(parseInt(btn.dataset.idx), 1); renderReelClips(); });
  });
}

async function reelRecord() {
  try {
    el('reel-rec-btn').disabled = true;
    reelStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
    reelChunks = [];
    const m = mime();
    reelMediaRecorder = new MediaRecorder(reelStream, { mimeType: m });
    reelMediaRecorder.ondataavailable = e => { if (e.data?.size > 0) reelChunks.push(e.data); };
    reelMediaRecorder.onstop = () => {
      const blob = new Blob(reelChunks, { type: m });
      reelClips.push({ name: `Clip ${reelClips.length+1}`, blob, size: blob.size });
      renderReelClips();
      el('reel-rec-btn').disabled = false;
    };
    reelStream.getVideoTracks()[0].addEventListener('ended', () => {
      if (reelMediaRecorder?.state !== 'inactive') reelMediaRecorder?.stop();
      reelStream?.getTracks().forEach(t => t.stop());
    });
    reelMediaRecorder.start(500);
  } catch { el('reel-rec-btn').disabled = false; }
}

function reelAddFiles(e) {
  Array.from(e.target.files).forEach(f => reelClips.push({ name: f.name, blob: f, size: f.size }));
  renderReelClips();
  e.target.value = '';
}

async function generateReel() {
  const warnEl = el('reel-warn');
  warnEl.classList.add('hidden');
  const desc = el('reel-desc').value.trim();
  if (!desc) { warnEl.textContent = '⚠️ Add a description.'; warnEl.classList.remove('hidden'); return; }
  if (reelClips.length < 2) { warnEl.textContent = '⚠️ Need at least 2 clips.'; warnEl.classList.remove('hidden'); return; }

  const btn = el('reel-generate');
  btn.disabled = true; btn.textContent = '⏳ Uploading...';

  try {
    const fd = new FormData();
    reelClips.forEach((c, i) => fd.append(`clip_${i}`, c.blob));
    fd.append('description', desc);
    fd.append('sfx', el('reel-sfx').value);
    fd.append('speed', el('reel-speed').value);
    fd.append('voice', el('reel-voice').value);

    const res = await fetch(`${serverUrl}/api/upload-reel`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error || `HTTP ${res.status}`);
    const { id } = await res.json();

    el('reel-watch').href = `${serverUrl}/dashboard?job=${id}`;
    el('reel-success').classList.remove('hidden');

    const cfg = await chrome.storage.local.get(['autoOpen']);
    if (cfg.autoOpen !== false) chrome.tabs.create({ url: `${serverUrl}/dashboard?job=${id}` });

  } catch (err) {
    warnEl.textContent = '❌ ' + err.message; warnEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = '🚀 Generate Reel';
  }
}
