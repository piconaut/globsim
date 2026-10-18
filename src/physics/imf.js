// Kroupa (2001) IMF: dN/dm ∝ m^-1.3 below 0.5 Msun, m^-2.3 above.

const BREAK = 0.5;
const A1 = 1.3;
const A2 = 2.3;

function powerLawIntegral(a, b, alpha) {
  const p = 1 - alpha;
  return (Math.pow(b, p) - Math.pow(a, p)) / p;
}

function samplePowerLaw(a, b, alpha, u) {
  const p = 1 - alpha;
  const ap = Math.pow(a, p);
  return Math.pow(ap + u * (Math.pow(b, p) - ap), 1 / p);
}

export function makeKroupa(mMin = 0.1, mMax = 50) {
  // Continuity at the break: k2 = k1 * BREAK^(A2 - A1)
  const k2 = Math.pow(BREAK, A2 - A1);
  const w1 = mMin < BREAK ? powerLawIntegral(mMin, Math.min(BREAK, mMax), A1) : 0;
  const w2 = mMax > BREAK ? k2 * powerLawIntegral(Math.max(BREAK, mMin), mMax, A2) : 0;
  const p1 = w1 / (w1 + w2);
  return (rand) => {
    const u = rand();
    const v = rand();
    return u < p1
      ? samplePowerLaw(mMin, Math.min(BREAK, mMax), A1, v)
      : samplePowerLaw(Math.max(BREAK, mMin), mMax, A2, v);
  };
}
