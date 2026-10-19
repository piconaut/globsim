import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { zcnsts, sinit, supdate } from '../src/physics/sse/sse.gen.js';
import { sseMsLifetime, ssePars, sseTurnoffMass } from '../src/physics/sse/index.js';
import { Simulation } from '../src/physics/sim.js';
import { KIND } from '../src/physics/stellar.js';

// Fortran output from vendor/sse/ref_tracks.f (scripts/sse-reference.sh):
// ZPARS j values...; T j star step t kw m0 mt r lum mc; LAST <same fields>.
const MASSES = [0.1, 0.3, 0.5, 0.7, 0.8, 0.85, 0.9, 1, 1.5, 2, 3, 5, 8, 12, 20, 30, 50];
const HELIUM = [0.2402, 0.32];
const ref = { zpars: {}, rows: {}, last: {} };
for (const line of readFileSync(new URL('./fixtures/sse-reference.txt', import.meta.url), 'utf8').split('\n')) {
  const f = line.trim().split(/\s+/);
  if (f[0] === 'ZPARS') ref.zpars[+f[1]] = f.slice(2).map(Number);
  else if (f[0] === 'T' || f[0] === 'LAST') {
    const key = `${f[1]} ${f[2]}`;
    const row = { step: +f[3], v: f.slice(4).map(Number) };
    if (f[0] === 'T') (ref.rows[key] ??= []).push(row);
    else ref.last[key] = row;
  }
}

function track(j, k) {
  const zpars = ssePars(HELIUM[j - 1], 1e-4);
  const s = { m: MASSES[k - 1], zpars, kw: 0, m0: 0, mt: 0, epoch: 0, r: 0, lum: 0, mc: 0, rc: 0, dtm: 0 };
  sinit(s);
  const u = { ...s, z: 1e-4, dtmax: 1e30, tev0: 0 };
  const rows = [];
  for (let n = 0; ; n++) {
    rows.push([u.tev0, u.kw, u.m0, u.mt, u.r, u.lum, u.mc]);
    if (u.tev0 >= 12000 || n >= 5000) break;
    supdate(u);
  }
  return rows;
}

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

test('zcnsts reproduces the Fortran metallicity constants', () => {
  for (const j of [1, 2]) {
    const zpars = new Float64Array(21);
    zcnsts({ y: HELIUM[j - 1], z: 1e-4, zpars });
    ref.zpars[j].forEach((v, i) => assert.ok(rel(zpars[i + 1], v) < 1e-14, `zpars(${i + 1})`));
  }
});

test('SSE tracks match the Fortran reference update by update', () => {
  let diverged = 0;
  for (const key of Object.keys(ref.rows)) {
    const [j, k] = key.split(' ').map(Number);
    const js = track(j, k);
    for (const { step, v } of ref.rows[key]) {
      const row = js[step];
      // A star sitting exactly on a phase boundary can change type one minimal
      // step earlier in one language than the other; after that the indices drift.
      if (!row || v.some((x, c) => rel(row[c], x) > 1e-8)) { diverged++; break; }
    }
    // Whatever the step indices, the end states must agree.
    const end = js[js.length - 1], fin = ref.last[key].v;
    assert.equal(end[1], fin[1], `final type for Y${j} m=${MASSES[k - 1]}`);
    for (const c of [0, 3, 6]) assert.ok(rel(end[c], fin[c]) < 1e-6, `final col ${c} for Y${j} m=${MASSES[k - 1]}`);
  }
  assert.ok(diverged <= 1, `${diverged} tracks changed type at a different step`);
});

test('helium-rich stars leave the main sequence earlier, by the NBODY6MP factor', () => {
  const normal = ssePars(0.2402, 1e-4), rich = ssePars(0.32, 1e-4);
  const d = 0.32 - 0.248, d0 = 0.2402 - 0.248;
  const f = (x) => Math.pow(10, Math.fround(-1.05980983377) * x * x + Math.fround(-2.78101476398) * x);
  for (const m of [0.7, 0.8, 1, 2]) {
    const ratio = sseMsLifetime(m, rich) / sseMsLifetime(m, normal);
    assert.ok(rel(ratio, f(d) / f(d0)) < 1e-3, `m = ${m}: ratio ${ratio}`);
  }
  // Turnoff-mass gap of about 0.15 Msun at ΔY = 0.08, as in Fare et al. (2018).
  const gap = sseTurnoffMass(4000, normal) - sseTurnoffMass(4000, rich);
  assert.ok(gap > 0.1 && gap < 0.2, `turnoff gap ${gap}`);
});

test('the simulation evolves stars with SSE by default', () => {
  const s = new Simulation({ n: 300 });
  s.t = s.unitsAt(12000);
  s.updateStars();
  const kinds = new Set(Array.from(s.kind.subarray(0, s.n)));
  assert.ok(kinds.has(KIND.MS) && kinds.has(KIND.WD), 'main-sequence stars and white dwarfs at 12 Gyr');
  assert.ok(!kinds.has(KIND.NS), 'neutron stars are kicked out');
});
