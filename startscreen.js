/**
 * startscreen.js — animated ASCII rain background + gesture cursor for the start screen.
 * No webcam preview is shown. The cursor is a 3×3 ASCII cluster in electric blue.
 * Hovering the cursor over the start button for 2 s triggers launchFn().
 */

const StartScreen = (() => {
  // ── state ───────────────────────────────────────────────────────────────────
  let canvas    = null;   // start-canvas: ASCII rain (behind overlay)
  let ctx       = null;
  let curCanvas = null;   // cursor-canvas: gesture cursor (above overlay)
  let curCtx    = null;
  let animId    = null;
  let launched  = false;
  let launchFn  = null;

  // ── ASCII rain ───────────────────────────────────────────────────────────────
  const CHARS  = ['!', '+', '/', '%', '#'];
  let   cols   = [];

  function initRain(W, H) {
    const cellW = 13;
    const count = Math.ceil(W / cellW);
    cols = [];
    for (let i = 0; i < count; i++) {
      cols.push({
        x        : i * cellW + cellW / 2,
        y        : Math.random() * H,
        speed    : 0.25 + Math.random() * 0.65,
        trailLen : 7 + Math.floor(Math.random() * 10),
        phase    : Math.random() * Math.PI * 2,
      });
    }
  }

  function drawRain(W, H, t) {
    ctx.clearRect(0, 0, W, H);
    ctx.font         = '11px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign    = 'center';

    for (const col of cols) {
      col.y += col.speed;
      if (col.y > H + 20) col.y = -20;

      for (let j = 0; j < col.trailLen; j++) {
        const cy = col.y - j * 13;
        if (cy < -20 || cy > H + 20) continue;

        const ci   = Math.abs(Math.floor(t * 0.0008 * col.speed + j + col.phase)) % CHARS.length;
        const fade = 1 - j / col.trailLen;
        const luma = 0.3 + fade * 0.7;
        const r    = Math.round(30  + luma * 50);
        const g    = Math.round(100 + luma * 80);
        const b    = 255;
        const a    = (0.10 + fade * 0.55).toFixed(3);
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.fillText(CHARS[ci], col.x, cy);
      }
    }
  }

  // ── gesture cursor ───────────────────────────────────────────────────────────
  let handX      = -1;
  let handY      = -1;
  let dwellStart = null;
  const DWELL_MS = 2000;
  let   btnRect  = null;

  function drawCursor(t) {
    curCtx.clearRect(0, 0, curCanvas.width, curCanvas.height);
    if (handX < 0) return;

    // 3×3 cluster of ASCII chars
    curCtx.font         = '11px monospace';
    curCtx.textBaseline = 'middle';
    curCtx.textAlign    = 'center';
    const sp = 10;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ci   = Math.abs(dx + dy * 3 + Math.floor(t * 0.003)) % CHARS.length;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const luma = 1 - dist * 0.18;
        const r    = Math.round(60  + luma * 80);
        const g    = Math.round(110 + luma * 100);
        const b    = 255;
        const a    = (0.55 + luma * 0.4).toFixed(3);
        curCtx.fillStyle = `rgba(${r},${g},${b},${a})`;
        curCtx.fillText(CHARS[ci], handX + dx * sp, handY + dy * sp);
      }
    }

    // resolve button bounds once
    if (!btnRect) {
      const btn = document.getElementById('start-btn');
      if (btn) btnRect = btn.getBoundingClientRect();
    }

    // Convert viewport btnRect to pane-local coords (right pane starts at 50vw)
    const paneLeft = curCanvas.getBoundingClientRect().left;
    const over = btnRect &&
      (handX + paneLeft) >= btnRect.left && (handX + paneLeft) <= btnRect.right &&
      handY >= btnRect.top  && handY <= btnRect.bottom;

    if (over) {
      if (!dwellStart) dwellStart = t;
      const progress = Math.min((t - dwellStart) / DWELL_MS, 1);

      // arc grows clockwise from top
      curCtx.beginPath();
      curCtx.arc(handX, handY, 20, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      curCtx.strokeStyle = `rgba(120,180,255,0.85)`;
      curCtx.lineWidth   = 2;
      curCtx.stroke();

      if (progress >= 1 && !launched) {
        launched = true;
        launchFn();
      }
    } else {
      dwellStart = null;
    }
  }

  // ── hands setup (minimal, start-screen only) ─────────────────────────────────
  function connectCamera(video) {
    if (typeof Hands === 'undefined') return;

    const hands = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
    });
    hands.setOptions({
      maxNumHands            : 1,
      modelComplexity        : 0,
      minDetectionConfidence : 0.6,
      minTrackingConfidence  : 0.5,
    });
    hands.onResults(results => {
      const lms = results.multiHandLandmarks;
      if (lms && lms.length > 0) {
        // palm centroid, mirrored
        let sx = 0, sy = 0;
        for (const lm of lms[0]) { sx += lm.x; sy += lm.y; }
        sx /= lms[0].length; sy /= lms[0].length;
        handX = (1 - sx) * canvas.width;
        handY = sy         * canvas.height;
        // invalidate cached btn rect in case overlay moved
        btnRect = null;
      } else {
        handX = -1; handY = -1; dwellStart = null;
      }
    });

    setInterval(async () => {
      if (!launched && video.readyState >= 2) {
        try { await hands.send({ image: video }); } catch (_) {}
      }
    }, 67); // ~15 fps
  }

  // ── main loop ────────────────────────────────────────────────────────────────
  function loop(t) {
    if (launched) return;
    drawRain(canvas.width, canvas.height, t);
    drawCursor(t);
    animId = requestAnimationFrame(loop);
  }

  // ── public ───────────────────────────────────────────────────────────────────
  function init(launchCallback) {
    launchFn  = launchCallback;
    canvas    = document.getElementById('start-canvas');
    curCanvas = document.getElementById('cursor-canvas');
    if (!canvas) return;
    ctx    = canvas.getContext('2d');
    curCtx = curCanvas ? curCanvas.getContext('2d') : canvas.getContext('2d');
    canvas.width    = Math.floor(window.innerWidth / 2);
    canvas.height   = window.innerHeight;
    if (curCanvas) { curCanvas.width = Math.floor(window.innerWidth / 2); curCanvas.height = window.innerHeight; }
    initRain(canvas.width, canvas.height);
    animId = requestAnimationFrame(loop);
  }

  function stop() {
    launched = true;
    if (animId) cancelAnimationFrame(animId);
    if (canvas)    { ctx.clearRect(0, 0, canvas.width, canvas.height);       canvas.style.display    = 'none'; }
    if (curCanvas) { curCtx.clearRect(0, 0, curCanvas.width, curCanvas.height); curCanvas.style.display = 'none'; }
  }

  return { init, connectCamera, stop };
})();
