/**
 * DemoReel Recorder — popup.js
 * Handles recording flow: start → stop → describe → upload → show result
 */

const DEMOREEL_URL = 'https://demoreel-production.up.railway.app';

let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let recordingBlob = null;

// DOM refs
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const preRecordPanel = document.getElementById('preRecordPanel');
const recordingPanel = document.getElementById('recordingPanel');
const describePanel = document.getElementById('describePanel');
const resultPanel = document.getElementById('resultPanel');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const generateBtn = document.getElementById('generateBtn');
const discardBtn = document.getElementById('discardBtn');
const regionToggle = document.getElementById('regionToggle');
const descriptionInput = document.getElementById('descriptionInput');
const titleInput = document.getElementById('titleInput');
const jobIdDisplay = document.getElementById('jobIdDisplay');
const watchLink = document.getElementById('watchLink');
const voiceSelect = document.getElementById('voiceSelect');
const toneSelect = document.getElementById('toneSelect');
const purposeSelect = document.getElementById('purposeSelect');

function setStatus(text, state) {
  statusText.textContent = text;
  statusDot.className = 'status-dot ' + (state || '');
}

function showPanel(panelId) {
  [preRecordPanel, recordingPanel, describePanel, resultPanel].forEach(p => p.classList.add('hidden'));
  document.getElementById(panelId).classList.remove('hidden');
}

// ── Start Recording ──────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  try {
    setStatus('Requesting screen access...', '');

    const constraints = {
      video: {
        cursor: 'always',
      },
      audio: false, // system audio requires special handling
    };

    stream = await navigator.mediaDevices.getDisplayMedia(constraints);

    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
        ? 'video/webm;codecs=vp9' 
        : 'video/webm',
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      recordingBlob = new Blob(recordedChunks, { type: 'video/webm' });
      setStatus(`Recorded ${(recordingBlob.size / 1024 / 1024).toFixed(1)} MB`, 'ready');
      showPanel('describePanel');
    };

    // Auto-stop when user closes screen share
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        stream.getTracks().forEach(t => t.stop());
      }
    });

    mediaRecorder.start(1000); // collect chunks every second

    setStatus('Recording...', 'recording');
    showPanel('recordingPanel');

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      setStatus('Permission denied', '');
    } else {
      setStatus('Error: ' + err.message, '');
    }
    console.error('[DemoReel] Start recording error:', err);
  }
});

// ── Stop Recording ────────────────────────────────────────────────────────────
stopBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  setStatus('Processing recording...', 'processing');
});

// ── Generate Demo ─────────────────────────────────────────────────────────────
generateBtn.addEventListener('click', async () => {
  if (!recordingBlob) {
    setStatus('No recording found', '');
    return;
  }

  const description = descriptionInput.value.trim();
  const title = titleInput.value.trim();
  const voice = voiceSelect.value;
  const tone = toneSelect.value;
  const purpose = purposeSelect.value;

  if (!description) {
    descriptionInput.focus();
    descriptionInput.placeholder = '⚠️ Please describe this feature first...';
    return;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = '⏳ Uploading...';
  setStatus('Uploading to DemoReel...', 'processing');

  try {
    const formData = new FormData();
    formData.append('recording', recordingBlob, 'recording.webm');
    formData.append('description', description);
    formData.append('title', title || description.slice(0, 50));
    formData.append('voice', voice);
    formData.append('tone', tone);
    formData.append('purpose', purpose);
    formData.append('duration', '30');

    const response = await fetch(`${DEMOREEL_URL}/api/upload-recording`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const jobId = data.id;

    // Show result
    jobIdDisplay.textContent = `Job ID: ${jobId}`;
    watchLink.href = `${DEMOREEL_URL}/?job=${jobId}`;
    showPanel('resultPanel');
    setStatus('Pipeline running...', 'processing');

    // Save to extension storage
    chrome.storage.local.get(['recentJobs'], (result) => {
      const jobs = result.recentJobs || [];
      jobs.unshift({ id: jobId, title: title || description.slice(0, 30), createdAt: Date.now() });
      chrome.storage.local.set({ recentJobs: jobs.slice(0, 10) });
    });

  } catch (err) {
    generateBtn.disabled = false;
    generateBtn.textContent = '🚀 Generate Demo Video';
    setStatus('Upload failed: ' + err.message, '');
    console.error('[DemoReel] Upload error:', err);
  }
});

// ── Discard ───────────────────────────────────────────────────────────────────
discardBtn.addEventListener('click', () => {
  recordingBlob = null;
  recordedChunks = [];
  descriptionInput.value = '';
  titleInput.value = '';
  showPanel('preRecordPanel');
  setStatus('Ready to record', 'ready');
});

// ── Region Select (inject content.js) ─────────────────────────────────────────
regionToggle.addEventListener('change', async () => {
  if (regionToggle.checked) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.postMessage({ type: 'DEMOREEL_REGION_SELECT' }, '*');
      },
    });
  }
});
