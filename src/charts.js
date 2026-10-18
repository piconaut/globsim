// Small canvas charts with a hover readout. Colours come from CSS tokens.

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function niceTicks(lo, hi, count = 4) {
  const span = hi - lo || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

const PAD = { l: 40, r: 10, t: 10, b: 24 };

function axes(ctx, w, h, sx, sy, xt, yt, xFmt, yFmt) {
  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = css('--muted');
  ctx.strokeStyle = css('--grid');
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of yt) {
    const y = Math.round(sy(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
    ctx.fillText(yFmt(v), PAD.l - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of xt) ctx.fillText(xFmt(v), sx(v), h - PAD.b + 6);
}

// Running mean, for noisy diagnostics like δα.
export function smooth(values, k) {
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(values.length - 1, i + k); j++) {
      if (Number.isFinite(values[j])) { s += values[j]; c++; }
    }
    out[i] = c ? s / c : NaN;
  }
  return out;
}

export class TimeChart {
  // series: [{ label, color: '--token', dash, get: (point) => number, run: 'main' | 'twin' }]
  constructor(canvas, tooltip, { series, xMax, yFmt = (v) => v.toFixed(1), smoothK = 0, unit = '' }) {
    Object.assign(this, { canvas, tooltip, series, xMax, yFmt, smoothK, unit });
    this.runs = { main: [], twin: [] };
    this.hoverX = null;
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hoverX = e.clientX - r.left;
      this.hoverY = e.clientY - r.top;
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => { this.hoverX = null; this.tooltip.hidden = true; this.draw(); });
  }

  reset(xMax) {
    this.runs = { main: [], twin: [] };
    if (xMax) this.xMax = xMax;
    this.draw();
  }

  push(run, point) {
    this.runs[run].push(point);
  }

  values(s) {
    const pts = this.runs[s.run];
    const v = pts.map(s.get);
    return this.smoothK ? smooth(v, this.smoothK) : v;
  }

  draw() {
    const { ctx, w, h } = setupCanvas(this.canvas);
    const visible = this.series.filter((s) => !s.hidden && this.runs[s.run].length);
    let lo = Infinity, hi = -Infinity;
    const cache = new Map();
    for (const s of visible) {
      const v = this.values(s);
      cache.set(s, v);
      for (const y of v) if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const padY = (hi - lo) * 0.08 || 0.5;
    lo -= padY; hi += padY;
    const sx = (x) => PAD.l + (x / this.xMax) * (w - PAD.l - PAD.r);
    const sy = (y) => h - PAD.b - ((y - lo) / (hi - lo)) * (h - PAD.t - PAD.b);
    axes(ctx, w, h, sx, sy, niceTicks(0, this.xMax, 6), niceTicks(lo, hi, 4), (v) => `${v}`, this.yFmt);
    ctx.lineJoin = 'round';
    for (const s of visible) {
      const v = cache.get(s);
      const pts = this.runs[s.run];
      ctx.strokeStyle = css(s.color);
      ctx.lineWidth = s.run === 'main' ? 2 : 1.5;
      ctx.setLineDash(s.run === 'twin' ? [5, 4] : []);
      ctx.globalAlpha = s.run === 'twin' ? 0.8 : 1;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < pts.length; i++) {
        if (!Number.isFinite(v[i])) { started = false; continue; }
        const X = sx(pts[i].tGyr), Y = sy(v[i]);
        if (started) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); started = true; }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
    if (this.hoverX != null && this.hoverX > PAD.l) {
      const t = ((this.hoverX - PAD.l) / (w - PAD.l - PAD.r)) * this.xMax;
      ctx.strokeStyle = css('--muted');
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(this.hoverX) + 0.5, PAD.t); ctx.lineTo(Math.round(this.hoverX) + 0.5, h - PAD.b); ctx.stroke();
      const rows = [];
      for (const s of visible) {
        const pts = this.runs[s.run];
        let best = -1, bd = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const d = Math.abs(pts[i].tGyr - t);
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0 || bd > 0.3) continue;
        const v = cache.get(s)[best];
        if (!Number.isFinite(v)) continue;
        ctx.fillStyle = css(s.color);
        ctx.beginPath(); ctx.arc(sx(pts[best].tGyr), sy(v), 3.5, 0, 7); ctx.fill();
        rows.push(`<div class="tt-row"><i class="sw ${s.run === 'twin' ? 'dash' : ''}" style="--c:var(${s.color})"></i>${s.label}<b>${this.yFmt(v)}${this.unit}</b></div>`);
      }
      if (rows.length) {
        this.tooltip.innerHTML = `<div class="tt-head">${t.toFixed(2)} Gyr</div>${rows.join('')}`;
        this.tooltip.hidden = false;
        const left = this.hoverX > w / 2 ? this.hoverX - this.tooltip.offsetWidth - 12 : this.hoverX + 12;
        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.top = `${PAD.t}px`;
      } else this.tooltip.hidden = true;
    }
  }
}

