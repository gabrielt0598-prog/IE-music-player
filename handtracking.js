// Hand tracking — MediaPipe Tasks Vision @0.10.21
// Improvements over original: GPU→CPU fallback, separate render/inference loops,
// inference error recovery, newer model URL, mobile-aware confidence thresholds.

const TASKS_CDN  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker' +
                   '/hand_landmarker/float16/latest/hand_landmarker.task';

const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17]
];

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export class HandTracker {
  constructor(videoEl, overlayCanvas) {
    this.video   = videoEl;
    this.overlay = overlayCanvas;
    this.ctx     = overlayCanvas.getContext('2d');

    this.landmarker = null;
    this.enabled    = false;
    this.running    = false;
    this.onUpdate   = null;

    this._stream             = null;
    this._delegate           = 'GPU';
    this._lastTs             = -1;
    this._handResults        = [];
    this._recoveryAttempted  = false;
    this._recoveryInProgress = false;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async start() {
    this.enabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: 'user' } }
      });
      this._stream = stream;
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.setAttribute('playsinline', '');
      await new Promise(res => { this.video.onloadedmetadata = res; });
      await this.video.play();
      this.video.classList.add('active');
      this.overlay.classList.add('active');

      await this._loadMediaPipe();

      this.running = true;
      this._inferenceLoop();
      this._renderLoop();
    } catch (e) {
      console.warn('Hand tracking unavailable:', e.message);
      this.enabled = false;
    }
  }

  stop() {
    this.enabled = false;
    this.running = false;

    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    this.video.srcObject = null;
    this.video.classList.remove('active');
    this.overlay.classList.remove('active');

    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this._handResults = [];
    if (this.onUpdate) this.onUpdate([]);
  }

  // ── MediaPipe initialisation — GPU preferred, CPU fallback ─────────────────

  async _loadMediaPipe() {
    const { HandLandmarker, FilesetResolver } = await import(
      `${TASKS_CDN}/vision_bundle.mjs`
    );
    const vision = await FilesetResolver.forVisionTasks(`${TASKS_CDN}/wasm`);

    const confidence        = isMobile ? 0.35 : 0.5;
    const preferredDelegate = isMobile ? 'CPU' : 'GPU';

    const build = (delegate) => HandLandmarker.createFromOptions(vision, {
      baseOptions:               { modelAssetPath: HAND_MODEL, delegate },
      runningMode:               'VIDEO',
      numHands:                  2,
      minHandDetectionConfidence: confidence,
      minHandPresenceConfidence:  confidence,
      minTrackingConfidence:      confidence,
    });

    try {
      this.landmarker = await build(preferredDelegate);
      this._delegate  = preferredDelegate;
    } catch (e) {
      const fallback = preferredDelegate === 'GPU' ? 'CPU' : 'GPU';
      console.warn(`${preferredDelegate} delegate failed, switching to ${fallback}:`, e);
      this.landmarker = await build(fallback);
      this._delegate  = fallback;
    }
  }

  // ── Loops ───────────────────────────────────────────────────────────────────

  // Inference loop: runs the ML model as fast as frames arrive (typically 30fps).
  _inferenceLoop() {
    if (!this.running) return;

    if (this.landmarker && this.video.readyState >= 2) {
      const ts = performance.now();
      if (ts > this._lastTs) {
        this._lastTs = ts;
        try {
          const result   = this.landmarker.detectForVideo(this.video, ts);
          this._handResults = result.landmarks  || [];
          const handedness  = result.handedness || [];
          if (this.onUpdate) {
            this.onUpdate(this._handResults.map((lm, i) => this._process(lm, handedness[i])));
          }
        } catch (err) {
          console.error('HandLandmarker inference error:', err);
          if (!this._recoveryAttempted && this._delegate === 'GPU' && !this._recoveryInProgress) {
            this._recoveryInProgress = true;
            this._recoverWithCPU(err).finally(() => { this._recoveryInProgress = false; });
          }
          return; // don't reschedule — recovery will restart the loop
        }
      }
    }

    requestAnimationFrame(() => this._inferenceLoop());
  }

  // Render loop: redraws the overlay at ~60fps, independent of inference rate.
  _renderLoop() {
    if (!this.running) return;
    this._drawOverlay(this._handResults);
    requestAnimationFrame(() => this._renderLoop());
  }

  // Attempt to recover from a GPU inference crash by rebuilding with CPU.
  async _recoverWithCPU(originalErr) {
    this._recoveryAttempted = true;
    this.running = false;
    console.warn('Attempting CPU recovery after GPU failure:', originalErr);

    try {
      const { HandLandmarker, FilesetResolver } = await import(
        `${TASKS_CDN}/vision_bundle.mjs`
      );
      const vision = await FilesetResolver.forVisionTasks(`${TASKS_CDN}/wasm`);
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions:               { modelAssetPath: HAND_MODEL, delegate: 'CPU' },
        runningMode:               'VIDEO',
        numHands:                  2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence:  0.4,
        minTrackingConfidence:      0.4,
      });
      this._delegate    = 'CPU';
      this._lastTs      = -1;
      this._handResults = [];
      this.running      = true;
      this._inferenceLoop();
      this._renderLoop();
    } catch (e) {
      console.error('CPU recovery failed — stopping hand tracking:', e);
      this.stop();
    }
  }

  // ── Per-hand data processing ─────────────────────────────────────────────────

  _process(lm, handed) {
    const thumb = lm[4];
    const index = lm[8];
    const pinchDist = Math.hypot(thumb.x - index.x, thumb.y - index.y, thumb.z - index.z);

    return {
      landmarks:  lm,
      handedness: handed?.[0]?.categoryName ?? 'Unknown',
      isPinching: pinchDist < 0.07,
      pinchDist,
      pinchCenter: { x: (thumb.x + index.x) * 0.5, y: (thumb.y + index.y) * 0.5 },
      indexTip:    { x: index.x, y: index.y },
    };
  }

  // ── Overlay drawing ──────────────────────────────────────────────────────────

  _drawOverlay(landmarkSets) {
    const ctx = this.ctx;
    // Keep overlay canvas resolution in sync with the live video feed.
    const W = this.overlay.width  = this.video.videoWidth  || this.overlay.width;
    const H = this.overlay.height = this.video.videoHeight || this.overlay.height;
    ctx.clearRect(0, 0, W, H);

    for (const lm of landmarkSets) {
      // Skeleton
      ctx.strokeStyle = 'rgba(74,222,128,0.5)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(lm[a].x * W, lm[a].y * H);
        ctx.lineTo(lm[b].x * W, lm[b].y * H);
      }
      ctx.stroke();

      // Landmark dots (thumb tip + index tip highlighted)
      for (let i = 0; i < 21; i++) {
        const isPinchPoint = i === 4 || i === 8;
        ctx.beginPath();
        ctx.arc(lm[i].x * W, lm[i].y * H, isPinchPoint ? 4 : 2, 0, Math.PI * 2);
        ctx.fillStyle = isPinchPoint ? '#ff4488' : '#4ade80';
        ctx.fill();
      }
    }
  }
}
