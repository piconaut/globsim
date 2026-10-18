import { Simulation, DEFAULTS } from './physics/sim.js';
import { heliumLifetimeRatio, defaultHelium } from './physics/stellar.js';
import { GpuIntegrator, gpuSupported, advance } from './gpu.js';
import { Renderer, CONTRAST_STOPS } from './render.js';
import { TimeChart, HRChart } from './charts.js';

const T_END_GYR = 12;

const PRESETS = {
  fig3: { tidal: false, yP2: 0.32, p2Scale: 0.5 },
  fig4: { tidal: true, rgKpc: 20, yP2: 0.32, p2Scale: 0.5 },
  fig6: { tidal: true, rgKpc: 20, yP2: 0.32, p2Scale: 1.0 },
  extreme: { tidal: false, yP2: 0.40, p2Scale: 0.5 },
};

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hexToRgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);

const canvas = $('sky');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true });
const useGpu = gpuSupported(gl);
const renderer = gl ? new Renderer(gl, canvas, [hexToRgb(css('--p1')), hexToRgb(css('--p2'))]) : null;

const state = {
  params: { ...DEFAULTS, ...PRESETS.fig3, n: useGpu ? 2000 : 1000 },
  twin: true,
  playing: true,
  runs: [],
  speed: 100, // target Myr per second; Infinity runs as fast as the device allows
  clockMyr: 0,
};

const series = (get) => [
  { label: 'P1 normal He', color: '--p1', run: 'main', get: (p) => get(p, 'p1') },
  { label: 'P2', color: '--p2', run: 'main', get: (p) => get(p, 'p2') },
  { label: 'All stars', color: '--ink', run: 'main', get: (p) => get(p, 'all') },
  { label: 'P1, twin', color: '--p1', run: 'twin', get: (p) => get(p, 'p1') },
  { label: 'P2, twin', color: '--p2', run: 'twin', get: (p) => get(p, 'p2') },
  { label: 'All, twin', color: '--ink', run: 'twin', get: (p) => get(p, 'all') },
];

const rhChart = new TimeChart($('rh-chart'), $('rh-tip'), {
  series: series((p, k) => p.rh[k]), xMax: T_END_GYR, yFmt: (v) => v.toFixed(1), unit: ' pc',
});
const daChart = new TimeChart($('da-chart'), $('da-tip'), {
  series: series((p, k) => p.dAlpha[k]).filter((s) => !s.label.startsWith('All')),
  xMax: T_END_GYR, yFmt: (v) => v.toFixed(2), smoothK: 12,
});
const hrChart = new HRChart($('hr-chart'), $('hr-tip'));

function makeRun(role, params) {
  const sim = new Simulation(params);
  return { role, sim, gpu: useGpu ? new GpuIntegrator(gl, sim) : null, batch: 32 };
}

function restart() {
  const p = state.params;
  state.runs = [makeRun('main', p)];
  if (state.twin) state.runs.push(makeRun('twin', { ...p, yP2: p.yP1 }));
  for (const run of state.runs) {
    for (const pt of run.sim.history) push(run.role, pt);
  }
  rhChart.reset();
  daChart.reset();
  state.done = false;
  state.clockMyr = 0;
  if (renderer) renderer.focus = null;
  updateLabels();
  syncReadouts();
}

function push(role, pt) {
  rhChart.push(role, pt);
  daChart.push(role, pt);
}

// ---- Controls ----

function updateLabels() {
  const p = state.params;
  $('yp2-out').textContent = p.yP2.toFixed(3);
  const ratio = heliumLifetimeRatio(p.yP2) / heliumLifetimeRatio(defaultHelium(p.z));
  $('yp2-note').textContent = `P2 main-sequence lifetimes ×${ratio.toFixed(2)}`;
  $('scale-out').textContent = `${(p.p2Scale * p.rhP1pc).toFixed(1)} pc`;
  $('rg-out').textContent = `${p.rgKpc} kpc`;
  $('rg-row').hidden = !p.tidal;
  $('env-iso').setAttribute('aria-pressed', String(!p.tidal));
  $('env-orbit').setAttribute('aria-pressed', String(p.tidal));
  $('yp2').value = p.yP2;
  $('scale').value = p.p2Scale;
  $('rg').value = p.rgKpc;
  $('n').value = String(p.n);
  $('bh').checked = p.retainBH;
  $('twin').checked = state.twin;
}

