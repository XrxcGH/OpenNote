// Checking a value against the rule that covers its cell (format spec R-SHT-14; DESIGN 13.4). A rule is plain JSON in
// `data.sheet.validation`. `check` says whether typed text is valid for a cell, `invalidCells` lists the cells whose
// current values are not (circle invalid data), and `ruleAt` finds the rule, including the one a choice column implies.
import { isError, splitChoices } from '../../engine';
import type { Cell, Value } from '../../engine';
import { gridOf, validationAt } from '../model';
import type { Box, JsonObject, TableLike } from '../model';
import { evalMany } from './batch';
import type { Job } from './batch';
import { RANGE, evalFormula, keyOf, listItems, operand, readText, recall, sameValue, scalarText, shiftedOf } from './operands';
import type { Kind } from './operands';
import type { Alert, At, Context, Reason, Verdict } from './types';

/** The rule that covers a cell, its ID, and the top-left cell of the rule's first range. */
export interface Found {
  id: string;
  rule: JsonObject;
  /** Relative references in the rule count from this cell. */
  anchor: At;
}

const OPS = ['between', 'notBetween', 'equal', 'notEqual', 'greater', 'less', 'greaterOrEqual', 'lessOrEqual'];
const KINDS = ['any', 'whole', 'decimal', 'list', 'date', 'time', 'textLength', 'custom', 'checkbox'];

/** The ID of the column-wide list a choice column stands for when no rule covers its cells. */
export const CHOICE_RULE = '(choices)';

const like = (ctx: Context) => ctx.table as unknown as TableLike;

/**
 * The rule of a cell. A choice column with no rule gets a column-wide list of its options; its alert is a note,
 * so typing a word that is not an option stays allowed, as before, and the column keeps its format.
 */
export function ruleAt(ctx: Context, at: At): Found | undefined {
  const hit = validationAt(ctx.sheet, like(ctx), at.row, at.col);
  if (hit) {
    // Relative references count from the first range's top-left cell, as in Excel and the format spec.
    const first = hit.boxes[0];
    return { id: hit.id, rule: hit.rule, anchor: { row: first.top, col: first.left } };
  }
  const column = ctx.table.columns[at.col];
  if (column?.type === 'choice' && column.options && column.options.length > 0) {
    const rule: JsonObject = {
      ranges: [{ col: column.id }],
      kind: 'list',
      items: [...column.options],
      alert: 'information',
    };
    return { id: CHOICE_RULE, rule, anchor: { row: 0, col: at.col } };
  }
  return undefined;
}

const kindOf = (rule: JsonObject) => (typeof rule.kind === 'string' && KINDS.includes(rule.kind) ? rule.kind : 'any');
const opOf = (rule: JsonObject) => (typeof rule.op === 'string' && OPS.includes(rule.op) ? rule.op : 'between');
const alertOf = (rule: JsonObject): Alert =>
  rule.alert === 'warning' || rule.alert === 'information' ? rule.alert : 'stop';

function messageOf(rule: JsonObject): { title: string; text: string } | null {
  const e = rule.error;
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return null;
  const title = typeof e.title === 'string' ? e.title : '';
  const text = typeof e.text === 'string' ? e.text : '';
  return title === '' && text === '' ? null : { title, text };
}

/** The eight operators. `b` is used only by between and not between. */
export function compare(op: string, x: number, a: number, b: number | null): boolean {
  switch (op) {
    case 'between':
    case 'notBetween': {
      const hi = b ?? a;
      const inside = x >= Math.min(a, hi) && x <= Math.max(a, hi);
      return op === 'between' ? inside : !inside;
    }
    case 'equal':
      return x === a;
    case 'notEqual':
      return x !== a;
    case 'greater':
      return x > a;
    case 'less':
      return x < a;
    case 'greaterOrEqual':
      return x >= a;
    default:
      return x <= a;
  }
}

/** What a custom formula counts as yes: TRUE, or a number other than 0. */
function truthy(v: Value): boolean {
  if (isError(v)) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v !== null && typeof v === 'object' && 'kind' in v && v.kind === 'array') return truthy(v.data[0]);
  return false;
}

function cellText(cell: Cell | undefined, ctx: Context): string {
  if (!cell) return '';
  return cell.formula === undefined ? cell.raw : scalarText(cell.value, ctx);
}

function judge(
  ctx: Context,
  found: Found,
  at: At,
  text: string,
  candidate: string | undefined,
  custom?: Value,
): Reason | null {
  const { rule, anchor } = found;
  const kind = kindOf(rule);
  if (kind === 'any') return null;
  if (text.trim() === '') return rule.ignoreBlank === false ? 'blank' : null;
  if (kind === 'custom') {
    const v = custom ?? evalFormula(ctx, typeof rule.a === 'string' ? rule.a : '', at, anchor, candidate);
    return truthy(v) ? null : 'custom';
  }
  if (kind === 'checkbox') {
    const on = typeof rule.checked === 'string' ? rule.checked : 'TRUE';
    const off = typeof rule.unchecked === 'string' ? rule.unchecked : 'FALSE';
    const t = text.trim().toLowerCase();
    return t === on.toLowerCase() || t === off.toLowerCase() ? null : 'checkbox';
  }
  if (kind === 'list') {
    const items = listItems(ctx, rule, at, anchor);
    const typed = Array.isArray(rule.items);
    const same = (x: string, y: string) =>
      (typed ? x === y : x.toLowerCase() === y.toLowerCase()) || sameValue(x, y, ctx);
    const column = ctx.table.columns[at.col];
    const names = column?.type === 'choice' && column.multi ? splitChoices(text) : [text.trim()];
    return names.every((n) => items.some((i) => same(i, n))) ? null : 'list';
  }
  const k = kind as Kind;
  const x = readText(k, text, ctx);
  if (x === null) return k === 'textLength' ? 'length' : 'type';
  if (kind === 'whole' && !Number.isInteger(x)) return 'type';
  const a = operand(ctx, k, rule.a, at, anchor);
  if (a === null) return null;
  const op = opOf(rule);
  const b = op === 'between' || op === 'notBetween' ? operand(ctx, k, rule.b, at, anchor) : null;
  if (compare(op, x, a, b)) return null;
  return k === 'textLength' ? 'length' : 'range';
}

