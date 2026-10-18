// Direct-summation N-body integrator with stellar evolution and an optional
// Galactic tidal field, in Hénon units.
//
// Time scaling: a few thousand particles stand in for a 40 000-star cluster.
// Simulation time is mapped to physical time through the half-mass relaxation
// time, so stellar evolution and two-body relaxation keep their real ratio.
// The tidal field is scaled to preserve r_t / r_h.

import { buildCluster, halfMassRadius, potentialEnergy } from './ics.js';
import { G_PC_MSUN_MYR, KMS_TO_PC_MYR, relaxationTime } from './units.js';
import {
  KIND, Z_DEFAULT, defaultHelium, msLifetime, evolveStar, photometry, turnoffMass,
} from './stellar.js';
import { massSegregation } from './analysis.js';

export const DEFAULTS = {
  n: 2000,
  seed: 2446,
  z: Z_DEFAULT,
  yP1: defaultHelium(Z_DEFAULT),
  yP2: 0.32,
  p2Scale: 0.5,
  nReal: 40000,
  rhP1pc: 5.0,
  tidal: false,
  rgKpc: 20,
  vcKms: 220,
  retainBH: false,
  eta: 0.2,
  evolve: true,
};

export class Simulation {
  constructor(params = {}) {
    this.p = { ...DEFAULTS, ...params };
    const p = this.p;
    const c = buildCluster({ n: p.n, p2Scale: p.p2Scale, seed: p.seed });
    const cap = c.n;
    this.n = c.n;
    this.x = c.x; this.y = c.y; this.z = c.z;
    this.vx = c.vx; this.vy = c.vy; this.vz = c.vz;
    this.ax = new Float64Array(cap); this.ay = new Float64Array(cap); this.az = new Float64Array(cap);
    this.m = c.m;
    this.mass = c.mass;
    this.m0 = Float64Array.from(c.mass);
    this.pop = c.pop;
    this.kind = new Uint8Array(cap);
    this.phase = new Float64Array(cap);
    this.massNorm = c.massTotal; // Msun per unit simulation mass
    this.tms = new Float64Array(cap);
    for (let i = 0; i < cap; i++) {
      this.tms[i] = msLifetime(this.m0[i], this.pop[i] === 0 ? p.yP1 : p.yP2, p.z);
    }
    this.eps = 0.012 * Math.cbrt(2000 / p.n);
    this.eps2 = this.eps * this.eps;

    // Physical scalings.
    const all = [...Array(cap).keys()];
    const p1 = all.filter((i) => this.pop[i] === 0);
    const rhSim = halfMassRadius(all, this.x, this.y, this.z, this.m);
    const rhP1Sim = halfMassRadius(p1, this.x, this.y, this.z, this.m);
    this.pcPerUnit = p.rhP1pc / rhP1Sim;
    this.starsPerParticle = p.nReal / p.n;
    this.massPhys = (c.massTotal / p.n) * p.nReal;
    const trhPhys = relaxationTime(
      p.nReal, rhSim * this.pcPerUnit, this.massPhys, G_PC_MSUN_MYR, Math.log(0.11 * p.nReal),
    );
    const lnSim = Math.log(Math.min(0.11 * p.n, rhSim / this.eps));
    const trhSim = relaxationTime(p.n, rhSim, 1, 1, lnSim);
    this.myrPerUnit = trhPhys / trhSim;
    this.trhMyr = trhPhys;
    this.rh0 = rhSim;

    this.omega2 = 0;
    this.omega = 0;
    if (p.tidal) {
      const omegaPhys = (p.vcKms * KMS_TO_PC_MYR) / (p.rgKpc * 1000);
      const rtPhys = Math.cbrt((G_PC_MSUN_MYR * this.massPhys) / (2 * omegaPhys * omegaPhys));
      const rtSim = rtPhys / this.pcPerUnit;
      this.omega2 = 1 / (2 * rtSim ** 3);
      this.omega = Math.sqrt(this.omega2);
    }

    this.t = 0;
    this.steps = 0;
    this.statsEvery = 10 / this.myrPerUnit; // ~10 Myr
    this.nextStats = 0;
    this.center = [0, 0, 0];
    this.massLost = { stellar: 0, escaped: 0, kicked: 0 };
    this.history = [];
    this.updateStars();
    this.computeAcc();
    this.dt = this.chooseDt();
  }

  get tMyr() {
    return this.t * this.myrPerUnit;
  }

