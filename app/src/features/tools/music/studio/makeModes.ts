// The studio tool's making modes: perspective grids, fabric yardage, the weight of a sculpture, and glaze recipes.
import { fail, fixed, fmt, need, ok, positive, readNumber } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import { DENSITIES, glaze, lossOnIgnition, parseMaterial, scaleBatch, shapeVolume, yardage } from './materials';
import type { Material, Piece, Shape } from './materials';
import { perspectiveGrid, perspectiveSvg } from './perspective';
import type { PerspectiveKind } from './perspective';

export function perspective(v: Values): KitOk {
  const kind = (v.pKind ?? 'two') as PerspectiveKind;
  const horizon = need(v, 'pHorizon', 'stuHorizon');
  if (horizon <= 0 || horizon >= 1) fail('stuHorizonRange');
  const lines = Math.round(positive(v, 'pLines', 'stuLines'));
  if (lines < 2 || lines > 24) fail('stuLinesRange');
  const grid = perspectiveGrid({ kind, width: 600, height: 400, horizon, lines });
  const label = `${kind}-point perspective grid`;
  const rows: KitRow[] = [
    { key: 'horizonAt', value: `${fixed(horizon * 100, 0)}% from the top` },
    { key: 'vanishingPoints', value: fmt(grid.points.length) },
    { key: 'lineCount', value: fmt(grid.segments.length) },
  ];
  const steps: KitStep[] = [
    { key: 'perspHorizon', vars: { horizon: fixed(horizon * 100, 0) } },
    { key: kind === 'one' ? 'perspOne' : kind === 'two' ? 'perspTwo' : 'perspThree' },
    { key: 'perspUse' },
  ];
  return ok({
    rows,
    steps,
    answer: `A ${kind}-point grid with the horizon ${fixed(horizon * 100, 0)}% down`,
    svg: { markup: perspectiveSvg(grid, label), label },
    notes: ['stuNotePerspective'],
  });
}

/** Lines like "20 x 30 x 4": the width, the length, and an optional count. */
export function readFabricPieces(text: string): Piece[] {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return fail('stuNoPieces');
  return lines.map((line, i) => {
    const parts = line.split(/\s*[x×]\s*/i).map((part) => readNumber(part));
    const [width, length, quantity = 1] = parts;
    if (parts.length < 2 || parts.length > 3 || !width || !length || width <= 0 || length <= 0) {
      return fail('stuBadFabric', { line: String(i + 1) });
    }
    if (quantity === null || !Number.isInteger(quantity) || quantity < 1) {
      return fail('stuBadFabric', { line: String(i + 1) });
    }
    return { width, length, quantity };
  });
}

export function fabric(v: Values): KitOk {
  const unit = v.fabricUnit === 'cm' ? 'cm' : 'in';
  const width = positive(v, 'fabric', 'stuFabricWidth');
  const pieces = readFabricPieces(v.pieces ?? '');
  const nap = v.nap === 'yes';
  const typed = readNumber(v.repeat ?? '');
  if (typed !== null && typed < 0) fail('nonNegative', { field: 'stuRepeat' });
  const plan = yardage(pieces, width, nap, typed ?? 0);
  if (!plan) return fail('stuTooWide', { width: `${fmt(width)} ${unit}` });
  const perYard = unit === 'in' ? 36 : 91.44;
  const yards = plan.length / perYard;
  const rows: KitRow[] = [
    { key: 'fabricLength', value: `${fmt(plan.length, 5)} ${unit}` },
    { key: 'fabricYards', value: `${fmt(yards, 4)} yd` },
    { key: 'fabricMeters', value: `${fmt(yards * 0.9144, 4)} m` },
    { key: 'fabricRows', value: plan.across.join(', ') },
  ];
  return ok({
    rows,
    steps: [
      { key: 'fabricShelf', vars: { width: `${fmt(width)} ${unit}`, rows: fmt(plan.rows) } },
      { key: 'fabricSum', vars: { length: `${fmt(plan.length, 5)} ${unit}`, yards: fmt(yards, 4) } },
    ],
    answer: `Buy ${fmt(yards, 4)} yd (${fmt(plan.length, 5)} ${unit}) of ${fmt(width)} ${unit} wide fabric`,
    notes: nap ? ['stuNoteNap', 'stuNoteFabric'] : ['stuNoteFabric'],
  });
}

