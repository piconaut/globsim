import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '../src/physics/rng.js';
import { makeKroupa } from '../src/physics/imf.js';
import { solveKing } from '../src/physics/king.js';
import { buildCluster, potentialEnergy, halfMassRadius } from '../src/physics/ics.js';
import {
  heliumLifetimeRatio, msLifetime, turnoffMass, evolveStar, KIND, whiteDwarfMass,
} from '../src/physics/stellar.js';
import { powerLawSlope } from '../src/physics/analysis.js';
import { Simulation } from '../src/physics/sim.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('Kroupa IMF has the expected mean mass over 0.1-50 Msun', () => {
  const rng = makeRng(7);
  const imf = makeKroupa(0.1, 50);
  let s = 0;
  const n = 200000;
  for (let i = 0; i < n; i++) s += imf(rng.uniform);
  // Analytic mean for this broken power law is 0.610 Msun.
  close(s / n, 0.610, 0.01, 'mean mass');
});

test('King W0 = 7 has the tabulated concentration', () => {
  const king = solveKing(7);
  // c = log10(rt / r0) = 1.53 for W0 = 7 (King 1966).
  close(Math.log10(king.rt), 1.53, 0.02, 'concentration');
});

test('initial conditions are virialised in Hénon units, P2 at half radius', () => {
  const c = buildCluster({ n: 1200, seed: 3 });
  let t = 0;
  for (let i = 0; i < c.n; i++) t += 0.5 * c.m[i] * (c.vx[i] ** 2 + c.vy[i] ** 2 + c.vz[i] ** 2);
  const w = potentialEnergy(c.n, c.x, c.y, c.z, c.m);
  close(t + w, -0.25, 1e-9, 'energy');
  close(-2 * t / w, 1, 1e-9, 'virial ratio');
  const idx = (p) => [...Array(c.n).keys()].filter((i) => c.pop[i] === p);
  const r1 = halfMassRadius(idx(0), c.x, c.y, c.z, c.m);
  const r2 = halfMassRadius(idx(1), c.x, c.y, c.z, c.m);
  close(r2 / r1, 0.5, 0.08, 'P2 / P1 half-mass radius');
});

test('helium lifetime ratio matches Fare et al. (2018) eq. 1', () => {
  assert.equal(heliumLifetimeRatio(0.248), 1);
  close(heliumLifetimeRatio(0.32), Math.pow(10, -1.074 * 0.072 - 2.776 * 0.072 ** 2), 1e-12, 'Y = 0.32');
  // Helium-rich stars live shorter lives at every mass.
  for (const m of [0.6, 0.8, 1, 5]) assert.ok(msLifetime(m, 0.32) < msLifetime(m, 0.2402));
});

test('turnoff mass is 0.8 Msun at 12 Gyr and lower for helium-rich stars', () => {
  close(turnoffMass(12000, 0.2402), 0.8, 0.002, 'P1 turnoff');
  assert.ok(turnoffMass(12000, 0.32) < turnoffMass(12000, 0.2402));
  close(msLifetime(turnoffMass(5000, 0.3), 0.3), 5000, 1, 'inverse');
});

test('stars end as the right remnants', () => {
  const late = 1e5;
  assert.equal(evolveStar(0.85, msLifetime(0.85, 0.24), late).kind, KIND.WD);
  close(evolveStar(0.85, msLifetime(0.85, 0.24), late).mass, whiteDwarfMass(0.85), 1e-12, 'WD mass');
  assert.equal(evolveStar(12, msLifetime(12, 0.24), late).kind, KIND.NS);
  assert.equal(evolveStar(40, msLifetime(40, 0.24), late).kind, KIND.BH);
  assert.equal(evolveStar(0.5, msLifetime(0.5, 0.24), 12000).kind, KIND.MS);
});

test('mass-function slope estimator recovers a known slope', () => {
  const rng = makeRng(11);
  const alpha = -1.8;
  const p = alpha + 1;
  const ms = [];
  for (let i = 0; i < 20000; i++) {
    const u = rng.uniform();
    ms.push(Math.pow(0.3 ** p + u * (0.8 ** p - 0.3 ** p), 1 / p));
  }
  close(powerLawSlope(ms), alpha, 0.05, 'slope');
});

test('leapfrog conserves energy in isolation and in a tidal field', () => {
  for (const tidal of [false, true]) {
    const s = new Simulation({ n: 400, evolve: false, tidal, rgKpc: 8, seed: 5 });
    const e0 = s.energy();
    while (s.t < 2) s.step();
    const de = Math.abs((s.energy() - e0) / e0);
    assert.ok(de < 2e-3, `tidal=${tidal}: dE/E = ${de}`);
  }
});

test('time scaling maps the simulation to a 40 000-star cluster', () => {
  const s = new Simulation({ n: 1000 });
  const info = s.info();
  // t_rh of the physical cluster: ~0.4 Gyr for M ~ 2.5e4 Msun, r_h ~ 3.6 pc.
  assert.ok(info.trhMyr > 300 && info.trhMyr < 600, `trh = ${info.trhMyr}`);
  close(info.massPhys / 40000, 0.61, 0.1, 'mean physical stellar mass');
  s.step();
  const first = s.history[0];
  close(first.rh.p1, 5, 0.2, 'P1 half-mass radius in pc (about the density centre)');
});

test('two-stage clock runs at the crossing time early, then by relaxation time', () => {
  const s = new Simulation({ n: 1000, earlyMyr: 50 });
  const info = s.info();
  // The physical Hénon time unit of a ~2e4 Msun, few-pc cluster is about 1 Myr.
  assert.ok(info.myrPerUnitFast > 0.5 && info.myrPerUnitFast < 2, `fast = ${info.myrPerUnitFast}`);
  assert.ok(info.myrPerUnit > 5 * info.myrPerUnitFast, 'relaxation scaling is the slower clock');
  // Continuous at the switch, and unitsAt inverts myrAt on both sides of it.
  close(s.myrAt(s.earlyUnits), 50, 1e-9, 'switch time');
  for (const myr of [10, 49.9, 50, 51, 3000]) close(s.myrAt(s.unitsAt(myr)), myr, 1e-9, `round trip ${myr}`);
  // With the early stage off, the mapping is a single linear scale.
  const plain = new Simulation({ n: 1000 });
  close(plain.myrAt(10), 10 * plain.myrPerUnit, 1e-9, 'no early stage');
});
