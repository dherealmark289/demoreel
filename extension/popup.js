/**
 * DemoReel — popup.js (thin shell, loads UI from Railway server)
 * This means updates to the UI are instant — no reinstall needed.
 */

const DEFAULT_SERVER = 'https://demoreel-production.up.railway.app';

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = await chrome.storage.local.get(['serverUrl']);
  const serverUrl = (cfg.serverUrl || DEFAULT_SERVER).replace(/\/$/, '');

  const frame = document.getElementById('main-frame');
  const loading = document.getElementById('loading');
  const status = document.getElementById('load-status');

  status.textContent = 'Connecting to DemoReel...';

  // Load the hosted popup UI from the server
  frame.src = `${serverUrl}/extension-popup`;

  frame.addEventListener('load', () => {
    loading.style.display = 'none';
    frame.style.display = 'block';
  });

  frame.addEventListener('error', () => {
    status.textContent = 'Could not connect. Check Settings.';
  });

  // Timeout fallback
  setTimeout(() => {
    if (loading.style.display !== 'none') {
      status.textContent = 'Taking longer than expected...';
    }
  }, 5000);

  // Listen for messages from the iframe (recording requests)
  window.addEventListener('message', async (event) => {
    if (event.origin !== serverUrl) return;
    const { type, data } = event.data || {};

    if (type === 'OPEN_TAB') {
      chrome.tabs.create({ url: data.url });
    }

    if (type === 'START_RECORDING') {
      // Open the full-page recording tab — popup closes anyway when screen picker opens
      const params = new URLSearchParams();
      if (data.voice) params.set('voice', data.voice);
      if (data.tone) params.set('tone', data.tone);
      if (data.purpose) params.set('purpose', data.purpose);
      chrome.tabs.create({ url: `${serverUrl}/record?${params.toString()}` });
    }

    if (type === 'GET_STORAGE') {
      const result = await chrome.storage.local.get(data.keys);
      frame.contentWindow.postMessage({ type: 'STORAGE_RESULT', data: result }, serverUrl);
    }

    if (type === 'SET_STORAGE') {
      await chrome.storage.local.set(data);
      frame.contentWindow.postMessage({ type: 'STORAGE_SET_OK' }, serverUrl);
    }
  });
});

// ── Upload already-recorded blob ─────────────────────────────────
async function uploadRecording(serverUrl, opts = {}) {
  const frame = document.getElementById('main-frame');
  function postMsg(type, data) { frame.contentWindow?.postMessage({ type, data }, serverUrl); }

  // _lastBlob is stored by startRecording when onstop fires
  const blob = window._lastBlob;
  if (!blob) { postMsg('UPLOAD_ERROR', { error: 'No recording found' }); return; }

  try {
    const fd = new FormData();
    fd.append('recording', blob, 'recording.webm');
    if (opts.description) fd.append('description', opts.description);
    if (opts.title) fd.append('title', opts.title);
    if (opts.voice) fd.append('voice', opts.voice);
    if (opts.tone) fd.append('tone', opts.tone);
    if (opts.purpose) fd.append('purpose', opts.purpose);
    if (opts.speed) fd.append('speed', opts.speed);
    fd.append('blurCredentials', opts.blurCredentials ?? true);
    fd.append('chapters', opts.chapters ?? false);
    fd.append('autoZoom', opts.autoZoom ?? true);
    fd.append('webcam', opts.webcam ?? false);

    const res = await fetch(`${serverUrl}/api/upload-recording`, { method: 'POST', body: fd });
    const result = await res.json();
    postMsg('UPLOAD_DONE', result);
    const cfg = await chrome.storage.local.get(['autoOpen']);
    if (cfg.autoOpen !== false && result.id) {
      chrome.tabs.create({ url: `${serverUrl}/dashboard?job=${result.id}` });
    }
  } catch (err) {
    postMsg('UPLOAD_ERROR', { error: err.message });
  }
}

// ── Recording (stays in extension — needs native APIs) ────────────
async function startRecording(serverUrl, opts = {}) {
  const frame = document.getElementById('main-frame');
  let stream, mediaRecorder, chunks = [], timerInterval, seconds = 0;

  function postMsg(type, data) {
    frame.contentWindow?.postMessage({ type, data }, serverUrl);
  }

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
    const mimeType = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };

    mediaRecorder.onstop = async () => {
      clearInterval(timerInterval);
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mimeType });
      window._lastBlob = blob; // store for later upload
      postMsg('RECORDING_DONE', { size: blob.size, type: mimeType });

      // Upload directly
      if (opts.autoUpload) {
        const fd = new FormData();
        fd.append('recording', blob, 'recording.webm');
        if (opts.description) fd.append('description', opts.description);
        if (opts.title) fd.append('title', opts.title);
        if (opts.voice) fd.append('voice', opts.voice);
        if (opts.tone) fd.append('tone', opts.tone);
        if (opts.purpose) fd.append('purpose', opts.purpose);
        if (opts.speed) fd.append('speed', opts.speed);
        if (opts.blurCredentials !== undefined) fd.append('blurCredentials', opts.blurCredentials);
        if (opts.chapters !== undefined) fd.append('chapters', opts.chapters);
        if (opts.autoZoom !== undefined) fd.append('autoZoom', opts.autoZoom);

        try {
          const res = await fetch(`${serverUrl}/api/upload-recording`, { method: 'POST', body: fd });
          const result = await res.json();
          postMsg('UPLOAD_DONE', result);
          const cfg = await chrome.storage.local.get(['autoOpen']);
          if (cfg.autoOpen !== false && result.id) {
            chrome.tabs.create({ url: `${serverUrl}/dashboard?job=${result.id}` });
          }
        } catch (err) {
          postMsg('UPLOAD_ERROR', { error: err.message });
        }
      }
    };

    // Timer
    timerInterval = setInterval(() => {
      seconds++;
      const m = Math.floor(seconds/60), s = seconds%60;
      postMsg('RECORDING_TICK', { time: `${m}:${s.toString().padStart(2,'0')}`, seconds });
    }, 1000);

    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (mediaRecorder?.state !== 'inactive') mediaRecorder?.stop();
    });

    mediaRecorder.start(500);
    postMsg('RECORDING_STARTED', {});

    // Listen for stop command from iframe
    window.addEventListener('message', function stopHandler(e) {
      if (e.origin !== serverUrl) return;
      if (e.data?.type === 'STOP_RECORDING') {
        if (mediaRecorder?.state !== 'inactive') mediaRecorder?.stop();
        window.removeEventListener('message', stopHandler);
      }
    });

  } catch (err) {
    postMsg('RECORDING_ERROR', { error: err.message });
  }
}
