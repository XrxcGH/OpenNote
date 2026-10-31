// The studio tool's size modes: scale drawings and models, enlarging a sketch, and cut lists for boards.
import { fail, fixed, fmt, ok, positive, readNumber } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import { METERS, areaFactor, cutList, drawn, enlargement, parseScale, real, volumeFactor } from './scale';
import type { CutPiece } from './scale';

/** Lines like "48 x 2" or "30" (a length and an optional count) into pieces; the problem line is reported. */
export function readPieces(text: string): CutPiece[] {
  const pieces: CutPiece[] = [];
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return fail('stuNoPieces');
  lines.forEach((line, i) => {
    const parts = line.split(/\s*[x×]\s*/i);
    const length = readNumber(parts[0] ?? '');
    const quantity = parts.length > 1 ? readNumber(parts[1] ?? '') : 1;
    if (length === null || length <= 0 || quantity === null || !Number.isInteger(quantity) || quantity < 1) {
      return fail('stuBadPiece', { line: String(i + 1) });
    }
    if (parts.length > 2) return fail('stuBadPiece', { line: String(i + 1) });
    pieces.push({ length, quantity });
  });
  return pieces;
}

const unitName = (v: Values, id: string): string => (METERS[v[id] ?? ''] ? (v[id] as string) : 'm');

export function scale(v: Values): KitOk {
  const parsed = parseScale(v.scaleText ?? '');
  if (!parsed) return fail('stuScaleFormat');
  const input = positive(v, 'length', 'stuLength');
  const from = unitName(v, 'lengthUnit');
  const to = unitName(v, 'outUnit');
  const meters = input * METERS[from]!;
  const toDrawn = (v.direction ?? 'toDrawn') === 'toDrawn';
  const result = (toDrawn ? drawn(meters, parsed) : real(meters, parsed)) / METERS[to]!;
  const rows: KitRow[] = [
    { key: 'scaleResult', value: `${fmt(result, 6)} ${to}` },
    { key: 'scaleRatio', value: `1 : ${fmt(parsed.ratio, 6)}` },
    { key: 'areaFactor', value: fmt(areaFactor(parsed), 4) },
    { key: 'volumeFactor', value: fmt(volumeFactor(parsed), 4) },
  ];
  const steps: KitStep[] = [
    { key: 'scaleRatioStep', vars: { text: v.scaleText ?? '', ratio: fmt(parsed.ratio, 6) } },
    {
      key: toDrawn ? 'scaleDrawnStep' : 'scaleRealStep',
      vars: { length: `${fmt(input)} ${from}`, ratio: fmt(parsed.ratio, 6), result: `${fmt(result, 6)} ${to}` },
    },
    { key: 'scaleAreaStep', vars: { ratio: fmt(parsed.ratio, 6), area: fmt(areaFactor(parsed), 4) } },
  ];
  const answer = toDrawn
    ? `${fmt(input)} ${from} at ${v.scaleText} is ${fmt(result, 6)} ${to} on the drawing`
    : `${fmt(input)} ${from} on the drawing at ${v.scaleText} is ${fmt(result, 6)} ${to} in real life`;
  return ok({ rows, steps, answer, notes: ['stuNoteScale'] });
}

export function enlarge(v: Values): KitOk {
  const [w, h] = [positive(v, 'skW', 'stuSketchWidth'), positive(v, 'skH', 'stuSketchHeight')];
  const [tw, th] = [positive(v, 'tgW', 'stuTargetWidth'), positive(v, 'tgH', 'stuTargetHeight')];
  const cell = positive(v, 'cell', 'stuGridCell');
  const e = enlargement(w, h, tw, th);
  const factor = e.uniform ? e.widthFactor : e.fit;
  const rows: KitRow[] = [
    { key: 'enlargeWidth', value: fmt(e.widthFactor, 6) },
    { key: 'enlargeHeight', value: fmt(e.heightFactor, 6) },
    { key: 'enlargeCell', value: fmt(cell * factor, 6) },
    { key: 'enlargeCells', value: `${fmt(Math.ceil(w / cell - 1e-9))} × ${fmt(Math.ceil(h / cell - 1e-9))}` },
  ];
  const steps: KitStep[] = [
    {
      key: 'enlargeFactor',
      vars: { tw: fmt(tw), w: fmt(w), th: fmt(th), h: fmt(h), fw: fmt(e.widthFactor, 6), fh: fmt(e.heightFactor, 6) },
    },
    e.uniform
      ? { key: 'enlargeSame', vars: { f: fmt(factor, 6) } }
      : { key: 'enlargeDiffer', vars: { f: fmt(e.fit, 6) } },
    { key: 'enlargeGrid', vars: { cell: fmt(cell), f: fmt(factor, 6), big: fmt(cell * factor, 6) } },
  ];
  return ok({
    rows,
    steps,
    answer:
      `Enlarge by ${fmt(factor, 6)}: a ${fmt(cell)} unit grid square becomes ${fmt(cell * factor, 6)}` +
      (e.uniform
        ? ''
        : ` (the target has a different shape: ${fmt(e.widthFactor, 6)} across, ${fmt(e.heightFactor, 6)} up)`),
    notes: e.uniform ? [] : ['stuNoteShape'],
  });
}

export function cuts(v: Values): KitOk {
  const stock = positive(v, 'stock', 'stuStock');
  const kerf = Number(v.kerf === '' ? '0' : (readNumber(v.kerf ?? '') ?? NaN));
  if (!Number.isFinite(kerf) || kerf < 0) return fail('nonNegative', { field: 'stuKerf' });
  const plan = cutList(stock, kerf, readPieces(v.cuts ?? ''));
  if (plan.tooLong.length > 0) return fail('stuTooLong', { length: fmt(plan.tooLong[0]!), stock: fmt(stock) });
  const layout = plan.boards.map(
    (b, i) => `${i + 1}: ${b.cuts.map((c) => fmt(c)).join(' + ')}  (${fmt(b.leftover, 5)} left)`,
  );
  return ok({
    rows: [
      { key: 'boardsNeeded', value: fmt(plan.boards.length) },
      { key: 'wastePercent', value: `${fixed(plan.wasteFraction * 100, 1)}%` },
    ],
    steps: [
      { key: 'cutSort' },
      { key: 'cutFit', vars: { stock: fmt(stock), kerf: fmt(kerf) } },
      { key: 'cutWaste', vars: { boards: fmt(plan.boards.length), waste: fixed(plan.wasteFraction * 100, 1) } },
    ],
    answer: `${plan.boards.length} boards of ${fmt(stock)} (${fixed(plan.wasteFraction * 100, 1)}% waste)`,
    code: layout.join('\n'),
    notes: ['stuNoteCuts'],
  });
}
