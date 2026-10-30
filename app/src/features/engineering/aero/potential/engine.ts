// Two-dimensional potential flow: superpose uniform flow, sources, sinks, doublets, and point vortices as one
// complex potential W(z) = phi + i psi. Streamlines are level curves of psi (marching squares), stagnation points come
// from complex Newton iteration on dW/dz, and the lift per unit span from the Kutta-Joukowski theorem.
// Incompressible, inviscid, irrotational; vortex strength positive clockwise, so lift = rho U Gamma upward.
import { AeroError, DEG, eq, finite, num, positive, step, tex, type AeroStep } from '../common';
import { levelCurves, type LevelCurve } from '../num';

export type ElementKind = 'uniform' | 'source' | 'doublet' | 'vortex';

export interface FlowElement {
  readonly kind: ElementKind;
  /** Uniform: speed U (m/s). Source: m (m^2/s, negative for a sink). Doublet: kappa (m^3/s). Vortex: Gamma (m^2/s). */
  readonly strength: number;
  readonly x: number;
  readonly y: number;
  /** Uniform flow direction, degrees from +x. */
  readonly angle?: number;
}

export interface PotentialInput {
  readonly elements: readonly FlowElement[];
  readonly rho: number;
  /** Point to probe. */
  readonly px: number;
  readonly py: number;
  readonly window?: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };
}

interface C {
  re: number;
  im: number;
}
const c = (re: number, im = 0): C => ({ re, im });
const add = (a: C, b: C) => c(a.re + b.re, a.im + b.im);
const sub = (a: C, b: C) => c(a.re - b.re, a.im - b.im);
const mul = (a: C, b: C) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: C, b: C) => {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const scale = (a: C, k: number) => c(a.re * k, a.im * k);

/** dW/dz = u - i v and its derivative, for complex Newton iteration. */
function velocity(els: readonly FlowElement[], z: C): { w: C; dw: C } {
  let w = c(0);
  let dw = c(0);
  for (const e of els) {
    if (e.kind === 'uniform') {
      const a = (e.angle ?? 0) * DEG;
      w = add(w, c(e.strength * Math.cos(a), -e.strength * Math.sin(a)));
      continue;
    }
    const d = sub(z, c(e.x, e.y));
    const inv = div(c(1), d);
    const inv2 = mul(inv, inv);
    if (e.kind === 'source') {
      const k = e.strength / (2 * Math.PI);
      w = add(w, scale(inv, k));
      dw = add(dw, scale(inv2, -k));
    } else if (e.kind === 'doublet') {
      const k = e.strength / (2 * Math.PI);
      w = add(w, scale(inv2, -k));
      dw = add(dw, scale(mul(inv2, inv), 2 * k));
    } else {
      // W = i Gamma/(2 pi) ln(z - z0): clockwise positive.
      const k = e.strength / (2 * Math.PI);
      w = add(w, mul(c(0, k), inv));
      dw = add(dw, mul(c(0, -k), inv2));
    }
  }
  return { w, dw };
}

/** Stream function psi; source branch cuts point along +x from each source. */
function streamFunction(els: readonly FlowElement[], x: number, y: number): number {
  let psi = 0;
  for (const e of els) {
    if (e.kind === 'uniform') {
      const a = (e.angle ?? 0) * DEG;
      psi += e.strength * (y * Math.cos(a) - x * Math.sin(a));
      continue;
    }
    const dx = x - e.x;
    const dy = y - e.y;
    const r2 = dx * dx + dy * dy;
    if (e.kind === 'source') {
      let th = Math.atan2(dy, dx);
      if (th < 0) th += 2 * Math.PI;
      psi += (e.strength / (2 * Math.PI)) * th;
    } else if (e.kind === 'doublet') psi += (-e.strength / (2 * Math.PI)) * (dy / r2);
    else psi += (e.strength / (4 * Math.PI)) * Math.log(r2);
  }
  return psi;
}

export interface PotentialResult {
  readonly u: number;
  readonly v: number;
  readonly speed: number;
  /** Pressure coefficient at the probe, from the free-stream speed (NaN without a uniform flow). */
  readonly Cp: number;
  readonly freeStream: number;
  readonly circulation: number;
  /** Lift per unit span, N/m (Kutta-Joukowski), perpendicular to the free stream. */
  readonly lift: number;
  readonly stagnation: readonly { readonly x: number; readonly y: number }[];
  readonly streamlines: readonly LevelCurve[];
  /** Contours of Cp = 1 - V^2/U^2 at CP_LEVELS (empty without a uniform flow). */
  readonly cpContours: readonly LevelCurve[];
  readonly window: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };
  readonly steps: readonly AeroStep[];
}

