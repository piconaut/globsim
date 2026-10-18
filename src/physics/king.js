// King (1966) model: solve Poisson's equation for the lowered isothermal
// sphere, then sample positions and speeds from it.
// Radii are in King radii r0, speeds in units of the velocity parameter sigma.

function erf(x) {
  // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x));
  return y;
}

// Density as a function of dimensionless potential W, up to a constant.
export function kingDensity(w) {
  if (w <= 0) return 0;
  const s = Math.sqrt(w);
  return Math.exp(w) * erf(s) - Math.sqrt(4 * w / Math.PI) * (1 + (2 * w) / 3);
}

export function solveKing(w0, dr = 1e-3) {
  const rho0 = kingDensity(w0);
  // y = [W, dW/dr, M], with d2W/dr2 + (2/r) dW/dr = -9 rho/rho0 and dM/dr = r^2 rho/rho0
  const deriv = (r, y) => {
    const rho = kingDensity(y[0]) / rho0;
    return [y[1], -9 * rho - (2 * y[1]) / r, r * r * rho];
  };
  let r = 1e-4;
  let y = [w0 - 1.5 * r * r, -3 * r, (r * r * r) / 3];
  const rs = [0, r];
  const ms = [0, y[2]];
  const ws = [w0, y[0]];
  while (y[0] > 0 && r < 1e3) {
    const h = dr * Math.max(1, r);
    const k1 = deriv(r, y);
    const k2 = deriv(r + h / 2, y.map((v, i) => v + (h / 2) * k1[i]));
    const k3 = deriv(r + h / 2, y.map((v, i) => v + (h / 2) * k2[i]));
    const k4 = deriv(r + h, y.map((v, i) => v + h * k3[i]));
    const yn = y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    if (yn[0] <= 0) {
      // Interpolate to the tidal radius where W = 0.
      const f = y[0] / (y[0] - yn[0]);
      r += f * h;
      y = y.map((v, i) => v + f * (yn[i] - v));
      y[0] = 0;
    } else {
      r += h;
      y = yn;
    }
    rs.push(r);
    ws.push(y[0]);
    ms.push(y[2]);
  }
  return { r: rs, w: ws, m: ms, rt: r, mTotal: y[2] };
}

function interp(xs, ys, x) {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] > x) hi = mid;
    else lo = mid;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}

// Sample n stars as [x, y, z, vx, vy, vz] in model units.
export function sampleKing(model, n, rng) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = interp(model.m, model.r, rng.uniform() * model.mTotal);
    const w = Math.max(0, interp(model.r, model.w, r));
    // Speed distribution ∝ v^2 (exp(W - v^2/2) - 1) for v < sqrt(2W).
    const vmax = Math.sqrt(2 * w);
    const bound = 2 * Math.exp(w - 1) + 1e-12;
    let v = 0;
    for (let tries = 0; tries < 10000; tries++) {
      const cand = rng.uniform() * vmax;
      const g = cand * cand * (Math.exp(w - (cand * cand) / 2) - 1);
      if (rng.uniform() * bound < g) {
        v = cand;
        break;
      }
    }
    const [dx, dy, dz] = rng.direction();
    const [ux, uy, uz] = rng.direction();
    out[i] = [r * dx, r * dy, r * dz, v * ux, v * uy, v * uz];
  }
  return out;
}
