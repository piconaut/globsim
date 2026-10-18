// Seeded PRNG so a run and its twin start from identical initial conditions.

export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return next;
}

export function makeRng(seed) {
  const uniform = mulberry32(seed);
  return {
    uniform,
    // Random unit vector, isotropic.
    direction() {
      const z = 2 * uniform() - 1;
      const phi = 2 * Math.PI * uniform();
      const s = Math.sqrt(1 - z * z);
      return [s * Math.cos(phi), s * Math.sin(phi), z];
    },
  };
}
