// Schematic single-star evolution.
//
// Dynamics only feel stellar masses, so the parts that matter are the
// main-sequence lifetime and the mass a star ends up with. As in NBODY6MP,
// helium changes the MS lifetime only (Fare, Webb & Sills 2018, eq. 1);
// luminosities and temperatures are cosmetic, for the HR diagram and colours.

export const KIND = { MS: 0, RGB: 1, HB: 2, WD: 3, NS: 4, BH: 5 };

export const Z_DEFAULT = 0.0001;
export const defaultHelium = (z) => 0.24 + 2 * z;

// Eggleton, Fitchett & Tout (1989) time to the base of the giant branch, Myr (Z = 0.02).
function tmsEFT(m) {
  return (2550 + 669 * Math.pow(m, 2.5) + Math.pow(m, 4.5)) /
    (0.0327 * Math.pow(m, 1.5) + 0.346 * Math.pow(m, 4.5));
}

// Rescale so a 0.8 Msun star leaves the MS at 12 Gyr, typical for Z ~ 1e-4.
const METAL_POOR = 12000 / tmsEFT(0.8);

// Fare, Webb & Sills (2018) eq. 1: MS lifetime relative to Y = 0.248.
export function heliumLifetimeRatio(y) {
  const d = y - 0.248;
  return Math.pow(10, -1.074 * d - 2.776 * d * d);
}

// MS lifetime in Myr. The helium factor is taken relative to the population's
// default helium so the normal-helium baseline stays exactly the SSE-like fit.
export function msLifetime(m0, y, z = Z_DEFAULT) {
  return tmsEFT(m0) * METAL_POOR * heliumLifetimeRatio(y) / heliumLifetimeRatio(defaultHelium(z));
}

// Mass of stars leaving the MS at time t (Myr), by bisection in log mass.
export function turnoffMass(tMyr, y, z = Z_DEFAULT) {
  let lo = Math.log(0.08);
  let hi = Math.log(100);
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (msLifetime(Math.exp(mid), y, z) > tMyr) lo = mid;
    else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}

const F_RGB = 0.085; // SGB + RGB duration, as a fraction of the MS lifetime
const F_HB = 0.012;
const CORE_HB = 0.49; // helium core mass at the tip of the RGB

// Kalirai et al. (2008) initial-final mass relation.
export const whiteDwarfMass = (m0) => Math.min(1.38, 0.109 * m0 + 0.394);

export function remnantFor(m0) {
  if (m0 < 8) return { kind: KIND.WD, mass: whiteDwarfMass(m0) };
  if (m0 < 20) return { kind: KIND.NS, mass: 1.35 };
  return { kind: KIND.BH, mass: Math.max(5, 0.4 * m0) };
}

// Stellar state at time t (Myr) for a star of initial mass m0 and MS lifetime tms.
export function evolveStar(m0, tms, tMyr) {
  if (tMyr < tms) return { kind: KIND.MS, mass: m0, phase: tMyr / tms };
  const post = (tMyr - tms) / tms;
  if (m0 >= 8) {
    if (post < 0.1) return { kind: KIND.RGB, mass: m0, phase: post / 0.1 };
    return { ...remnantFor(m0), phase: (tMyr - tms * 1.1) };
  }
  // Red-giant mass loss: low-mass stars shed up to 0.2 Msun on the RGB.
  const hbMass = m0 < 2 ? Math.max(CORE_HB + 0.005, m0 - 0.2) : m0;
  if (post < F_RGB) {
    const g = post / F_RGB;
    return { kind: KIND.RGB, mass: m0 + (hbMass - m0) * g, phase: g };
  }
  if (post < F_RGB + F_HB) return { kind: KIND.HB, mass: hbMass, phase: (post - F_RGB) / F_HB };
  const tCool = tMyr - tms * (1 + F_RGB + F_HB);
  return { kind: KIND.WD, mass: whiteDwarfMass(m0), phase: tCool };
}

// ---- Cosmetic photometry: log10 L/Lsun and log10 Teff/K ----

function zamsLum(m) {
  if (m < 0.43) return 0.23 * Math.pow(m, 2.3);
  if (m < 2) return Math.pow(m, 4);
  if (m < 20) return 1.4 * Math.pow(m, 3.5);
  return 32000 * m;
}

const zamsRadius = (m) => (m < 1 ? Math.pow(m, 0.8) : Math.pow(m, 0.57));
const teffFrom = (logL, logR) => Math.log10(5772) + 0.25 * logL - 0.5 * logR;

export function photometry(m0, mass, kind, phase) {
  if (kind === KIND.MS || (kind === KIND.RGB && m0 >= 8)) {
    const tau = kind === KIND.MS ? phase : 1;
    // Metal-poor stars run a little hotter than this solar-ish relation.
    const logL = Math.log10(zamsLum(m0)) + 0.5 * tau * tau;
    const logR = Math.log10(zamsRadius(m0)) + 0.22 * tau * tau * tau - 0.06;
    if (kind === KIND.RGB) return { logL: logL + 0.3, logT: 3.65 };
    return { logL, logT: teffFrom(logL, logR) };
  }
  if (kind === KIND.RGB) {
    const lTO = Math.log10(zamsLum(m0)) + 0.5;
    const rTO = Math.log10(zamsRadius(m0)) + 0.16;
    const tTO = teffFrom(lTO, rTO);
    if (phase < 0.15) {
      // Subgiant branch: cool at roughly constant luminosity.
      const s = phase / 0.15;
      return { logL: lTO + 0.15 * s, logT: tTO + (3.71 - tTO) * s };
    }
    const g = (phase - 0.15) / 0.85;
    return { logL: lTO + 0.15 + (3.3 - lTO - 0.15) * g * g * g, logT: 3.71 - 0.09 * g };
  }
  if (kind === KIND.HB) {
    // Thinner envelopes give bluer horizontal-branch stars.
    const env = Math.max(0, mass - CORE_HB);
    const blue = Math.pow(1 - Math.min(env / 0.25, 1), 1.5);
    return { logL: 1.7 - 0.25 * blue, logT: Math.log10(5600 + 14000 * blue) };
  }
  if (kind === KIND.WD) {
    const gyr = Math.max(phase / 1000, 1e-4);
    const logL = Math.min(1, -3 - 1.4 * Math.log10(gyr));
    return { logL, logT: teffFrom(logL, Math.log10(0.013)) };
  }
  return { logL: -6, logT: 3.5 };
}
