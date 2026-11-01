// Seventeen kits keep only their window title and palette words in start-up; the rest of each namespace loads with the
// kit. These checks keep the start-up copies the same as the full namespaces, and make sure loading a kit fills in
// the rest.
import { describe, expect, it } from 'vitest';
import { en } from '.';
import { kitCivil } from './kitCivil';
import { kitCivilStart } from './kitCivilStart';
import { kitEcon } from './kitEcon';
import { kitEconStart } from './kitEconStart';
import { kitHumanities } from './kitHumanities';
import { kitHumanitiesStart } from './kitHumanitiesStart';
import { kitMolBio } from './kitMolBio';
import { kitMolBioStart } from './kitMolBioStart';
import { kitMusic } from './kitMusic';
import { kitMusicStart } from './kitMusicStart';
import { kitReasoning } from './kitReasoning';
import { kitReasoningStart } from './kitReasoningStart';
import { kitPhysics } from './kitPhysics';
import { kitPhysicsStart } from './kitPhysicsStart';
import { kitControl } from './kitControl';
import { kitControlStart } from './kitControlStart';
import { kitSolids } from './kitSolids';
import { kitSolidsStart } from './kitSolidsStart';
import { kitMath } from './kitMath';
import { kitMathStart } from './kitMathStart';
import { kitMechDyn } from './kitMechDyn';
import { kitMechDynStart } from './kitMechDynStart';
import { kitElectrical } from './kitElectrical';
import { kitElectricalStart } from './kitElectricalStart';
import { kitFluidHeat } from './kitFluidHeat';
import { kitFluidHeatStart } from './kitFluidHeatStart';
import { kitDesign } from './kitDesign';
import { kitDesignStart } from './kitDesignStart';
import { kitAero } from './kitAero';
import { kitAeroStart } from './kitAeroStart';
import { kitChemMat } from './kitChemMat';
import { kitChemMatStart } from './kitChemMatStart';
import { kitThermo } from './kitThermo';
import { kitThermoStart } from './kitThermoStart';

const KITS = [
  ['kitCivil', kitCivilStart, kitCivil, '../../features/tools/civil/text'],
  ['kitEcon', kitEconStart, kitEcon, '../../features/tools/econ/text'],
  ['kitHumanities', kitHumanitiesStart, kitHumanities, '../../features/tools/humanities/text'],
  ['kitMolBio', kitMolBioStart, kitMolBio, '../../features/tools/molbio/text'],
  ['kitMusic', kitMusicStart, kitMusic, '../../features/tools/music/text'],
  ['kitReasoning', kitReasoningStart, kitReasoning, '../../features/tools/reasoning/text'],
  ['kitPhysics', kitPhysicsStart, kitPhysics, '../../features/tools/physics/text'],
  ['kitControl', kitControlStart, kitControl, '../../features/engineering/control/text'],
  ['kitSolids', kitSolidsStart, kitSolids, '../../features/engineering/solids/text'],
  ['kitMath', kitMathStart, kitMath, '../../features/tools/mathkit/text'],
  ['kitMechDyn', kitMechDynStart, kitMechDyn, '../../features/engineering/mechdyn/text'],
  ['kitElectrical', kitElectricalStart, kitElectrical, '../../features/engineering/electrical/text'],
  ['kitFluidHeat', kitFluidHeatStart, kitFluidHeat, '../../features/engineering/fluidheat/text'],
  ['kitDesign', kitDesignStart, kitDesign, '../../features/tools/design/text'],
  ['kitAero', kitAeroStart, kitAero, '../../features/engineering/aero/text'],
  ['kitChemMat', kitChemMatStart, kitChemMat, '../../features/tools/chemmat/text'],
  ['kitThermo', kitThermoStart, kitThermo, '../../features/engineering/thermo/text'],
] as const;

/** Every string in `start`, with its dotted path. */
function leaves(start: object, path = ''): [string, string][] {
  return Object.entries(start).flatMap(([key, value]) =>
    typeof value === 'string' ? [[path + key, value] as [string, string]] : leaves(value as object, `${path}${key}.`),
  );
}

const at = (root: object, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], root);

describe('the kits’ start-up words', () => {
  it.each(KITS)('%s keeps the same words as the full namespace', (_name, start, full) => {
    const words = leaves(start);
    expect(words.length).toBeGreaterThan(0);
    for (const [path, text] of words) expect(at(full, path), path).toBe(text);
  });

  it.each(KITS)('%s gets the rest of its words when the kit loads', async (name, _start, full, text) => {
    await import(/* @vite-ignore */ text);
    expect(en[name]).toEqual(full);
  });
});
