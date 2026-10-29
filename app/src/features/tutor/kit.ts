// The math the tutor works with (Check my work, the calculus engine, and its reader), loaded once when a tutor
// session starts, so the plan and its hints can be worked out without waiting.
import { loadTutorMath } from '../math';

export type MathKit = Awaited<ReturnType<typeof loadTutorMath>>;

let kit: MathKit | null = null;

export async function loadMathKit(): Promise<MathKit> {
  kit ??= await loadTutorMath();
  return kit;
}

/** The loaded math, or null before `loadMathKit` finished. */
export function mathKit(): MathKit | null {
  return kit;
}
