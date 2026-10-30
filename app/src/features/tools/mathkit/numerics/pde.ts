// Partial differential equations on a grid by finite differences: Laplace and Poisson equations on a rectangle by
// successive over-relaxation, and the two-dimensional heat equation by the explicit scheme with its stability limit.
import { readFunction } from '../expr';
import { fmt } from '../numeric';
import { KitError, step, type KitStep } from '../types';
import { line, type NumLine, type NumOut } from './common';

export interface GridResult extends NumOut {
  /** Row 0 is the top edge. */
  grid: number[][];
  iterations: number;
}

/** An edge condition: an expression in the coordinate along the edge (s, from 0 to 1 across the edge). */
const edge = (text: string, name: string) => {
  try {
    return readFunction(text.trim() || '0', ['s']);
  } catch (error) {
    if (error instanceof KitError) throw new KitError('unreadable', `${name}: ${text}`);
    throw error;
  }
};

export interface BoundaryText {
  top: string;
  bottom: string;
  left: string;
  right: string;
}

function boundaryGrid(nx: number, ny: number, edges: BoundaryText): number[][] {
  const top = edge(edges.top, 'top');
  const bottom = edge(edges.bottom, 'bottom');
  const left = edge(edges.left, 'left');
  const right = edge(edges.right, 'right');
  const grid = Array.from({ length: ny }, () => new Array<number>(nx).fill(0));
  for (let i = 0; i < nx; i++) {
    const s = i / (nx - 1);
    grid[0][i] = top([s]);
    grid[ny - 1][i] = bottom([s]);
  }
  for (let j = 1; j < ny - 1; j++) {
    const s = 1 - j / (ny - 1);
    grid[j][0] = left([s]);
    grid[j][nx - 1] = right([s]);
  }
  // The corners belong to both edges; take the average, which is what the grid sees.
  grid[0][0] = (top([0]) + left([1])) / 2;
  grid[0][nx - 1] = (top([1]) + right([1])) / 2;
  grid[ny - 1][0] = (bottom([0]) + left([0])) / 2;
  grid[ny - 1][nx - 1] = (bottom([1]) + right([0])) / 2;
  if (grid.some((row) => row.some((v) => !Number.isFinite(v)))) throw new KitError('undefinedValue', 'edge');
  return grid;
}

const cell = (grid: readonly (readonly number[])[]) => grid.map((row) => row.map((v) => fmt(v, 6)));

/** Laplace (source "0") or Poisson (u_xx + u_yy = f(x, y)) on a rectangle, with the four edges given. */
export function solvePoisson(options: {
  nx: number;
  ny: number;
  width: number;
  height: number;
  edges: BoundaryText;
  source: string;
  tolerance: number;
}): GridResult {
  const { nx, ny, width, height } = options;
  if (nx < 3 || ny < 3 || nx > 80 || ny > 80) throw new KitError('badGrid');
  if (!(width > 0) || !(height > 0)) throw new KitError('badLength');
  const hx = width / (nx - 1);
  const hy = height / (ny - 1);
  const grid = boundaryGrid(nx, ny, options.edges);
  const sourceFn = readFunction(options.source.trim() || '0', ['x', 'y']);
  const f = Array.from({ length: ny }, (_, j) =>
    Array.from({ length: nx }, (_, i) => sourceFn([i * hx, height - j * hy])),
  );
  if (f.some((row) => row.some((v) => !Number.isFinite(v)))) throw new KitError('undefinedValue', 'f(x, y)');
  // SOR with the optimal factor for a rectangle: 2 / (1 + sin(pi / N)).
  const N = Math.max(nx, ny) - 1;
  const omega = 2 / (1 + Math.sin(Math.PI / N));
  const ax = 1 / (hx * hx);
  const ay = 1 / (hy * hy);
  const diag = 2 * (ax + ay);
  let iterations = 0;
  let change = Infinity;
  for (; iterations < 20000 && change > options.tolerance; iterations++) {
    change = 0;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const gs = (ax * (grid[j][i - 1] + grid[j][i + 1]) + ay * (grid[j - 1][i] + grid[j + 1][i]) - f[j][i]) / diag;
        const updated = grid[j][i] + omega * (gs - grid[j][i]);
        change = Math.max(change, Math.abs(updated - grid[j][i]));
        grid[j][i] = updated;
      }
    }
  }
  let residual = 0;
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const r =
        ax * (grid[j][i - 1] - 2 * grid[j][i] + grid[j][i + 1]) +
        ay * (grid[j - 1][i] - 2 * grid[j][i] + grid[j + 1][i]) -
        f[j][i];
      residual = Math.max(residual, Math.abs(r));
    }
  }
  const mj = Math.floor(ny / 2);
  const mi = Math.floor(nx / 2);
  const lines: NumLine[] = [
    line('gridCenter', { x: fmt(mi * hx, 6), y: fmt(height - mj * hy, 6), value: fmt(grid[mj][mi], 8) }),
    line('gridSolved', { k: String(iterations), residual: fmt(residual, 3) }),
  ];
  const steps: KitStep[] = [
    step(
      'numMethod',
      '\\frac{u_{i+1,j}-2u_{i,j}+u_{i-1,j}}{h_x^2}+\\frac{u_{i,j+1}-2u_{i,j}+u_{i,j-1}}{h_y^2}=f_{i,j}',
      {
        $method: 'kitMath.numerics.method.fivePointStencil',
      },
    ),
    step('gridSor', `\\omega=\\frac{2}{1+\\sin(\\pi/${N})}=${fmt(omega, 6)}`),
    step('gridSize', `h_x=${fmt(hx, 6)},\\ h_y=${fmt(hy, 6)}`),
  ];
  return {
    lines,
    tables: [],
    plots: [],
    fields: [{ label: 'gridField', values: grid }],
    steps,
    grid,
    iterations,
  };
}