function setParams(patch) {
  Object.assign(state.params, patch);
  $('preset').value = Object.entries(PRESETS).find(([, v]) =>
    Object.entries(v).every(([k, x]) => state.params[k] === x))?.[0] ?? 'custom';
  restart();
}

$('preset').addEventListener('change', (e) => {
  if (PRESETS[e.target.value]) setParams({ rgKpc: DEFAULTS.rgKpc, ...PRESETS[e.target.value] });
});
$('yp2').addEventListener('input', (e) => { $('yp2-out').textContent = (+e.target.value).toFixed(3); });
$('yp2').addEventListener('change', (e) => setParams({ yP2: +e.target.value }));
$('scale').addEventListener('input', (e) => { $('scale-out').textContent = `${(+e.target.value * state.params.rhP1pc).toFixed(1)} pc`; });
$('scale').addEventListener('change', (e) => setParams({ p2Scale: +e.target.value }));
$('rg').addEventListener('input', (e) => { $('rg-out').textContent = `${e.target.value} kpc`; });
$('rg').addEventListener('change', (e) => setParams({ rgKpc: +e.target.value }));
$('env-iso').addEventListener('click', () => setParams({ tidal: false }));
$('env-orbit').addEventListener('click', () => setParams({ tidal: true }));
$('n').addEventListener('change', (e) => setParams({ n: +e.target.value }));
$('bh').addEventListener('change', (e) => setParams({ retainBH: e.target.checked }));
$('twin').addEventListener('change', (e) => { state.twin = e.target.checked; restart(); });
$('seed').addEventListener('click', () => setParams({ seed: (Math.random() * 1e9) | 0 }));
$('restart').addEventListener('click', restart);

