export class HandTracker {
  constructor(videoEl, overlayCanvas) {
    this.video   = videoEl;
    this.overlay = overlayCanvas;
    this.ctx     = overlayCanvas.getContext('2d');
    this.landmarker = null;
    this.running    = false;
    this.lastTime   = -1;
    this.enabled    = false;

    // Callback: receives array of processed hand objects
    this.onUpdate = null;
  }

  async start() {
    this.enabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      this.video.srcObject = stream;
      await new Promise(res => { this.video.onloadedmetadata = res; });
      this.video.classList.add('active');
      this.overlay.classList.add('active');
      await this._loadMediaPipe();
      this.running = true;
      this._loop();
    } catch (e) {
      console.warn('Hand tracking unavailable:', e.message);
    }
  }

  stop() {
    this.enabled = false;
    this.running = false;
    const stream = this.video.srcObject;
    if (stream) stream.getTracks().forEach(t => t.stop());
    this.video.srcObject = null;
    this.video.classList.remove('active');
    this.overlay.classList.remove('active');
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (this.onUpdate) this.onUpdate([]);
  }

  async _loadMediaPipe() {
    const { HandLandmarker, FilesetResolver } = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3'
    );
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 2
    });
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());

    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastTime) return;
    this.lastTime = this.video.currentTime;

    const results = this.landmarker.detectForVideo(this.video, performance.now());
    const landmarks   = results.landmarks   || [];
    const handedness  = results.handedness  || [];

    this._drawOverlay(landmarks);

    if (this.onUpdate) {
      this.onUpdate(landmarks.map((lm, i) => this._process(lm, handedness[i])));
    }
  }

  _process(lm, handed) {
    const thumb = lm[4];
    const index = lm[8];
    const pinchDist = Math.hypot(thumb.x-index.x, thumb.y-index.y, thumb.z-index.z);
    const isPinching = pinchDist < 0.07;

    return {
      landmarks: lm,
      handedness: handed?.[0]?.categoryName ?? 'Unknown',
      isPinching,
      pinchDist,
      // Normalised 0-1 coords (video space, mirrored later)
      pinchCenter: { x: (thumb.x + index.x)*0.5, y: (thumb.y + index.y)*0.5 },
      indexTip:    { x: index.x, y: index.y },
    };
  }

  _drawOverlay(landmarkSets) {
    const ctx = this.ctx;
    const W = this.overlay.width, H = this.overlay.height;
    ctx.clearRect(0, 0, W, H);

    const CONNECTIONS = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],
      [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],
      [5,9],[9,13],[13,17]
    ];

    for (const lm of landmarkSets) {
      ctx.strokeStyle = 'rgba(29,185,84,0.55)';
      ctx.lineWidth = 1;
      for (const [a,b] of CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(lm[a].x*W, lm[a].y*H);
        ctx.lineTo(lm[b].x*W, lm[b].y*H);
        ctx.stroke();
      }
      for (let i = 0; i < 21; i++) {
        ctx.beginPath();
        ctx.arc(lm[i].x*W, lm[i].y*H, i===4||i===8 ? 4 : 2, 0, Math.PI*2);
        ctx.fillStyle = i===4||i===8 ? '#ff4488' : '#1db954';
        ctx.fill();
      }
    }
  }

  // Map normalised hand coords → screen px (mirrors X)
  toScreen(hand, containerW, containerH) {
    return {
      x: (1 - hand.pinchCenter.x) * containerW,
      y:       hand.pinchCenter.y  * containerH,
    };
  }
}
