// Star renderer: additive gaussian point sprites in a slowly orbiting camera.

import { KIND } from './physics/stellar.js';

const VS = `#version 300 es
in vec3 aPos;
in vec4 aCol;
in float aSize;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uScale;
out vec4 vCol;
void main() {
  vec4 p = uView * vec4(aPos, 1.0);
  gl_Position = uProj * p;
  gl_PointSize = clamp(aSize * uScale / -p.z, 1.0, 48.0);
  vCol = aCol;
}`;

const FS = `#version 300 es
precision mediump float;
in vec4 vCol;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float glow = exp(-r2 * 4.0);
  float core = exp(-r2 * 24.0);
  vec3 c = vCol.rgb * glow + vec3(core * 0.55 * vCol.a);
  c *= vCol.a;
  // Premultiplied output whose alpha tracks brightness, so the glow adds to the page.
  outColor = vec4(c, min(1.0, max(c.r, max(c.g, c.b))));
}`;

const RING_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uView;
uniform mat4 uProj;
void main() { gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

const RING_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(t);
    gl.shaderSource(sh, s);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  return p;
}

// Approximate blackbody colour for an effective temperature.
const BB = [
  [2500, [1.0, 0.45, 0.2]], [3500, [1.0, 0.62, 0.36]], [4500, [1.0, 0.78, 0.56]],
  [5500, [1.0, 0.9, 0.78]], [6500, [0.98, 0.96, 0.95]], [8000, [0.82, 0.87, 1.0]],
  [12000, [0.68, 0.77, 1.0]], [30000, [0.6, 0.7, 1.0]],
];
export function teffColor(t) {
  if (t <= BB[0][0]) return BB[0][1];
  for (let k = 1; k < BB.length; k++) {
    if (t < BB[k][0]) {
      const f = (t - BB[k - 1][0]) / (BB[k][0] - BB[k - 1][0]);
      return BB[k - 1][1].map((v, i) => v + f * (BB[k][1][i] - v));
    }
  }
  return BB[BB.length - 1][1];
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function orbitView(yaw, pitch, dist) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Rotate about z (yaw) then tilt about x (pitch), then push back along -z.
  return new Float32Array([
    cy, -sy * cp, sy * sp, 0,
    sy, cy * cp, -cy * sp, 0,
    0, sp, cp, 0,
    0, 0, -dist, 1,
  ]);
}

export class Renderer {
  constructor(gl, canvas, colors) {
    this.gl = gl;
    this.canvas = canvas;
    this.colors = colors;
    this.prog = program(gl, VS, FS);
    this.ringProg = program(gl, RING_VS, RING_FS);
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = 8 * 4;
    const attr = (name, size, offset) => {
      const loc = gl.getAttribLocation(this.prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    };
    attr('aPos', 3, 0);
    attr('aCol', 4, 12);
    attr('aSize', 1, 28);
    gl.bindVertexArray(null);
    this.ringVao = gl.createVertexArray();
    this.ringVbo = gl.createBuffer();
    gl.bindVertexArray(this.ringVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ringVbo);
    const ring = new Float32Array(3 * 128);
    for (let k = 0; k < 128; k++) {
      ring[3 * k] = Math.cos((2 * Math.PI * k) / 128);
      ring[3 * k + 1] = Math.sin((2 * Math.PI * k) / 128);
    }
    gl.bufferData(gl.ARRAY_BUFFER, ring, gl.STATIC_DRAW);
    const rl = gl.getAttribLocation(this.ringProg, 'aPos');
    gl.enableVertexAttribArray(rl);
    gl.vertexAttribPointer(rl, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.data = new Float32Array(0);
    this.yaw = 0.6;
    this.pitch = 1.05;
    this.dist = 34;
    this.colorMode = 'population';
    this.autoRotate = true;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  draw(snap, dtSec) {
    const { gl } = this;
    this.resize();
    if (this.autoRotate) this.yaw += dtSec * 0.05;
    const n = snap ? snap.n : 0;
    if (this.data.length < n * 8) this.data = new Float32Array(n * 8);
    const d = this.data;
    const [p1, p2] = this.colors;
    for (let i = 0; i < n; i++) {
      const kind = snap.meta[2 * i + 1];
      const logL = snap.phot[2 * i];
      const logT = snap.phot[2 * i + 1];
      let col;
      if (this.colorMode === 'temperature') col = teffColor(Math.pow(10, logT));
      else col = snap.meta[2 * i] === 0 ? p1 : p2;
      let a = Math.min(1, Math.max(0.35, 0.55 + 0.15 * (logL + 1.5)));
      let size = Math.min(9, Math.max(2.2, 3 + 1.1 * (logL + 1)));
      if (kind === KIND.WD) { a *= 0.6; size = 1.1; }
      if (kind === KIND.BH) { col = [0.55, 0.45, 0.8]; a = 0.9; size = 3; }
      const o = 8 * i;
      d[o] = snap.pos[3 * i]; d[o + 1] = snap.pos[3 * i + 1]; d[o + 2] = snap.pos[3 * i + 2];
      d[o + 3] = col[0]; d[o + 4] = col[1]; d[o + 5] = col[2]; d[o + 6] = a;
      d[o + 7] = size;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const proj = perspective(0.75, this.canvas.width / Math.max(1, this.canvas.height), 0.1, 5000);
    const view = orbitView(this.yaw, this.pitch, this.dist);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    if (snap && snap.rt) {
      gl.useProgram(this.ringProg);
      const ringView = view.slice();
      // Scale the unit ring to r_t by scaling the model part of the view matrix.
      for (let k = 0; k < 12; k++) if (k % 4 !== 3) ringView[k] *= snap.rt;
      gl.uniformMatrix4fv(gl.getUniformLocation(this.ringProg, 'uView'), false, ringView);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.ringProg, 'uProj'), false, proj);
      gl.uniform4f(gl.getUniformLocation(this.ringProg, 'uColor'), 0.22, 0.2, 0.26, 1);
      gl.bindVertexArray(this.ringVao);
      gl.drawArrays(gl.LINE_LOOP, 0, 128);
    }

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'uView'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'uProj'), false, proj);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uScale'), this.dpr * 60);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, n * 8), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.bindVertexArray(null);
  }
}