// Speed slider: log scale from 2 to 1000 Myr/s, with the top notch meaning "as fast as possible".
const SPEED_MAX = 100;
const speedFromSlider = (v) => (v >= SPEED_MAX ? Infinity : Math.round(2 * Math.pow(500, v / (SPEED_MAX - 1))));
const sliderFromSpeed = (myr) => Math.round((Math.log(myr / 2) / Math.log(500)) * (SPEED_MAX - 1));
function showSpeed() {
  $('speed-out').textContent = Number.isFinite(state.speed) ? `${state.speed} Myr/s` : 'Max';
}
$('speed').value = sliderFromSpeed(state.speed);
showSpeed();
$('speed').addEventListener('input', (e) => {
  state.speed = speedFromSlider(+e.target.value);
  showSpeed();
});
$('play').addEventListener('click', () => {
  state.playing = !state.playing;
  $('play').textContent = state.playing ? 'Pause' : 'Play';
  $('play').setAttribute('aria-pressed', String(!state.playing));
});
$('color').addEventListener('change', (e) => {
  if (renderer) renderer.colorMode = e.target.value;
  $('legend-pop').hidden = e.target.value !== 'population';
  $('legend-temp').hidden = e.target.value !== 'contrast';
});
$('ramp').style.background = `linear-gradient(90deg, ${CONTRAST_STOPS
  .map(([f, c]) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')}) ${f * 100}%`).join(', ')})`;

// Orbit and zoom the camera.
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || !renderer) return;
  renderer.yaw += (e.clientX - drag[0]) * 0.006;
  renderer.pitch = Math.min(3.1, Math.max(0.05, renderer.pitch - (e.clientY - drag[1]) * 0.006));
  drag = [e.clientX, e.clientY];
});
canvas.addEventListener('wheel', (e) => {
  if (!renderer) return;
  e.preventDefault();
  renderer.dist = Math.min(600, Math.max(8, renderer.dist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });
$('spin').addEventListener('change', (e) => { if (renderer) renderer.autoRotate = e.target.checked; });

// ---- Readouts ----

const fmt = {
  mass: (m) => `${(m / 1e4).toFixed(2)}×10⁴ M☉`,
};

function syncReadouts() {
  const main = state.runs[0];
  if (!main) return;
  const s = main.sim;
  const last = s.history.at(-1);
  $('time').textContent = (s.tMyr / 1000).toFixed(2);
  $('trh').textContent = (s.tMyr / s.trhMyr).toFixed(1);
  if (last) {
    $('members').textContent = last.n.toLocaleString();
    $('mass').textContent = fmt.mass(last.mass);
    const to = (m) => (m > 50 ? 'above 50 M☉' : `${m.toFixed(3)} M☉`);
    $('to1').textContent = to(last.turnoff.p1);
    $('to2').textContent = to(last.turnoff.p2);
    $('rhs').textContent = `${last.rh.p1.toFixed(2)} / ${last.rh.p2.toFixed(2)} pc`;
    $('rt').textContent = last.rt ? `${last.rt.toFixed(1)} pc` : 'none';
  }
}

// ---- Main loop ----

let lastFrame = performance.now();
let lastSlow = 0;
let simMyrAtLast = 0;
let snap = null;

function frame(now) {
  const dtSec = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const runs = state.runs;
  if (state.playing && !state.done) {
    // Every run chases one shared clock, so the twin stays in step with the main run.
    // The clock may lead the slowest run by at most half a second, so a slow
    // device falls behind the target rather than lurching to catch up.
    const endMyr = T_END_GYR * 1000;
    const target = state.speed;
    const slowest = Math.min(...runs.map((r) => r.sim.tMyr));
    state.clockMyr = Number.isFinite(target)
      ? Math.min(endMyr, state.clockMyr + target * dtSec, slowest + target * 0.5)
      : endMyr;
    const share = 24 / runs.length;
    for (const run of runs) {
      const start = performance.now();
      while (performance.now() - start < share && run.sim.tMyr < state.clockMyr) {
        const t0 = performance.now();
        const pt = advance(run.sim, run.gpu, run.batch, state.clockMyr);
        const took = performance.now() - t0;
        // Keep each batch to a few ms so the page stays responsive.
        run.batch = Math.max(4, Math.min(4000, Math.round(run.batch * (took < 4 ? 1.25 : took > 9 ? 0.7 : 1))));
        if (pt) push(run.role, pt);
      }
    }
    state.done = runs.every((r) => r.sim.tMyr >= T_END_GYR * 1000);
    if (state.done) {
      state.playing = false;
      $('play').textContent = 'Play';
    }
  }
  if (runs[0]) snap = runs[0].sim.snapshot();
  if (renderer) renderer.draw(snap, dtSec);
  if (now - lastSlow > 250) {
    const simMyr = runs[0] ? runs[0].sim.tMyr : 0;
    const rate = ((simMyr - simMyrAtLast) / (now - lastSlow)) * 1000;
    simMyrAtLast = simMyr;
    lastSlow = now;
    const behind = Number.isFinite(state.speed) && rate < 0.8 * state.speed;
    $('rate').textContent = !state.playing || state.done ? 'paused'
      : behind || !Number.isFinite(state.speed) ? `running at ${Math.round(rate)} Myr/s` : '';
    rhChart.draw();
    daChart.draw();
    hrChart.draw(snap, snap?.mass);
    syncReadouts();
  }
  requestAnimationFrame(frame);
}

if (!gl) {
  $('notice').hidden = false;
  $('notice').textContent = 'This browser has no WebGL2, so the cluster view is off. The simulation still runs on the CPU.';
} else if (!useGpu) {
  $('notice').hidden = false;
  $('notice').textContent = 'Float render targets are unavailable, so the simulation runs on the CPU with fewer stars.';
  for (const opt of $('n').options) opt.disabled = +opt.value > 1000;
}

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches && renderer) {
  renderer.autoRotate = false;
  $('spin').checked = false;
}

restart();
requestAnimationFrame(frame);
window.globsim = state;
