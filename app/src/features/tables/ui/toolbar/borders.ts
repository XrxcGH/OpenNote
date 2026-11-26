// The borders menu (DESIGN 10.5): sixteen presets, each a list of steps. A step names a part of the selected box (its
// outer edges, its inner lines, or all of it) and the sides of those cells to set. A border belongs to the cell
// it is a side of (R-SHT-7). So Outside borders writes only the outer sides of the edge cells, and nothing inside.
// An inside line writes both cells that share it, so either neighbor shows the same line.
import type { MessageKey } from '../../../../strings/t';
import type { CellBox, Step } from '../../sheet/formatTarget';
import type { BorderSide, StyleChange } from '../../sheet/model';

export type BorderId =
  | 'all'
  | 'outside'
  | 'thickOutside'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'insideH'
  | 'insideV'
  | 'none'
  | 'bottomDouble'
  | 'bottomThick'
  | 'topBottom'
  | 'topThickBottom'
  | 'diagonalUp'
  | 'diagonalDown';

export type Side = 't' | 'r' | 'b' | 'l' | 'du' | 'dd';

/** The line a preset draws: the menu's current style and color, with a preset's own override for thick and double. */
export interface Line {
  style: string;
  color?: string;
}

type Part = 'whole' | 'top' | 'bottom' | 'left' | 'right' | 'insideTop' | 'insideBottom' | 'insideLeft' | 'insideRight';
type Draw = 'line' | 'thick' | 'double' | 'clear';

interface Rule {
  part: Part;
  side: Side;
  draw: Draw;
}

const OUTSIDE: readonly Rule[] = [
  { part: 'top', side: 't', draw: 'line' },
  { part: 'bottom', side: 'b', draw: 'line' },
  { part: 'left', side: 'l', draw: 'line' },
  { part: 'right', side: 'r', draw: 'line' },
];

const outside = (draw: Draw): Rule[] => OUTSIDE.map((rule) => ({ ...rule, draw }));

/** What each preset sets. Order matters only for presets that set the same side twice. */
export const PRESETS: Readonly<Record<BorderId, readonly Rule[]>> = {
  all: [
    { part: 'whole', side: 't', draw: 'line' },
    { part: 'whole', side: 'r', draw: 'line' },
    { part: 'whole', side: 'b', draw: 'line' },
    { part: 'whole', side: 'l', draw: 'line' },
  ],
  outside: outside('line'),
  thickOutside: outside('thick'),
  top: [{ part: 'top', side: 't', draw: 'line' }],
  bottom: [{ part: 'bottom', side: 'b', draw: 'line' }],
  left: [{ part: 'left', side: 'l', draw: 'line' }],
  right: [{ part: 'right', side: 'r', draw: 'line' }],
  insideH: [
    { part: 'insideBottom', side: 'b', draw: 'line' },
    { part: 'insideTop', side: 't', draw: 'line' },
  ],
  insideV: [
    { part: 'insideRight', side: 'r', draw: 'line' },
    { part: 'insideLeft', side: 'l', draw: 'line' },
  ],
  none: (['t', 'r', 'b', 'l', 'du', 'dd'] as const).map((side) => ({ part: 'whole', side, draw: 'clear' })),
  bottomDouble: [{ part: 'bottom', side: 'b', draw: 'double' }],
  bottomThick: [{ part: 'bottom', side: 'b', draw: 'thick' }],
  topBottom: [
    { part: 'top', side: 't', draw: 'line' },
    { part: 'bottom', side: 'b', draw: 'line' },
  ],
  topThickBottom: [
    { part: 'top', side: 't', draw: 'line' },
    { part: 'bottom', side: 'b', draw: 'thick' },
  ],
  diagonalUp: [{ part: 'whole', side: 'du', draw: 'line' }],
  diagonalDown: [{ part: 'whole', side: 'dd', draw: 'line' }],
};

export const BORDER_IDS = Object.keys(PRESETS) as BorderId[];

/** The menu label of each preset. */
export const BORDER_LABELS: Readonly<Record<BorderId, MessageKey>> = {
  all: 'sheetToolbar.borderAll',
  outside: 'sheetToolbar.borderOutside',
  thickOutside: 'sheetToolbar.borderThickOutside',
  top: 'sheetToolbar.borderTop',
  bottom: 'sheetToolbar.borderBottom',
  left: 'sheetToolbar.borderLeft',
  right: 'sheetToolbar.borderRight',
  insideH: 'sheetToolbar.borderInsideH',
  insideV: 'sheetToolbar.borderInsideV',
  none: 'sheetToolbar.borderNone',
  bottomDouble: 'sheetToolbar.borderBottomDouble',
  bottomThick: 'sheetToolbar.borderBottomThick',
  topBottom: 'sheetToolbar.borderTopBottom',
  topThickBottom: 'sheetToolbar.borderTopThickBottom',
  diagonalUp: 'sheetToolbar.borderDiagonalUp',
  diagonalDown: 'sheetToolbar.borderDiagonalDown',
};

/** The cells of a box a part covers, or null when the box has no such part (an inside line of one row). */
function partBox(box: CellBox, part: Part): CellBox | null {
  const { top, left, bottom, right } = box;
  switch (part) {
    case 'whole':
      return box;
    case 'top':
      return { top, left, bottom: top, right };
    case 'bottom':
      return { top: bottom, left, bottom, right };
    case 'left':
      return { top, left, bottom, right: left };
    case 'right':
      return { top, left: right, bottom, right };
    case 'insideBottom':
      return bottom > top ? { top, left, bottom: bottom - 1, right } : null;
    case 'insideTop':
      return bottom > top ? { top: top + 1, left, bottom, right } : null;
    case 'insideRight':
      return right > left ? { top, left, bottom, right: right - 1 } : null;
    case 'insideLeft':
      return right > left ? { top, left: left + 1, bottom, right } : null;
  }
}

const sideOf = (draw: Draw, line: Line): BorderSide | null => {
  if (draw === 'clear') return null;
  const style = draw === 'thick' ? 'thick' : draw === 'double' ? 'double' : line.style;
  return line.color ? { style, color: line.color } : { style };
};

/** The steps of a preset over a box, drawn with `line`. A step sets one side of the cells it covers. */
export function bordersFor(id: BorderId, box: CellBox, line: Line): Step[] {
  const steps: Step[] = [];
  for (const rule of PRESETS[id]) {
    const covered = partBox(box, rule.part);
    if (!covered) continue;
    // A border side the file has no value for is cleared with null; a drawn one replaces the side whole.
    const change = { border: { [rule.side]: sideOf(rule.draw, line) } } as StyleChange;
    steps.push({ box: covered, change });
  }
  return steps;
}