// Hertzsprung-Russell diagram from a snapshot. Temperature runs right to left.
export class HRChart {
  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.snap = null;
    this.hover = null;
    this.xr = [4.45, 3.5];
    this.yr = [-4.2, 3.6];
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hover = [e.clientX - r.left, e.clientY - r.top];
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.tooltip.hidden = true; this.draw(); });
  }

  draw(snap = this.snap, masses = this.masses) {
    this.snap = snap;
    this.masses = masses;
    const { ctx, w, h } = setupCanvas(this.canvas);
    const sx = (v) => PAD.l + ((v - this.xr[0]) / (this.xr[1] - this.xr[0])) * (w - PAD.l - PAD.r);
    const sy = (v) => h - PAD.b - ((v - this.yr[0]) / (this.yr[1] - this.yr[0])) * (h - PAD.t - PAD.b);
    axes(ctx, w, h, sx, sy, [4.4, 4.2, 4.0, 3.8, 3.6], [-4, -2, 0, 2], (v) => `${Math.round(Math.pow(10, v) / 100) * 100}`, (v) => `${v}`);
    if (!snap) return;
    const cols = [css('--p1'), css('--p2')];
    let near = null, nd = 64;
    for (let i = 0; i < snap.n; i++) {
      const kind = snap.meta[2 * i + 1];
      if (kind > 3) continue;
      const X = sx(snap.phot[2 * i + 1]), Y = sy(snap.phot[2 * i]);
      if (X < PAD.l || X > w - PAD.r || Y < PAD.t || Y > h - PAD.b) continue;
      ctx.fillStyle = cols[snap.meta[2 * i]];
      ctx.globalAlpha = kind === 0 ? 0.55 : 0.95;
      const r = kind === 0 ? 1.4 : 2.4;
      ctx.fillRect(X - r, Y - r, 2 * r, 2 * r);
      if (this.hover) {
        const d = (X - this.hover[0]) ** 2 + (Y - this.hover[1]) ** 2;
        if (d < nd) { nd = d; near = { i, X, Y }; }
      }
    }
    ctx.globalAlpha = 1;
    if (near) {
      const i = near.i;
      ctx.strokeStyle = css('--ink');
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(near.X, near.Y, 5, 0, 7); ctx.stroke();
      const names = ['Main sequence', 'Giant branch', 'Horizontal branch', 'White dwarf'];
      const kind = snap.meta[2 * i + 1];
      const m = masses ? masses[i] : null;
      this.tooltip.innerHTML = `<div class="tt-head">${names[kind]} · P${snap.meta[2 * i] + 1}</div>` +
        `<div class="tt-row">Teff<b>${Math.round(Math.pow(10, snap.phot[2 * i + 1]))} K</b></div>` +
        `<div class="tt-row">L<b>${Math.pow(10, snap.phot[2 * i]).toPrecision(2)} L☉</b></div>` +
        (m ? `<div class="tt-row">Mass<b>${m.toFixed(2)} M☉</b></div>` : '');
      this.tooltip.hidden = false;
      const left = near.X > w / 2 ? near.X - this.tooltip.offsetWidth - 12 : near.X + 12;
      this.tooltip.style.left = `${left}px`;
      this.tooltip.style.top = `${Math.max(0, near.Y - 30)}px`;
    } else if (this.hover) this.tooltip.hidden = true;
  }
}
