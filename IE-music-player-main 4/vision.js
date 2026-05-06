/**
 * vision.js — webcam capture, MediaPipe Hands landmark detection,
 *              and obstacle body creation for Matter.js
 *              Barriers are hands only — no background subtraction.
 */

const Vision = (() => {
  // ── config ─────────────────────────────────────────────────────────────────
  const MAX_OBSTACLES  = 4;       // 2 hands × up to 2 bodies each
  const DETECTION_FPS  = 15;      // target detection framerate
  const DETECTION_INT  = 1000 / DETECTION_FPS;

  // ── state ──────────────────────────────────────────────────────────────────
  let videoEl        = null;
  let lastDetectTime = 0;
  let handLandmarks  = [];        // latest landmarks from MediaPipe
  let pinchStates    = [];        // boolean per hand — true when thumb+index pinched
  let handHulls      = [];        // computed convex hulls in canvas coords
  let segMask        = null;      // latest segmentation mask from SelfieSegmentation
  let canvasW        = Math.floor(window.innerWidth / 2);
  let canvasH        = window.innerHeight;

  // ── convex hull helper ────────────────────────────────────────────────────
  // Graham scan — returns array of {x,y} points
  function convexHull(points) {
    if (points.length < 3) return points;
    points = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (O, A, B) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
    const lower = [], upper = [];
    for (const p of points) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // ── map cam coords → canvas coords (mirrored) ─────────────────────────────
  function camToCanvas(cx, cy) {
    // cam is 320×240, canvas is full viewport; cam is already mirrored in video CSS
    // MediaPipe also returns mirrored coords (0=left when mirrored)
    return {
      x: (1 - cx) * canvasW,   // MediaPipe x is 0→1 left-to-right in mirrored space
      y: cy * canvasH,
    };
  }

  // ── MediaPipe Hands setup ─────────────────────────────────────────────────
  function initMediaPipe() {
    if (typeof Hands === 'undefined') {
      console.warn('[Vision] MediaPipe Hands not available — no barriers will appear');
      return;
    }

    const hands = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
    });

    hands.setOptions({
      maxNumHands         : 1,
      modelComplexity     : 0,
      minDetectionConfidence : 0.6,
      minTrackingConfidence  : 0.5,
    });

    hands.onResults(results => {
      handLandmarks = (results.multiHandLandmarks || []).slice(0, 1);
      pinchStates = handLandmarks.map(lm => {
        const dx = lm[4].x - lm[8].x;
        const dy = lm[4].y - lm[8].y;
        return Math.sqrt(dx * dx + dy * dy) < 0.07;
      });
    });

    // feed frames into MediaPipe on a low-rate interval
    setInterval(async () => {
      if (videoEl && videoEl.readyState >= 2) {
        try { await hands.send({ image: videoEl }); } catch (_) {}
      }
    }, DETECTION_INT);

    console.log('[Vision] MediaPipe Hands initialised');
  }

  // ── MediaPipe SelfieSegmentation setup ────────────────────────────────
  function initSelfieSegmentation() {
    if (typeof SelfieSegmentation === 'undefined') {
      console.warn('[Vision] SelfieSegmentation not available');
      return;
    }

    const seg = new SelfieSegmentation({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`,
    });

    seg.setOptions({ modelSelection: 0 }); // 0 = general model (faster)

    seg.onResults(results => {
      segMask = results.segmentationMask;
    });

    setInterval(async () => {
      if (videoEl && videoEl.readyState >= 2) {
        try { await seg.send({ image: videoEl }); } catch (_) {}
      }
    }, DETECTION_INT);

    console.log('[Vision] SelfieSegmentation initialised');
  }

  // ── compute hand hulls in canvas coords ──────────────────────────────────
  function computeHandHulls() {
    const hulls = [];
    for (const landmarks of handLandmarks) {
      const pts  = landmarks.map(lm => camToCanvas(lm.x, lm.y));
      const hull = convexHull(pts);
      if (hull.length >= 3) hulls.push(hull);
    }
    return hulls;
  }

  // ── detection loop (decoupled from render) ────────────────────────────────
  function detectionLoop(now) {
    if (now - lastDetectTime >= DETECTION_INT) {
      lastDetectTime = now;
      if (videoEl && videoEl.readyState >= 2) {
        handHulls = computeHandHulls();
      }
    }
    requestAnimationFrame(detectionLoop);
  }

  // ── init ──────────────────────────────────────────────────────────────────
  async function init(video) {
    videoEl = video;
    initMediaPipe();
    initSelfieSegmentation();
    requestAnimationFrame(detectionLoop);
  }

  function recalibrate() { /* no-op: hand-only mode needs no recalibration */ }

  function resize(w, h) { canvasW = w; canvasH = h; }

  function getHandHulls() { return handHulls; }

  function getHandCenters() {
    // Use the four finger-base knuckles (MCPs) rather than the full hull centroid,
    // so the bucket tracks the palm opening rather than being pulled toward the wrist/arm.
    return handLandmarks.map(lm => {
      const pts = [5, 9, 13, 17].map(i => camToCanvas(lm[i].x, lm[i].y));
      return pts.reduce((s, p) => s + p.x, 0) / pts.length;
    });
  }

  function getSegmentationMask() { return segMask; }

  function getPinchStates() { return pinchStates; }

  return { init, recalibrate, resize, getHandHulls, getHandCenters, getSegmentationMask, getPinchStates };
})();
