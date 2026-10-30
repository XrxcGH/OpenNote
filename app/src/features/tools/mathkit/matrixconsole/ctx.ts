// What a built-in function can reach: the plot it draws on, the lines it prints, a way to call a function handle,
// and a seeded random source so a session replays the same way.
import type { Say } from './ops';
import type { Value } from './values';

export interface Series {
  x: number[];
  y: number[];
  dots: boolean;
  name: string;
}

export interface Figure {
  title: string;
  xlabel: string;
  ylabel: string;
  series: Series[];
  logx: boolean;
  logy: boolean;
  /** True once something was drawn or labeled since the figure was last shown. */
  changed: boolean;
}

export const newFigure = (): Figure => ({
  title: '',
  xlabel: '',
  ylabel: '',
  series: [],
  logx: false,
  logy: false,
  changed: false,
});

export interface Ctx {
  say: Say;
  print: (lines: string[]) => void;
  figure: Figure;
  hold: { on: boolean };
  format: { long: boolean };
  call: (f: Value, args: Value[], nargout?: number) => Value[];
  random: () => number;
  /** Counts one unit of work and stops a script that runs too long. */
  tick: (units?: number) => void;
}

export type Builtin = (args: Value[], nargout: number, ctx: Ctx) => Value[];
