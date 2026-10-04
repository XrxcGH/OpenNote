// Ruled paper as the unit of text layout, shared by the page view, print, and export. When a page's paper has rules
// (ruled, grid, or dots), its spacing is the one unit the page lays out in: body text takes one rule for each line with its baseline on the rule, headings and larger
// text take whole rules, and a text box sits so that its first baseline lands on a rule. The CSS does the work with
// the custom properties that `ruleProperties` writes, so a change of spacing, paper, text size, or zoom keeps
// everything aligned without moving any stored value. This file is the math for what CSS cannot do: placing a text
// box that is created, moved, or resized, and padding the blocks that don't come in whole rules.

/** The lattice of rules. Rule k is at `origin + k * step`, down the page (or down each sheet, when `sheet` is set). */
export interface RuleGrid {
  /** The distance between two rules, in page units. */
  readonly step: number;
  /** The y of rule 0: the top margin. The first drawn rule of ruled paper is one step below it. */
  readonly origin: number;
  /** The height of a sheet when the page is paginated: the lattice starts again at the top margin of every sheet. */
  readonly sheet: number | null;
}

/** Tolerance for a height that is a whole number of rules, in page units. Layout rounds to fractions of a pixel. */
const WHOLE = 0.5;

/**
 * The finer tolerance for the pad under a block: layout measures in 64ths of a pixel, so the cap-height lengths of
 * a callout or a code block leave a block a few hundredths of a unit short of its rule. Let alone, each block adds
 * its share and a long page drifts off its rules by more than a pixel; the pad takes it up at the end of each block.
 */
export const FINE = 0.02;

/** The y of the rule at or above `y` in its sheet's lattice, and the sheet's own top. */
function cell(y: number, grid: RuleGrid): { top: number; into: number } {
  const top = grid.sheet === null ? 0 : y - (((y % grid.sheet) + grid.sheet) % grid.sheet);
  return { top, into: y - top };
}

/** The first rule on a sheet: a text box never snaps above the top of the page, or of its sheet. */
const firstRule = (grid: RuleGrid): number => ((grid.origin % grid.step) + grid.step) % grid.step;

/** The rule nearest to `y`, which is where a text box's top goes so its first baseline lands on a rule. */
export function snapY(y: number, grid: RuleGrid | null): number {
  if (!grid) return y;
  const { top, into } = cell(y, grid);
  const at = Math.max(into, firstRule(grid));
  return top + grid.origin + Math.round((at - grid.origin) / grid.step) * grid.step;
}

/** The rule one step above or below `y`'s nearest rule: what a nudge with the arrow keys does on ruled paper. */
export function stepY(y: number, direction: 1 | -1, grid: RuleGrid | null): number {
  if (!grid) return y + direction;
  const here = snapY(y, grid);
  const moved = snapY(here + direction * grid.step, grid);
  // A y that was between rules snaps toward the direction first, so one press never skips a rule.
  if (direction === 1 && here > y + WHOLE) return here;
  if (direction === -1 && here < y - WHOLE) return here;
  return moved;
}

/** A height rounded up to whole rules, at least one: what a block that does not come in rules is padded to. */
export function wholeRules(height: number, grid: RuleGrid | null): number {
  if (!grid) return height;
  return Math.max(1, Math.ceil((height - WHOLE) / grid.step)) * grid.step;
}

/** How far down from `top` the next rule is, from 0 to a step. A flow that starts there has its lines on the rules. */
export function leadFor(top: number, grid: RuleGrid, tolerance = WHOLE): number {
  const { into } = cell(top, grid);
  const lead = (((grid.origin - into) % grid.step) + grid.step) % grid.step;
  return lead < tolerance || grid.step - lead < tolerance ? 0 : lead;
}

/**
 * The y of the first rule drawn on a page that has a header: the rule the page's first line of text sits above. The
 * title and the date under it sit in an unruled header, like the top margin of a notebook page, and the rules begin
 * below it. `flowTop` is the top of the flow (the bottom of the title band and its margin) and `lineMiddle` the
 * middle of the first line's letters, when it has any: a line that takes several rules (large text, or fine ruling)
 * sits above the last of them, and with no letters the first rule below the flow's top is the first.
 */
export function firstRuleBelow(flowTop: number, grid: RuleGrid, lineMiddle?: number): number {
  const first = flowTop + leadFor(flowTop, grid) + grid.step;
  if (lineMiddle === undefined) return first;
  const beneath = grid.origin + (Math.floor((lineMiddle - grid.origin) / grid.step) + 1) * grid.step;
  return Math.max(first, beneath);
}

/**
 * The lift: how far above its rule every line's baseline sits, the way handwriting sits just clear of the line, so
 * the rule reads as a line under the words and never touches the bottoms of the letters. It is a share of the rule
 * spacing, the same for every size of text on the page, and never under MIN_LIFT. Descenders may reach or cross the
 * rule. College ruling (26) lifts its text 3 units.
 *
 * It is a whole number of page units, which at 100 percent text and zoom is a whole number of device pixels: a
 * browser paints a baseline on a whole layout pixel, so a lift between two would round up on some lines and down on
 * others, and the gap under the letters would change from line to line.
 */
const LIFT_SHARE = 0.12;
const MIN_LIFT = 2;

/** The lift for a rule spacing, in page units. */
export function ruleLift(step: number): number {
  return Math.max(MIN_LIFT, Math.round(LIFT_SHARE * step));
}

/**
 * The custom properties the stylesheet reads. They are on the page's world, so everything inside follows them. The
 * stylesheet finds each line's baseline from its own font (text-box-trim), so no font metric is passed.
 */
export function ruleProperties(grid: RuleGrid): Record<string, string> {
  return {
    '--rule': `${grid.step}px`,
    '--rule-origin': `${grid.origin}px`,
    // An unpaginated page is one long lattice, which a sheet height far past any page makes the same arithmetic.
    '--rule-sheet': `${grid.sheet ?? 1e9}px`,
    '--rule-lift': `${ruleLift(grid.step)}px`,
  };
}

export const RULE_PROPERTIES = ['--rule', '--rule-origin', '--rule-sheet', '--rule-lift'] as const;
