/**
 * dual-camera.js — Drop-in dual-camera upgrade for the split-pane app.
 *
 * Assigns camera 0 to the left pane (Gesture Instrument) and
 * camera 1 to the right pane (Ball Drop), with per-pane selector dropdowns.
 *
 * ── HOW TO USE (teammate instructions) ────────────────────────────────────
 *
 *  1. Drop this file into the project folder.
 *
 *  2. In index.html — add ONE line immediately after the existing camera
 *     startup <script> block (the one containing "window.CAMERA_READY"):
 *
 *       <script src="dual-camera.js"></script>
 *
 *  3. In main.js — change TWO lines:
 *
 *       getElementById('shared-webcam')  →  getElementById('right-webcam')
 *       await window.CAMERA_READY        →  await window.RIGHT_CAMERA_READY
 *
 *  That's it. No other files need to be changed.
 * ──────────────────────────────────────────────────────────────────────────
 */

(async () => {

  // ── 1. Inject CSS ─────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #right-webcam {
      position: fixed;
      top: -9999px;
      left: -9999px;
      width: 320px;
      height: 240px;
    }
    .cam-picker {
      position: absolute;
      display: flex;
      align-items: center;
      gap: 7px;
      z-index: 200;
    }
    .cam-label {
      font-family: 'Courier New', monospace;
      font-size: 9px;
      letter-spacing: 0.2em;
      color: rgba(255,255,255,0.38);
      text-transform: uppercase;
      user-select: none;
      white-space: nowrap;
    }
    .cam-select {
      background: rgba(0,0,0,0.85);
      border: 1.5px solid rgba(255,255,255,0.35);
      color: rgba(255,255,255,0.75);
      font-family: 'Courier New', monospace;
      font-size: 11px;
      letter-spacing: 0.04em;
      padding: 4px 8px;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      outline: none;
      max-width: 170px;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .cam-select:hover { border-color: rgba(255,255,255,0.75); color: #fff; }
    #left-cam-picker  { left: 18px; top: 100px; }
    #right-cam-picker { right: 18px; top: 18px; }
  `;
  document.head.appendChild(style);

  // ── 2. Create the hidden right-pane video element ─────────────────────────
  const rightVideo = document.createElement('video');
  rightVideo.id = 'right-webcam';
  rightVideo.autoplay = true;
  rightVideo.playsInline = true;
  rightVideo.muted = true;
  document.body.insertBefore(rightVideo, document.body.firstChild);

  // ── 3. Helper: start a camera stream on a given video element ─────────────
  async function openCamera(videoEl, deviceId) {
    if (videoEl.srcObject) {
      videoEl.srcObject.getTracks().forEach(t => t.stop());
      videoEl.srcObject = null;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    videoEl.srcObject = stream;
    await new Promise(r => { videoEl.onloadedmetadata = r; });
    await videoEl.play();
  }

  // ── 4. switchCamera — called by the dropdown selectors ────────────────────
  window.switchCamera = async (side, deviceId) => {
    const el = document.getElementById(side === 'left' ? 'shared-webcam' : 'right-webcam');
    if (!el) return;
    try {
      await openCamera(el, deviceId);
    } catch (e) {
      console.warn('[DualCamera] Switch failed:', e.message);
    }
  };

  // ── 5. Inject camera-picker UI into each pane ─────────────────────────────
  function makePicker(wrapperId, selectId) {
    const wrap = document.createElement('div');
    wrap.className = 'cam-picker';
    wrap.id = wrapperId;
    wrap.innerHTML =
      `<span class="cam-label">CAM</span>` +
      `<select class="cam-select" id="${selectId}"><option>Detecting…</option></select>`;
    return wrap;
  }

  const leftPane  = document.getElementById('left-pane');
  const rightPane = document.getElementById('right-pane');
  if (leftPane)  leftPane.appendChild(makePicker('left-cam-picker',  'left-cam-select'));
  if (rightPane) rightPane.appendChild(makePicker('right-cam-picker', 'right-cam-select'));

  // ── 6. Camera setup ───────────────────────────────────────────────────────
  // LEFT_CAMERA_READY: camera 0 is already started by the original CAMERA_READY
  // block in index.html — just alias it.
  window.LEFT_CAMERA_READY = window.CAMERA_READY;

  // RIGHT_CAMERA_READY: wait for permission, then open camera 1 on #right-webcam.
  window.RIGHT_CAMERA_READY = (async () => {
    await window.CAMERA_READY; // permission is already granted by the original startup

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams    = devices.filter(d => d.kind === 'videoinput');
      if (cams.length === 0) return false;

      const leftSel  = document.getElementById('left-cam-select');
      const rightSel = document.getElementById('right-cam-select');

      // Populate both dropdowns with all available cameras
      [leftSel, rightSel].forEach(sel => {
        if (!sel) return;
        sel.innerHTML = '';
        cams.forEach((cam, i) => {
          const opt = document.createElement('option');
          opt.value       = cam.deviceId;
          opt.textContent = cam.label || `Camera ${i + 1}`;
          sel.appendChild(opt);
        });
      });

      if (leftSel)  leftSel.value  = cams[0].deviceId;
      if (rightSel) rightSel.value = (cams[1] ?? cams[0]).deviceId;

      if (leftSel)  leftSel.addEventListener('change',  () => window.switchCamera('left',  leftSel.value));
      if (rightSel) rightSel.addEventListener('change', () => window.switchCamera('right', rightSel.value));

      if (cams.length >= 2) {
        await openCamera(rightVideo, cams[1].deviceId);
        console.log('[DualCamera] Two cameras connected —',
          cams[0].label || 'Camera 0', '/', cams[1].label || 'Camera 1');
      } else {
        // Only one physical camera — share the left stream
        const leftVideo = document.getElementById('shared-webcam');
        if (leftVideo) {
          rightVideo.srcObject = leftVideo.srcObject;
          await new Promise(r => { rightVideo.onloadedmetadata = r; });
          await rightVideo.play();
        }
        console.warn('[DualCamera] Only one camera detected — both panes share the same feed');
      }
      return true;
    } catch (e) {
      console.warn('[DualCamera] Right camera setup failed:', e.message);
      return false;
    }
  })();

})();
