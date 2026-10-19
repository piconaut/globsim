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
| Helium | P2's main-sequence lifetimes are scaled by eq. 1 of the paper, t/t(Y=0.248) = 10^(−1.074 ΔY − 2.776 ΔY²), normalised to the default Y = 0.24 + 2Z. As in NBODY6MP, nothing else about the stars depends on Y. |
| Stellar evolution | Main-sequence lifetimes come from the Eggleton, Fitchett & Tout (1989) fit, rescaled so the turnoff at 12 Gyr is 0.8 M☉ (Z = 10⁻⁴). Below 8 M☉, stars lose 0.2 M☉ on the RGB and end as white dwarfs (Kalirai et al. 2008 IFMR). Stars of 8–20 M☉ become neutron stars and heavier ones become black holes. Natal kicks remove the neutron stars. Black holes are removed too, unless *Keep black holes* is on. |
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

An ensemble of 8 seeds at N = 1000 in isolation (CPU, Node), with P2 at
Y = 0.32 and each run paired with a normal-helium twin. The table gives the
mean ratio of half-mass radii (helium-rich run over twin) ± the standard error,
averaged over ±0.5 Gyr:

| t (Gyr) | whole cluster | P1 | P2 |
|---|---|---|---|
| 2 | 0.976 ± 0.013 | 0.998 ± 0.010 | 0.948 ± 0.022 |
| 6 | 0.997 ± 0.029 | 1.019 ± 0.040 | 0.965 ± 0.037 |
| 10 | 0.979 ± 0.036 | 1.036 ± 0.041 | 0.939 ± 0.038 |

The cluster with a helium-rich P2 comes out slightly smaller, as in the paper,
but only at about 2σ. The mean main-sequence mass of P2 ends up about
0.009 M☉ below P1's (paper: about 0.01 M☉). Unlike the paper, the shrinkage
shows up in P2 rather than P1. P1 is consistent with no change. The likely
causes are the small N and the compressed early mass loss. The turnoff-mass
gap is also smaller than in the paper: 0.05 M☉ at ΔY = 0.08, against 0.15 M☉,
because the lifetime fit here is steeper in mass than SSE's.

#### With the two-stage clock

The same 8 seeds with *Early clock* at 50 Myr:

| t (Gyr) | whole cluster | P1 | P2 |
|---|---|---|---|
| 2 | 0.968 ± 0.012 | 0.980 ± 0.027 | 0.954 ± 0.017 |
| 6 | 0.974 ± 0.012 | 0.959 ± 0.029 | 0.984 ± 0.015 |
| 10 | 0.965 ± 0.017 | 0.947 ± 0.024 | 0.976 ± 0.021 |
| 12 | 0.940 ± 0.022 | 0.917 ± 0.039 | 0.958 ± 0.024 |

With the supernova era at its real crossing time, the whole cluster is
smaller at every time, and from about 6 Gyr on P1 shows the larger difference.
That ordering matches the paper. The early stage has its own cost, though.
At N = 1000 the 50 Myr real-time stage covers 2.6 relaxation times, against
0.13 in a real cluster. The massive stars therefore segregate before they
explode, and the cluster expands much more: r_h reaches about 16 pc at
12 Gyr, against about 11 pc without the early stage. At N = 2000 the stage
covers 1.15 t_rh. A shorter stage or a larger N reduces this.

### Differences from the paper

- The paper used NBODY6 with SSE and the Miholics et al. (2015) Milky Way
  potential. globsim uses schematic stellar evolution and a flat rotation curve.
- The HR diagram is cosmetic. Luminosities and temperatures come from simple
  scaling relations, and only lifetimes and masses feed back into the dynamics.
- There are no primordial binaries and no binary evolution, and softening
  prevents dynamical binaries from forming.

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
  stellar.js          lifetimes, helium scaling, remnants, photometry
  analysis.js         mass-function slope and δα
scripts/              build-artifact.mjs (page without its document wrapper)
tests/                node --test suite
```

## References

- Fare, Webb & Sills 2018, MNRAS, 481, 3027
- Aarseth 2003, *Gravitational N-Body Simulations*
- Baumgardt 2001, MNRAS, 325, 1323
- Eggleton, Fitchett & Tout 1989, ApJ, 347, 998
- Kalirai et al. 2008, ApJ, 676, 594
- King 1966, AJ, 71, 64
- Kroupa 2001, MNRAS, 322, 231
- Miholics, Webb & Sills 2015, MNRAS, 454, 2166
- Webb & Vesperini 2016, MNRAS, 463, 2383
