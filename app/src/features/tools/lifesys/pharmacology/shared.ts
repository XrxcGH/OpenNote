// What the pharmacology engines share: a sampled curve and the coursework note.
import type { Step } from '../types';

export type Point = [number, number];
export const curve = (tEnd: number, f: (t: number) => number, n = 200): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => [(tEnd * i) / n, f((tEnd * i) / n)]);
export const COURSEWORK: Step = { key: 'pharmacology.n.coursework' };
