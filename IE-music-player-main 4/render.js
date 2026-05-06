/**
 * render.js — canvas drawing loop (60fps target)
 */

const Renderer = (() => {
  // ── state ──────────────────────────────────────────────────────────────────
  let canvas   = null;
  let ctx      = null;
  let videoEl  = null;
  let lastTime = 0;
  let fpsEl    = null;
  let fpsAccum = 0;
  let fpsTicks = 0;
  let startTime      = 0;
  let gameOver        = false;
  let lastHandCenters = [];
  const barHeights = Array.from({ length: 8 }, (_, i) => 4 + Math.round(Math.sin(i * 1.4 + 0.5) * 6 + 8));

  // ── offscreen canvases for ASCII body filter ───────────────────────────
  let offCanvas  = null;   // video sample
  let offCtx     = null;
  let maskCanvas = null;   // segmentation mask sample
  let maskCtx    = null;

  // ── bucket style ──────────────────────────────────────────────────────────
  const STYLE_NAMES    = ['Orbit', 'Signal', 'Scan', 'Grid', 'Pulse'];
  let bucketStyleIndex = 4;

  // ── background color (set by pinch gesture) ───────────────────────────────
  let bgColor = [0, 0, 0];

  function setBgMode(rgb) { bgColor = rgb; }

  // particles: [{x,y,vx,vy,life,maxLife,color}]
  const particles = [];
  const MAX_PARTICLES = 200;

  // ── particle system (monochrome) ───────────────────────────────────────────
  function spawnParticles(pos) {
    const count = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      if (particles.length >= MAX_PARTICLES) break;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      particles.push({
        x: pos.x, y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 1, maxLife: 0.5 + Math.random() * 0.4,
      });
    }
  }

  // ── draw a ball — wireframe monochrome ───────────────────────────────────
  function drawBall(ball) {
    const { x, y } = ball.position;
    const r = ball.circleRadius || 16;

    // broad soft glow (bloom)
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    grd.addColorStop(0,   'rgba(255,255,255,0.13)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.05)');
    grd.addColorStop(1,   'transparent');
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // solid opaque white ball body
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();

    // bright rim for definition
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // inner detail ring
    ctx.beginPath();
    ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(180,200,255,0.4)';
    ctx.lineWidth = 0.75;
    ctx.stroke();

    // center dot
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(180,210,255,0.9)';
    ctx.fill();
  }

  // ── ripple effect on catch ───────────────────────────────────────────────
  const ripples = [];

  function spawnRipple(pos) {
    for (let i = 0; i < 3; i++) {
      ripples.push({ x: pos.x, y: pos.y, r: 8, maxR: 60 + i * 28, alpha: 0.72 - i * 0.12, delay: i * 5 });
    }
  }

  function drawRipples() {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      if (rp.delay > 0) { rp.delay--; continue; }
      rp.r += (rp.maxR - rp.r) * 0.1;
      rp.alpha *= 0.92;
      if (rp.alpha < 0.008) { ripples.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${rp.alpha.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // ── bucket geometry constants ────────────────────────────────────────────
  const BUCKET_OPEN_W  = 160;  // opening width (top)
  const BUCKET_CLOSE_W = 128;  // base width (bottom, narrower = trapezoid)
  const BUCKET_H       = 60;   // height
  const BUCKET_MARGIN  = 18;   // gap from screen bottom

  // Returns the 4 key points of the bucket given its center X
  function bucketGeom(cx) {
    const botY = canvas.height - BUCKET_MARGIN;
    const topY = botY - BUCKET_H;
    const ho   = BUCKET_OPEN_W  / 2;
    const hb   = BUCKET_CLOSE_W / 2;
    return { cx, botY, topY, ho, hb };
  }

  // Draw the 3 bucket walls (left, bottom, right) — open at top
  function strokeBucket(g) {
    ctx.beginPath();
    ctx.moveTo(g.cx - g.ho, g.topY);
    ctx.lineTo(g.cx - g.hb, g.botY);
    ctx.lineTo(g.cx + g.hb, g.botY);
    ctx.lineTo(g.cx + g.ho, g.topY);
    ctx.stroke();
  }

  // Fill the closed trapezoid interior
  function fillBucket(g) {
    ctx.beginPath();
    ctx.moveTo(g.cx - g.ho, g.topY);
    ctx.lineTo(g.cx - g.hb, g.botY);
    ctx.lineTo(g.cx + g.hb, g.botY);
    ctx.lineTo(g.cx + g.ho, g.topY);
    ctx.closePath();
    ctx.fill();
  }

  // Rim dashes across the opening
  function drawRim(g, extend) {
    const e = extend || 0;
    ctx.beginPath();
    ctx.moveTo(g.cx - g.ho - e, g.topY);
    ctx.lineTo(g.cx - g.ho + 14, g.topY);
    ctx.moveTo(g.cx + g.ho - 14, g.topY);
    ctx.lineTo(g.cx + g.ho + e, g.topY);
    ctx.stroke();
  }

  // ── style 0: Plasma ───────────────────────────────────────────────────────
  function drawPlasma(cx) {
    const g = bucketGeom(cx);
    ctx.save();
    ctx.shadowBlur  = 26;
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth   = 3;
    strokeBucket(g);
    drawRim(g, 6);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    fillBucket(g);
  }

  // ── style 1: Fire ─────────────────────────────────────────────────────────
  function drawFire(cx, now) {
    const g  = bucketGeom(cx);
    const f1 = 0.6 + 0.4 * Math.sin(now * 0.012);
    const f2 = 0.5 + 0.5 * Math.sin(now * 0.017 + 1.2);
    ctx.save();
    ctx.shadowBlur  = Math.round(32 * f1);
    ctx.shadowColor = `rgba(200,180,255,${(0.9 * f1).toFixed(2)})`;
    ctx.strokeStyle = `rgba(${Math.round(180 + 50 * f2)},${Math.round(160 + 60 * f2)},255,${(0.9 * f1).toFixed(2)})`;
    ctx.lineWidth   = 2.5 + f1;
    strokeBucket(g);
    drawRim(g, 8);
    ctx.restore();
    ctx.fillStyle = `rgba(160,140,255,${(0.06 * f1 + 0.03).toFixed(3)})`;
    fillBucket(g);
  }

  // ── style 2: Ice ──────────────────────────────────────────────────────────
  function drawIce(cx) {
    const g = bucketGeom(cx);
    ctx.save();
    ctx.shadowBlur     = 20;
    ctx.shadowColor    = 'rgba(255,255,255,0.85)';
    ctx.strokeStyle    = 'rgba(255,255,255,0.9)';
    ctx.lineWidth      = 2.5;
    ctx.setLineDash([8, 5]);
    strokeBucket(g);
    ctx.strokeStyle    = 'rgba(200,210,255,0.55)';
    ctx.lineWidth      = 1;
    ctx.setLineDash([4, 8]);
    ctx.lineDashOffset = 6;
    strokeBucket(g);
    ctx.setLineDash([]);
    ctx.lineWidth      = 3;
    ctx.strokeStyle    = 'rgba(255,255,255,0.92)';
    drawRim(g, 6);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    fillBucket(g);
  }

  // ── style 3: Retro ────────────────────────────────────────────────────────
  function drawRetro(cx) {
    const g = bucketGeom(cx);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 4]);
    strokeBucket(g);
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    drawRim(g, 10);
    // corner ticks on rim ends
    ctx.lineWidth = 3;
    [[g.cx - g.ho, g.topY, g.cx - g.ho, g.topY + 10],
     [g.cx + g.ho, g.topY, g.cx + g.ho, g.topY + 10]].forEach(([x1,y1,x2,y2]) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    fillBucket(g);
    // scanlines inside trapezoid
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1;
    for (let ly = g.topY + 6; ly < g.botY; ly += 7) {
      const t  = (ly - g.topY) / (g.botY - g.topY);
      const lx = g.cx - g.ho + (g.ho - g.hb) * t;
      const rx = g.cx + g.ho - (g.ho - g.hb) * t;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ly); ctx.stroke();
    }
    ctx.restore();
  }

  // ── style 4: Ghost ────────────────────────────────────────────────────────
  function drawGhost(cx, now) {
    const g     = bucketGeom(cx);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
    ctx.save();
    ctx.shadowBlur  = Math.round(36 * pulse);
    ctx.shadowColor = `rgba(255,255,255,${(0.9 * pulse).toFixed(2)})`;
    ctx.strokeStyle = `rgba(255,255,255,${(0.5 + 0.45 * pulse).toFixed(2)})`;
    ctx.lineWidth   = 2.5 + pulse;
    strokeBucket(g);
    drawRim(g, 8);
    ctx.restore();
    const grd = ctx.createLinearGradient(g.cx, g.topY, g.cx, g.botY);
    grd.addColorStop(0, `rgba(255,255,255,${(0.1 * pulse).toFixed(3)})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    fillBucket(g);
  }

  // ── bucket dispatcher ─────────────────────────────────────────────────────
  function drawBucket(centerX, now) {
    switch (bucketStyleIndex) {
      case 0: drawPlasma(centerX);       break;
      case 1: drawFire(centerX, now);    break;
      case 2: drawIce(centerX);          break;
      case 3: drawRetro(centerX);        break;
      case 4: drawGhost(centerX, now);   break;
    }
  }

  // ── ASCII body filter (uses SelfieSegmentation mask) ──────────────────────
  const ASCII_COLS  = 130;  // more columns = smaller chars
  const ASCII_CHARS = ['!', '+', '/', '%', '#'];

  function drawASCIIFiltered(W, H) {
    if (!videoEl || videoEl.readyState < 2) return;
    const seg = Vision.getSegmentationMask();
    if (!seg) return;

    const cols     = ASCII_COLS;
    const fontSize = W / cols;
    const rows     = Math.ceil(H / (fontSize * 1.45));
    const cellW    = W / cols;
    const cellH    = H / rows;

    if (!offCanvas) {
      offCanvas = document.createElement('canvas');
      offCtx    = offCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!maskCanvas) {
      maskCanvas = document.createElement('canvas');
      maskCtx    = maskCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (offCanvas.width !== cols || offCanvas.height !== rows) {
      offCanvas.width = cols; offCanvas.height = rows;
    }
    if (maskCanvas.width !== cols || maskCanvas.height !== rows) {
      maskCanvas.width = cols; maskCanvas.height = rows;
    }

    // Mirrored video → offscreen
    offCtx.save();
    offCtx.translate(cols, 0); offCtx.scale(-1, 1);
    offCtx.drawImage(videoEl, 0, 0, cols, rows);
    offCtx.restore();

    // Mirrored mask → maskCanvas
    try {
      maskCtx.clearRect(0, 0, cols, rows);
      maskCtx.save();
      maskCtx.translate(cols, 0); maskCtx.scale(-1, 1);
      maskCtx.drawImage(seg, 0, 0, cols, rows);
      maskCtx.restore();
    } catch (_) { return; }

    const videoPx = offCtx.getImageData(0, 0, cols, rows).data;
    const maskPx  = maskCtx.getImageData(0, 0, cols, rows).data;

    ctx.save();
    ctx.font         = `${Math.ceil(fontSize)}px monospace`;
    ctx.textBaseline = 'top';
    ctx.textAlign    = 'left';

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const i = (gy * cols + gx) * 4;
        // MediaPipe SelfieSegmentation encodes confidence in alpha channel
        const confidence = maskPx[i + 3] > 0 ? maskPx[i + 3] : maskPx[i];
        if (confidence < 160) continue;  // background — skip

        const raw  = (0.299 * videoPx[i] + 0.587 * videoPx[i + 1] + 0.114 * videoPx[i + 2]) / 255;
        const luma = Math.pow(raw, 0.75);
        const char = ASCII_CHARS[Math.min(Math.floor(luma * ASCII_CHARS.length), ASCII_CHARS.length - 1)];
        // Electric blue tinted by brightness (darker areas = deeper blue)
        const r = Math.round(40  + luma * 60);
        const g = Math.round(80  + luma * 80);
        const b = Math.round(200 + luma * 55);
        const a = (0.3 + luma * 0.55).toFixed(3);
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.fillText(char, gx * cellW, gy * cellH);
      }
    }
    ctx.restore();
  }

  // ── background: grid + faint orbital circles ─────────────────────────────
  function drawBgLayer(W, H) {
    ctx.fillStyle = `rgb(${bgColor[0]},${bgColor[1]},${bgColor[2]})`;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < W; gx += 80) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = 0; gy < H; gy += 80) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    for (const r of [H * 0.32, H * 0.52, H * 0.7]) {
      ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.restore();
  }

  // ── corner brackets ─────────────────────────────────────────────────────
  function drawCornerBrackets(W, H) {
    const s = 30;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth   = 1.5;
    [
      [s, 0, 0, 0, 0, s],
      [W - s, 0, W, 0, W, s],
      [s, H, 0, H, 0, H - s],
      [W - s, H, W, H, W, H - s],
    ].forEach(([bx, by, ax, ay, cx2, cy2]) => {
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ax, ay); ctx.lineTo(cx2, cy2); ctx.stroke();
    });
    ctx.restore();
  }

  // ── HUD: score (left) + 1-min countdown (right) + decorations ─────────────
  function drawHUD(W, H, now) {
    const elapsed   = now - startTime;
    const remaining = Math.max(0, 60000 - elapsed);
    const remM  = String(Math.floor(remaining / 60000)).padStart(2, '0');
    const remS  = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
    const urgent = remaining < 10000 && remaining > 0; // last 10 s

    ctx.save();
    ctx.textBaseline = 'top';

    // ── TOP-LEFT: SCORE ──────────────────────────────────────────────────────
    ctx.textAlign = 'left';
    ctx.font      = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillText('SCORE', 26, 22);
    ctx.font      = 'bold 48px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fillText(String(PhysicsEngine.score).padStart(5, '0'), 26, 35);

    // ── TOP-RIGHT: COUNTDOWN TIMER ───────────────────────────────────────────
    ctx.textAlign = 'right';
    ctx.font      = '9px monospace';
    ctx.fillStyle = urgent ? 'rgba(255,120,100,0.75)' : 'rgba(255,255,255,0.32)';
    ctx.fillText('TIME', W - 26, 22);
    const timerAlpha = urgent ? (0.6 + 0.4 * Math.sin(now * 0.012)) : 0.96;
    ctx.font      = 'bold 48px monospace';
    ctx.fillStyle = urgent
      ? `rgba(255,120,100,${timerAlpha.toFixed(3)})`
      : `rgba(255,255,255,${timerAlpha.toFixed(3)})`;
    ctx.fillText(`${remM}:${remS}`, W - 26, 35);

    // ── small decorations below score / timer ────────────────────────────────
    ctx.textAlign = 'left';
    ctx.font      = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillText('ACTIVE  ' + String(PhysicsEngine.balls.length).padStart(2, '0'), 26, 92);

    ctx.textAlign = 'right';
    ctx.font      = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillText(remaining > 0 ? 'RUNNING' : 'COMPLETE', W - 26, 92);

    ctx.restore();
  }

  // ── game-over overlay ─────────────────────────────────────────────────────
  function drawGameOver(W, H) {
    ctx.save();

    // light full-screen veil so game is still faintly visible behind
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);

    // solid opaque panel
    const bW = 360, bH = 240;
    const bX = (W - bW) / 2, bY = (H - bH) / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.96)';
    ctx.fillRect(bX, bY, bW, bH);

    // panel border
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(bX, bY, bW, bH);

    // corner brackets
    const s = 22;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    [[bX+s,bY,   bX,bY,     bX,bY+s   ],
     [bX+bW-s,bY,  bX+bW,bY,  bX+bW,bY+s  ],
     [bX+s,bY+bH,  bX,bY+bH,  bX,bY+bH-s  ],
     [bX+bW-s,bY+bH,bX+bW,bY+bH,bX+bW,bY+bH-s],
    ].forEach(([x1,y1,x2,y2,x3,y3]) => {
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.stroke();
    });

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    const cx = W / 2, cy = H / 2;

    ctx.font      = '10px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('SEQUENCE  COMPLETE', cx, cy - 62);

    ctx.font      = 'bold 64px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(PhysicsEngine.score).padStart(5, '0'), cx, cy - 4);

    ctx.font      = '10px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('FINAL  SCORE', cx, cy + 48);

    ctx.font      = '11px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('PRESS  SPACE  TO  RESTART', cx, cy + 76);
    ctx.restore();
  }

  // ── draw particles (monochrome) ──────────────────────────────────────────
  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x   += p.vx;
      p.y   += p.vy;
      p.vy  += 0.1;
      p.life -= dt / p.maxLife / 60;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2 * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${(p.life * 0.88).toFixed(3)})`;
      ctx.fill();
    }
  }

  // ── main draw ─────────────────────────────────────────────────────────────
  function draw(now) {
    const dt = Math.min((now - lastTime) / 16.67, 3);
    lastTime = now;
    const W = canvas.width;
    const H = canvas.height;

    fpsAccum += 1000 / (dt * 16.67);
    fpsTicks++;
    if (fpsTicks >= 20) {
      if (fpsEl) fpsEl.textContent = `${Math.round(fpsAccum / fpsTicks)} fps`;
      fpsAccum = 0; fpsTicks = 0;
    }

    // background: solid black + grid + orbital circles
    drawBgLayer(W, H);

    // ASCII body silhouette
    drawASCIIFiltered(W, H);

    // buckets — persist last known positions; freeze when game is over
    const fresh = Vision.getHandCenters();
    if (!gameOver && fresh.length > 0) lastHandCenters = fresh;
    const activeCenters = lastHandCenters.length > 0 ? lastHandCenters : [W / 2];
    for (const cx of activeCenters) drawBucket(cx, now);

    // balls
    for (const ball of PhysicsEngine.balls) {
      drawBall(ball);
    }

    // particles
    drawParticles(dt);
    drawRipples();

    // HUD readouts + corner brackets (drawn last, always on top)
    drawHUD(W, H, now);
    drawCornerBrackets(W, H);

    // game-over check
    if (!gameOver && now - startTime >= 60000) {
      gameOver = true;
      PhysicsEngine.stopSpawning();
    }
    if (gameOver) drawGameOver(W, H);
  }

  // ── public ─────────────────────────────────────────────────────────────────
  function init(canvasEl, video) {
    canvas  = canvasEl;
    ctx     = canvas.getContext('2d');
    videoEl = video;
    fpsEl   = document.getElementById('fps');

    startTime = performance.now();
    PhysicsEngine.onCollision((ball, pos) => { spawnParticles(pos); });
  }

  function frame(now) {
    draw(now);
  }

  function nextBucketStyle() {
    bucketStyleIndex = (bucketStyleIndex + 1) % STYLE_NAMES.length;
    return STYLE_NAMES[bucketStyleIndex];
  }

  function isGameOver() { return gameOver; }
  function resetTimer()  { startTime = performance.now(); gameOver = false; lastHandCenters = []; }

  return { init, frame, spawnRipple, setBgMode, nextBucketStyle, isGameOver, resetTimer };
})();