  computeAcc() {
    const { n, x, y, z, m, ax, ay, az, eps2 } = this;
    ax.fill(0, 0, n); ay.fill(0, 0, n); az.fill(0, 0, n);
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i], zi = z[i], mi = m[i];
      let axi = 0, ayi = 0, azi = 0;
      for (let j = i + 1; j < n; j++) {
        const dx = x[j] - xi, dy = y[j] - yi, dz = z[j] - zi;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const inv3 = 1 / (r2 * Math.sqrt(r2));
        const fj = m[j] * inv3, fi = mi * inv3;
        axi += dx * fj; ayi += dy * fj; azi += dz * fj;
        ax[j] -= dx * fi; ay[j] -= dy * fi; az[j] -= dz * fi;
      }
      ax[i] += axi; ay[i] += ayi; az[i] += azi;
    }
    if (this.omega2) {
      // Hill's equations for a circular orbit in a flat rotation curve:
      // tidal 2Ω²x radially, -Ω²z vertically (Coriolis is applied in kick()).
      const tx = 2 * this.omega2, tz = this.omega2;
      for (let i = 0; i < n; i++) {
        ax[i] += tx * x[i];
        az[i] -= tz * z[i];
      }
    }
  }

  chooseDt() {
    let amax2 = 0;
    for (let i = 0; i < this.n; i++) {
      const a2 = this.ax[i] ** 2 + this.ay[i] ** 2 + this.az[i] ** 2;
      if (a2 > amax2) amax2 = a2;
    }
    const dt = this.p.eta * Math.sqrt(this.eps / Math.sqrt(amax2 || 1));
    return Math.min(1 / 32, Math.max(1e-5, dt));
  }

  kick(h, coriolisFirst) {
    const { n, vx, vy, vz, ax, ay, az } = this;
    const rotate = () => {
      if (!this.omega) return;
      // Coriolis rotates velocities at -2Ω about z; apply it exactly.
      const c = Math.cos(-2 * this.omega * h), s = Math.sin(-2 * this.omega * h);
      for (let i = 0; i < n; i++) {
        const u = vx[i], v = vy[i];
        vx[i] = c * u - s * v;
        vy[i] = s * u + c * v;
      }
    };
    if (coriolisFirst) rotate();
    for (let i = 0; i < n; i++) {
      vx[i] += ax[i] * h; vy[i] += ay[i] * h; vz[i] += az[i] * h;
    }
    if (!coriolisFirst) rotate();
  }

  step() {
    const dt = this.dt;
    const h = dt / 2;
    this.kick(h, false);
    const { n, x, y, z, vx, vy, vz } = this;
    for (let i = 0; i < n; i++) {
      x[i] += vx[i] * dt; y[i] += vy[i] * dt; z[i] += vz[i] * dt;
    }
    this.computeAcc();
    this.kick(h, true);
    this.t += dt;
    this.steps++;
    this.dt = this.chooseDt();
    if (this.t >= this.nextStats) {
      this.tick();
      this.computeAcc();
      return true;
    }
    return false;
  }

  // Periodic bookkeeping: stellar evolution, escapers, diagnostics.
  // Leaves accelerations stale; the caller recomputes them.
  tick() {
    this.nextStats += this.statsEvery;
    this.updateStars();
    this.removeEscapers();
    const point = this.measure();
    this.history.push(point);
    return point;
  }

  remove(i) {
    const last = this.n - 1;
    for (const a of [this.x, this.y, this.z, this.vx, this.vy, this.vz, this.m, this.mass,
      this.m0, this.pop, this.kind, this.phase, this.tms]) {
      a[i] = a[last];
    }
    this.n--;
  }

  updateStars() {
    if (!this.p.evolve) return;
    const t = this.tMyr;
    for (let i = this.n - 1; i >= 0; i--) {
      const s = evolveStar(this.m0[i], this.tms[i], t);
      if (s.mass !== this.mass[i]) {
        this.massLost.stellar += this.mass[i] - s.mass;
      }
      this.kind[i] = s.kind;
      this.phase[i] = s.phase;
      this.mass[i] = s.mass;
      this.m[i] = s.mass / this.massNorm;
      // Supernova natal kicks exceed the escape speed by far: remove the remnant.
      if (s.kind === KIND.NS || (s.kind === KIND.BH && !this.p.retainBH)) {
        this.massLost.kicked += s.mass;
        this.remove(i);
      }
    }
  }

  findCenter() {
    const { n, x, y, z, m } = this;
    let cx = 0, cy = 0, cz = 0, mt = 0;
    for (let i = 0; i < n; i++) { cx += m[i] * x[i]; cy += m[i] * y[i]; cz += m[i] * z[i]; mt += m[i]; }
    cx /= mt; cy /= mt; cz /= mt;
    // Shrinking-sphere density centre.
    let r = 0;
    for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(x[i] - cx, y[i] - cy, z[i] - cz));
    const minCount = Math.max(30, n / 50);
    for (let iter = 0; iter < 40; iter++) {
      r *= 0.85;
      let sx = 0, sy = 0, sz = 0, sm = 0, count = 0;
      const r2 = r * r;
      for (let i = 0; i < n; i++) {
        const dx = x[i] - cx, dy = y[i] - cy, dz = z[i] - cz;
        if (dx * dx + dy * dy + dz * dz < r2) { sx += m[i] * x[i]; sy += m[i] * y[i]; sz += m[i] * z[i]; sm += m[i]; count++; }
      }
      if (count < minCount) break;
      cx = sx / sm; cy = sy / sm; cz = sz / sm;
    }
    this.center = [cx, cy, cz];
    return this.center;
  }

  boundMass() {
    let mt = 0;
    for (let i = 0; i < this.n; i++) mt += this.m[i];
    return mt;
  }

  tidalRadius() {
    return this.omega2 ? Math.cbrt(this.boundMass() / (2 * this.omega2)) : Infinity;
  }

  removeEscapers() {
    const [cx, cy, cz] = this.findCenter();
    const mt = this.boundMass();
    const rt = this.tidalRadius();
    const rCut = this.omega2 ? 2 * rt : 20 * this.rh0;
    for (let i = this.n - 1; i >= 0; i--) {
      const r = Math.hypot(this.x[i] - cx, this.y[i] - cy, this.z[i] - cz);
      if (r < rCut) continue;
      if (!this.omega2) {
        const v2 = this.vx[i] ** 2 + this.vy[i] ** 2 + this.vz[i] ** 2;
        if (0.5 * v2 < mt / r) continue; // still bound in isolation
      }
      this.massLost.escaped += this.mass[i];
      this.remove(i);
    }
  }

  // Indices of stars counted as cluster members (inside r_t when there is a tide).
  members() {
    const [cx, cy, cz] = this.center;
    const rt = this.tidalRadius();
    const out = [];
    for (let i = 0; i < this.n; i++) {
      if (rt === Infinity || Math.hypot(this.x[i] - cx, this.y[i] - cy, this.z[i] - cz) < rt) out.push(i);
    }
    return out;
  }

  measure() {
    const [cx, cy, cz] = this.center;
    const mem = this.members();
    const p1 = mem.filter((i) => this.pop[i] === 0);
    const p2 = mem.filter((i) => this.pop[i] === 1);
    const rh = (idx) => halfMassRadius(idx, this.x, this.y, this.z, this.m, cx, cy, cz) * this.pcPerUnit;
    const meanMs = (idx) => {
      let s = 0, k = 0;
      for (const i of idx) if (this.kind[i] === KIND.MS) { s += this.mass[i]; k++; }
      return k ? s / k : 0;
    };
    const massOf = (idx) => idx.reduce((s, i) => s + this.mass[i], 0) * this.starsPerParticle;
    const seg = (idx) => massSegregation(idx, this, rh(idx) / this.pcPerUnit);
    const t = this.tMyr;
    return {
      tGyr: t / 1000,
      n: mem.length,
      mass: massOf(mem),
      rh: { all: rh(mem), p1: rh(p1), p2: rh(p2) },
      rt: this.omega2 ? this.tidalRadius() * this.pcPerUnit : null,
      turnoff: { p1: turnoffMass(t, this.p.yP1, this.p.z), p2: turnoffMass(t, this.p.yP2, this.p.z) },
      meanMs: { p1: meanMs(p1), p2: meanMs(p2) },
      dAlpha: { all: seg(mem), p1: seg(p1), p2: seg(p2) },
      nPop: { p1: p1.length, p2: p2.length },
    };
  }

  // Positions relative to the density centre, in pc, plus photometry.
  snapshot() {
    const n = this.n;
    const pos = new Float32Array(3 * n);
    const meta = new Uint8Array(2 * n);
    const phot = new Float32Array(2 * n);
    const mass = Float32Array.from(this.mass.subarray(0, n));
    const [cx, cy, cz] = this.center;
    const s = this.pcPerUnit;
    for (let i = 0; i < n; i++) {
      pos[3 * i] = (this.x[i] - cx) * s;
      pos[3 * i + 1] = (this.y[i] - cy) * s;
      pos[3 * i + 2] = (this.z[i] - cz) * s;
      meta[2 * i] = this.pop[i];
      meta[2 * i + 1] = this.kind[i];
      const ph = photometry(this.m0[i], this.mass[i], this.kind[i], this.phase[i]);
      phot[2 * i] = ph.logL;
      phot[2 * i + 1] = ph.logT;
    }
    return { n, pos, meta, phot, mass, tGyr: this.tMyr / 1000, rt: this.omega2 ? this.tidalRadius() * s : null };
  }

  // Total energy, including the tidal (Jacobi) term. For tests.
  energy() {
    const { n, x, y, z, vx, vy, vz, m } = this;
    let k = 0, tid = 0;
    for (let i = 0; i < n; i++) {
      k += 0.5 * m[i] * (vx[i] ** 2 + vy[i] ** 2 + vz[i] ** 2);
      if (this.omega2) tid += m[i] * (-this.omega2 * x[i] * x[i] + 0.5 * this.omega2 * z[i] * z[i]);
    }
    return k + tid + potentialEnergy(n, x, y, z, m, this.eps2);
  }

  info() {
    return {
      n: this.p.n,
      myrPerUnit: this.myrPerUnit,
      trhMyr: this.trhMyr,
      pcPerUnit: this.pcPerUnit,
      massPhys: this.massPhys,
      rtPc: this.omega2 ? this.tidalRadius() * this.pcPerUnit : null,
      eps: this.eps,
    };
  }
}
