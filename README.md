# globsim

A globular cluster with two stellar populations, simulated in the browser.

globsim is an interactive version of the experiment in
[Fare, Webb & Sills (2018), *The effect of stellar helium abundance on dynamics of multiple populations in globular clusters*, MNRAS 481, 3027](https://arxiv.org/abs/1809.01055).
A normal-helium population (P1) and a centrally concentrated, helium-rich
population (P2) evolve together for 12 Gyr. Helium-rich stars leave the main
sequence sooner, so P2's massive stars become remnants earlier. That changes
how the cluster mass-segregates and how quickly the two populations mix.

A twin run with P2 at normal helium runs alongside, like the paper's benchmark
simulations. The charts show both: solid lines for the main run, dashed for the
twin.

## Running it

No build step. Serve the folder and open it:

```sh
npm run serve        # python3 -m http.server 8000
# open http://localhost:8000
```

The browser needs WebGL2 with `EXT_color_buffer_float`, which current desktop
and mobile browsers support. Without it, the simulation falls back to the CPU
with at most 1000 particles.

```sh
npm test             # physics unit tests (Node 18+)
```

## What's simulated

| | |
|---|---|
| Gravity | Direct summation, Plummer softening, kick-drift-kick leapfrog with a shared adaptive step. The force sum and update run in WebGL2 fragment shaders. |
| Initial conditions | As in the paper: P1 is a King (1966) W₀ = 7 model with r_h = 5 pc. P2 is the same model shrunk by a factor (0.5 by default), 50:50 by number. Masses come from a Kroupa (2001) IMF over 0.1–50 M☉. The combined system is rescaled to virial equilibrium. |
| Helium | P2's main-sequence lifetimes are scaled by eq. 1 of the paper, t/t(Y=0.248) = 10^(−1.074 ΔY² − 2.776 ΔY), normalised to the default Y = 0.24 + 2Z. With SSE this is NBODY6MP's own code in star.f, whose coefficients are −1.0598 and −2.7810. As in NBODY6MP, nothing else about the stars depends on Y. |
| Stellar evolution | SSE (Hurley, Pols & Tout 2000), translated line by line from NBODY6MP's Fortran (see below). Each star is updated at its own look-up times, as in NBODY6's MDOT and TRDOT: wind mass loss capped at 2% per update, rejuvenation of main-sequence and Hertzsprung-gap stars, and SSE's white-dwarf, neutron-star and black-hole masses. Natal kicks remove the neutron stars. Black holes are removed too, unless *Keep black holes* is on. *Schematic lifetimes* switches to the earlier simple model, based on Eggleton, Fitchett & Tout (1989) lifetimes and the Kalirai et al. (2008) initial-final mass relation. |
| Tidal field | A circular orbit at R_G in a flat rotation curve (220 km/s), using Hill's equations in the rotating frame. Stars beyond 2 r_t are removed. |
| Diagnostics | Half-mass radii about the density centre, the mass-segregation gradient δα = dα/d ln(r/r_m) for 0.3–0.8 M☉ main-sequence stars (Webb & Vesperini 2016), turnoff masses, and an HR diagram. |

### Scaling a small N to a real cluster

The paper used 40 000 stars. A browser can integrate a few thousand for
12 Gyr, so globsim maps simulation time to physical time through the
half-mass relaxation time of the 40 000-star cluster. That keeps relaxation and
stellar evolution in their real proportion, which is what sets mass
segregation. The Coulomb logarithm of the softened simulation uses
ln(min(0.11 N, r_h/ε)). The tidal field is scaled to preserve r_t/r_h.

The *Early clock* setting runs the first 25, 50 or 100 Myr at the physical
Hénon time unit, √(r³/GM) ≈ 0.7–0.9 Myr, instead, and then switches to
relaxation scaling. During that stage the supernova era spans its real number
of crossing times, but relaxation runs too fast relative to stellar evolution.

The costs of the scaling:

- A cluster's crossing time is compressed relative to its relaxation time,
  so the early mass loss from massive stars hits the cluster faster than it
  would in reality.
- Escape in a tidal field does not scale purely with t_rh (Baumgardt 2001),
  so tidal mass loss is approximate.
- Particle noise is high. δα in particular is noisy, and the chart shows a running mean.

Expect the trends from the paper, not its numbers.

### How it compares with the paper

Ensembles of 8 seeds at N = 1000 in isolation (CPU, Node), with SSE and P2 at
Y = 0.32. Each run is paired with a normal-helium twin from the same initial
conditions. The tables give the mean ratio of half-mass radii (helium-rich run
over twin) ± the standard error, averaged over ±0.5 Gyr.

Relaxation-scaled from t = 0:

| t (Gyr) | whole cluster | P1 | P2 |
|---|---|---|---|
| 2 | 0.955 ± 0.019 | 0.988 ± 0.025 | 0.947 ± 0.017 |
| 6 | 0.983 ± 0.023 | 0.989 ± 0.026 | 0.999 ± 0.032 |
| 10 | 0.982 ± 0.028 | 0.969 ± 0.035 | 1.001 ± 0.032 |
| 12 | 0.969 ± 0.043 | 0.958 ± 0.056 | 0.987 ± 0.035 |

*Early clock* at 50 Myr:

| t (Gyr) | whole cluster | P1 | P2 |
|---|---|---|---|
| 2 | 0.947 ± 0.030 | 0.921 ± 0.029 | 0.963 ± 0.039 |
| 6 | 0.950 ± 0.024 | 0.922 ± 0.018 | 0.973 ± 0.038 |
| 10 | 0.925 ± 0.021 | 0.901 ± 0.024 | 0.958 ± 0.032 |
| 12 | 0.924 ± 0.023 | 0.891 ± 0.022 | 0.966 ± 0.040 |

In both, the cluster with a helium-rich P2 is smaller, as in the paper. P2's
mean main-sequence mass ends up 0.014–0.016 M☉ below P1's (paper: about
0.01 M☉).

