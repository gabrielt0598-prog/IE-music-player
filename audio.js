export class AudioEngine {
  constructor() {
    this.ctx       = null;
    this.analyser  = null;
    this.freqData  = null;
    this.fftSize   = 256; // 128 bins — matches reference sketch

    // EQ filters (affect visualizer sensitivity, not SDK audio)
    this.lowFilter  = null;
    this.midFilter  = null;
    this.highFilter = null;

    // FX nodes
    this.delayNode     = null;
    this.delayFeedback = null;
    this.delayWet      = null;
    this.convolver     = null;
    this.reverbGain    = null;
    this.noiseSource   = null;
    this.noiseGain     = null;
    this.masterGain    = null;

    // Local file playback
    this._localEl        = null;
    this._localSrc       = null;
    this._waveData       = null;

    // Energy-based beat detection
    this._beatHistory = new Float32Array(43); // ~0.7 s at 60 fps
    this._beatHistIdx = 0;
    this._beatPulse   = 0;
    this._beatLastAt  = 0;

    // BPM clock (fallback when no audio signal)
    this._bpm           = 120;
    this._clockLastBeat = 0;
    this._clockPulse    = 0;
    this._tapTimes      = [];

    this.values = { low:0.5, mid:0.5, high:0.5, echo:0, reverb:0, noise:0, volume:0.8, eq:0.5 };
  }

  async init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Analyser — 128 bins like the reference sketch
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.85;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    // EQ filters
    this.lowFilter = this.ctx.createBiquadFilter();
    this.lowFilter.type = 'lowshelf';
    this.lowFilter.frequency.value = 320;

    this.midFilter = this.ctx.createBiquadFilter();
    this.midFilter.type = 'peaking';
    this.midFilter.frequency.value = 1000;
    this.midFilter.Q.value = 0.7;

    this.highFilter = this.ctx.createBiquadFilter();
    this.highFilter.type = 'highshelf';
    this.highFilter.frequency.value = 3200;

    // Echo
    this.delayNode = this.ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0.3;
    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = 0;
    this.delayWet = this.ctx.createGain();
    this.delayWet.gain.value = 0;

    // Reverb
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this._makeImpulse(2.5, 3);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0;

    // Noise
    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseSource = this._makeNoiseSource();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;

    // Noise → master (also silent)
    this.noiseSource.connect(this.noiseGain);
    this.noiseGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    // Audio input → EQ → analyser → FX → master
    this._analysisInput = this.ctx.createGain();
    this._analysisInput.connect(this.lowFilter);
    this.lowFilter.connect(this.midFilter);
    this.midFilter.connect(this.highFilter);
    this.highFilter.connect(this.analyser);
    this.analyser.connect(this.masterGain);
    this.highFilter.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.masterGain);
    this.highFilter.connect(this.convolver);
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);
  }

  // ── Load a local audio File for playback + analysis ────────────────────────
  loadFile(file) {
    // Tear down previous
    if (this._localEl) {
      this._localEl.pause();
      URL.revokeObjectURL(this._localEl.src);
    }
    if (this._localSrc) {
      this._localSrc.disconnect();
      this._localSrc = null;
    }

    const url = URL.createObjectURL(file);
    const el  = new Audio();
    el.src    = url;

    const src = this.ctx.createMediaElementSource(el);
    src.connect(this._analysisInput);

    this._localEl  = el;
    this._localSrc = src;
    return el; // caller controls play/pause
  }

  get localAudio() { return this._localEl; }

  // ── FFT data ────────────────────────────────────────────────────────────────
  getLevels() {
    if (!this.analyser) return { low:0, mid:0, high:0, data: new Uint8Array(128) };
    this.analyser.getByteFrequencyData(this.freqData);
    const n  = this.freqData.length; // 128 bins
    const lo = Math.floor(n * 0.08);
    const mi = Math.floor(n * 0.35);

    let low = 0, mid = 0, high = 0;
    for (let i = 0;  i < lo; i++) low  += this.freqData[i];
    for (let i = lo; i < mi; i++) mid  += this.freqData[i];
    for (let i = mi; i < n;  i++) high += this.freqData[i];

    return {
      low:  low  / (lo       * 255),
      mid:  mid  / ((mi-lo)  * 255),
      high: high / ((n-mi)   * 255),
      data: this.freqData,
    };
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  getSpectrum() {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  getWaveform() {
    if (!this.analyser) return null;
    if (!this._waveData) this._waveData = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(this._waveData);
    return this._waveData;
  }

  // Tap tempo — call on each tap, returns current BPM
  tap() {
    const now = performance.now();
    if (this._tapTimes.length && now - this._tapTimes[this._tapTimes.length - 1] > 2000) {
      this._tapTimes = []; // reset if gap > 2 s
    }
    this._tapTimes.push(now);
    if (this._tapTimes.length > 8) this._tapTimes.shift();

    if (this._tapTimes.length >= 2) {
      let total = 0;
      for (let i = 1; i < this._tapTimes.length; i++) total += this._tapTimes[i] - this._tapTimes[i - 1];
      const avg = total / (this._tapTimes.length - 1);
      this._bpm = Math.max(40, Math.min(240, Math.round(60000 / avg)));
      this._clockLastBeat = now; // sync clock to last tap
    }
    return this._bpm;
  }

  get bpm() { return this._bpm; }

  setBPM(bpm) {
    this._bpm = Math.max(40, Math.min(240, Math.round(bpm)));
    this._tapTimes = [];
  }

  _clockBeat() {
    const now      = performance.now();
    const interval = 60000 / this._bpm;
    if (now - this._clockLastBeat >= interval) {
      // Advance by one interval (keeps phase stable instead of drifting)
      this._clockLastBeat += interval;
      if (now - this._clockLastBeat > interval * 2) this._clockLastBeat = now;
      this._clockPulse = 1.0;
    }
    this._clockPulse *= 0.82;
    return this._clockPulse;
  }

  getBeat() {
    if (!this.analyser) return this._clockBeat();

    this.analyser.getByteFrequencyData(this.freqData);

    // Energy in the kick/bass bins
    const lo = Math.floor(this.freqData.length * 0.08);
    let energy = 0;
    for (let i = 0; i < lo; i++) energy += this.freqData[i] / 255;
    energy /= lo;

    // Rolling average over ~0.7 s
    this._beatHistory[this._beatHistIdx] = energy;
    this._beatHistIdx = (this._beatHistIdx + 1) % this._beatHistory.length;
    let avg = 0;
    for (let i = 0; i < this._beatHistory.length; i++) avg += this._beatHistory[i];
    avg /= this._beatHistory.length;

    if (energy > 0.02) {
      // Live audio signal — use energy-based detection
      const now = performance.now();
      if (energy > avg * 1.35 && energy > 0.02 && now - this._beatLastAt > 220) {
        this._beatPulse = 1.0;
        this._beatLastAt = now;
      }
      this._beatPulse *= 0.82;
      return this._beatPulse;
    }

    // No signal — fall back to BPM clock
    return this._clockBeat();
  }

  // ── Controls ────────────────────────────────────────────────────────────────
  setLow(v)    { this.values.low    = v; if (this.lowFilter)    this.lowFilter.gain.value    = (v-0.5)*30; }
  setMid(v)    { this.values.mid    = v; if (this.midFilter)    this.midFilter.gain.value    = (v-0.5)*30; }
  setHigh(v)   { this.values.high   = v; if (this.highFilter)   this.highFilter.gain.value   = (v-0.5)*30; }
  setEcho(v)   { this.values.echo   = v; if (this.delayFeedback) this.delayFeedback.gain.value = v*0.72; if (this.delayWet) this.delayWet.gain.value = v*0.8; }
  setReverb(v) { this.values.reverb = v; if (this.reverbGain)   this.reverbGain.gain.value   = v*2.5; }
  setNoise(v)  { this.values.noise  = v; if (this.noiseGain)    this.noiseGain.gain.value    = v*0.08; }
  setVolume(v) { this.values.volume = v; if (this.masterGain) this.masterGain.gain.value = v; }
  setEQ(v)     {
    this.values.eq = v;
    const s = Math.pow(2, (v-0.5)*3);
    if (this.lowFilter)  this.lowFilter.frequency.value  = Math.max(20, 320  * s);
    if (this.midFilter)  this.midFilter.frequency.value  = Math.max(20, 1000 * s);
    if (this.highFilter) this.highFilter.frequency.value = Math.max(20, 3200 * s);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  _makeImpulse(duration, decay) {
    const sr  = this.ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/len, decay);
    }
    return buf;
  }

  _makeNoiseSource() {
    const len = this.ctx.sampleRate * 4;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random()*2-1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.start();
    return src;
  }
}
