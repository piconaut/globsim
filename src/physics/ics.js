// Initial conditions following Fare, Webb & Sills (2018), after Miholics et al. (2015):
// P1 is a King W0 = 7 model; P2 is the same model scaled to a fraction of its radius.
// The two are combined and velocities rescaled so the ensemble is virialised.

import { makeRng } from './rng.js';
import { makeKroupa } from './imf.js';
import { solveKing, sampleKing } from './king.js';

export function potentialEnergy(n, x, y, z, m, eps2 = 0) {
  let w = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[j] - x[i], dy = y[j] - y[i], dz = z[j] - z[i];
      w -= (m[i] * m[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
    }
  }
  return w;
}

export function halfMassRadius(idx, x, y, z, m, cx = 0, cy = 0, cz = 0) {
  if (idx.length === 0) return 0;
  const rs = idx.map((i) => {
    const dx = x[i] - cx, dy = y[i] - cy, dz = z[i] - cz;
    return [dx * dx + dy * dy + dz * dz, m[i]];
  });
  rs.sort((a, b) => a[0] - b[0]);
  const total = rs.reduce((s, r) => s + r[1], 0);
  let acc = 0;
  for (const [r2, mi] of rs) {
    acc += mi;
    if (acc >= total / 2) return Math.sqrt(r2);
  }
  return Math.sqrt(rs[rs.length - 1][0]);
}

export function buildCluster({ n, w0 = 7, p2Fraction = 0.5, p2Scale = 0.5, seed = 1, mMax = 50 }) {
  const rng = makeRng(seed);
  const imf = makeKroupa(0.1, mMax);
  const model = solveKing(w0);
  const n2 = Math.round(n * p2Fraction);
  const n1 = n - n2;
  const stars = sampleKing(model, n, rng);

  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);
  const mass = new Float64Array(n); // Msun
  const pop = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = stars[i];
    const scale = i < n1 ? 1 : p2Scale;
    x[i] = s[0] * scale; y[i] = s[1] * scale; z[i] = s[2] * scale;
    vx[i] = s[3]; vy[i] = s[4]; vz[i] = s[5];
    mass[i] = imf(rng.uniform);
    pop[i] = i < n1 ? 0 : 1;
  }

  const mTot = mass.reduce((a, b) => a + b, 0);
  const m = mass.map((v) => v / mTot);

  // Centre of mass frame.
  let cx = 0, cy = 0, cz = 0, cvx = 0, cvy = 0, cvz = 0;
  for (let i = 0; i < n; i++) {
    cx += m[i] * x[i]; cy += m[i] * y[i]; cz += m[i] * z[i];
    cvx += m[i] * vx[i]; cvy += m[i] * vy[i]; cvz += m[i] * vz[i];
  }
  for (let i = 0; i < n; i++) {
    x[i] -= cx; y[i] -= cy; z[i] -= cz;
    vx[i] -= cvx; vy[i] -= cvy; vz[i] -= cvz;
  }

  // Virialise (2T = -W), then scale to Hénon units (E = -1/4).
  const wPot = potentialEnergy(n, x, y, z, m);
  let t = 0;
  for (let i = 0; i < n; i++) t += 0.5 * m[i] * (vx[i] ** 2 + vy[i] ** 2 + vz[i] ** 2);
  const q = Math.sqrt(-wPot / (2 * t));
  const e = wPot / 2; // energy once virialised
  const lambda = -4 * e; // r -> r * lambda gives E -> E / lambda = -1/4
  const vScale = q / Math.sqrt(lambda);
  for (let i = 0; i < n; i++) {
    x[i] *= lambda; y[i] *= lambda; z[i] *= lambda;
    vx[i] *= vScale; vy[i] *= vScale; vz[i] *= vScale;
  }

  return { n, n1, n2, x, y, z, vx, vy, vz, m, mass, pop, massTotal: mTot };
}
