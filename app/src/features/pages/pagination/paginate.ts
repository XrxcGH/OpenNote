// The flow paginator. It places a flow of measured blocks onto sheets and reports where each sheet starts. It is a
// pure function: the stored content never changes, and a view turns each break into a spacer of `push` page units.
//
// A paragraph splits between lines, with at least `minLines` on each side. A heading never ends a sheet.
//
// A table splits between rows and keeps together by default, repeating its header rows after a break. Images never
// split. A manual break starts a new sheet, and two in a row leave a blank one.
//
// When a chain of kept-together pieces cannot fit on one sheet, its rules give way, softest first, so every sheet
// takes something. A piece taller than a content box is clipped and reported as `tooTall`.

import { EPS, contentBottom, contentTop, flowSheetAt, sheetAt, type SheetGeometry } from './geometry';
import type { FlowBlock, Measure, PaginateOptions, Plan, PlanWarning, SheetBreak } from './types';
import { buildUnits, type Unit } from './units';

interface State {
  /** The sum of every spacer so far. */
  shift: number;
  /** The sheet the last piece sits on, counting the sheets its bottom reaches. */
  sheet: number;
  /** The first piece on that sheet. A break never goes before it, or the sheet would stay empty. */
  start: number;
  readonly breaks: SheetBreak[];
  readonly warnings: PlanWarning[];
  readonly forcedDone: Set<number>;
}

/** The piece to start the next sheet with, at or before i, or i when every rule has to give way. */
function findBreak(units: readonly Unit[], i: number, start: number): number {
  for (const keepSoft of [true, false]) {
    let j = i;
    while (j > start && (units[j].bind || (keepSoft && units[j].soft))) j -= 1;
    if (j > start) return j;
  }
  return i;
}

/** A sheet that starts right before the piece at `index`. */
interface Start {
  readonly index: number;
  readonly dest: number;
  readonly forced: boolean;
}

function startSheet(g: SheetGeometry, units: readonly Unit[], st: State, at: Start): void {
  const unit = units[at.index];
  const gap = Math.max(0, contentTop(g, at.dest) - (unit.top + st.shift));
  const push = gap + unit.header;
  st.breaks.push({
    sheet: at.dest,
    pos: unit.pos,
    push,
    forced: at.forced,
    repeatHeader: unit.header > 0,
    headerHeight: unit.header,
  });
  st.shift += push;
  st.sheet = at.dest;
  st.start = at.index;
}

/** A manual break: the piece starts `forced` sheets after the last one, or where it already lies if that is later. */
function forceBreak(g: SheetGeometry, units: readonly Unit[], i: number, st: State): void {
  const unit = units[i];
  const dest = Math.max(st.sheet + unit.forced, flowSheetAt(g, unit.top + st.shift));
  st.forcedDone.add(i);
  startSheet(g, units, st, { index: i, dest, forced: true });
}

/** Places piece i, or moves to the break point that has to come first. Returns the next piece to look at. */
function place(g: SheetGeometry, units: readonly Unit[], i: number, st: State): number {
  const unit = units[i];
  if (unit.forced > 0 && !st.forcedDone.has(i)) {
    forceBreak(g, units, i, st);
    return i;
  }
  const top = unit.top + st.shift;
  const bottom = unit.bottom + st.shift;
  const k = Math.max(st.sheet, flowSheetAt(g, top));
  const inBand = k > st.sheet && top < contentTop(g, k) - EPS;
  const overflow = bottom > contentBottom(g, k) + EPS;
  const atTop = top <= contentTop(g, k) + EPS;
  if (inBand || (overflow && !atTop)) {
    const dest = inBand ? k : k + 1;
    const j = dest === st.sheet + 1 ? findBreak(units, i, st.start) : i;
    startSheet(g, units, st, { index: j, dest, forced: false });
    return j;
  }
  if (k > st.sheet) {
    st.sheet = k;
    st.start = i;
  }
  if (overflow) {
    st.warnings.push({ kind: 'tooTall', block: unit.block, sheet: k });
    st.sheet = Math.max(k, sheetAt(g, bottom - 2 * EPS));
  }
  return i + 1;
}

export function paginate(
  g: SheetGeometry,
  blocks: readonly FlowBlock[],
  measure: Measure,
  options: PaginateOptions = {},
): Plan {
  const { units, trailing } = buildUnits(blocks, measure, options.minLines ?? 2);
  const st: State = { shift: 0, sheet: 0, start: 0, breaks: [], warnings: [], forcedDone: new Set() };
  let i = 0;
  while (i < units.length) i = place(g, units, i, st);
  const sheets = st.sheet + 1 + trailing;
  const last = units.at(-1);
  const end = trailing > 0 || !last ? contentTop(g, sheets - 1) : last.bottom + st.shift;
  return { sheets, breaks: st.breaks, warnings: st.warnings, end };
}
