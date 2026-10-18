// Mass segregation as in Webb & Vesperini (2016), used in Fare et al. (2018) fig. 5:
// the radial gradient of the mass-function slope, δα = dα / d ln(r / r_m),
// for main-sequence stars between 0.3 and 0.8 Msun.

import { KIND } from './stellar.js';

const M_LO = 0.3;
const M_HI = 0.8;
const BINS = 5;

// Maximum-likelihood slope of dN/dm ∝ m^α on [M_LO, M_HI].
export function powerLawSlope(masses) {
  const n = masses.length;
  if (n < 8) return NaN;
  let sumLog = 0;
  for (const m of masses) sumLog += Math.log(m);
  const meanLog = sumLog / n;
  const la = Math.log(M_LO), lb = Math.log(M_HI);
  // d/dα log L = 0  <=>  <ln m>_model(α) = <ln m>_data; <ln m>_model is monotonic in α.
  const modelMeanLog = (alpha) => {
    const p = alpha + 1;
    if (Math.abs(p) < 1e-6) return 0.5 * (la + lb);
    const A = Math.exp(p * la), B = Math.exp(p * lb);
    return (B * lb - A * la) / (B - A) - 1 / p;
  };
  let lo = -8, hi = 6;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (modelMeanLog(mid) < meanLog) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export function massSegregation(idx, sim, rm) {
  const [cx, cy, cz] = sim.center;
  const sel = [];
  for (const i of idx) {
    const mass = sim.mass[i];
    if (sim.kind[i] !== KIND.MS || mass < M_LO || mass > M_HI) continue;
    const r = Math.hypot(sim.x[i] - cx, sim.y[i] - cy, sim.z[i] - cz);
    if (r > 0) sel.push([Math.log(r / rm), mass]);
  }
  if (sel.length < BINS * 10) return NaN;
  sel.sort((a, b) => a[0] - b[0]);
  const xs = [], ys = [];
  for (let b = 0; b < BINS; b++) {
    const chunk = sel.slice(Math.floor((b * sel.length) / BINS), Math.floor(((b + 1) * sel.length) / BINS));
    const alpha = powerLawSlope(chunk.map((s) => s[1]));
    if (!Number.isFinite(alpha)) continue;
    xs.push(chunk.reduce((s, c) => s + c[0], 0) / chunk.length);
    ys.push(alpha);
  }
  if (xs.length < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let k = 0; k < xs.length; k++) {
    num += (xs[k] - mx) * (ys[k] - my);
    den += (xs[k] - mx) ** 2;
  }
  return num / den;
}
