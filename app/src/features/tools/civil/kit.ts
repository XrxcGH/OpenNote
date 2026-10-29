// Each tool's calculations, loaded the first time the tool is chosen, so the window opens without the engines.
import type { Calc } from './core/types';
import type { CivilToolId } from './meta';

export const CIVIL_KIT: Readonly<Record<CivilToolId, () => Promise<readonly Calc[]>>> = {
  indeterminate: () => import('./structures/calcs').then((module) => module.CALCS),
  soils: () => import('./soils/calcs').then((module) => module.CALCS),
  foundations: () => import('./foundations/calcs').then((module) => module.CALCS),
  hydraulics: () => import('./hydraulics/calcs').then((module) => module.CALCS),
  groundwater: () => import('./groundwater/calcs').then((module) => module.CALCS),
  water: () => import('./water/calcs').then((module) => module.CALCS),
  transport: () => import('./transport/calcs').then((module) => module.CALCS),
  process: () => import('./process/calcs').then((module) => module.CALCS),
  reactors: () => import('./reactors/calcs').then((module) => module.CALCS),
};
