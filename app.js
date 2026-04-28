import { AudioEngine }  from './audio.js';
import { Visualizer }   from './visualizer.js';
import { ControlsUI }   from './controls.js';
import { HandTracker }  from './handtracking.js';

function $(id) { return document.getElementById(id); }

function showStatus(msg, ms = 2500) {
  const el = $('status-bar');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._tid);
  el._tid = setTimeout(() => el.classList.remove('show'), ms);
}

class App {
  constructor() {
    this.audio    = null;
    this.viz      = null;
    this.controls = null;
    this.tracker  = null;

    this._prevPinch = [false, false];
    this._mouseDown = false;

    this._boot();
  }

  async _boot() {
    this.audio    = new AudioEngine();
    await this.audio.init();

    this.viz      = new Visualizer($('visualizer-container'));
    this.controls = new ControlsUI($('controls-canvas'));

    this.tracker  = new HandTracker($('webcam'), $('hand-canvas'));
    this.tracker.onUpdate = hands => this._onHands(hands);

    this._wireUI();
    this._wireMouseControls();
    this._loop();
  }

  // ── UI wiring ────────────────────────────────────────────────────────────────
  _wireUI() {
    const fileInput = $('file-input');

    // Header file-open button
    $('file-open-btn').addEventListener('click', () => fileInput.click());

    // Drop-zone choose-file button
    $('file-btn').addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) this._loadFile(f);
      fileInput.value = '';
    });

    // Drag-and-drop onto the whole visualizer container
    const container = $('visualizer-container');
    container.addEventListener('dragover', e => {
      e.preventDefault();
      $('drop-zone').classList.add('drag-over');
    });
    container.addEventListener('dragleave', e => {
      if (!container.contains(e.relatedTarget)) {
        $('drop-zone').classList.remove('drag-over');
      }
    });
    container.addEventListener('drop', e => {
      e.preventDefault();
      $('drop-zone').classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('audio/')) this._loadFile(f);
      else showStatus('Please drop an audio file');
    });

    // Play / pause
    $('play-pause-btn').addEventListener('click', () => {
      this.audio.resume();
      const el = this.audio.localAudio;
      if (!el) return;
      el.paused ? el.play() : el.pause();
    });

    // Hand tracking toggle
    $('hand-toggle').addEventListener('click', () => {
      if (this.tracker.enabled) {
        this.tracker.stop();
        $('hand-toggle').classList.remove('active');
        $('hand-cursor').classList.remove('visible');
        $('hand-cursor-2').classList.remove('visible');
        showStatus('Hand tracking off');
      } else {
        this.tracker.start();
        $('hand-toggle').classList.add('active');
        showStatus('Hand tracking starting…');
      }
    });
  }

  _loadFile(file) {
    this.audio.resume();
    const el = this.audio.loadFile(file);
    el.play().catch(() => {});

    const name = file.name.replace(/\.[^/.]+$/, '');
    $('track-name').textContent = name;
    $('drop-zone').style.display = 'none';
    showStatus(`▶ ${name}`, 3000);

    el.addEventListener('ended', () => showStatus('Track ended — drop another file'));
  }

  // ── Mouse controls ────────────────────────────────────────────────────────────
  _wireMouseControls() {
    const cv = $('controls-canvas');

    cv.addEventListener('mousemove', e => {
      const { x, y } = this._canvasPos(cv, e);
      this.controls.setHover(this.controls.hitTest(x, y));
      if (this._mouseDown) {
        const r = this.controls.updateGrab(x, y);
        if (r) this._apply(r.name, r.value);
      }
    });

    cv.addEventListener('mousedown', e => {
      const { x, y } = this._canvasPos(cv, e);
      const name = this.controls.hitTest(x, y);
      if (name) {
        this._mouseDown = true;
        this.audio.resume();
        this.controls.startGrab(name, x, y);
      }
    });

    window.addEventListener('mouseup', () => {
      this._mouseDown = false;
      this.controls.endGrab();
    });

    cv.addEventListener('wheel', e => {
      const { x, y } = this._canvasPos(cv, e);
      const name = this.controls.hitTest(x, y);
      if (!name) return;
      e.preventDefault();
      const d = this.controls.defs[name];
      if (!d) return;
      const delta = -e.deltaY / 600;
      const nv = Math.max(0, Math.min(1, d.value + delta));
      d.value = nv;
      if (d.type === 'jog') d.angle += delta * Math.PI;
      this._apply(name, nv);
    }, { passive: false });
  }

  _canvasPos(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ── Apply control value ───────────────────────────────────────────────────────
  _apply(name, value) {
    if (!this.audio) return;
    switch (name) {
      case 'low':    this.audio.setLow(value);    break;
      case 'mid':    this.audio.setMid(value);    break;
      case 'high':   this.audio.setHigh(value);   break;
      case 'echo':   this.audio.setEcho(value);   break;
      case 'reverb': this.audio.setReverb(value); break;
      case 'noise':  this.audio.setNoise(value);  break;
      case 'volume': this.audio.setVolume(value); break;
      case 'jog':    this.audio.setEQ(value);     break;
    }
  }

  // ── Hand tracking ─────────────────────────────────────────────────────────────
  _onHands(hands) {
    const container = $('visualizer-container');
    const cw = container.clientWidth, ch = container.clientHeight;
    const cursors = [$('hand-cursor'), $('hand-cursor-2')];

    if (!hands.length) {
      cursors.forEach(c => c.classList.remove('visible', 'pinching'));
      if (this.controls.grabbed) this.controls.endGrab();
      this._prevPinch = [false, false];
      return;
    }

    hands.slice(0, 2).forEach((hand, i) => {
      const sx = (1 - hand.pinchCenter.x) * cw;
      const sy =      hand.pinchCenter.y  * ch;
      const cur = cursors[i];
      if (!cur) return;

      cur.classList.add('visible');
      cur.style.left = sx + 'px';
      cur.style.top  = sy + 'px';
      cur.classList.toggle('pinching', hand.isPinching);

      if (i !== 0) return;

      const hovered = this.controls.hitTest(sx, sy);
      this.controls.setHover(hovered);

      if (hand.isPinching && !this._prevPinch[i]) {
        if (hovered) { this.audio.resume(); this.controls.startGrab(hovered, sx, sy); }
      }
      if (hand.isPinching && this.controls.grabbed) {
        const r = this.controls.updateGrab(sx, sy);
        if (r) this._apply(r.name, r.value);
      }
      if (!hand.isPinching && this._prevPinch[i]) this.controls.endGrab();

      this._prevPinch[i] = hand.isPinching;
    });

    for (let i = hands.length; i < 2; i++) cursors[i]?.classList.remove('visible');
  }

  // ── Main loop ─────────────────────────────────────────────────────────────────
  _loop() {
    requestAnimationFrame(() => this._loop());
    const raw   = this.audio ? this.audio.getLevels() : { low:0, mid:0, high:0 };
    const pulse = this.audio ? this.audio.getBeat()   : 0;
    this.viz?.update({ ...raw, pulse });
    this.controls?.draw();
  }
}

document.addEventListener('DOMContentLoaded', () => new App());
