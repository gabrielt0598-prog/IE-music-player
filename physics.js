/**
 * physics.js — Matter.js world, ball management, bucket catch detection
 */

const PhysicsEngine = (() => {
  const { Engine, Render: MRender, Runner, Bodies, Body, World, Events, Vector } = Matter;

  // ── world ──────────────────────────────────────────────────────────────────
  const engine = Engine.create({
    gravity: { x: 0, y: 0.7 },
    positionIterations: 6,
    velocityIterations: 4,
  });
  const world = engine.world;

  // ── constants ──────────────────────────────────────────────────────────────
  const MAX_BALLS       = 40;
  const BALL_INTERVAL   = 800;   // ms between spawns
  const BALL_RADIUS_MIN = 14;
  const BALL_RADIUS_MAX = 20;
  const BURST_COUNT     = 10;

  // ── state ──────────────────────────────────────────────────────────────────
  let balls          = [];
  let wallBodies     = [];        // side walls only (no floor — balls fall off)
  let spawnTimer     = null;
  let windEnabled    = false;
  let windForce      = 0.0004;
  let canvasW        = window.innerWidth;
  let canvasH        = window.innerHeight;
  let score          = 0;
  const catchHandlers    = [];

  // ── walls ──────────────────────────────────────────────────────────────────
  function buildWalls(w, h) {
    wallBodies.forEach(b => World.remove(world, b));
    const opts = { isStatic: true, label: 'wall', restitution: 0.3, friction: 0.5 };
    wallBodies = [
      Bodies.rectangle(-25, h / 2, 50, h + 100, opts),      // left
      Bodies.rectangle(w + 25, h / 2, 50, h + 100, opts),   // right
    ];
    World.add(world, wallBodies);
  }

  // ── ball helpers ───────────────────────────────────────────────────────────
  function randomColor() {
    const h = Math.random() * 360;
    const s = 70 + Math.random() * 30;
    const l = 50 + Math.random() * 15;
    return `hsl(${h},${s}%,${l}%)`;
  }

  function spawnBall() {
    if (balls.length >= MAX_BALLS) {
      const oldest = balls.shift();
      World.remove(world, oldest);
    }

    const r = BALL_RADIUS_MIN + Math.random() * (BALL_RADIUS_MAX - BALL_RADIUS_MIN);
    const x = r + Math.random() * (canvasW - r * 2);
    const ball = Bodies.circle(x, -r - 5, r, {
      restitution : 0.55,
      friction    : 0.1,
      frictionAir : 0.014,
      density     : 0.002,
      label       : 'ball',
      render      : { fillStyle: randomColor() },
    });

    // slight random horizontal nudge
    Body.setVelocity(ball, {
      x: (Math.random() - 0.5) * 4,
      y: 0,
    });

    balls.push(ball);
    World.add(world, ball);
  }

  function burstSpawn() {
    for (let i = 0; i < BURST_COUNT; i++) {
      setTimeout(spawnBall, i * 60);
    }
  }

  // ── bucket constants (must match render.js) ────────────────────────────────
  const BUCKET_OPEN_W = 260;
  const BUCKET_H      = 80;
  const BUCKET_MARGIN = 18;

  // ── bucket catch check ─────────────────────────────────────────────────
  function checkCatches(handCenterXs) {
    if (!handCenterXs || handCenterXs.length === 0) return;
    const topY = canvasH - BUCKET_MARGIN - BUCKET_H;
    const hw   = BUCKET_OPEN_W / 2;
    balls = balls.filter(ball => {
      const { x, y } = ball.position;
      const r = ball.circleRadius || 16;
      for (const bx of handCenterXs) {
        if (y + r >= topY && x >= bx - hw && x <= bx + hw) {
          World.remove(world, ball);
          score++;
          catchHandlers.forEach(fn => fn(ball, { x, y }));
          return false;
        }
      }
      return true;
    });
  }

  // ── off-screen culling ─────────────────────────────────────────────────────
  function cullBalls() {
    balls = balls.filter(b => {
      if (b.position.y > canvasH + 60) {
        World.remove(world, b);
        return false;
      }
      return true;
    });
  }

  // ── wind ──────────────────────────────────────────────────────────────────
  function applyWind() {
    if (!windEnabled) return;
    balls.forEach(b => {
      Body.applyForce(b, b.position, { x: windForce, y: 0 });
    });
  }

  // ── collision particles (exported as event source) ─────────────────────────
  // main.js wires this up to the renderer
  const collisionHandlers = [];
  Events.on(engine, 'collisionStart', ({ pairs }) => {
    for (const pair of pairs) {
      const { bodyA, bodyB } = pair;
      const ball = bodyA.label === 'ball' ? bodyA
                 : bodyB.label === 'ball' ? bodyB
                 : null;
      const other = ball === bodyA ? bodyB : bodyA;
      if (ball && other.label !== 'ball') {
        collisionHandlers.forEach(fn => fn(ball, pair.collision.supports[0] || ball.position));
      }
    }
  });

  // ── tick ──────────────────────────────────────────────────────────────────
  function step(delta) {
    Engine.update(engine, delta);
    applyWind();
    cullBalls();
  }

  // ── init / resize ─────────────────────────────────────────────────────────
  function init(w, h) {
    canvasW = w;
    canvasH = h;
    buildWalls(w, h);
    spawnTimer = setInterval(spawnBall, BALL_INTERVAL);
  }

  function resize(w, h) {
    canvasW = w;
    canvasH = h;
    buildWalls(w, h);
  }

  function stopSpawning() {
    if (spawnTimer !== null) { clearInterval(spawnTimer); spawnTimer = null; }
  }

  function reset() {
    stopSpawning();
    balls.forEach(b => World.remove(world, b));
    balls = [];
    score = 0;
    spawnTimer = setInterval(spawnBall, BALL_INTERVAL);
  }

  function toggleWind() {
    windEnabled = !windEnabled;
    // reverse direction occasionally for fun
    windForce = (Math.random() > 0.5 ? 1 : -1) * (0.0003 + Math.random() * 0.0004);
    return windEnabled;
  }

  // ── public API ─────────────────────────────────────────────────────────────
  return {
    engine,
    world,
    get balls()  { return balls; },
    get score()  { return score; },
    init,
    resize,
    step,
    spawnBall,
    burstSpawn,
    checkCatches,
    stopSpawning,
    reset,
    toggleWind,
    onCollision(fn) { collisionHandlers.push(fn); },
    onCatch(fn)     { catchHandlers.push(fn); },
  };
})();
