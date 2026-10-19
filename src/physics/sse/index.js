// SSE (Hurley, Pols & Tout 2000) single-star evolution, as in NBODY6MP.
//
// sse.gen.js is translated line by line from NBODY6MP's Fortran (vendor/sse)
// by scripts/f2js.py, including NBODY6MP's helium-dependent MS lifetimes in
// star.f. supdate() is our single-star version of NBODY6's MDOT + TRDOT:
// each star is updated at its own look-up times with wind mass loss,
// rejuvenation and the same time-step rules.

import { zcnsts, sinit, supdate, star } from './sse.gen.js';
import { KIND } from '../stellar.js';

// SSE stellar type (kw) to the coarse kinds used by the rest of globsim.
export function kindFromKw(kw) {
  if (kw <= 1) return KIND.MS;
  if (kw === 4 || (kw >= 7 && kw <= 9)) return KIND.HB; // core helium burning, naked He stars
  if (kw <= 6) return KIND.RGB; // Hertzsprung gap, giant branch, AGB
  if (kw <= 12) return KIND.WD;
  if (kw === 13) return KIND.NS;
  if (kw === 14) return KIND.BH;
  return KIND.NONE; // massless remnant after a supernova
}

export function ssePars(y, z) {
  const zpars = new Float64Array(21);
  zcnsts({ y, z, zpars });
  return zpars;
}

// Main-sequence lifetime from STAR, in Myr.
export function sseMsLifetime(m, zpars) {
  const c = {
    kw: 1, mass: m, mt: m, tm: 0, tn: 0,
    tscls: new Float64Array(21), lums: new Float64Array(11), gb: new Float64Array(11), zpars,
  };
  star(c);
  return c.tm;
}

export function sseTurnoffMass(tMyr, zpars) {
  let lo = Math.log(0.1), hi = Math.log(100);
  for (let k = 0; k < 60; k++) {
    const mid = 0.5 * (lo + hi);
    if (sseMsLifetime(Math.exp(mid), zpars) > tMyr) lo = mid;
    else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}

// Per-star SSE state for a whole cluster, in parallel typed arrays.
export class SSEPopulation {
  constructor(masses, pops, helium, z) {
    const n = masses.length;
    this.z = z;
    this.zpars = helium.map((y) => ssePars(y, z));
    this.kw = new Int8Array(n);
    this.m0 = new Float64Array(n);
    this.mt = new Float64Array(n);
    this.epoch = new Float64Array(n);
    this.tev0 = new Float64Array(n);
    this.dtm = new Float64Array(n);
    this.r = new Float64Array(n);
    this.lum = new Float64Array(n);
    this.mc = new Float64Array(n);
    this.pop = pops;
    this.s = {
      z, zpars: null, dtmax: 1e30, kw: 0, m0: 0, mt: 0, epoch: 0, tev0: 0, r: 0, lum: 0, mc: 0, rc: 0, dtm: 0, m: 0,
    };
    for (let i = 0; i < n; i++) {
      const s = { m: masses[i], zpars: this.zpars[pops[i]], kw: 0, m0: 0, mt: 0, epoch: 0, r: 0, lum: 0, mc: 0, rc: 0, dtm: 0 };
      sinit(s);
      this.store(i, { ...s, tev0: 0 });
    }
  }

  // Arrays that must be permuted together when a star is removed.
  arrays() {
    return [this.kw, this.m0, this.mt, this.epoch, this.tev0, this.dtm, this.r, this.lum, this.mc];
  }

  store(i, s) {
    this.kw[i] = s.kw; this.m0[i] = s.m0; this.mt[i] = s.mt; this.epoch[i] = s.epoch;
    this.tev0[i] = s.tev0; this.dtm[i] = s.dtm; this.r[i] = s.r; this.lum[i] = s.lum; this.mc[i] = s.mc;
  }

  // Apply every update due by tMyr, as NBODY6 does when TIME passes TEV.
  advance(i, tMyr) {
    if (this.tev0[i] + this.dtm[i] > tMyr) return false;
    const s = this.s;
    s.zpars = this.zpars[this.pop[i]];
    s.kw = this.kw[i]; s.m0 = this.m0[i]; s.mt = this.mt[i]; s.epoch = this.epoch[i];
    s.tev0 = this.tev0[i]; s.dtm = this.dtm[i]; s.r = this.r[i]; s.lum = this.lum[i]; s.mc = this.mc[i];
    for (let k = 0; k < 100000 && s.tev0 + s.dtm <= tMyr && s.kw < 15; k++) supdate(s);
    this.store(i, s);
    return true;
  }

  photometry(i) {
    const logL = Math.log10(Math.max(this.lum[i], 1e-10));
    const logT = Math.log10(5772) + 0.25 * logL - 0.5 * Math.log10(Math.max(this.r[i], 1e-10));
    return { logL, logT };
  }
}
