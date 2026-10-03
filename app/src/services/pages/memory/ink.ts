// Strokes in the memory page service (Phase 5; owner: the ink lane). They live in the held page under MEMORY_INK as
// decoded records keyed by ID, so undo and redo, which move whole pages, carry them too. The rules are the core's:
// a new stroke needs its ink block, an ID is never reused, and transforms compose with `transform` applied first.
import { decodeRecords, encodeRecords } from '../../../core/ink/codec';
import type { InkRecord, Stroke } from '../../../core/ink/codec';
import type { InkChanges, StrokeEdit } from '../ink';
import { PageServiceError } from '../types';
import type { PageJson } from '../types';

/** Where the held page keeps its strokes. It never reaches the page view, which reads `OpenPage.ink`. */
export const MEMORY_INK = 'memoryInk';

type Strokes = Readonly<Record<string, Stroke>>;

export function strokesOf(page: PageJson): Strokes {
  return (page[MEMORY_INK] as Strokes | undefined) ?? {};
}

/** The page's live strokes as ink records, in drawing order: start time, then ID. */
export function inkRecords(page: PageJson): Uint8Array {
  const strokes = Object.values(strokesOf(page)).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  return encodeRecords(strokes.map((stroke): InkRecord => ({ kind: 'stroke', stroke })));
}

/** The page without its strokes, as the page view opens it. */
export function withoutInk(page: PageJson): PageJson {
  const { [MEMORY_INK]: _ink, ...rest } = page;
  return rest as PageJson;
}

function compose(m: readonly number[], t: readonly number[] | null): number[] {
  const [a, b, c, d, e, f] = m;
  const [ta, tb, tc, td, te, tf] = t ?? [1, 0, 0, 1, 0, 0];
  const out = [
    a * ta + c * tb,
    b * ta + d * tb,
    a * tc + c * td,
    b * tc + d * td,
    a * te + c * tf + e,
    b * te + d * tf + f,
  ];
  return out.map((v) => Math.fround(v));
}

function own(page: PageJson, ids: readonly string[]): Record<string, Stroke> {
  const strokes = { ...strokesOf(page) };
  for (const id of ids) if (!strokes[id]) throw new PageServiceError('notFound', `The page has no stroke ${id}.`);
  page[MEMORY_INK] = strokes;
  return strokes;
}

function inkBlock(page: PageJson, id: string): void {
  const block = page.blocks.find((candidate) => candidate.id === id);
  if (!block || block.type !== 'ink') throw new PageServiceError('invalid', `There is no ink block ${id}.`);
  if (block.lock === 'all') throw new PageServiceError('locked', `Block ${id} is locked.`);
}

/** Applies one stroke edit to a page from editableCopy. */
export function applyStrokeEdit(page: PageJson, edit: StrokeEdit): null {
  const strokes = own(page, edit.strokes);
  for (const id of edit.strokes) {
    const stroke = strokes[id];
    if (edit.edit === 'removeStrokes') delete strokes[id];
    else if (edit.edit === 'transformStrokes')
      strokes[id] = { ...stroke, transform: compose(edit.matrix, stroke.transform) };
    else if (edit.edit === 'restyleStrokes') strokes[id] = { ...stroke, style: { ...stroke.style, ...edit.style } };
    else {
      inkBlock(page, edit.block);
      strokes[id] = { ...stroke, block: edit.block };
    }
  }
  return null;
}

/** Adds new strokes, sent as ink records, after the batch's edits. */
export function addStrokes(page: PageJson, records: Uint8Array): void {
  const strokes = { ...strokesOf(page) };
  for (const record of decodeRecords(records)) {
    if (record.kind !== 'stroke') throw new PageServiceError('invalid', 'Only stroke records can be added.');
    const { stroke } = record;
    if (strokes[stroke.id]) throw new PageServiceError('invalid', `The page already has a stroke ${stroke.id}.`);
    inkBlock(page, stroke.block);
    strokes[stroke.id] = stroke;
  }
  page[MEMORY_INK] = strokes;
}

/** Deleting an ink block deletes its strokes, as in the core. */
export function dropStrokesOf(page: PageJson, blocks: readonly string[]): void {
  const strokes = strokesOf(page);
  if (!Object.values(strokes).some((stroke) => blocks.includes(stroke.block))) return;
  page[MEMORY_INK] = Object.fromEntries(Object.entries(strokes).filter(([, stroke]) => !blocks.includes(stroke.block)));
}

const sameStroke = (a: Stroke, b: Stroke) =>
  a === b ||
  (a.block === b.block &&
    a.pointCount === b.pointCount &&
    a.start === b.start &&
    JSON.stringify([a.style, a.transform]) === JSON.stringify([b.style, b.transform]));

/** What changed in the ink from `from` to `to`, with the added and changed strokes as records. */
export function inkChanges(from: PageJson, to: PageJson): InkChanges {
  const [a, b] = [strokesOf(from), strokesOf(to)];
  const added: string[] = [];
  const changed: string[] = [];
  const removed = Object.keys(a).filter((id) => !b[id]);
  for (const [id, stroke] of Object.entries(b)) {
    if (!a[id]) added.push(id);
    else if (!sameStroke(a[id], stroke)) changed.push(id);
  }
  const now = [...added, ...changed].map((id): InkRecord => ({ kind: 'stroke', stroke: b[id] }));
  return { added, removed, changed, records: encodeRecords(now) };
}

/** Takes `current`'s ink from `from` to `to`, touching only the strokes that differ between those two. */
export function revertInk(current: PageJson, from: PageJson, to: PageJson): void {
  const changes = inkChanges(from, to);
  if (changes.added.length + changes.removed.length + changes.changed.length === 0) return;
  const strokes = { ...strokesOf(current) };
  const target = strokesOf(to);
  for (const id of changes.removed) delete strokes[id];
  for (const id of [...changes.added, ...changes.changed]) strokes[id] = target[id];
  current[MEMORY_INK] = strokes;
}
