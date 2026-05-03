/**
 * main.js — initialisation, glue code, keyboard shortcuts, audio
 */

(async () => {
  // ── DOM refs ───────────────────────────────────────────────────────────────
  const canvasEl   = document.getElementById('game-canvas');
  const videoEl    = document.getElementById('webcam');
  const overlay    = document.getElementById('overlay');
  const startBtn   = document.getElementById('start-btn');
  const calibFlash = document.getElementById('calib-flash');

  // ── canvas sizing ──────────────────────────────────────────────────────────
  function resizeCanvas() {
    canvasEl.width  = window.innerWidth;
    canvasEl.height = window.innerHeight;
    PhysicsEngine.resize(canvasEl.width, canvasEl.height);
    Vision.resize(canvasEl.width, canvasEl.height);
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // ── Web Audio (optional) ──────────────────────────────────────────────────
  let audioCtx   = null;
  let soundEnabled = true;

  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  // ── ambient drone ─────────────────────────────────────────────────────────────────
  let ambientGain    = null;
  let ambientStarted = false;

  function startAmbient() {
    if (ambientStarted || !soundEnabled) return;
    ambientStarted = true;
    try {
      const ac  = getAudioCtx();
      const now = ac.currentTime;
      ambientGain = ac.createGain();
      ambientGain.connect(ac.destination);
      // Fade in slowly over 5s
      ambientGain.gain.setValueAtTime(0, now);
      ambientGain.gain.linearRampToValueAtTime(0.085, now + 4);

      // C2, G2, C3, E3, G3 — open fifth drone chord with added fifth
      [65.41, 98.00, 130.81, 164.81, 196.00].forEach((f, i) => {
        const osc = ac.createOscillator(), g = ac.createGain();
        osc.connect(g); g.connect(ambientGain);
        osc.type = 'sine';
        osc.frequency.value = f;
        osc.detune.value = i * 4;   // slight spread for warmth
        g.gain.value = i === 0 ? 0.6 : i < 3 ? 0.32 : 0.18;
        osc.start();
      });
    } catch (_) {}
  }

  function pulseAmbient() {
    if (!ambientGain || !soundEnabled) return;
    try {
      const ac  = getAudioCtx();
      const now = ac.currentTime;
      ambientGain.gain.cancelScheduledValues(now);
      ambientGain.gain.setValueAtTime(0.085, now);
      ambientGain.gain.linearRampToValueAtTime(0.22, now + 0.18);  // swell
      ambientGain.gain.exponentialRampToValueAtTime(0.085, now + 3.5); // fade back
    } catch (_) {}
  }

  // ── melody sequencer (C major pentatonic) ─────────────────────────────────
  const MELODY = [
    261.63, 293.66, 329.63, 392.00, 440.00,
    523.25, 587.33, 659.25, 784.00, 880.00,
    784.00, 659.25, 587.33, 523.25, 440.00,
    392.00, 329.63, 293.66, 261.63,
  ];
  let melodyIdx = 0;

  // Soft bell tone with simulated reverb (short delay feedback)
  function playBell(freq) {
    if (!soundEnabled) return;
    try {
      const ac  = getAudioCtx();
      const now = ac.currentTime;

      // delay → feedback loop (simulates reverb tail)
      const delay  = ac.createDelay(1.0);
      const fbGain = ac.createGain();
      const wetOut = ac.createGain();
      delay.delayTime.value = 0.28;
      fbGain.gain.value     = 0.32;
      wetOut.gain.value     = 0.42;
      delay.connect(fbGain); fbGain.connect(delay);
      delay.connect(wetOut); wetOut.connect(ac.destination);

      // fundamental — long sine decay
      const o1 = ac.createOscillator(), g1 = ac.createGain();
      o1.connect(g1); g1.connect(ac.destination); g1.connect(delay);
      o1.type = 'sine'; o1.frequency.value = freq;
      g1.gain.setValueAtTime(0.16, now);
      g1.gain.exponentialRampToValueAtTime(0.001, now + 2.8);
      o1.start(now); o1.stop(now + 3.0);

      // detuned octave shimmer
      const o2 = ac.createOscillator(), g2 = ac.createGain();
      o2.connect(g2); g2.connect(delay);
      o2.type = 'sine'; o2.frequency.value = freq * 2.007;
      g2.gain.setValueAtTime(0.045, now);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      o2.start(now); o2.stop(now + 1.4);
    } catch (_) {}
  }

  function playCatch() {
    startAmbient();
    const freq = MELODY[melodyIdx % MELODY.length];
    melodyIdx++;
    playBell(freq);
    pulseAmbient();
  }

  // ── calibration flash helper ──────────────────────────────────────────────
  function flashCalibration() {
    calibFlash.classList.add('flash');
    setTimeout(() => calibFlash.classList.remove('flash'), 200);
  }

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  let windActive = false;

  window.addEventListener('keydown', e => {
    switch (e.key.toLowerCase()) {
      case 'r':
        Vision.recalibrate();
        flashCalibration();
        break;
      case ' ':
        e.preventDefault();
        if (Renderer.isGameOver()) {
          PhysicsEngine.reset();
          Renderer.resetTimer();
        } else {
          PhysicsEngine.burstSpawn();
        }
        break;
      case 'w':
        windActive = PhysicsEngine.toggleWind();
        showToast(windActive ? '💨 Wind ON' : 'Wind OFF');
        break;
      case 's':
        soundEnabled = !soundEnabled;
        if (ambientGain) {
          const ac  = getAudioCtx();
          const now = ac.currentTime;
          ambientGain.gain.cancelScheduledValues(now);
          ambientGain.gain.linearRampToValueAtTime(soundEnabled ? 0.085 : 0, now + 0.5);
        }
        showToast(soundEnabled ? 'Sound ON' : 'Sound OFF');
        break;
      case 'b': {
        const name = Renderer.nextBucketStyle();
        showToast(`Bucket: ${name}`);
        break;
      }
    }
  });

  // ── tiny toast notification ────────────────────────────────────────────────
  let toastEl = null;
  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position     : 'fixed',
        bottom       : '36px',
        left         : '50%',
        transform    : 'translateX(-50%)',
        background   : 'rgba(0,0,0,0.92)',
        color        : '#ffffff',
        border       : '1.5px solid rgba(255,255,255,0.75)',
        padding      : '12px 32px',
        borderRadius : '0',
        fontFamily   : "'Courier New', monospace",
        fontSize     : '1rem',
        fontWeight   : '600',
        letterSpacing: '0.1em',
        zIndex       : '300',
        pointerEvents: 'none',
        transition   : 'opacity 0.35s ease',
        whiteSpace   : 'nowrap',
        boxShadow    : '0 0 24px rgba(100,160,255,0.25)',
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => { toastEl.style.opacity = '0'; }, 2800);
  }

  // ── webcam start ───────────────────────────────────────────────────────────
  async function startWebcam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width : { ideal: 320 },
          height: { ideal: 240 },
          facingMode: 'user',
        },
        audio: false,
      });
      videoEl.srcObject = stream;
      await new Promise(res => { videoEl.onloadedmetadata = res; });
      await videoEl.play();
      return true;
    } catch (err) {
      console.error('[Main] Webcam error:', err);
      showToast('Camera unavailable — obstacles disabled');
      return false;
    }
  }

  // ── launch game (shared by button click + gesture dwell) ──────────────────
  let launching = false;
  async function launchGame() {
    if (launching) return;
    launching = true;

    startBtn.disabled    = true;
    startBtn.textContent = 'Starting…';

    // Stop start-screen animation
    StartScreen.stop();

    // Camera may already be running (auto-started below); start if not
    let camOk = videoEl.srcObject !== null;
    if (!camOk) camOk = await startWebcam();

    // init subsystems
    PhysicsEngine.init(canvasEl.width, canvasEl.height);
    Renderer.init(canvasEl, videoEl);

    if (camOk && !visionInitialised) {
      await Vision.init(videoEl);
      visionInitialised = true;
    }

    PhysicsEngine.onCatch((ball, pos) => {
      Renderer.spawnCatchBurst(pos);
      playCatch();
    });

    // start ambient drone
    startAmbient();

    // fade out overlay
    overlay.classList.add('fade-out');
    setTimeout(() => { overlay.style.display = 'none'; }, 900);

    // ── render + physics loop ───────────────────────────────────────────────
    let lastPhysics = performance.now();
    function loop(now) {
      const delta = Math.min(now - lastPhysics, 50);
      lastPhysics = now;
      PhysicsEngine.checkCatches(Vision.getHandCenters());
      PhysicsEngine.step(delta);
      Renderer.frame(now);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    if (camOk) showToast('Hold your hands up to catch the balls!');
  }

  // ── auto-start camera silently on page load for gesture detection ──────────
  let visionInitialised = false;
  (async () => {
    const camOk = await startWebcam();
    if (camOk) {
      StartScreen.connectCamera(videoEl);
    }
  })();

  // ── wire up StartScreen + button ───────────────────────────────────────────
  StartScreen.init(launchGame);
  startBtn.addEventListener('click', () => launchGame());
})();
