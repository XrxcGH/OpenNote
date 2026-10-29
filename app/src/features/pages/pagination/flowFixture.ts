// A synthetic flow for the paginator's tests: blocks with fixed line and row heights, laid out top to bottom.

import { sheetAt, type SheetGeometry } from './geometry';
import type { BlockMeasure, BreakPos, FlowBlock, Measure, Plan } from './types';

export const LINE = 24;
export const ROW = 30;
export const GAP = 12;

export type Spec =
  | {
      readonly id: string;
      readonly kind: 'text';
      readonly lines: number;
      readonly heading?: boolean;
      readonly together?: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'table';
      readonly rows: number;
      readonly headerRows?: number;
      readonly together?: boolean;
    }
  | { readonly id: string; readonly kind: 'atom'; readonly height: number }
  | { readonly id: string; readonly kind: 'break' };

export function toBlock(spec: Spec): FlowBlock {
  if (spec.kind === 'text') return { id: spec.id, kind: 'text', heading: spec.heading, keepTogether: spec.together };
  if (spec.kind === 'table') {
    return { id: spec.id, kind: 'table', headerRows: spec.headerRows, keepTogether: spec.together };
  }
  return { id: spec.id, kind: spec.kind };
}

function measureOne(spec: Spec, top: number): BlockMeasure {
  if (spec.kind === 'text') {
    const lines = Array.from({ length: spec.lines }, (_, i) => ({ top: top + i * LINE, height: LINE }));
    return { top, height: spec.lines * LINE, lines };
  }
  if (spec.kind === 'table') {
    const rows = Array.from({ length: spec.rows }, (_, i) => ({ top: top + i * ROW, height: ROW }));
    return { top, height: spec.rows * ROW, rows };
  }
  return { top, height: spec.kind === 'atom' ? spec.height : 0 };
}

/** Lays the blocks out from `start` with GAP between them, as a browser would before any spacer exists. */
export function flow(specs: readonly Spec[], start: number): { blocks: FlowBlock[]; measure: Measure } {
  const measured = new Map<string, BlockMeasure>();
  let y = start;
  for (const spec of specs) {
    const m = measureOne(spec, y);
    measured.set(spec.id, m);
    if (spec.kind !== 'break') y += m.height + GAP;
  }
  return { blocks: specs.map(toBlock), measure: (block) => measured.get(block.id)! };
}

export const text = (id: string, lines: number, more: Partial<Spec> = {}): Spec =>
  ({ id, kind: 'text', lines, ...more }) as Spec;
export const table = (id: string, rows: number, more: Partial<Spec> = {}): Spec =>
  ({ id, kind: 'table', rows, ...more }) as Spec;
export const atom = (id: string, height: number): Spec => ({ id, kind: 'atom', height });
export const pageBreak = (id: string): Spec => ({ id, kind: 'break' });

export interface Placed {
  readonly block: string;
  readonly index: number;
  readonly sheet: number;
  readonly top: number;
  readonly bottom: number;
}

function posKey(pos: BreakPos): string {
  if (pos.kind === 'line') return `${pos.block}:${pos.line}`;
  return pos.kind === 'row' ? `${pos.block}:${pos.row}` : `${pos.block}:0`;
}

/** Where every line, row, and atom ends up once the plan's spacers are in: the check the paginator must pass. */
export function placed(g: SheetGeometry, plan: Plan, blocks: readonly FlowBlock[], measure: Measure): Placed[] {
  const pushes = new Map(plan.breaks.map((b) => [posKey(b.pos), b.push]));
  const out: Placed[] = [];
  let shift = 0;
  for (const block of blocks) {
    const m = measure(block);
    const pieces = m.lines ?? m.rows ?? (block.kind === 'break' ? [] : [m]);
    pieces.forEach((piece, index) => {
      shift += pushes.get(`${block.id}:${index}`) ?? 0;
      const top = piece.top + shift;
      out.push({ block: block.id, index, sheet: sheetAt(g, top), top, bottom: top + piece.height });
    });
  }
  return out;
}
