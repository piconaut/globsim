// Physical constants and N-body <-> physical scalings.
// Simulation units are Hénon units: G = 1, initial total mass = 1, E0 = -1/4.

export const G_PC_MSUN_MYR = 4.498502151469554e-3; // pc^3 / (Msun Myr^2)
export const KMS_TO_PC_MYR = 1.0227121650537077;

// Spitzer half-mass relaxation time, in whatever units G, M and r_h are given in.
export function relaxationTime(n, rh, totalMass, G, lnLambda) {
  return (0.138 * n * Math.pow(rh, 1.5)) / (Math.sqrt(G * totalMass) * lnLambda);
}