Without the early clock, the P1 and P2 differences are within the noise. With
it, P1 shows the largest difference from 1 Gyr on, at 4–5σ, which is the
paper's ordering. The effect is larger than the paper's, though. At N = 1000
the 50 Myr stage covers 2.6 relaxation times, against 0.13 in a real cluster.
The cluster therefore expands to r_h ≈ 15 pc by 1 Gyr, against ≈ 7 pc without
the early clock. These runs show the direction of the effect more reliably
than its size.

The superseded results from before the eq. 1 fix are in the git history.

### Differences from the paper

- The paper used the Miholics et al. (2015) Milky Way potential. globsim uses
  a flat rotation curve and Hill's approximation.
- Stellar updates happen at bookkeeping ticks, every ~10 Myr (~1 Myr during
  the early clock), rather than at each star's exact look-up time.
- With *Schematic lifetimes*, the HR diagram is cosmetic. With SSE, it shows
  SSE's luminosities and radii.
- There are no primordial binaries and no binary evolution, and softening
  prevents dynamical binaries from forming.

### The SSE port

`vendor/sse` holds NBODY6MP's copies of zcnsts.f, zfuncs.f, star.f, hrdiag.f,
mlwind.f and mrenv.f, unchanged. `sevolve.f` is written for globsim: a
single-star version of NBODY6's INSTAR, MDOT and TRDOT. `scripts/f2js.py`
translates all of it into `src/physics/sse/sse.gen.js`:

```sh
python3 scripts/f2js.py --skip celamf src/physics/sse/sse.gen.js \
  vendor/sse/{zcnsts,zfuncs,star,hrdiag,mlwind,mrenv,sevolve}.f
```

`vendor/sse/ref_tracks.f` evolves 17 masses at both helium abundances with
the original Fortran. `scripts/sse-reference.sh` (needs gfortran) stores a
sample of the output in `tests/fixtures`, and `tests/sse.test.mjs` checks
the JavaScript against it. The tracks agree to about 10⁻¹³. In one track, a
star that lands exactly on a phase boundary changes type one minimal step
later in Fortran, and its final state still agrees to 10⁻⁹.

## Layout

```
index.html            page, styles, controls
src/main.js           UI wiring and the main loop
src/gpu.js            WebGL2 integrator (force and leapfrog shaders)
src/render.js         star renderer
src/charts.js         canvas charts with hover readouts
src/physics/          everything that also runs in Node
  sim.js              Simulation: integrator, tides, escapers, diagnostics
  ics.js              King-model initial conditions for two populations
  king.js             King (1966) model solver and sampler
  imf.js              Kroupa IMF
  stellar.js          schematic lifetimes, helium scaling, remnants, photometry
  sse/                SSE: generated sse.gen.js and the wrapper in index.js
  analysis.js         mass-function slope and δα
scripts/              build-artifact.mjs (page without its document wrapper),
                      f2js.py (Fortran to JavaScript), sse-reference.sh
vendor/sse/           SSE Fortran from NBODY6MP, plus the single-star driver
tests/                node --test suite
```

## References

- Fare, Webb & Sills 2018, MNRAS, 481, 3027
- Aarseth 2003, *Gravitational N-Body Simulations*
- Baumgardt 2001, MNRAS, 325, 1323
- Eggleton, Fitchett & Tout 1989, ApJ, 347, 998
- Hurley, Pols & Tout 2000, MNRAS, 315, 543
- Kalirai et al. 2008, ApJ, 676, 594
- King 1966, AJ, 71, 64
- Kroupa 2001, MNRAS, 322, 231
- Miholics, Webb & Sills 2015, MNRAS, 454, 2166
- Webb & Vesperini 2016, MNRAS, 463, 2383
