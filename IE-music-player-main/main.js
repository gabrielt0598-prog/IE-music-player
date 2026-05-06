/**
 * main.js — initialisation, glue code, keyboard shortcuts, audio
 */

(async () => {
  // ── DOM refs ───────────────────────────────────────────────────────────────
  const canvasEl   = document.getElementById('game-canvas');
  const videoEl    = document.getElementById('right-webcam');
  const overlay    = document.getElementById('overlay');
  const startBtn   = document.getElementById('start-btn');
  const calibFlash = document.getElementById('calib-flash');

  // ── canvas sizing ──────────────────────────────────────────────────────────
  function resizeCanvas() {
    canvasEl.width  = canvasEl.offsetWidth;
    canvasEl.height = canvasEl.offsetHeight;
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
  let soundMode = 0;
  const SOUND_MODES = [
    { name: 'Bell',  bg: [26, 8, 18]  },
    { name: 'Pluck', bg: [22, 6, 24]  },
    { name: 'Synth', bg: [30, 6, 14]  },
    { name: 'Pad',   bg: [20, 10, 22] },
  ];

  function playBell(freq) {
    if (!soundEnabled) return;
    try {
      const ac  = getAudioCtx();
      const now = ac.currentTime;
      const delay  = ac.createDelay(1.0);
      const fbGain = ac.createGain();
      const wetOut = ac.createGain();
      delay.delayTime.value = 0.28;
      fbGain.gain.value     = 0.32;
      wetOut.gain.value     = 0.42;
      delay.connect(fbGain); fbGain.connect(delay);
      delay.connect(wetOut); wetOut.connect(ac.destination);
      const o1 = ac.createOscillator(), g1 = ac.createGain();
      o1.connect(g1); g1.connect(ac.destination); g1.connect(delay);
      o1.type = 'sine'; o1.frequency.value = freq;
      g1.gain.setValueAtTime(0.16, now);
      g1.gain.exponentialRampToValueAtTime(0.001, now + 2.8);
      o1.start(now); o1.stop(now + 3.0);
      const o2 = ac.createOscillator(), g2 = ac.createGain();
      o2.connect(g2); g2.connect(delay);
      o2.type = 'sine'; o2.frequency.value = freq * 2.007;
      g2.gain.setValueAtTime(0.045, now);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      o2.start(now); o2.stop(now + 1.4);
    } catch (_) {}
  }

  function playPluck(freq) {
    if (!soundEnabled) return;
    try {
      const ac  = getAudioCtx();
      const now = ac.currentTime;
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.type = 'triangle'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.22, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      o.start(now); o.stop(now + 0.7);
    } catch (_) {}
  }

  function playSynth(freq) {
    if (!soundEnabled) return;
    try {
      const ac  = getAudioCtx();
      const now = ac.currentTime;
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.1, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      o.start(now); o.stop(now + 0.5);
    } catch (_) {}
  }

  function playPad(freq) {
    if (!soundEnabled) return;
    try {
      const ac  = getAudioCtx();
      const now = ac.currentTime;
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
      o1.connect(g); o2.connect(g); g.connect(ac.destination);
      o1.type = 'sawtooth'; o1.frequency.value = freq;
      o2.type = 'sawtooth'; o2.frequency.value = freq * 1.005;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.12, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
      o1.start(now); o1.stop(now + 1.5);
      o2.start(now); o2.stop(now + 1.5);
    } catch (_) {}
  }

  function playCatch() {
    startAmbient();
    const freq = MELODY[melodyIdx % MELODY.length];
    melodyIdx++;
    switch (soundMode) {
      case 0: playBell(freq);  break;
      case 1: playPluck(freq); break;
      case 2: playSynth(freq); break;
      case 3: playPad(freq);   break;
    }
    pulseAmbient();
  }

  // ── calibration flash helper ──────────────────────────────────────────────
  function flashCalibration() {
    calibFlash.classList.add('flash');
    setTimeout(() => calibFlash.classList.remove('flash'), 200);
  }

  // ── keyboard shortcuts ────────────────────────────────────────────────────
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
        zIndex       : '700',
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

  // ── webcam start — reuses the globally shared camera stream ───────────────
  async function startWebcam() {
    try {
      await window.RIGHT_CAMERA_READY;
      return videoEl.srcObject !== null;
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
      Renderer.spawnRipple(pos);
      Renderer.spawnCatchText(pos);
      playCatch();
    });

    // start ambient drone
    startAmbient();

    // fade out overlay
    overlay.classList.add('fade-out');
    setTimeout(() => { overlay.style.display = 'none'; }, 900);

    // ── render + physics loop ───────────────────────────────────────────────
    let lastPhysics = performance.now();
    let prevPinch   = [];
    let lastPinchAt = 0;

    function loop(now) {
      const delta = Math.min(now - lastPhysics, 50);
      lastPhysics = now;

      // Pinch rising edge → cycle sound mode (600ms debounce)
      const pinch = Vision.getPinchStates();
      pinch.forEach((isPinching, i) => {
        if (isPinching && !prevPinch[i] && now - lastPinchAt > 600) {
          lastPinchAt = now;
          soundMode = (soundMode + 1) % SOUND_MODES.length;
          const mode = SOUND_MODES[soundMode];
          Renderer.setBgMode(mode.bg);
          showToast(`Sound: ${mode.name}`);
        }
      });
      prevPinch = pinch.slice();

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

  // ── game over buttons ──────────────────────────────────────────────────────
  document.getElementById('go-btn-yes').addEventListener('click', () => {
    PhysicsEngine.reset();
    Renderer.resetTimer();
  });
  document.getElementById('go-btn-no').addEventListener('click', () => {
    document.getElementById('gameover-overlay').style.display = 'none';
    overlay.classList.remove('fade-out');
    overlay.style.display = 'flex';
    startBtn.disabled    = false;
    startBtn.textContent = 'Start Game';
    launching = false;
  });
})();
