// WebGL2 integrator: the O(N²) force sum and the leapfrog update run in
// fragment shaders over RGBA32F textures (one texel per star). The CPU
// Simulation keeps the authoritative state; each batch uploads it, takes
// many steps on the GPU, reads it back, and completes the last half-kick.

const W = 64;

const VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FORCE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uPos;
uniform int uN;
uniform float uEps2;
uniform float uTx;
uniform float uTz;
out vec4 outAcc;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int i = c.y * ${W} + c.x;
  if (i >= uN) { outAcc = vec4(0.0); return; }
  vec3 xi = texelFetch(uPos, c, 0).xyz;
  vec3 a = vec3(0.0);
  for (int j = 0; j < uN; j++) {
    vec4 pj = texelFetch(uPos, ivec2(j % ${W}, j / ${W}), 0);
    vec3 d = pj.xyz - xi;
    float inv = inversesqrt(dot(d, d) + uEps2);
    a += d * (pj.w * inv * inv * inv);
  }
  a += vec3(uTx * xi.x, 0.0, -uTz * xi.z);
  outAcc = vec4(a, 0.0);
}`;

// Completes the previous step's second half-kick, takes this step's first
// half-kick, then drifts. Coriolis is an exact rotation of (vx, vy).
const STEP_FS = `#version 300 es
precision highp float;
uniform highp sampler2D uPos;
uniform highp sampler2D uVel;
uniform highp sampler2D uAcc;
uniform float uHPrev;
uniform float uHNext;
uniform float uOmega;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outVel;
vec2 rot(vec2 v, float ang) {
  float c = cos(ang), s = sin(ang);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 p = texelFetch(uPos, c, 0);
  vec3 u = texelFetch(uVel, c, 0).xyz;
  vec3 a = texelFetch(uAcc, c, 0).xyz;
  u.xy = rot(u.xy, -2.0 * uOmega * uHPrev);
  u += a * (uHPrev + uHNext);
  u.xy = rot(u.xy, -2.0 * uOmega * uHNext);
  p.xyz += u * (2.0 * uHNext);
  outPos = p;
  outVel = vec4(u, 0.0);
}`;

function compile(gl, vs, fs) {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const uniforms = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let k = 0; k < count; k++) {
    const name = gl.getActiveUniform(prog, k).name;
    uniforms[name] = gl.getUniformLocation(prog, name);
  }
  return { prog, u: uniforms };
}

const programs = new WeakMap();

export function gpuSupported(gl) {
  return !!(gl && gl.getExtension('EXT_color_buffer_float'));
}

export class GpuIntegrator {
  constructor(gl, sim) {
    this.gl = gl;
    this.sim = sim;
    if (!programs.has(gl)) {
      programs.set(gl, { force: compile(gl, VS, FORCE_FS), step: compile(gl, VS, STEP_FS), vao: gl.createVertexArray() });
    }
    this.progs = programs.get(gl);
    this.h = Math.ceil(sim.n / W);
    const tex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, W, this.h);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
      return t;
    };
    this.pos = [tex(), tex()];
    this.vel = [tex(), tex()];
    this.acc = tex();
    this.fbStep = [0, 1].map((k) => {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pos[k], 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.vel[k], 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      return fb;
    });
    this.fbAcc = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbAcc);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.acc, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Float render targets unavailable');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.buf = new Float32Array(W * this.h * 4);
    this.cur = 0;
  }

  upload() {
    const { gl, sim, buf } = this;
    const n = sim.n;
    buf.fill(0);
    for (let i = 0; i < n; i++) {
      buf[4 * i] = sim.x[i]; buf[4 * i + 1] = sim.y[i]; buf[4 * i + 2] = sim.z[i]; buf[4 * i + 3] = sim.m[i];
    }
    gl.bindTexture(gl.TEXTURE_2D, this.pos[this.cur]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, this.h, gl.RGBA, gl.FLOAT, buf);
    buf.fill(0);
    for (let i = 0; i < n; i++) {
      buf[4 * i] = sim.vx[i]; buf[4 * i + 1] = sim.vy[i]; buf[4 * i + 2] = sim.vz[i];
    }
    gl.bindTexture(gl.TEXTURE_2D, this.vel[this.cur]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, this.h, gl.RGBA, gl.FLOAT, buf);
  }

  bindTex(unit, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  force() {
    const { gl, sim } = this;
    const { prog, u } = this.progs.force;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbAcc);
    this.bindTex(0, this.pos[this.cur], u.uPos);
    gl.uniform1i(u.uN, sim.n);
    gl.uniform1f(u.uEps2, sim.eps2);
    gl.uniform1f(u.uTx, 2 * sim.omega2);
    gl.uniform1f(u.uTz, sim.omega2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  stepPass(hPrev, hNext) {
    const gl = this.gl;
    const { prog, u } = this.progs.step;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbStep[1 - this.cur]);
    this.bindTex(0, this.pos[this.cur], u.uPos);
    this.bindTex(1, this.vel[this.cur], u.uVel);
    this.bindTex(2, this.acc, u.uAcc);
    gl.uniform1f(u.uHPrev, hPrev);
    gl.uniform1f(u.uHNext, hNext);
    gl.uniform1f(u.uOmega, this.sim.omega);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 1 - this.cur;
  }

  read(fb, attachment, fn) {
    const { gl, buf, sim } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.readBuffer(attachment);
    gl.readPixels(0, 0, W, this.h, gl.RGBA, gl.FLOAT, buf);
    for (let i = 0; i < sim.n; i++) fn(i, buf);
  }

  // Advance `steps` leapfrog steps of size dt from the synchronised CPU state.
  run(steps, dt) {
    const { gl, sim } = this;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, W, this.h);
    gl.bindVertexArray(this.progs.vao);
    this.upload();
    this.force();
    const h = dt / 2;
    for (let k = 0; k < steps; k++) {
      this.stepPass(k === 0 ? 0 : h, h);
      this.force();
    }
    const fb = this.fbStep[this.cur];
    this.read(fb, gl.COLOR_ATTACHMENT0, (i, b) => { sim.x[i] = b[4 * i]; sim.y[i] = b[4 * i + 1]; sim.z[i] = b[4 * i + 2]; });
    this.read(fb, gl.COLOR_ATTACHMENT1, (i, b) => { sim.vx[i] = b[4 * i]; sim.vy[i] = b[4 * i + 1]; sim.vz[i] = b[4 * i + 2]; });
    this.read(this.fbAcc, gl.COLOR_ATTACHMENT0, (i, b) => { sim.ax[i] = b[4 * i]; sim.ay[i] = b[4 * i + 1]; sim.az[i] = b[4 * i + 2]; });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    sim.kick(h, true);
    sim.t += steps * dt;
    sim.steps += steps;
  }
}

// Advance a simulation by up to `maxSteps`, stopping at its next bookkeeping
// tick or once it reaches `untilMyr`. Returns the diagnostics point if a tick happened.
export function advance(sim, gpu, maxSteps, untilMyr = Infinity) {
  const dt = sim.chooseDt();
  const toTick = Math.ceil((sim.nextStats - sim.t) / dt);
  const toGoal = Math.ceil((untilMyr / sim.myrPerUnit - sim.t) / dt);
  const steps = Math.max(1, Math.min(maxSteps, toTick, toGoal));
  if (gpu) gpu.run(steps, dt);
  else {
    sim.dt = dt;
    for (let k = 0; k < steps; k++) if (sim.step()) return sim.history.at(-1);
    return null;
  }
  return sim.t >= sim.nextStats ? sim.tick() : null;
}
