/**
 * DemoReel Recorder — content.js
 * Region selector overlay injected into the current tab
 */

(function () {
  'use strict';

  let overlay = null;
  let selecting = false;
  let startX = 0, startY = 0;
  let selectionBox = null;

  function removeOverlay() {
    if (overlay) {
      document.body.removeChild(overlay);
      overlay = null;
    }
  }

  function createRegionSelector() {
    if (overlay) return; // Already active

    overlay = document.createElement('div');
    overlay.id = 'demoreel-region-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.4);
      cursor: crosshair;
      user-select: none;
    `;

    const instructions = document.createElement('div');
    instructions.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, sans-serif;
      font-size: 14px;
      pointer-events: none;
      text-align: center;
    `;
    instructions.innerHTML = '🎬 <strong>Drag to select region</strong><br><small>Press Esc to cancel</small>';
    overlay.appendChild(instructions);

    selectionBox = document.createElement('div');
    selectionBox.style.cssText = `
      position: absolute;
      border: 2px solid #2563eb;
      background: rgba(37, 99, 235, 0.15);
      pointer-events: none;
      display: none;
    `;
    overlay.appendChild(selectionBox);

    overlay.addEventListener('mousedown', (e) => {
      selecting = true;
      startX = e.clientX;
      startY = e.clientY;
      instructions.style.display = 'none';
      selectionBox.style.display = 'block';
      selectionBox.style.left = startX + 'px';
      selectionBox.style.top = startY + 'px';
      selectionBox.style.width = '0';
      selectionBox.style.height = '0';
    });

    overlay.addEventListener('mousemove', (e) => {
      if (!selecting) return;
      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      selectionBox.style.left = x + 'px';
      selectionBox.style.top = y + 'px';
      selectionBox.style.width = w + 'px';
      selectionBox.style.height = h + 'px';
    });

    overlay.addEventListener('mouseup', (e) => {
      if (!selecting) return;
      selecting = false;

      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);

      removeOverlay();

      if (w > 20 && h > 20) {
        // Send region back to background/popup
        window.postMessage({
          type: 'DEMOREEL_REGION_SELECTED',
          region: { x, y, width: w, height: h },
        }, '*');
      }
    });

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        removeOverlay();
        document.removeEventListener('keydown', escHandler);
        window.postMessage({ type: 'DEMOREEL_REGION_CANCELLED' }, '*');
      }
    });

    document.body.appendChild(overlay);
  }

  // Listen for messages from popup
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type === 'DEMOREEL_REGION_SELECT') {
      createRegionSelector();
    }
  });

  // Also listen for chrome runtime messages
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'DEMOREEL_REGION_SELECT') {
        createRegionSelector();
      }
    });
  }
})();
