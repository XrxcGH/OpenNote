// Engineering tools (items 6, 7, and 10 of the math tools, and units in tables): the solvers are pure and load with
// this module; each block's editor loads when a page shows one.
export { solveLinear } from './linalg';
export { readFbd, starterFbd } from './fbd/model';
export type { FbdModel, FbdPart } from './fbd/model';
export { solveFbd } from './fbd/solve';
export type { FbdResult } from './fbd/solve';

export async function mountFbd(container: HTMLElement, props: import('./canvas/shared').BlockProps) {
  const [{ mountPanel }, { FbdPanel }] = await Promise.all([import('./mount'), import('./fbd/FbdPanel')]);
  return mountPanel(FbdPanel)(container, props);
}

export async function fbdStarter(): Promise<{ model: import('./fbd/model').FbdModel; fallback: string }> {
  const [{ starterFbd: starter }, { fbdFallback }] = await Promise.all([
    import('./fbd/model'),
    import('./fbd/FbdPanel'),
  ]);
  const model = starter();
  return { model, fallback: fbdFallback(model) };
}
