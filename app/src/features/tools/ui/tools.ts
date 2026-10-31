// The tool windows there are (Phases 7 and 10). Each has a name, a first size, and a title.
import type { MessageKey } from '../../../strings/t';

export type ToolId =
  | 'timers'
  | 'calculator'
  | 'upcoming'
  | 'flashcards'
  | 'exam'
  | 'converter'
  | 'reference'
  | 'dictionary'
  | 'citations'
  | 'constants'
  | 'sigfigs'
  | 'latex'
  | 'solvers'
  | 'vectors'
  | 'solids'
  | 'projectile'
  | 'chemcalc'
  | 'structure'
  | 'properties'
  | 'formulasheet'
  | 'practice'
  | 'figure'
  | 'symbols'
  | 'kit-modphys'
  | 'kitelectrical'
  | 'kit-fluidheat'
  | 'kit-solids'
  | 'kitaero'
  | 'kit-chemmat'
  | 'kit-thermo'
  | 'kit-control'
  | 'kit-design'
  | 'kit-math'
  | 'kit-mechdyn'
  | 'kit-physics';

export interface ToolDef {
  id: ToolId;
  title: MessageKey;
  width: number;
}

export const TOOLS: readonly ToolDef[] = [
  { id: 'timers', title: 'smart.tools.timers.title', width: 340 },
  { id: 'calculator', title: 'smart.tools.calculator.title', width: 400 },
  { id: 'upcoming', title: 'smart.tools.upcoming.title', width: 380 },
  { id: 'flashcards', title: 'study.deck.tool', width: 420 },
  { id: 'exam', title: 'exams.tool', width: 560 },
  { id: 'converter', title: 'study.converter.title', width: 380 },
  { id: 'reference', title: 'study.reference.title', width: 640 },
  { id: 'dictionary', title: 'study.dictionary.title', width: 400 },
  { id: 'symbols', title: 'study.symbols.title', width: 420 },
  { id: 'kit-fluidheat', title: 'kitFluidHeat.title', width: 560 },
  { id: 'citations', title: 'study.citations.title', width: 440 },
  { id: 'constants', title: 'science.constants.title', width: 520 },
  { id: 'sigfigs', title: 'science.sigfigs.title', width: 420 },
  { id: 'latex', title: 'science.latex.title', width: 480 },
  { id: 'solvers', title: 'solvers.title', width: 560 },
  { id: 'vectors', title: 'graph3d.tools.vectors.title', width: 520 },
  { id: 'solids', title: 'graph3d.tools.solids.title', width: 520 },
  { id: 'projectile', title: 'graph3d.tools.projectile.title', width: 520 },
  { id: 'chemcalc', title: 'chem.calc.title', width: 460 },
  { id: 'structure', title: 'chem.structure.title', width: 420 },
  { id: 'properties', title: 'chem.data.title', width: 560 },
  { id: 'formulasheet', title: 'docStructure.sheet.title', width: 400 },
  { id: 'practice', title: 'docStructure.practice.title', width: 440 },
  { id: 'figure', title: 'docStructure.figure.title', width: 420 },
  { id: 'kit-modphys', title: 'kitModPhys.window.title', width: 520 },
  { id: 'kitelectrical', title: 'kitElectrical.window', width: 560 },
  { id: 'kit-solids', title: 'kitSolids.title', width: 560 },
  { id: 'kitaero', title: 'kitAero.window', width: 560 },
  { id: 'kit-chemmat', title: 'kitChemMat.title', width: 560 },
  { id: 'kit-thermo', title: 'kitThermo.title', width: 560 },
  { id: 'kit-control', title: 'kitControl.title', width: 560 },
  { id: 'kit-design', title: 'kitDesign.title', width: 560 },
  { id: 'kit-math', title: 'kitMath.title', width: 560 },
  { id: 'kit-mechdyn', title: 'kitMechDyn.title', width: 560 },
  { id: 'kit-physics', title: 'kitPhysics.title', width: 560 },
];

export const isToolId = (value: unknown): value is ToolId => TOOLS.some((tool) => tool.id === value);