/** The table of a grid, for the Insert menu: one row of text per grid row. */
export const gridRows = (grid: readonly (readonly number[])[]): string[][] => cell(grid);

/** The explicit step bound for the 2D heat equation: alpha dt (1/hx^2 + 1/hy^2) <= 1/2. */
export function heatStepLimit(alpha: number, hx: number, hy: number): number {
  return 1 / (2 * alpha * (1 / (hx * hx) + 1 / (hy * hy)));
}

/** u_t = alpha (u_xx + u_yy) on a rectangle with fixed edges and a starting temperature, to time tEnd. */
export function solveHeat2d(options: {
  nx: number;
  ny: number;
  width: number;
  height: number;
  alpha: number;
  edges: BoundaryText;
  initial: string;
  dt: number;
  tEnd: number;
}): GridResult {
  const { nx, ny, width, height, alpha, dt, tEnd } = options;
  if (nx < 3 || ny < 3 || nx > 60 || ny > 60) throw new KitError('badGrid');
  if (!(width > 0) || !(height > 0)) throw new KitError('badLength');
  if (!(alpha > 0)) throw new KitError('badSpeed');
  if (!(dt > 0) || !(tEnd > 0)) throw new KitError('badStepSize');
  const hx = width / (nx - 1);
  const hy = height / (ny - 1);
  const limit = heatStepLimit(alpha, hx, hy);
  if (dt > limit) throw new KitError('unstableScheme', fmt(limit, 4));
  const steps = Math.ceil(tEnd / dt - 1e-9);
  if (steps > 200000) throw new KitError('tooManySteps');
  const dtUsed = tEnd / steps;
  const grid = boundaryGrid(nx, ny, options.edges);
  const start = readFunction(options.initial.trim() || '0', ['x', 'y']);
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) grid[j][i] = start([i * hx, height - j * hy]);
  if (grid.some((row) => row.some((v) => !Number.isFinite(v)))) throw new KitError('undefinedValue', 'u(x, y, 0)');
  const rx = (alpha * dtUsed) / (hx * hx);
  const ry = (alpha * dtUsed) / (hy * hy);
  let current = grid;
  for (let n = 0; n < steps; n++) {
    const next = current.map((row) => row.slice());
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        next[j][i] =
          current[j][i] +
          rx * (current[j][i - 1] - 2 * current[j][i] + current[j][i + 1]) +
          ry * (current[j - 1][i] - 2 * current[j][i] + current[j + 1][i]);
      }
    }
    current = next;
  }
  const mj = Math.floor(ny / 2);
  const mi = Math.floor(nx / 2);
  return {
    lines: [
      line('heatCenter', { t: fmt(tEnd, 6), value: fmt(current[mj][mi], 8) }),
      line('heatSteps', { n: String(steps), dt: fmt(dtUsed, 6), limit: fmt(limit, 6) }),
    ],
    tables: [],
    plots: [],
    fields: [{ label: 'gridField', values: current }],
    steps: [
      step(
        'numMethod',
        'u^{n+1}_{i,j}=u^{n}_{i,j}+\\frac{\\alpha\\Delta ' +
          't}{h_x^2}\\delta_x^2u^{n}_{i,j}+\\frac{\\alpha\\Delta t}{h_y^2}\\delta_y^2u^{n}_{i,j}',
        {
          $method: 'kitMath.numerics.method.explicitHeat',
        },
      ),
      step('heatStability', `\\Delta t=${fmt(dtUsed, 6)}\\le\\frac{1}{2\\alpha(1/h_x^2+1/h_y^2)}=${fmt(limit, 6)}`),
    ],
    grid: current,
    iterations: steps,
  };
}
