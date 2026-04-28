// GPU particle visualizer — ping-pong GLSL shader simulation
// Audio reactivity: bass expands spawn radius, pulse bursts velocity, all three tint color

export class Visualizer {
  constructor(container) {
    this.container = container;
    this._bass = 0; this._mid = 0; this._high = 0; this._pulse = 0;
    this._p5 = null;
    this._init();
  }

  update({ low = 0, mid = 0, high = 0, pulse = 0 } = {}) {
    this._bass  += (low   - this._bass)  * 0.14;
    this._mid   += (mid   - this._mid)   * 0.18;
    this._high  += (high  - this._high)  * 0.22;
    this._pulse += (pulse - this._pulse) * 0.30;
  }

  _init() {
    const self      = this;
    const container = this.container;

    const sketch = (p) => {
      let texture_particleDataA, texture_particleDataB;
      let texture_initialData,   texture_randomSeed;
      let shader_particleDataA,  shader_particleDataB;
      let bigTriangleGeometryA,  bigTriangleGeometryB;
      let shader_drawParticle,   geometry_particles;
      let isA = false;

      // ─── Particle-move vertex shader ──────────────────────────────────────────
      const particleMoveVert = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
attribute vec4 aVertexColor;
uniform mat4 uProjectionMatrix;
uniform mat4 uModelViewMatrix;
varying vec2 vTexCoord;
void main () {
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
  vTexCoord = aTexCoord;
}
`;

      // ─── Particle-move fragment shader (audio-reactive) ───────────────────────
      const particleMoveFrag = `
precision highp float;

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}
vec3 mod289_3(vec3 x) { return x - floor(x*(1./289.))*289.; }
vec4 mod289_4(vec4 x) { return x - floor(x*(1./289.))*289.; }
vec4 permute4(vec4 x) { return mod289_4(((x*34.)+1.)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314*r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1./6., 1./3.);
  const vec4 D = vec4(0., .5, 1., 2.);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1. - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289_3(i);
  vec4 pp = permute4(permute4(permute4(
    i.z+vec4(0.,i1.z,i2.z,1.))
    +i.y+vec4(0.,i1.y,i2.y,1.))
    +i.x+vec4(0.,i1.x,i2.x,1.));
  float n_ = .142857142857;
  vec3 ns = n_*D.wyz - D.xzx;
  vec4 j = pp - 49.*floor(pp*ns.z*ns.z);
  vec4 x_ = floor(j*ns.z);
  vec4 y_ = floor(j - 7.*x_);
  vec4 x = x_*ns.x + ns.yyyy;
  vec4 y = y_*ns.x + ns.yyyy;
  vec4 h = 1. - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.+1.;
  vec4 s1 = floor(b1)*2.+1.;
  vec4 sh = -step(h, vec4(0.));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m = max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
  m = m*m;
  return 42.*dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

const float c_precision = 256.;
const float c_p1 = 257.;
float color2float(vec3 c) {
  return floor(c.r*c_precision+.5) + floor(c.g*c_precision+.5)*c_p1
       + floor(c.b*c_precision+.5)*c_p1*c_p1;
}
vec3 float2color(float v) {
  vec3 c;
  c.r = mod(v, c_p1)/c_precision;
  c.g = mod(floor(v/c_p1), c_p1)/c_precision;
  c.b = floor(v/(c_p1*c_p1))/c_precision;
  return c;
}
float realToRaw(float v) { return (v+4096.)*1000.; }
float rawToReal(float v) { return v/1000.-4096.; }

#define DEG_TO_RAD 0.0174532925
varying vec2 vTexCoord;
uniform sampler2D uDataTexture;
uniform sampler2D uRandomSeedTexture;
uniform vec2  uScreenSize;
uniform float uTime;
uniform float uBass;
uniform float uPulse;

void main() {
  vec2 ftc = vec2(vTexCoord.x, 1.-vTexCoord.y);
  vec4 dataColor = texture2D(uDataTexture, ftc);

  if (ftc.x < .5 && ftc.y < .5) {
    // X position
    float seed    = color2float(texture2D(uRandomSeedTexture, vTexCoord).rgb);
    float xPos    = rawToReal(color2float(texture2D(uDataTexture, ftc).rgb));
    float vel     = rawToReal(color2float(texture2D(uDataTexture, ftc+vec2(.5,.5)).rgb));
    float rot     = rawToReal(color2float(texture2D(uDataTexture, ftc+vec2(0.,.5)).rgb));
    float lifeOff = color2float(texture2D(uRandomSeedTexture, vTexCoord+vec2(0.,.5)).rgb);
    float life    = color2float(texture2D(uRandomSeedTexture, vTexCoord+vec2(.5,.5)).rgb);
    if (mod(uTime-lifeOff, life) == 0.) {
      float ang  = random(vec2(uTime, seed))*360.;
      float side = uScreenSize.x < uScreenSize.y ? uScreenSize.x : uScreenSize.y;
      float r    = side*(0.25 + uBass*0.45);
      xPos = sin(ang*DEG_TO_RAD)*r + .5*uScreenSize.x;
    }
    xPos += sin(rot*DEG_TO_RAD)*vel*0.005;
    gl_FragColor = vec4(float2color(realToRaw(xPos)), 1.);
  }
  else if (ftc.x >= .5 && ftc.y < .5) {
    // Y position
    float seed    = color2float(texture2D(uRandomSeedTexture, vTexCoord+vec2(-.5,0.)).rgb);
    float yPos    = rawToReal(color2float(texture2D(uDataTexture, ftc).rgb));
    float vel     = rawToReal(color2float(texture2D(uDataTexture, ftc+vec2(0.,.5)).rgb));
    float rot     = rawToReal(color2float(texture2D(uDataTexture, ftc+vec2(-.5,.5)).rgb));
    float lifeOff = color2float(texture2D(uRandomSeedTexture, vTexCoord+vec2(-.5,.5)).rgb);
    float life    = color2float(texture2D(uRandomSeedTexture, vTexCoord+vec2(0.,.5)).rgb);
    if (mod(uTime-lifeOff, life) == 0.) {
      float ang  = random(vec2(uTime, seed))*360.;
      float side = uScreenSize.x < uScreenSize.y ? uScreenSize.x : uScreenSize.y;
      float r    = side*(0.25 + uBass*0.45);
      yPos = cos(ang*DEG_TO_RAD)*r + .5*uScreenSize.y;
    }
    yPos += cos(rot*DEG_TO_RAD)*vel*0.005;
    gl_FragColor = vec4(float2color(realToRaw(yPos)), 1.);
  }
  else if (ftc.x < .5 && ftc.y >= .5) {
    // Rotation
    float posX = rawToReal(color2float(texture2D(uDataTexture, ftc+vec2(0.,-.5)).rgb));
    float posY = rawToReal(color2float(texture2D(uDataTexture, ftc+vec2(.5,-.5)).rgb));
    float rot  = rawToReal(color2float(texture2D(uDataTexture, ftc).rgb));
    rot = mix(rot, snoise(vec3(posX*.001, posY*.001, uTime*.001))*360., 0.01);
    gl_FragColor = vec4(float2color(realToRaw(rot)), 1.);
  }
  else {
    // Velocity
    float posX = rawToReal(color2float(texture2D(uDataTexture, ftc+vec2(-.5,-.5)).rgb));
    float posY = rawToReal(color2float(texture2D(uDataTexture, ftc+vec2(0.,-.5)).rgb));
    float vel  = rawToReal(color2float(texture2D(uDataTexture, ftc+vec2(0.,-.5)).rgb));
    float noiseV = snoise(vec3(posX, posY, uTime))*0.5+0.5;
    vel += noiseV + uBass*300. + uPulse*500.;
    vel *= 0.9;
    gl_FragColor = vec4(float2color(realToRaw(vel)), 1.);
  }
}
`;

      // ─── Particle-draw vertex shader ──────────────────────────────────────────
      const particleDrawVert = `
precision mediump float;

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233)))*43758.5453123);
}
vec3 mod289_3(vec3 x) { return x - floor(x*(1./289.))*289.; }
vec2 mod289_2(vec2 x) { return x - floor(x*(1./289.))*289.; }
vec3 permute3(vec3 x) { return mod289_3(((x*34.)+1.)*x); }
float snoise2(vec2 v) {
  const vec4 C = vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.,0.) : vec2(0.,1.);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289_2(i);
  vec3 pp = permute3(permute3(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m = max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m = m*m; m = m*m;
  vec3 x2 = 2.*fract(pp*C.www)-1.;
  vec3 h = abs(x2)-.5;
  vec3 ox = floor(x2+.5);
  vec3 a0 = x2-ox;
  m *= 1.79284291400159 - 0.85373472095314*(a0*a0+h*h);
  vec3 g2;
  g2.x  = a0.x *x0.x  + h.x *x0.y;
  g2.yz = a0.yz*x12.xz + h.yz*x12.yw;
  return 130.*dot(m, g2);
}

vec2 rot2(vec2 v, float a) {
  float s=sin(a), c=cos(a);
  return mat2(c,s,-s,c)*v;
}

const float c_precision = 256.;
const float c_p1 = 257.;
float color2float(vec3 col) {
  return floor(col.r*c_precision+.5) + floor(col.g*c_precision+.5)*c_p1
       + floor(col.b*c_precision+.5)*c_p1*c_p1;
}
float rawToReal(float v) { return v/1000.-4096.; }

attribute vec3 aPosition;
attribute vec2 aTexCoord;
attribute vec4 aVertexColor;
#define DEG_TO_RAD 0.0174532925
uniform mat4 uProjectionMatrix;
uniform mat4 uModelViewMatrix;
varying float vAlpha;
varying vec2  vTexCoord;
uniform vec2  uScreenSize;
uniform sampler2D uDataTexture;
uniform sampler2D uRandomSeedTexture;
uniform float uTime;

void main() {
  vec4 posXCol  = texture2D(uDataTexture, aTexCoord);
  vec4 posYCol  = texture2D(uDataTexture, aTexCoord+vec2(.5,0.));
  vec4 rotCol   = texture2D(uDataTexture, aTexCoord+vec2(0.,.5));
  vec4 lifeOCol = texture2D(uRandomSeedTexture, aTexCoord+vec2(0.,.5));
  vec4 lifeCol  = texture2D(uRandomSeedTexture, aTexCoord+vec2(.5,.5));

  float lifeOff = color2float(lifeOCol.rgb);
  float life    = color2float(lifeCol.rgb);
  float alpha   = 1. - mod(uTime-lifeOff, life)/life;
  vAlpha = clamp(alpha - 0.05, 0., 1.);

  float posX = rawToReal(color2float(posXCol.rgb));
  float posY = rawToReal(color2float(posYCol.rgb));
  float rot  = rawToReal(color2float(rotCol.rgb));

  vec2 vp = rot2(aPosition.xy, -rot*DEG_TO_RAD);
  vp.x += posX - .5*uScreenSize.x;
  vp.y += posY - .5*uScreenSize.y;

  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(vp, 0., 1.);
  vTexCoord = aTexCoord;
}
`;

      // ─── Particle-draw fragment shader (audio-colored) ────────────────────────
      const particleDrawFrag = `
precision mediump float;
varying float vAlpha;
varying vec2  vTexCoord;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uPulse;

void main() {
  float b = vAlpha * (0.25 + uBass*0.55 + uPulse*0.9);
  gl_FragColor = vec4(
    b*(1. + uBass*1.2 + uPulse*0.6),
    b*(1. + uMid *0.7),
    b*(1. + uHigh*0.9 - uPulse*0.2),
    1.
  );
}
`;

      // ─── NYModel helper ───────────────────────────────────────────────────────
      class NYModel {
        constructor(name) {
          this.modelName  = name;
          this.verts      = [];
          this.vertColors = [];
          this.triangles  = [];
          this.uvs        = [];
          this.vertIndex  = 0;
        }
        addFullScreenTriangle(xW, yH) {
          this.addTriangle(-0.5*xW,0.5*yH, -0.5*xW,-1.5*yH, 1.5*xW,0.5*yH, [0,0],[0,2],[2,0]);
        }
        addTriangle(x1,y1, x2,y2, x3,y3, uv1=[0,1], uv2=[1,0], uv3=[1,1]) {
          this.verts.push([x1,y1],[x2,y2],[x3,y3]);
          this.vertColors.push([1,1,1,1],[1,1,1,1],[1,1,1,1]);
          this.uvs.push(uv1,uv2,uv3);
          this.triangles.push([this.vertIndex,this.vertIndex+1,this.vertIndex+2]);
          this.vertIndex += 3;
        }
        build() {
          const md = new p5.Geometry();
          md.gid = this.modelName + '_' + Math.random().toString(36).slice(2);
          md.vertices    = this.verts.map(v => new p5.Vector(v[0], v[1], 0));
          md.faces       = this.triangles;
          md.uvs         = this.uvs;
          md.vertexColors = this.vertColors;
          return md;
        }
      }

      // ─── JS helpers ───────────────────────────────────────────────────────────
      function pack3(value) {
        const z = Math.floor(value / 65536);
        const y = Math.floor((value - z * 65536) / 256);
        const x = Math.floor(value) % 156;
        return [x, y, z];
      }
      function realToRaw(v) { return (v + 4096.0) * 1000.0; }

      // ─── Texture initialisation ───────────────────────────────────────────────
      function initTextures() {
        const makeGfx = () => {
          const g = p.createGraphics(512, 512, p.WEBGL);
          g.noSmooth();
          try { g.textureWrap(p.CLAMP, p.CLAMP); } catch(e) {}
          try { g.setAttributes({ alpha: true, antialias: false }); } catch(e) {}
          g.background(30);
          return g;
        };

        texture_initialData   = makeGfx();
        texture_randomSeed    = makeGfx();
        texture_particleDataA = makeGfx();
        texture_particleDataB = makeGfx();

        shader_particleDataA = texture_particleDataA.createShader(particleMoveVert, particleMoveFrag);
        shader_particleDataB = texture_particleDataB.createShader(particleMoveVert, particleMoveFrag);

        const cw = p.width, ch = p.height;
        for (let x = 0; x < 256; x++) {
          for (let y = 0; y < 256; y++) {
            const xPos   = Math.floor((x / 256) * cw);
            const yPos   = Math.floor((y / 256) * ch);
            const packedY = pack3(realToRaw(yPos));
            const packRot = pack3(realToRaw(Math.random() * 360));
            const packVel = pack3(realToRaw(1 + Math.random() * 199));

            texture_initialData.noStroke();
            texture_initialData.fill(255, 0, 0);
            texture_initialData.rect(x-256, y-256, 1, 1);
            texture_initialData.fill(packedY[0], packedY[1], packedY[2]);
            texture_initialData.rect(x, y-256, 1, 1);
            texture_initialData.fill(packRot[0], packRot[1], packRot[2]);
            texture_initialData.rect(x-256, y, 1, 1);
            texture_initialData.fill(packVel[0], packVel[1], packVel[2]);
            texture_initialData.rect(x, y, 1, 1);

            const randSeed     = Math.floor(Math.random() * 65535);
            const initLife     = Math.floor(Math.random() * 300);
            const particleLife = Math.floor(15 + Math.random() * 75);
            const packedSeed   = pack3(randSeed);
            const packedIL     = pack3(initLife);
            const packedPL     = pack3(particleLife);

            texture_randomSeed.noStroke();
            texture_randomSeed.fill(packedSeed[0], packedSeed[1], packedSeed[2]);
            texture_randomSeed.rect(x-256, y-256, 1, 1);
            texture_randomSeed.fill(packedIL[0], packedIL[1], packedIL[2]);
            texture_randomSeed.rect(x-256, y, 1, 1);
            texture_randomSeed.fill(packedPL[0], packedPL[1], packedPL[2]);
            texture_randomSeed.rect(x, y, 1, 1);
          }
        }
      }

      // ─── Geometry initialisation ──────────────────────────────────────────────
      function initModels() {
        const pm = new NYModel('particle');
        for (let x = 0; x < 256; x++) {
          for (let y = 0; y < 256; y++) {
            const uvX = (x + 0.5) / 512;
            const uvY = (y + 0.5) / 512;
            const uv  = [uvX, uvY];
            pm.addTriangle(-0.5,-1, 0.5,-1, 0.5,1, uv,uv,uv);
            pm.addTriangle(-0.5,-1, 0.5,1, -0.5,1, uv,uv,uv);
          }
        }
        geometry_particles = pm.build();

        const btA = new NYModel('screenA');
        btA.addFullScreenTriangle(512, 512);
        bigTriangleGeometryA = btA.build();

        const btB = new NYModel('screenB');
        btB.addFullScreenTriangle(512, 512);
        bigTriangleGeometryB = btB.build();
      }

      // ─── Seed initial state ───────────────────────────────────────────────────
      function drawStart() {
        [[texture_particleDataA, shader_particleDataA, bigTriangleGeometryA],
         [texture_particleDataB, shader_particleDataB, bigTriangleGeometryB]].forEach(([tex, sh, geo]) => {
          tex.shader(sh);
          sh.setUniform('uDataTexture',       texture_initialData);
          sh.setUniform('uRandomSeedTexture', texture_randomSeed);
          sh.setUniform('uScreenSize', [p.width, p.height]);
          sh.setUniform('uTime',  0);
          sh.setUniform('uBass',  0.0);
          sh.setUniform('uPulse', 0.0);
          tex.model(geo);
        });
      }

      // ─── p5 lifecycle ─────────────────────────────────────────────────────────
      p.setup = () => {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const cnv = p.createCanvas(cw, ch, p.WEBGL);
        cnv.style('position', 'absolute');
        cnv.style('inset', '0');
        p.frameRate(30);
        p.noStroke();

        shader_drawParticle = p.createShader(particleDrawVert, particleDrawFrag);

        initTextures();
        initModels();
        drawStart();
      };

      p.draw = () => {
        const bass  = self._bass;
        const mid   = self._mid;
        const high  = self._high;
        const pulse = self._pulse;
        const t     = p.frameCount;
        const sz    = [p.width, p.height];

        // Ping-pong: compute new particle positions
        if (isA) {
          texture_particleDataA.shader(shader_particleDataA);
          shader_particleDataA.setUniform('uDataTexture',       texture_particleDataB);
          shader_particleDataA.setUniform('uRandomSeedTexture', texture_randomSeed);
          shader_particleDataA.setUniform('uScreenSize', sz);
          shader_particleDataA.setUniform('uTime',  t);
          shader_particleDataA.setUniform('uBass',  bass);
          shader_particleDataA.setUniform('uPulse', pulse);
          texture_particleDataA.model(bigTriangleGeometryA);
        } else {
          texture_particleDataB.shader(shader_particleDataB);
          shader_particleDataB.setUniform('uDataTexture',       texture_particleDataA);
          shader_particleDataB.setUniform('uRandomSeedTexture', texture_randomSeed);
          shader_particleDataB.setUniform('uScreenSize', sz);
          shader_particleDataB.setUniform('uTime',  t);
          shader_particleDataB.setUniform('uBass',  bass);
          shader_particleDataB.setUniform('uPulse', pulse);
          texture_particleDataB.model(bigTriangleGeometryB);
        }

        // Draw particles on the main WEBGL canvas
        p.background(0);
        p.blendMode(p.ADD);
        p.shader(shader_drawParticle);
        shader_drawParticle.setUniform('uScreenSize',        sz);
        shader_drawParticle.setUniform('uRandomSeedTexture', texture_randomSeed);
        shader_drawParticle.setUniform('uTime',  t);
        shader_drawParticle.setUniform('uBass',  bass);
        shader_drawParticle.setUniform('uMid',   mid);
        shader_drawParticle.setUniform('uHigh',  high);
        shader_drawParticle.setUniform('uPulse', pulse);
        shader_drawParticle.setUniform(
          'uDataTexture',
          isA ? texture_particleDataA : texture_particleDataB
        );
        p.model(geometry_particles);

        isA = !isA;
      };

      p.windowResized = () => {
        p.resizeCanvas(container.clientWidth, container.clientHeight);
      };
    };

    this._p5 = new p5(sketch, container);
  }
}