const TERM: Record<ElementKind, string> = {
  uniform: 'U e^{-i\\alpha} z',
  source: '\\frac{m}{2\\pi}\\ln(z - z_0)',
  doublet: '\\frac{\\kappa}{2\\pi (z - z_0)}',
  vortex: '\\frac{i\\Gamma}{2\\pi}\\ln(z - z_0)',
};

export function potentialFlow(input: PotentialInput): PotentialResult {
  const els = input.elements;
  if (els.length === 0) throw new AeroError('noElements');
  if (els.length > 20) throw new AeroError('tooManyElements');
  els.forEach((e) => {
    finite(e.strength, 'strength');
    finite(e.x, 'x');
    finite(e.y, 'y');
  });
  const rho = positive(input.rho, 'ρ');
  const px = finite(input.px, 'x');
  const py = finite(input.py, 'y');
  const win = input.window ?? { x0: -3, x1: 3, y0: -2, y1: 2 };
  if (!(win.x1 > win.x0 && win.y1 > win.y0)) throw new AeroError('windowRange');
  const uniform = els.filter((e) => e.kind === 'uniform');
  let Ux = 0;
  let Uy = 0;
  uniform.forEach((e) => {
    Ux += e.strength * Math.cos((e.angle ?? 0) * DEG);
    Uy += e.strength * Math.sin((e.angle ?? 0) * DEG);
  });
  const U = Math.hypot(Ux, Uy);
  for (const e of els) {
    if (e.kind !== 'uniform' && Math.hypot(px - e.x, py - e.y) < 1e-9) throw new AeroError('probeOnElement');
  }
  const { w } = velocity(els, c(px, py));
  const u = w.re;
  const v = -w.im;
  const speed = Math.hypot(u, v);
  const Cp = U > 0 ? 1 - (speed * speed) / (U * U) : NaN;
  const circulation = els.filter((e) => e.kind === 'vortex').reduce((sum, e) => sum + e.strength, 0);
  const lift = rho * U * circulation;
  const steps: AeroStep[] = [
    step('pfComplex', `W(z) = ${els.map((e) => TERM[e.kind]).join(' + ')}`, { count: String(els.length) }),
    step(
      'pfVelocity',
      eq(
        '\\frac{dW}{dz}',
        'u - iv \\Rightarrow u',
        `${tex(u, 5)},\\ v`,
        `${tex(v, 5)}\\ \\text{m/s at } (${tex(px, 4)}, ${tex(py, 4)})`,
      ),
    ),
  ];
  if (U > 0)
    steps.push(
      step(
        'pfBernoulli',
        `C_p = 1 - \\frac{V^2}{U_\\infty^2} = 1 - \\frac{${tex(speed, 5)}^2}{${tex(U, 5)}^2} = ${tex(Cp, 5)}`,
      ),
    );
  else steps.push(step('pfNoFreeStream'));
  steps.push(
    step(
      'pfKuttaJoukowski',
      eq(
        "L'",
        '\\rho_\\infty U_\\infty \\Gamma',
        `${tex(rho, 5)} \\times ${tex(U, 5)} \\times ${tex(circulation, 5)}`,
        `${tex(lift, 6)}\\ \\text{N/m}`,
      ),
    ),
  );
  const stagnation = stagnationPoints(els, win);
  steps.push(
    step('pfStagnation', undefined, {
      points: stagnation.map((s) => `(${num(s.x, 4)}, ${num(s.y, 4)})`).join(', ') || '—',
    }),
  );
  return {
    u,
    v,
    speed,
    Cp,
    freeStream: U,
    circulation,
    lift,
    stagnation,
    streamlines: streamlines(els, win),
    cpContours: U > 0 ? cpContours(els, win, U) : [],
    window: win,
    steps,
  };
}

