// Turns the measured blocks into one flat list of pieces that may sit on a sheet: a line, a table row, or a whole
// block. Each piece says whether a sheet may start right before it. The paginator then needs no special cases.

import type { BlockMeasure, BreakPos, FlowBlock, Measure } from './types';

export interface Unit {
  readonly block: string;
  /** The break position if a sheet starts right before this piece. */
  readonly pos: BreakPos;
  /** Natural top and bottom, in page units. */
  readonly top: number;
  readonly bottom: number;
  /** A sheet can't start here: a widow or orphan rule, or a header row. Dropped only when a piece can't fit. */
  readonly bind: boolean;
  /** A sheet shouldn't start here: keep together or keep with a heading. Dropped first when it can't be met. */
  readonly soft: boolean;
  /** How many manual breaks come right before this piece. */
  readonly forced: number;
  /** The table header's height to repeat if a sheet starts here. */
  readonly header: number;
}

export interface UnitList {
  readonly units: readonly Unit[];
  /** Manual breaks after the last piece, each of which adds a sheet. */
  readonly trailing: number;
}

interface Carry {
  forced: number;
  afterHeading: boolean;
}

type Part = Omit<Unit, 'block' | 'forced' | 'soft'> & { soft?: boolean };

function whole(block: FlowBlock, m: BlockMeasure): Part[] {
  return [{ pos: { kind: 'block', block: block.id }, top: m.top, bottom: m.top + m.height, bind: false, header: 0 }];
}

function textParts(block: FlowBlock, m: BlockMeasure, minLines: number): Part[] {
  const lines = m.lines ?? [];
  const together = block.keepTogether === true;
  return lines.map((line, i) => ({
    pos:
      i === 0 ? ({ kind: 'block', block: block.id } as const) : ({ kind: 'line', block: block.id, line: i } as const),
    top: line.top,
    bottom: line.top + line.height,
    // A split needs minLines on each side, so a short paragraph never splits.
    bind: i > 0 && !(i >= minLines && lines.length - i >= minLines),
    soft: together && i > 0,
    header: 0,
  }));
}

function tableParts(block: FlowBlock, m: BlockMeasure): Part[] {
  const rows = m.rows ?? [];
  const together = block.keepTogether !== false;
  const headerRows = Math.min(block.headerRows ?? 0, Math.max(rows.length - 1, 0));
  const header = rows.slice(0, headerRows).reduce((sum, row) => sum + row.height, 0);
  return rows.map((row, i) => ({
    pos: i === 0 ? ({ kind: 'block', block: block.id } as const) : ({ kind: 'row', block: block.id, row: i } as const),
    top: row.top,
    bottom: row.top + row.height,
    // The header rows and the first body row stay together. A break after that repeats the header.
    bind: i > 0 && i <= headerRows,
    soft: together && i > headerRows,
    header: i > headerRows ? header : 0,
  }));
}

function partsOf(block: FlowBlock, m: BlockMeasure, minLines: number): Part[] {
  if (block.kind === 'text' && m.lines?.length) return textParts(block, m, minLines);
  if (block.kind === 'table' && m.rows?.length) return tableParts(block, m);
  return whole(block, m);
}

/** Flattens the flow, calling `measure` once per block that takes room. */
export function buildUnits(blocks: readonly FlowBlock[], measure: Measure, minLines: number): UnitList {
  const units: Unit[] = [];
  const carry: Carry = { forced: 0, afterHeading: false };
  for (const block of blocks) {
    if (block.kind === 'break') {
      carry.forced += 1;
      carry.afterHeading = false;
      continue;
    }
    const parts = partsOf(block, measure(block), minLines);
    parts.forEach((part, i) => {
      const first = i === 0;
      const soft = (part.soft ?? false) || (first && carry.afterHeading);
      units.push({ ...part, block: block.id, soft, forced: first ? carry.forced : 0 });
    });
    if (parts.length > 0) {
      carry.forced = 0;
      carry.afterHeading = block.heading === true;
    }
  }
  return { units, trailing: carry.forced };
}
