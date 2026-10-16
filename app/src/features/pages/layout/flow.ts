// Turns the paginator's plan for a flow page into what views and export need. It finds where every line, row, and
// block ends up and which part of each block sits on which sheet. It also maps a position before the spacers to
// one after.

import { EPS, sheetAt, type SheetGeometry } from '../pagination/geometry';
import { paginate } from '../pagination/paginate';
import type { BreakPos, FlowBlock, Measure, PaginateOptions, Plan } from '../pagination/types';

/** One line, table row, or whole block once the spacers are in. */
export interface FlowPiece {
  readonly block: string;
  /** The line or row number, or 0 for a block that doesn't split. */
  readonly index: number;
  readonly sheet: number;
  /** Top and bottom in page coordinates, with every spacer above counted. */
  readonly top: number;
  readonly bottom: number;
}

/** The part of one block that sits on one sheet. A block that never splits has one slice. */
export interface FlowSlice {
  readonly block: string;
  readonly sheet: number;
  /** The lines or rows from `from` up to, not including, `to`. */
  readonly from: number;
  readonly to: number;
  readonly top: number;
  readonly bottom: number;
  /** True when the slice is the whole block. */
  readonly whole: boolean;
  /** The height of the table header rows drawn again at the top of this slice, or 0. */
  readonly repeatedHeader: number;
}

/** Everything from natural position `at` down moves by `shift`. */
interface Shift {
  readonly at: number;
  readonly shift: number;
}

export interface FlowPlan {
  readonly plan: Plan;
  readonly pieces: readonly FlowPiece[];
  readonly slices: readonly FlowSlice[];
  readonly shifts: readonly Shift[];
}

function keyOf(pos: BreakPos): string {
  if (pos.kind === 'line') return `${pos.block}:${pos.line}`;
  return pos.kind === 'row' ? `${pos.block}:${pos.row}` : `${pos.block}:0`;
}

/** A measure that asks for each block once, however often the plan reads it. */
function once(measure: Measure): Measure {
  const seen = new Map<string, ReturnType<Measure>>();
  return (block) => {
    let found = seen.get(block.id);
    if (!found) {
      found = measure(block);
      seen.set(block.id, found);
    }
    return found;
  };
}

function slicesOf(plan: Plan, pieces: readonly FlowPiece[], counts: ReadonlyMap<string, number>): FlowSlice[] {
  const header = new Map(plan.breaks.filter((b) => b.repeatHeader).map((b) => [keyOf(b.pos), b.headerHeight]));
  const slices: FlowSlice[] = [];
  for (const piece of pieces) {
    const last = slices.at(-1);
    if (last && last.block === piece.block && last.sheet === piece.sheet && last.to === piece.index) {
      slices[slices.length - 1] = { ...last, to: piece.index + 1, bottom: piece.bottom };
    } else {
      slices.push({
        block: piece.block,
        sheet: piece.sheet,
        from: piece.index,
        to: piece.index + 1,
        top: piece.top,
        bottom: piece.bottom,
        whole: false,
        repeatedHeader: header.get(`${piece.block}:${piece.index}`) ?? 0,
      });
    }
  }
  return slices.map((s) => ({ ...s, whole: s.from === 0 && s.to === counts.get(s.block) }));
}

/**
 * Paginates a flow and works out where everything lands. `measure` gives each block's boxes as the browser lays them
 * out before any spacer exists, and is asked once per block.
 */
export function planFlow(
  g: SheetGeometry,
  blocks: readonly FlowBlock[],
  measure: Measure,
  options?: PaginateOptions,
): FlowPlan {
  const measured = once(measure);
  const plan = paginate(g, blocks, measured, options);
  const pushes = new Map(plan.breaks.map((b) => [keyOf(b.pos), b.push]));
  const pieces: FlowPiece[] = [];
  const shifts: Shift[] = [];
  const counts = new Map<string, number>();
  let shift = 0;
  for (const block of blocks) {
    if (block.kind === 'break') continue;
    const m = measured(block);
    const boxes = m.lines ?? m.rows ?? [m];
    counts.set(block.id, boxes.length);
    boxes.forEach((box, index) => {
      const push = pushes.get(`${block.id}:${index}`) ?? 0;
      if (push > 0) {
        shift += push;
        shifts.push({ at: box.top, shift });
      }
      const top = box.top + shift;
      pieces.push({ block: block.id, index, sheet: sheetAt(g, top), top, bottom: top + box.height });
    });
  }
  return { plan, pieces, slices: slicesOf(plan, pieces, counts), shifts };
}

/**
 * The slices on each sheet, in reading order. Every sheet up to `limit` has an entry, empty when nothing lands on it,
 * and slices past it are left out.
 */
export function slicesBySheet(flow: FlowPlan, limit = flow.plan.sheets): FlowSlice[][] {
  const sheets = Array.from({ length: Math.min(flow.plan.sheets, limit) }, (): FlowSlice[] => []);
  for (const slice of flow.slices) {
    if (slice.sheet < limit) sheets[Math.min(slice.sheet, sheets.length - 1)].push(slice);
  }
  return sheets;
}

/** Where natural position y ends up once the spacers are in. */
export function displayY(flow: FlowPlan, y: number): number {
  let lo = 0;
  let hi = flow.shifts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (flow.shifts[mid].at <= y + EPS) lo = mid + 1;
    else hi = mid;
  }
  return y + (lo > 0 ? flow.shifts[lo - 1].shift : 0);
}

/** The reverse of `displayY`: the natural position of a displayed y. A y inside a spacer maps to just above it. */
export function naturalY(flow: FlowPlan, y: number): number {
  const shifts = flow.shifts;
  let i = -1;
  while (i + 1 < shifts.length && shifts[i + 1].at + shifts[i + 1].shift <= y + EPS) i += 1;
  const natural = y - (i >= 0 ? shifts[i].shift : 0);
  const next = shifts[i + 1];
  return next && natural >= next.at ? next.at - EPS : natural;
}