export function sculpture(v: Values): KitOk {
  const shape = (v.shape ?? 'block') as Shape;
  const a = positive(v, 'a', 'stuDimA');
  const b = ['block', 'cylinder'].includes(shape) ? positive(v, 'b', 'stuDimB') : 0;
  const c = shape === 'block' ? positive(v, 'c', 'stuDimC') : 0;
  const volume = shapeVolume(shape, a, b, c);
  const density =
    v.material === 'typed' ? positive(v, 'density', 'stuDensity') : (DENSITIES[v.material ?? 'marble'] ?? 1);
  const grams = volume * density;
  return ok({
    rows: [
      { key: 'volumeCm', value: `${fmt(volume, 5)} cm³` },
      { key: 'densityUsed', value: `${fmt(density)} g/cm³` },
      { key: 'massKg', value: `${fmt(grams / 1000, 5)} kg` },
      { key: 'massLb', value: `${fmt(grams / 453.59237, 5)} lb` },
    ],
    steps: [
      { key: 'sculptVolume', vars: { volume: fmt(volume, 5) } },
      { key: 'sculptMass', vars: { volume: fmt(volume, 5), density: fmt(density), mass: fmt(grams / 1000, 5) } },
    ],
    answer: `${fmt(volume, 5)} cm³ at ${fmt(density)} g/cm³ weighs ${fmt(grams / 1000, 5)} kg`,
    notes: ['stuNoteSculpture'],
  });
}

function readRecipe(text: string): Material[] {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return fail('stuNoRecipe');
  return lines.map((line, i) => {
    const m = parseMaterial(line);
    return m && m.grams > 0 ? m : fail('stuBadMaterial', { line: String(i + 1) });
  });
}

const oxideOrder = (oxide: string): number => {
  const order = ['Li2O', 'Na2O', 'K2O', 'MgO', 'CaO', 'SrO', 'BaO', 'ZnO', 'PbO', 'Al2O3', 'B2O3', 'SiO2'];
  const at = order.indexOf(oxide);
  return at === -1 ? order.length : at;
};

export function glazeMode(v: Values): KitOk {
  const materials = readRecipe(v.recipe ?? '');
  const g = glaze(materials);
  if (!g) return fail('stuNoFlux');
  const typed = readNumber(v.batch ?? '');
  if (typed !== null && typed <= 0) fail('positive', { field: 'stuBatch' });
  const batch = typed ?? g.totalGrams;
  const scaled = scaleBatch(materials, batch);
  const unity = [...g.unity].sort(([a], [b]) => oxideOrder(a) - oxideOrder(b));
  const rows: KitRow[] = unity.map(([oxide, amount]) => ({
    key: 'unityOxide',
    value: fixed(amount, 3),
    vars: { oxide },
  }));
  rows.push(
    { key: 'unityAlkali', value: fixed(g.alkali, 3) },
    { key: 'unityEarth', value: fixed(g.alkalineEarth, 3) },
    {
      key: 'silicaAlumina',
      value: g.silicaAlumina === null ? '' : fixed(g.silicaAlumina, 2),
      ...(g.silicaAlumina === null ? { word: 'wordNoAlumina' as const } : {}),
    },
    { key: 'loiBatch', value: `${fixed(g.loi * 100, 2)}%` },
  );
  materials.forEach((m, i) =>
    rows.push({
      key: 'batchGrams',
      value: `${fmt(scaled[i]!, 5)} g (LOI ${fixed(lossOnIgnition(m) * 100, 2)}%)`,
      vars: { name: m.label },
    }),
  );
  const text = unity.map(([oxide, amount]) => `${oxide} ${fixed(amount, 3)}`).join(', ');
  return ok({
    rows,
    steps: [
      { key: 'glazeMoles' },
      { key: 'glazeFlux', vars: { flux: fmt(g.fluxMoles, 5) } },
      { key: 'glazeUnity' },
      { key: 'glazeLoi', vars: { loi: fixed(g.loi * 100, 2) } },
    ],
    answer: `Unity formula: ${text}`,
    code: materials.map((m, i) => `${m.label}\t${fmt(scaled[i]!, 5)} g`).join('\n'),
    notes: ['stuNoteGlaze', 'stuNoteIdeal'],
  });
}