function stagnationPoints(els: readonly FlowElement[], win: PotentialResult['window']) {
  const found: { x: number; y: number }[] = [];
  const span = Math.max(win.x1 - win.x0, win.y1 - win.y0);
  const n = 12;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      let z = c(win.x0 + ((win.x1 - win.x0) * i) / n + 1e-3, win.y0 + ((win.y1 - win.y0) * j) / n + 1.3e-3);
      let ok = false;
      for (let it = 0; it < 60; it += 1) {
        const { w, dw } = velocity(els, z);
        if (Math.hypot(dw.re, dw.im) < 1e-300) break;
        const dz = div(w, dw);
        z = sub(z, dz);
        if (!Number.isFinite(z.re) || !Number.isFinite(z.im) || Math.hypot(z.re, z.im) > 1e6) break;
        if (Math.hypot(dz.re, dz.im) < 1e-12 * (1 + Math.hypot(z.re, z.im))) {
          ok = Math.hypot(velocity(els, z).w.re, velocity(els, z).w.im) < 1e-8 * (1 + maxStrength(els));
          break;
        }
      }
      if (!ok) continue;
      const inside =
        z.re >= win.x0 - 0.5 * span &&
        z.re <= win.x1 + 0.5 * span &&
        z.im >= win.y0 - 0.5 * span &&
        z.im <= win.y1 + 0.5 * span;
      const atElement = els.some((e) => e.kind !== 'uniform' && Math.hypot(z.re - e.x, z.im - e.y) < 1e-6);
      if (!inside || atElement) continue;
      if (found.some((f) => Math.hypot(f.x - z.re, f.y - z.im) < 1e-5 * span)) continue;
      found.push({ x: Math.abs(z.re) < 1e-12 ? 0 : z.re, y: Math.abs(z.im) < 1e-12 ? 0 : z.im });
    }
  }
  return found.sort((a, b) => a.x - b.x || a.y - b.y);
}

const maxStrength = (els: readonly FlowElement[]) => els.reduce((m, e) => Math.max(m, Math.abs(e.strength)), 0);

/** The plot grid over the window: 120 cells across and square cells (at least 40 down). */
function plotGrid(win: PotentialResult['window']) {
  const nx = 120;
  const ny = Math.max(40, Math.round((nx * (win.y1 - win.y0)) / (win.x1 - win.x0)));
  const xs = Array.from({ length: nx + 1 }, (_, i) => win.x0 + ((win.x1 - win.x0) * i) / nx);
  const ys = Array.from({ length: ny + 1 }, (_, j) => win.y0 + ((win.y1 - win.y0) * j) / ny);
  return { xs, ys, dx: (win.x1 - win.x0) / nx, dy: (win.y1 - win.y0) / ny };
}

/** Cp levels drawn: -3 to 1 in steps of 0.25. */
export const CP_LEVELS: readonly number[] = Array.from({ length: 17 }, (_, k) => -3 + 0.25 * k);

/** Contours of Cp = 1 - |dW/dz|^2/U^2, masked in the cells at each singularity, where the speed is unbounded. */
function cpContours(els: readonly FlowElement[], win: PotentialResult['window'], U: number): LevelCurve[] {
  const { xs, ys, dx, dy } = plotGrid(win);
  const z = ys.map((y) =>
    xs.map((x) => {
      for (const e of els) {
        if (e.kind !== 'uniform' && Math.abs(x - e.x) < 1.5 * dx && Math.abs(y - e.y) < 1.5 * dy) return NaN;
      }
      const { w } = velocity(els, c(x, y));
      return 1 - (w.re * w.re + w.im * w.im) / (U * U);
    }),
  );
  return levelCurves({ xs, ys, z }, CP_LEVELS);
}

function streamlines(els: readonly FlowElement[], win: PotentialResult['window']): LevelCurve[] {
  const { xs, ys, dx, dy } = plotGrid(win);
  const z = ys.map((y) =>
    xs.map((x) => {
      for (const e of els) {
        if (e.kind === 'uniform') continue;
        // Mask the cells at each singularity and along each source's branch cut, so no false lines are drawn.
        if (Math.abs(x - e.x) < 1.5 * dx && Math.abs(y - e.y) < 1.5 * dy) return NaN;
        if (e.kind === 'source' && x > e.x && Math.abs(y - e.y) < 1.01 * dy) return NaN;
      }
      return streamFunction(els, x, y);
    }),
  );
  const finiteValues = z.flat().filter((v) => Number.isFinite(v));
  if (finiteValues.length === 0) return [];
  // Levels: evenly spaced in psi, including the dividing streamline psi at each stagnation point.
  const sorted = [...finiteValues].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)]!;
  const hi = sorted[Math.floor(sorted.length * 0.98)]!;
  const levels: number[] = [];
  for (let k = 0; k <= 24; k += 1) levels.push(lo + ((hi - lo) * k) / 24);
  for (const s of stagnationPoints(els, win)) {
    const psi = streamFunction(els, s.x, s.y);
    if (Number.isFinite(psi)) levels.push(psi);
  }
  return levelCurves({ xs, ys, z }, levels);
}
