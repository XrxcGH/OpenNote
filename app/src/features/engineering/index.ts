// Engineering tools (items 6, 7, and 10 of the math tools, and units in tables): the solvers are pure and load with
// this module; each block's editor loads when a page shows one.
export { solveLinear } from './linalg';
export { readFbd, starterFbd } from './fbd/model';
export type { FbdModel, FbdPart } from './fbd/model';
export { solveFbd } from './fbd/solve';
export type { FbdResult } from './fbd/solve';
export { readBeam, solveBeam, starterBeam } from './structures/beam';
export type { BeamModel, BeamResult } from './structures/beam';
export { readTruss, solveTruss, starterTruss } from './structures/truss';
export type { TrussModel, TrussResult } from './structures/truss';

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

export async function mountBeam(container: HTMLElement, props: import('./canvas/shared').BlockProps) {
  const [{ mountPanel }, { BeamPanel }] = await Promise.all([import('./mount'), import('./structures/BeamPanel')]);
  return mountPanel(BeamPanel)(container, props);
}

export async function mountTruss(container: HTMLElement, props: import('./canvas/shared').BlockProps) {
  const [{ mountPanel }, { TrussPanel }] = await Promise.all([import('./mount'), import('./structures/TrussPanel')]);
  return mountPanel(TrussPanel)(container, props);
}

export async function beamStarter(): Promise<{ model: import('./structures/beam').BeamModel; fallback: string }> {
  const [{ starterBeam: starter }, { beamFallback }] = await Promise.all([
    import('./structures/beam'),
    import('./structures/BeamPanel'),
  ]);
  const model = starter();
  return { model, fallback: beamFallback(model) };
}

export async function trussStarter(): Promise<{ model: import('./structures/truss').TrussModel; fallback: string }> {
  const [{ starterTruss: starter }, { trussFallback }] = await Promise.all([
    import('./structures/truss'),
    import('./structures/TrussPanel'),
  ]);
  const model = starter();
  return { model, fallback: trussFallback(model) };
}