function verdict(found: Found, reason: Reason | null): Verdict {
  if (reason === null) return { ok: true };
  return { ok: false, ruleId: found.id, alert: alertOf(found.rule), reason, message: messageOf(found.rule) };
}

/** Is `candidate` (typed text) valid for the cell? With no candidate, the cell's current value is checked. */
export function check(ctx: Context, at: At, candidate?: string): Verdict {
  const found = ruleAt(ctx, at);
  if (!found) return { ok: true };
  const text = candidate ?? cellText(ctx.table.rows[at.row]?.cells[at.col], ctx);
  return verdict(found, judge(ctx, found, at, text, candidate));
}

const COMPARING = ['whole', 'decimal', 'date', 'time', 'textLength'];

/**
 * Runs the formula operands (a, b) of many cells in one recalculation per operand, so the pass over a long column
 * does not rebuild the engine for every cell. Cells that share a formula (no relative references) share one run.
 */
function prime(ctx: Context, cells: readonly { at: At; found: Found }[]): void {
  for (const field of ['a', 'b']) {
    const jobs: Job[] = [];
    const seen = new Set<string>();
    for (const { at, found } of cells) {
      const { rule, anchor } = found;
      const text = rule[field];
      if (!COMPARING.includes(kindOf(rule)) || typeof text !== 'string' || !text.trim().startsWith('=')) continue;
      if (field === 'b' && !['between', 'notBetween'].includes(opOf(rule))) continue;
      const shifted = shiftedOf(ctx, text, at, anchor);
      if (typeof shifted !== 'string') continue;
      // The memo key names the cell too when the formula calls ROW() or COLUMN(), so dedupe by that key.
      const key = keyOf('n', shifted, at);
      if (recall(ctx, 'n', shifted, at) !== undefined || seen.has(key)) continue;
      seen.add(key);
      jobs.push({ at, anchor, formula: text });
    }
    if (jobs.length > 0) evalMany(ctx, jobs);
  }
  primeSources(ctx, cells);
}

/**
 * List sources that are formulas (not a range) with references that move from cell to cell: one recalculation for
 * all the cells, without the padding rows a spilling source needs. A source that spills (array or error here) is
 * left for the single-cell path, which pads.
 */
function primeSources(ctx: Context, cells: readonly { at: At; found: Found }[]): void {
  const jobs: Job[] = [];
  const seen = new Set<string>();
  for (const { at, found } of cells) {
    const { rule, anchor } = found;
    if (kindOf(rule) !== 'list' || typeof rule.source !== 'string' || RANGE.test(rule.source)) continue;
    const shifted = shiftedOf(ctx, rule.source, at, anchor);
    if (typeof shifted !== 'string' || RANGE.test(shifted)) continue;
    const key = keyOf('p', shifted, at);
    if (recall(ctx, 'p', shifted, at) !== undefined || seen.has(key)) continue;
    seen.add(key);
    jobs.push({ at, anchor, formula: rule.source });
  }
  if (jobs.length > 1) evalMany(ctx, jobs, 'p');
}

/** One invalid cell and why. */
export interface Invalid extends At {
  verdict: Extract<Verdict, { ok: false }>;
}

/**
 * Every cell whose current value is not valid, in reading order (Excel's "Circle invalid data"). Cells without a
 * rule, and blank cells where the rule ignores blanks, are fine. Custom formulas run once for all cells together.
 */
export function invalidCells(ctx: Context, within?: Box): Invalid[] {
  const { table } = ctx;
  const grid = gridOf(like(ctx));
  const out: Invalid[] = [];
  const customs: { at: At; found: Found; text: string }[] = [];
  const cells: { at: At; found: Found; text: string }[] = [];
  const lastRow = within?.bottom ?? grid.rows.length - 1;
  const lastCol = within?.right ?? grid.cols.length - 1;
  for (let row = within?.top ?? 0; row <= lastRow; row++)
    for (let col = within?.left ?? 0; col <= lastCol; col++) {
      const at = { row, col };
      const found = ruleAt(ctx, at);
      if (!found || kindOf(found.rule) === 'any') continue;
      const text = cellText(table.rows[row]?.cells[col], ctx);
      if (kindOf(found.rule) === 'custom' && text.trim() !== '') customs.push({ at, found, text });
      else if (text.trim() !== '') cells.push({ at, found, text });
      else {
        const v = verdict(found, judge(ctx, found, at, text, undefined));
        if (!v.ok) out.push({ ...at, verdict: v });
      }
    }
  prime(ctx, cells);
  for (const c of cells) {
    const v = verdict(c.found, judge(ctx, c.found, c.at, c.text, undefined));
    if (!v.ok) out.push({ ...c.at, verdict: v });
  }
  if (customs.length > 0) {
    const values = evalMany(
      ctx,
      customs.map((c) => ({
        at: c.at,
        anchor: c.found.anchor,
        formula: typeof c.found.rule.a === 'string' ? c.found.rule.a : '',
      })),
    );
    customs.forEach((c, i) => {
      const v = verdict(c.found, judge(ctx, c.found, c.at, c.text, undefined, values[i]));
      if (!v.ok) out.push({ ...c.at, verdict: v });
    });
  }
  return out.sort((p, q) => p.row - q.row || p.col - q.col);
}
