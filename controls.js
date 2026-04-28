export class ControlsUI {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.defs   = {};
    this.hovered = null;
    this.grabbed = null;
    this._grabMeta = {};

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const c = this.canvas;
    c.width  = c.clientWidth  || window.innerWidth;
    c.height = c.clientHeight || window.innerHeight;
    this._layout();
  }

  _layout() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const py = H - 105;          // knob centre Y
    const kr = 26;               // knob radius
    const jr = 44;               // jog radius
    const lx = 70;               // leftmost knob x
    const sp = 84;               // knob spacing

    this.defs = {
      low:    { type:'knob',   x: lx,            y: py,      r: kr, value:0.5, label:'LOW',    color:'#4488ff' },
      mid:    { type:'knob',   x: lx+sp,          y: py,      r: kr, value:0.5, label:'MID',    color:'#44ffaa' },
      high:   { type:'knob',   x: lx+sp*2,        y: py,      r: kr, value:0.5, label:'HIGH',   color:'#ff6688' },
      jog:    { type:'jog',    x: W/2,            y: py - 8,  r: jr, value:0.5, label:'EQ SHIFT', color:'#ffcc44', angle:0 },
      echo:   { type:'knob',   x: W-lx-sp*2,      y: py,      r: kr, value:0,   label:'ECHO',   color:'#cc44ff' },
      reverb: { type:'knob',   x: W-lx-sp,        y: py,      r: kr, value:0,   label:'REVERB', color:'#ff8844' },
      noise:  { type:'knob',   x: W-lx,           y: py,      r: kr, value:0,   label:'NOISE',  color:'#44ddff' },
      volume: { type:'volume', x: W-28,           y: H/2-80,  w:18, h:160, value:0.8, label:'VOL', color:'#1db954' },
    };
  }

  // ── Draw frame ──────────────────────────────────────────────────────────────
  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    this._drawPanel(W, H);

    for (const [name, d] of Object.entries(this.defs)) {
      const hov = this.hovered === name;
      const grb = this.grabbed === name;
      if      (d.type === 'knob')   this._drawKnob(ctx, d, hov, grb);
      else if (d.type === 'jog')    this._drawJog(ctx, d, hov, grb);
      else if (d.type === 'volume') this._drawVolume(ctx, d, hov, grb);
    }
  }

  _drawPanel(W, H) {
    const ctx = this.ctx;
    // Bottom gradient
    const g = ctx.createLinearGradient(0, H-170, 0, H);
    g.addColorStop(0,   'rgba(5,5,15,0)');
    g.addColorStop(0.2, 'rgba(8,8,22,0.8)');
    g.addColorStop(1,   'rgba(8,8,22,0.96)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H-170, W, 170);

    // Separator
    ctx.beginPath(); ctx.moveTo(0, H-170); ctx.lineTo(W, H-170);
    ctx.strokeStyle = 'rgba(40,40,90,0.5)'; ctx.lineWidth = 1; ctx.stroke();

    // Right-side vol panel
    const vg = ctx.createLinearGradient(W-70, 0, W, 0);
    vg.addColorStop(0, 'rgba(8,8,22,0)');
    vg.addColorStop(1, 'rgba(8,8,22,0.88)');
    ctx.fillStyle = vg;
    ctx.fillRect(W-70, 0, 70, H-170);

    // Labels: Left group / Right group
    ctx.fillStyle = 'rgba(100,100,160,0.5)';
    ctx.font = '9px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    const d = this.defs;
    if (d.low && d.high) {
      const lx  = (d.low.x + d.mid.x + d.high.x) / 3;
      ctx.fillText('— EQ —', lx, d.low.y - d.low.r - 22);
      const rx = (d.echo.x + d.reverb.x + d.noise.x) / 3;
      ctx.fillText('— FX —', rx, d.echo.y - d.echo.r - 22);
    }
  }

  _drawKnob(ctx, d, hov, grb) {
    const { x, y, r, value, label, color } = d;
    const minA = -Math.PI * 0.75;
    const maxA =  Math.PI * 0.75;
    const angle = minA + value * (maxA - minA);

    // Track arc
    ctx.beginPath();
    ctx.arc(x, y, r+5, minA, maxA);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();

    // Value arc
    ctx.beginPath();
    ctx.arc(x, y, r+5, minA, angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();

    // Body
    const rg = ctx.createRadialGradient(x - r*0.25, y - r*0.25, r*0.05, x, y, r);
    rg.addColorStop(0, grb ? '#3a3a5c' : hov ? '#2a2a48' : '#1c1c32');
    rg.addColorStop(1, '#080818');
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fillStyle = rg; ctx.fill();
    ctx.strokeStyle = grb ? color : hov ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = grb ? 1.5 : 1; ctx.stroke();

    // Indicator
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle)*r*0.38, y + Math.sin(angle)*r*0.38);
    ctx.lineTo(x + Math.cos(angle)*r*0.85, y + Math.sin(angle)*r*0.85);
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke();

    // Label
    ctx.fillStyle = grb ? color : hov ? '#ccc' : '#667';
    ctx.font = `${grb?'bold ':''}9px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + r + 14);

    if (hov || grb) {
      ctx.fillStyle = color;
      ctx.font = 'bold 9px monospace';
      ctx.fillText(Math.round(value*100)+'%', x, y+4);
    }
  }

  _drawJog(ctx, d, hov, grb) {
    const { x, y, r, label, color, angle } = d;

    // Outer rim
    ctx.beginPath(); ctx.arc(x, y, r+9, 0, Math.PI*2);
    ctx.strokeStyle = hov || grb ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 7; ctx.stroke();

    // Tick marks (rotate with angle)
    for (let i = 0; i < 36; i++) {
      const a = (i/36)*Math.PI*2 + angle;
      const r1 = r + 2, r2 = r + (i%9===0 ? 11 : 7);
      ctx.beginPath();
      ctx.moveTo(x+Math.cos(a)*r1, y+Math.sin(a)*r1);
      ctx.lineTo(x+Math.cos(a)*r2, y+Math.sin(a)*r2);
      ctx.strokeStyle = i%9===0 ? color : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = i%9===0 ? 2 : 1; ctx.stroke();
    }

    // Body
    const bg = ctx.createRadialGradient(x-r*0.3, y-r*0.3, r*0.05, x, y, r);
    bg.addColorStop(0, grb ? '#3a3a4c' : '#22223a');
    bg.addColorStop(1, '#07071a');
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = grb ? color : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = grb ? 1.5 : 1; ctx.stroke();

    // Centre hub
    ctx.beginPath(); ctx.arc(x, y, r*0.22, 0, Math.PI*2);
    ctx.fillStyle = color+'33'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke();

    // Position marker
    ctx.beginPath();
    ctx.moveTo(x+Math.cos(angle)*r*0.28, y+Math.sin(angle)*r*0.28);
    ctx.lineTo(x+Math.cos(angle)*r*0.88, y+Math.sin(angle)*r*0.88);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap='round'; ctx.stroke();

    ctx.fillStyle = grb ? color : '#667';
    ctx.font = `${grb?'bold ':''}9px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + r + 18);
  }

  _drawVolume(ctx, d, hov, grb) {
    const { x, y, w, h, value, label, color } = d;
    const sx = x - w/2;
    const sy = y;

    // Track
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(sx, sy, w, h, w/2);
    } else {
      ctx.beginPath(); ctx.rect(sx, sy, w, h);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();

    // Fill
    const fillH = h * value;
    const fillY = sy + h - fillH;
    const fg = ctx.createLinearGradient(0, fillY+fillH, 0, fillY);
    fg.addColorStop(0,   '#1db954');
    fg.addColorStop(0.7, '#22ee70');
    fg.addColorStop(1,   value > 0.85 ? '#ffaa00' : '#55ffcc');
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(sx, sy, w, h, w/2); else ctx.rect(sx, sy, w, h);
    ctx.clip();
    ctx.fillStyle = fg;
    ctx.fillRect(sx, fillY, w, fillH);
    ctx.restore();

    // Thumb
    const ty = sy + h * (1 - value);
    ctx.beginPath(); ctx.arc(x, ty, w*0.7, 0, Math.PI*2);
    ctx.fillStyle = grb ? '#fff' : hov ? '#ddd' : '#999'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();

    // Label above
    ctx.fillStyle = grb ? color : '#667';
    ctx.font = '9px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, x, sy - 8);

    if (hov || grb) {
      const db = Math.round(20*Math.log10(Math.max(0.001, value)));
      ctx.fillStyle = color; ctx.font = 'bold 8px monospace';
      ctx.fillText(db+'dB', x, ty - 10);
    }
  }

  // ── Interaction ─────────────────────────────────────────────────────────────
  hitTest(px, py) {
    for (const [name, d] of Object.entries(this.defs)) {
      if (d.type === 'volume') {
        if (Math.abs(px - d.x) < d.w + 6 && py >= d.y - 4 && py <= d.y + d.h + 4) return name;
      } else {
        const dx = px - d.x, dy = py - d.y;
        if (Math.sqrt(dx*dx + dy*dy) < d.r + 12) return name;
      }
    }
    return null;
  }

  setHover(name) { this.hovered = name; }

  startGrab(name, px, py) {
    this.grabbed = name;
    const d = this.defs[name];
    if (d.type === 'volume') {
      this._grabMeta = { startY: py, startVal: d.value };
    } else if (d.type === 'jog') {
      this._grabMeta = { startA: Math.atan2(py-d.y, px-d.x), startJog: d.angle, startVal: d.value };
    } else {
      this._grabMeta = { startA: Math.atan2(py-d.y, px-d.x), startVal: d.value };
    }
  }

  updateGrab(px, py) {
    if (!this.grabbed) return null;
    const d = this.defs[this.grabbed];

    if (d.type === 'volume') {
      const dy = this._grabMeta.startY - py;
      d.value = Math.max(0, Math.min(1, this._grabMeta.startVal + dy / (d.h * 0.45)));
    } else if (d.type === 'jog') {
      let delta = Math.atan2(py-d.y, px-d.x) - this._grabMeta.startA;
      while (delta >  Math.PI) delta -= Math.PI*2;
      while (delta < -Math.PI) delta += Math.PI*2;
      d.angle = this._grabMeta.startJog + delta;
      // map cumulative rotation to 0-1 value (wraps)
      d.value = ((this._grabMeta.startVal + delta / (Math.PI*2)) % 1 + 1) % 1;
    } else {
      let delta = Math.atan2(py-d.y, px-d.x) - this._grabMeta.startA;
      while (delta >  Math.PI) delta -= Math.PI*2;
      while (delta < -Math.PI) delta += Math.PI*2;
      d.value = Math.max(0, Math.min(1, this._grabMeta.startVal + delta * 0.45 / Math.PI));
    }
    return { name: this.grabbed, value: d.value };
  }

  endGrab() { this.grabbed = null; }

  getValue(name) { return this.defs[name]?.value ?? 0; }
  setValue(name, v) { if (this.defs[name]) this.defs[name].value = v; }
}
