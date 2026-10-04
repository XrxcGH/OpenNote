// Text on ruled, grid, and dot paper sits just above the rules the way handwriting does, proved from the pixels of
// a screenshot rather than from the layout the page reports about itself. For every line of the ruled fixture (the
// title, the date under it, body text, inline large text, sub- and superscripts, every heading level, the three
// kinds of list, a quote, a callout, a code block, and a table), the lowest row of ink of its "Hxn" (letters that
// sit flat on the baseline) must be the lift above a rule's row, within a device pixel, so a thin gap of paper
// shows between the letters and the rule, and no rule may cross the letters. The lift is 12 percent of the rule
// spacing, rounded to a whole page unit, and at least 2 (core/ruled.ts). The rules are found by color in a
// column with no text in it, never from the page's own numbers.
//
// The first tests sample text size and zoom on Letter. The matrix after them runs every paper the View tab offers
// (each size, a custom size, portrait and landscape, normal and wide margins) under every background that lays text
// on rules (the three linings, the three grids, and dots), in both page modes, and checks the first three sheets:
// each sheet draws its rules from its own top margin, and the lines after a break sit on that sheet's rules.
//
// The title and the date under it sit in an unruled header, like the top margin of a notebook page: no rule runs
// through them, and the first rule is the one the first line of body text sits above. A highlight and a piece of
// inline code sit in the gap between two rules, with rounded corners and padding at their sides: the box ends a CSS
// pixel above the rule beneath its line, which stays fully visible in its own color across the box, and starts below
// the rule above with a CSS pixel of paper under it. Both are read from the pixels of the same screenshots.
//
// The lines on a later sheet sit where the lines of the first sheet do, to half a CSS pixel: on the second and third
// sheet of every paper in the matrix, and on the fifth, which is scrolled to. A page break must not leave a line a
// pixel low (a table's pad, measured before the breaks moved it, once did on A4).
//
// Text size is the WebView's zoom in the app, which a browser shows as a larger device scale factor over the same
// CSS viewport: 80 percent is a scale of 1.6 and 200 percent a scale of 4, over a scale of 2.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

/** The lift in page units for a rule spacing: core/ruled.ts. */
const liftOf = (step: number) => Math.max(2, Math.round(0.12 * step));

const PAPERS = [
  { menu: 'Lined, college', dots: false },
  { menu: 'Grid, 5 mm', dots: false },
  { menu: 'Dot grid', dots: true },
] as const;
const MODES = ['Infinite canvas', 'Pages with breaks'] as const;
const TEXT_SIZES = [80, 200] as const;
/** Ctrl+Alt+= steps the page zoom 100, 110, 125, 150. */
const ZOOMS = [
  { percent: 100, steps: 0 },
  { percent: 150, steps: 3 },
] as const;
/**
 * Columns of the page, in page units, with no text in them, where the rules show: the margin left of the title and
 * the text, and, where the paper leaves the sheet's margins blank (grid and dots on sheets), a column inside the
 * text column that the fixture's short lines never reach.
 */
const MARGIN_COLUMN = [2, 20] as const;
const TEXT_COLUMN = [400, 460] as const;
const FIXTURE_LINES = 32;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One run of letters to check, in CSS pixels of the window. */
interface Run {
  key: string;
  box: Box;
}

/** A highlight or a piece of inline code, in CSS pixels of the window. */
interface Chip {
  key: string;
  kind: 'mark' | 'code';
  box: Box;
  /** The box's computed corner radius and side padding, in CSS pixels. */
  radius: number;
  padding: number;
}

interface Scene {
  zoom: number;
  /** The top of the page in the window: the top of its first sheet. */
  top: number;
  area: Box;
  band: readonly [number, number];
  runs: Run[];
  chips: Chip[];
  /** The title block: from the top of the title to the bottom of the date line. */
  header: Box | null;
}

/** What a screenshot shows of one chip: its box, and the rules around it, as rows of device pixels. */
interface ChipRead {
  /** The box's color, or null when none was found. */
  color: [number, number, number] | null;
  /** The first and last row that are mostly the box's color. */
  rows: [number, number] | null;
  /** The rule beneath its line and the one above it. */
  rule: [number, number] | null;
  above: [number, number] | null;
  /** Columns of the box that have its color on the rows of the rule beneath. */
  onRule: number;
  /** Columns of the box with no mark of a rule on the middle row of the rule beneath. */
  noRule: number;
  /** Columns of the box whose color on the middle row of the rule beneath is not one the rule has outside the box. */
  offColor: number;
  /** Columns of the box that are not paper on the row above the rule beneath. */
  notPaper: number;
  width: number;
}

/** What a screenshot holds: the rows of each rule, and the highest and lowest row of ink of each run. */
interface Pixels {
  rules: [number, number][];
  /** Runs of rows too tall for a rule: a box whose background hides the rules, or the space between sheets. */
  boxes: [number, number][];
  ink: Record<string, [number, number] | null>;
  chips: Record<string, ChipRead>;
  bandWidth: number;
  height: number;
}

/** The page's layout as the window shows it: the page area, the rule column, and every "Hxn" on the page. */
function scene(column: readonly [number, number]): Scene {
  const world = document.querySelector<HTMLElement>('[data-ruled]');
  if (!world) throw new Error('The page is not on ruled paper');
  const rect = world.getBoundingClientRect();
  const zoom = rect.width / world.offsetWidth;
  let clip: HTMLElement | null = world.parentElement;
  while (clip && getComputedStyle(clip).overflow === 'visible') clip = clip.parentElement;
  const view = (clip ?? document.body).getBoundingClientRect();
  // The sheet counter floats over the bottom of the page area.
  const top = Math.max(view.y, 0);
  const right = Math.min(view.right, window.innerWidth);
  const area = {
    x: view.x,
    y: top,
    width: right - view.x,
    height: Math.min(view.bottom, window.innerHeight) - top - 48,
  };
  const box = (r: DOMRect): Box => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const runs: Run[] = [];
  const walker = document.createTreeWalker(world, NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    for (let at = text.indexOf('Hxn'); at !== -1; at = text.indexOf('Hxn', at + 3)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 3);
      const r = range.getClientRects()[0];
      const parent = node.parentElement;
      const kind = parent?.closest('td,th')
        ? 'TABLE'
        : parent?.closest('pre')
          ? 'CODE'
          : parent?.closest('li')
            ? 'LIST'
            : parent?.closest('[data-callout]')
              ? 'CALLOUT'
              : parent?.closest('blockquote')
                ? 'QUOTE'
                : (parent?.closest('h1,h2,h3,h4,h5,h6')?.tagName ?? 'P');
      if (r && r.width > 0) runs.push({ key: `${count} ${kind} ${text.trim().slice(0, 24)}`, box: box(r) });
      count++;
    }
  }
  // The date under the title has no "Hxn": its "n" sits flat on the baseline too.
  const changed = document.querySelector('[data-page-title] + p')?.firstChild;
  const at = changed?.textContent?.indexOf('n') ?? -1;
  if (changed && at >= 0) {
    const range = document.createRange();
    range.setStart(changed, at);
    range.setEnd(changed, at + 1);
    const r = range.getClientRects()[0];
    if (r) runs.push({ key: 'date', box: box(r) });
  }
  const chips: Chip[] = [];
  let numbered = 0;
  for (const element of world.querySelectorAll<HTMLElement>('.ProseMirror mark, .ProseMirror :not(pre) > code')) {
    const r = element.getClientRects()[0];
    if (r && r.width > 0) {
      const style = getComputedStyle(element);
      chips.push({
        key: `${numbered} ${element.localName}`,
        kind: element.localName === 'mark' ? 'mark' : 'code',
        box: box(r),
        radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
        padding: Math.min(Number.parseFloat(style.paddingLeft) || 0, Number.parseFloat(style.paddingRight) || 0),
      });
    }
    numbered++;
  }
  const title = document.querySelector('[data-page-title]');
  const date = document.querySelector('[data-page-title] + p');
  let header: Box | null = null;
  if (title && date) {
    const [a, b] = [title.getBoundingClientRect(), date.getBoundingClientRect()];
    header = { x: a.x, y: a.y, width: a.width, height: b.bottom - a.y };
  }
  return { zoom, top: rect.y, area, band: [rect.x + column[0] * zoom, rect.x + column[1] * zoom], runs, chips, header };
}

/** Reads a screenshot's pixels in a blank page: the rule rows in the band, and the ink rows of each run. */
async function readPixels(
  lab: Page,
  png: Buffer,
  clip: Box,
  band: readonly [number, number],
  runs: Run[],
  dots: boolean,
  chips: Chip[] = [],
  step = 0,
): Promise<Pixels> {
  return lab.evaluate(
    async ({ data, clip, band, runs, dots, chips, step }) => {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const { width: W, height: H } = bitmap;
      const canvas = new OffscreenCanvas(W, H);
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, W, H).data;
      const sx = W / clip.width;
      const sy = H / clip.height;
      const at = (x: number, y: number) => (y * W + x) * 4;
      // The paper's color: the commonest color in the rule column.
      const x0 = Math.max(0, Math.ceil((band[0] - clip.x) * sx));
      const x1 = Math.min(W, Math.floor((band[1] - clip.x) * sx));
      const counts = new Map<number, number>();
      for (let y = 0; y < H; y += 2) {
        for (let x = x0; x < x1; x++) {
          const i = at(x, y);
          const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const paper = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const [pr, pg, pb] = [(paper >> 16) & 255, (paper >> 8) & 255, paper & 255];
      const paperLight = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      // A rule row: lined and grid paper mark most of the column, dots a few pixels of it. A run of marked rows
      // taller than a rule is a box with its own background, which hides the rules, and is no rule.
      const marked: boolean[] = [];
      for (let y = 0; y < H; y++) {
        let n = 0;
        for (let x = x0; x < x1; x++) {
          const i = at(x, y);
          if (Math.abs(pixels[i] - pr) + Math.abs(pixels[i + 1] - pg) + Math.abs(pixels[i + 2] - pb) > 24) n++;
        }
        marked.push(dots ? n >= 2 : n >= (x1 - x0) / 2);
      }
      const thickest = Math.ceil(4 * sy) + 2;
      const rules: [number, number][] = [];
      const boxes: [number, number][] = [];
      for (let y = 0; y < H; y++) {
        if (!marked[y]) continue;
        let end = y;
        while (end + 1 < H && marked[end + 1]) end++;
        if (end - y + 1 > thickest) boxes.push([y, end]);
        else if (y > 0 && end < H - 1) rules.push([y, end]);
        y = end;
      }
      // Chips: a highlight and a piece of inline code. The rule beneath a chip's line is the first rule below the
      // middle of its box, and the one above it the last rule above. The box's color is the commonest color that is
      // neither paper nor ink in the upper half of the rows between those two rules, and its rows are the ones in
      // that gap that are mostly that color. The edge of a rule is a blend of its color and the paper's, which can be
      // the very color of a box (inline code is pale), so a pixel on a row of the rule only counts as the box when
      // the rule's own pixels, in the rule column on the same row, do not have that color too.
      const near = (i: number, c: number[], tolerance: number) =>
        Math.abs(pixels[i] - c[0]) + Math.abs(pixels[i + 1] - c[1]) + Math.abs(pixels[i + 2] - c[2]) <= tolerance;
      const colorKey = (i: number) => (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      const ruleColumn = new Map<number, Set<number>>();
      const colorsOfRow = (y: number) => {
        let colors = ruleColumn.get(y);
        if (!colors) {
          colors = new Set<number>();
          for (let x = x0; x < x1; x++) colors.add(colorKey(at(x, y)));
          ruleColumn.set(y, colors);
        }
        return colors;
      };
      const chipsOut: Record<string, ChipRead> = {};
      for (const chip of chips) {
        const xa = Math.round((chip.box.x + 3 - clip.x) * sx);
        const xb = Math.round((chip.box.x + chip.box.width - 3 - clip.x) * sx);
        const yTop = Math.round((chip.box.y - clip.y) * sy);
        const yBottom = Math.round((chip.box.y + chip.box.height - clip.y) * sy);
        const read: ChipRead = {
          color: null,
          rows: null,
          rule: null,
          above: null,
          onRule: 0,
          noRule: 0,
          offColor: 0,
          notPaper: 0,
          width: xb - xa + 1,
        };
        chipsOut[chip.key] = read;
        const middle = (yTop + yBottom) / 2;
        read.rule = rules.find(([a]) => a > middle) ?? null;
        read.above = rules.filter(([, b]) => b < middle).at(-1) ?? null;
        if (!read.rule) continue;
        const [s, e] = read.rule;
        const lo = read.above ? read.above[1] + 1 : Math.max(0, yTop - Math.round(step));
        const tally = new Map<number, number>();
        for (let y = Math.max(lo, yTop) + 2; y <= middle; y++) {
          for (let x = xa; x <= xb; x++) {
            const i = at(x, y);
            if (near(i, [pr, pg, pb], 6)) continue;
            const light = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            if (light < paperLight * 0.55) continue;
            tally.set(colorKey(i), (tally.get(colorKey(i)) ?? 0) + 1);
          }
        }
        const best = [...tally].sort((a, b) => b[1] - a[1])[0];
        if (!best) continue;
        const color = [(best[0] >> 16) & 255, (best[0] >> 8) & 255, best[0] & 255];
        read.color = [color[0], color[1], color[2]];
        const isBox = (x: number, y: number) => near(at(x, y), color, 2);
        for (let y = lo; y < s; y++) {
          let n = 0;
          for (let x = xa; x <= xb; x++) if (isBox(x, y)) n++;
          if (n >= read.width * 0.4) read.rows = [read.rows ? read.rows[0] : y, y];
        }
        const mid = Math.floor((s + e) / 2);
        for (let x = xa; x <= xb; x++) {
          for (let y = s; y <= e; y++) {
            if (isBox(x, y) && !colorsOfRow(y).has(colorKey(at(x, y)))) {
              read.onRule++;
              break;
            }
          }
          if (near(at(x, mid), [pr, pg, pb], 6)) read.noRule++;
          if (!colorsOfRow(mid).has(colorKey(at(x, mid)))) read.offColor++;
          if (!colorsOfRow(s - 1).has(colorKey(at(x, s - 1)))) read.notPaper++;
        }
      }
      // Ink: dark, colorless pixels (a spelling squiggle is red, rules and highlights are light).
      const ink: Record<string, [number, number] | null> = {};
      for (const run of runs) {
        const left = Math.round((run.box.x - clip.x) * sx) + 1;
        const right = Math.round((run.box.x + run.box.width - clip.x) * sx) - 1;
        const top = Math.max(0, Math.floor((run.box.y - clip.y) * sy) - 2);
        const bottom = Math.min(H - 1, Math.ceil((run.box.y + run.box.height - clip.y) * sy) + 2);
        const inked = (y: number) => {
          for (let x = left; x <= right; x++) {
            const i = at(x, y);
            const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
            const light = 0.299 * r + 0.587 * g + 0.114 * b;
            if (light < paperLight * 0.55 && Math.max(r, g, b) - Math.min(r, g, b) < 60) return true;
          }
          return false;
        };
        // The letters are one block of rows with ink: the one at the middle of the run's box. Ink above or below it
        // with paper between (the line above's descenders, the line below's capitals) belongs to other lines.
        let middle = Math.round((top + bottom) / 2);
        for (let d = 0; d <= (bottom - top) / 2 && !inked(middle); d++) {
          if (inked(middle - d)) middle -= d;
          else if (inked(middle + d)) middle += d;
        }
        if (!inked(middle)) {
          ink[run.key] = null;
          continue;
        }
        let first = middle;
        let last = middle;
        while (first > top && inked(first - 1)) first--;
        while (last < bottom && inked(last + 1)) last++;
        ink[run.key] = [first, last];
      }
      return { rules, boxes, ink, chips: chipsOut, bandWidth: x1 - x0, height: H };
    },
    { data: png.toString('base64'), clip, band, runs, dots, chips, step },
  );
}

/**
 * The rules, with the ones a box hides put back: between two rules seen in the column, a gap of a whole number of
 * spacings holds that many rules, evenly spaced (a gap that is not whole is the edge of a sheet), and a box that
 * hides the rules holds the rules that continue the nearest rule seen above it, or below it. The header of the page
 * (its title and date) has no rules: `headerTop`, the row where the header starts, puts the rules of the lattice
 * back above the first one seen, so the lines in the header can still be judged against the lattice they sit on.
 */
function lattice(
  seen: [number, number][],
  boxes: [number, number][],
  sheetOf?: (y: number) => number,
  headerTop?: number,
): { rules: [number, number][]; period: number } {
  const steps = seen.slice(1).map((rule, i) => (rule[0] + rule[1]) / 2 - (seen[i][0] + seen[i][1]) / 2);
  const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)];
  // The spacing to a fraction of a pixel: every gap that is a whole number of spacings, divided by that number.
  const whole = steps.filter((gap) => Math.abs(gap / median - Math.round(gap / median)) < 0.1);
  const period = whole.reduce((sum, gap) => sum + gap / Math.round(gap / median), 0) / whole.length;
  const rules: [number, number][] = [];
  seen.forEach((rule, i) => {
    rules.push(rule);
    const next = seen[i + 1];
    if (!next) return;
    const gap = (next[0] + next[1]) / 2 - (rule[0] + rule[1]) / 2;
    const n = Math.round(gap / period);
    if (n < 2 || Math.abs(gap / period - n) > 0.1) return;
    // A rule is drawn on whole rows of pixels.
    for (let k = 1; k < n; k++) rules.push([Math.round(rule[0] + (k * gap) / n), Math.round(rule[1] + (k * gap) / n)]);
  });
  const middle = (rule: [number, number]) => (rule[0] + rule[1]) / 2;
  const topmost = seen[0];
  if (headerTop !== undefined && topmost) {
    const half = (topmost[1] - topmost[0]) / 2;
    for (let y = middle(topmost) - period; y >= headerTop - period; y -= period) {
      rules.push([Math.round(y - half), Math.round(y + half)]);
    }
  }
  for (const [a, b] of boxes) {
    // Each hidden rule continues the nearer of the rules seen above and below the box: a box can run across the
    // edge of a sheet, where the rules start again.
    const above = seen.filter((rule) => rule[1] < a).at(-1);
    const below = seen.find((rule) => rule[0] > b);
    for (const from of [above, below]) {
      if (!from) continue;
      const other = from === above ? below : above;
      const half = (from[1] - from[0]) / 2;
      for (let y = middle(from) + Math.round((a - middle(from)) / period - 1) * period; y <= b + period; y += period) {
        if (y < a - period / 2 || y > b + period / 2) continue;
        // Where the sheets are known, a hidden rule continues the rules of its own sheet, from above first.
        if (sheetOf) {
          if (sheetOf(y) !== sheetOf(middle(from))) continue;
          if (from === below && above && sheetOf(middle(above)) === sheetOf(y)) continue;
        } else if (other && Math.abs(y - middle(other)) < Math.abs(y - middle(from))) continue;
        if (rules.some((rule) => Math.abs(middle(rule) - y) < period / 4)) continue;
        rules.push([Math.round(y - half), Math.round(y + half)]);
      }
    }
  }
  return { rules, period };
}

/**
 * What is wrong with a line, or null: the lowest row of its ink must be `lift` device pixels above a rule's rows,
 * within one, and no rule may run through its letters.
 */
function judge(
  ink: [number, number],
  rules: [number, number][],
  period: number,
  lift: number,
  slack = 1,
): string | null {
  const [top, bottom] = ink;
  const lifted = rules.some(([s, e]) => bottom >= s - lift - slack && bottom <= e - lift + slack);
  const crossed = rules.some(([s, e]) => s > top && e < bottom - 1);
  // Letters too tall to fit, lifted, between two rules (a heading on narrow ruling) always have one through them.
  const tall = bottom - top + lift >= period;
  if (lifted && !(crossed && !tall)) return null;
  // How far the ink's lowest row is from the lift above the nearest rule: below it when positive.
  const off = rules.reduce((best, [s, e]) => {
    const d = bottom + lift < s ? bottom + lift - s : bottom + lift > e ? bottom + lift - e : 0;
    return Math.abs(d) < Math.abs(best) ? d : best;
  }, Number.POSITIVE_INFINITY);
  return !lifted
    ? `its ink ends ${Math.abs(off).toFixed(1)} device px ${off < 0 ? 'above' : 'below'} the lift over a rule`
    : 'a rule crosses its letters';
}

/**
 * What is wrong with a chip, or null: its box ends a CSS pixel above the rule beneath its line (`gap` device rows, within
 * one), starts below the rule above with a CSS pixel of paper under that rule, and leaves the rule beneath it in the
 * rule's own color across the box's width. `strict` papers have nothing but paper and that rule around the box (lined
 * paper).
 */
function judgeChip(
  read: ChipRead | undefined,
  gap: number,
  dots: boolean,
  strict: boolean,
  exact: boolean,
): string | null {
  if (!read?.color || !read.rows) return 'no box found';
  if (!read.rule) return 'no rule beneath its line';
  const [s, e] = read.rule;
  // A rule is a pixel wide and starts on the row the lattice puts it at. A dot is centered on that row, so the rule
  // of dot paper is the middle of its dots, and the box ends a CSS pixel above that.
  const line = dots ? Math.round((s + e + 1) / 2) : s;
  // The box's edge and the rule each round to a row: half a CSS pixel either way, and more where a CSS pixel is not
  // a whole number of device pixels.
  const slack = exact ? Math.max(1, Math.round(gap / 2)) : 2;
  // A few columns can blend to the box's color where the lines of a grid cross, or at the edge of a dot, at a scale
  // that is not a whole number of device pixels: a box over the rule covers it in nearly every column.
  if (read.onRule > read.width * 0.1)
    return `its box covers the rule beneath it in ${read.onRule} of ${read.width} columns`;
  const between = line - read.rows[1] - 1;
  if (Math.abs(between - gap) > slack)
    return `its box ends ${between} device rows above the rule, not ${gap} (rows ${read.rows.join('-')}, rule ${s}-${e})`;
  if (read.above && read.rows[0] - read.above[1] - 1 < gap - (exact ? 0 : 1))
    return `its box comes within ${read.rows[0] - read.above[1] - 1} device rows of the rule above it (rows ${read.rows.join('-')}, rule ${read.above.join('-')})`;
  if (!dots && read.noRule > 0) return `the rule beneath it is missing in ${read.noRule} of ${read.width} columns`;
  if (strict && exact && read.offColor > 0)
    return `the rule beneath it is not the rule's color in ${read.offColor} of ${read.width} columns`;
  if (strict && exact && read.notPaper > 0)
    return `the row above the rule is not paper in ${read.notPaper} of ${read.width} columns (box rows ${read.rows.join('-')}, rule ${s}-${e}, color ${read.color.join(',')})`;
  return null;
}

/**
 * Device rows from the lift above the nearest rule to the lowest row of a line's ink: below the lift when positive,
 * and the rule it was measured against.
 */
function residual(
  ink: [number, number],
  rules: [number, number][],
  lift: number,
): { off: number; rule: [number, number] } | null {
  let best: { off: number; rule: [number, number] } | null = null;
  for (const rule of rules) {
    const off = ink[1] - (rule[0] - lift);
    if (best === null || Math.abs(off) < Math.abs(best.off)) best = { off, rule };
  }
  return best;
}

/** Rows of the rules that run through the title block (the title and the date line), which must have none. */
function rulesInHeader(rules: [number, number][], header: Box, clip: Box, scale: number): [number, number][] {
  const top = (header.y - clip.y) * scale;
  const bottom = (header.y + header.height - clip.y) * scale;
  return rules.filter(([s, e]) => e >= top && s <= bottom);
}

/** The page's rule spacing and its lift, in device pixels of a screenshot. */
async function liftInPixels(page: Page, scale: number): Promise<number> {
  const { step, zoom } = await page.evaluate(() => {
    const world = document.querySelector<HTMLElement>('[data-ruled]')!;
    return {
      step: Number.parseFloat(getComputedStyle(world).getPropertyValue('--rule')),
      zoom: world.getBoundingClientRect().width / world.offsetWidth,
    };
  });
  return liftOf(step) * zoom * scale;
}

async function openRuledPage(page: Page, paper: string, mode: string, fixture = 'ruled'): Promise<void> {
  await page.goto(`/?fixture=${fixture}`);
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByText('Hxn after the table.').first()).toBeVisible({ timeout: 20_000 });
  // The title, renamed to letters that sit flat on the baseline.
  const title = page.getByRole('textbox', { name: 'Page title' });
  await title.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Hxn');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.getByRole('tab', { name: 'View' }).click();
  const bar = page.getByRole('toolbar');
  const press = async (name: string) => {
    const button = bar.getByRole('button', { name, exact: true });
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  };
  // A page starts in document flow. With the pane buttons in the bar, Document flow no longer fits at this width
  // and sits under More, so it is pressed only where it shows.
  if ((await bar.getByRole('button', { name: 'Document flow', exact: true }).count()) > 0) await press('Document flow');
  await press(mode);
  await bar.getByRole('button', { name: 'Background' }).click();
  await page.getByRole('menuitemradio', { name: paper }).click();
  await expect(page.locator('[data-ruled]')).toHaveCount(1);
}

async function setZoom(page: Page, steps: number, percent: number): Promise<void> {
  // The page zoom keys work with the focus in the page.
  await page.getByText('Hxn after the table.').first().click();
  await page.keyboard.press('Control+Alt+0');
  for (let i = 0; i < steps; i++) await page.keyboard.press('Control+Alt+Equal');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-ruled]')!.getBoundingClientRect().width))
    .toBeGreaterThan(0);
  const zoom = () =>
    page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('[data-ruled]')!;
      return Math.round((world.getBoundingClientRect().width / world.offsetWidth) * 100);
    });
  await expect.poll(zoom).toBe(percent);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

for (const size of TEXT_SIZES) {
  test.describe(`at ${size} percent text`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: (2 * size) / 100 });

    for (const paper of PAPERS) {
      for (const mode of MODES) {
        test(`every line sits on a rule: ${paper.menu}, ${mode}`, async ({ page, context }) => {
          test.slow();
          await openRuledPage(page, paper.menu, mode);
          const lab = await context.newPage();
          for (const zoom of ZOOMS) {
            await setZoom(page, zoom.steps, zoom.percent);
            const results = new Map<string, string | null>();
            let total = 0;
            // The page is taller than the window: scroll it to its top left, then down a screen at a time.
            const blankMargins = mode === 'Pages with breaks' && !paper.menu.startsWith('Lined');
            const column = blankMargins ? TEXT_COLUMN : MARGIN_COLUMN;
            const lift = await liftInPixels(page, (2 * size) / 100);
            const start = await page.evaluate(scene, column);
            const middle = { x: start.area.x + start.area.width / 2, y: start.area.y + start.area.height / 2 };
            await page.mouse.move(middle.x, middle.y);
            await page.mouse.wheel(-4000, -8000);
            for (let pass = 0; pass < 14; pass++) {
              await page.mouse.move(0, 0);
              await page.waitForTimeout(250);
              const now = await page.evaluate(scene, column);
              total = now.runs.length;
              const inside = (b: Box) =>
                b.y >= now.area.y + 2 && b.y + b.height <= now.area.y + now.area.height - 2 && b.x >= now.area.x;
              const fresh = now.runs.filter((run) => inside(run.box) && !results.has(run.key));
              expect(now.band[1], 'the rule column is on screen').toBeLessThan(now.area.x + now.area.width);
              if (fresh.length > 0) {
                const clip = now.area;
                const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
                const pixels = await readPixels(lab, png, clip, now.band, fresh, paper.dots);
                expect(pixels.rules.length, 'rules seen in the column').toBeGreaterThan(3);
                // Letter sheets are 1056 units tall: a box's hidden rules continue its own sheet's.
                const scale = (2 * size) / 100;
                const sheetOf = (y: number) => Math.floor(((y + 0.5) / scale + clip.y - now.top) / now.zoom / 1056);
                const { rules, period } = lattice(
                  pixels.rules,
                  pixels.boxes,
                  mode === 'Pages with breaks' ? sheetOf : undefined,
                  now.header && now.header.y >= clip.y ? Math.floor((now.header.y - clip.y) * scale) : undefined,
                );
                for (const run of fresh) {
                  const ink = pixels.ink[run.key];
                  if (!ink) {
                    results.set(run.key, 'no ink found');
                    continue;
                  }
                  const bottom = ink[1];
                  // Inside a box that runs off the screenshot, the rules on the far side are not in view: a later
                  // screenshot judges the line.
                  const cut = pixels.boxes.some(
                    ([a, b]) => bottom >= a && bottom <= b && (a === 0 || b >= pixels.height - 1),
                  );
                  if (cut) continue;
                  results.set(run.key, judge(ink, rules, period, lift));
                }
              }
              if (results.size >= total && total > 0) break;
              await page.mouse.move(middle.x, middle.y);
              await page.mouse.wheel(0, now.area.height * 0.55);
            }
            const failures = [...results].filter(([, problem]) => problem !== null);
            expect(total, 'the fixture is on the page').toBeGreaterThanOrEqual(FIXTURE_LINES);
            expect(results.size, `every line was checked at ${zoom.percent}%`).toBe(total);
            expect(failures, `lines off the rules at ${zoom.percent}% zoom`).toEqual([]);
          }
          await lab.close();
        });
      }
    }
  });
}

// ---- The matrix: every paper and every background that lays text on rules, over three sheets ------------------

/** The View tab's paper sizes in page units, portrait, and the custom size the fixture's page starts on. */
const SHEET_PAPERS = [
  { menu: 'Letter', width: 816, height: 1056 },
  { menu: 'A4', width: 793.7, height: 1122.52 },
  { menu: 'A5', width: 559.37, height: 793.7 },
  { menu: 'Legal', width: 816, height: 1344 },
  { menu: 'Tabloid', width: 1056, height: 1632 },
  { menu: null, width: 650, height: 901.37 },
] as const;
const ORIENTATIONS = ['Portrait', 'Landscape'] as const;
const MARGIN_SETS = [
  { menu: 'Normal margins', size: 72 },
  { menu: 'Wide margins', size: 96 },
] as const;
/** The backgrounds whose text is laid out on their rules (pages/paper/rules.ts): the others lay text out freely. */
const RULED_BACKGROUNDS = [
  { menu: 'Lined, narrow', kind: 'lined' },
  { menu: 'Lined, college', kind: 'lined' },
  { menu: 'Lined, wide', kind: 'lined' },
  { menu: 'Grid, 5 mm', kind: 'grid' },
  { menu: 'Grid, quarter inch', kind: 'grid' },
  { menu: 'Grid, 1 cm', kind: 'grid' },
  { menu: 'Dot grid', kind: 'dots' },
] as const;
const SHEETS_CHECKED = 3;
/** One sheet further down (counting from 0) is checked too, scrolled to: the fifth. */
const LATER_SHEET = 4;
/** How far under the top of the page area a later sheet is scrolled to, in CSS pixels: below the toolbar over it. */
const BELOW_TOOLBAR = 120;

interface SheetRun extends Run {
  sheet: number;
}

interface SheetScene {
  zoom: number;
  world: Box;
  area: Box;
  step: number;
  runs: SheetRun[];
  chips: (Chip & { sheet: number })[];
  header: Box | null;
}

/** The page's layout with each "Hxn" given the sheet it is on, for a sheet `height` page units tall. */
async function sheetScene(page: Page, height: number): Promise<SheetScene> {
  const base = await page.evaluate(scene, [0, 0] as const);
  const { world, step } = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-ruled]')!;
    const r = element.getBoundingClientRect();
    return {
      world: { x: r.x, y: r.y, width: r.width, height: r.height },
      step: Number.parseFloat(getComputedStyle(element).getPropertyValue('--rule')),
    };
  });
  const runs = base.runs.map((run) => ({ ...run, sheet: Math.floor((run.box.y - world.y) / base.zoom / height) }));
  const chips = base.chips.map((chip) => ({ ...chip, sheet: Math.floor((chip.box.y - world.y) / base.zoom / height) }));
  return { zoom: base.zoom, world, area: base.area, step, runs, chips, header: base.header };
}

/** Waits for the paginator and the rules to settle: the same layout twice in a row. */
async function settle(page: Page): Promise<void> {
  const shape = () =>
    page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('[data-ruled]');
      if (!world) return '';
      const marks = [...world.querySelectorAll('h1,h2,p,pre,td,li')].slice(0, 400);
      return `${world.offsetHeight}:${marks.map((m) => Math.round(m.getBoundingClientRect().y * 4)).join(',')}`;
    });
  let last = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const now = await shape();
    if (now !== '' && now === last) return;
    last = now;
  }
}

async function pick(page: Page, menu: 'Paper' | 'Background', item: string): Promise<void> {
  await page.getByRole('toolbar').getByRole('button', { name: menu, exact: true }).click();
  const choice = page.getByRole('menuitemradio', { name: item, exact: true });
  if ((await choice.getAttribute('aria-checked')) === 'true') await page.keyboard.press('Escape');
  else await choice.click();
}

async function pressMode(page: Page, mode: string): Promise<void> {
  const button = page.getByRole('toolbar').getByRole('button', { name: mode, exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
}

async function resetZoom(page: Page): Promise<void> {
  const zoom = () =>
    page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('[data-ruled]')!;
      return Math.round((world.getBoundingClientRect().width / world.offsetWidth) * 100);
    });
  if ((await zoom()) !== 100) await setZoom(page, 0, 100);
}

/** What one pass over a paper found. */
interface SheetsResult {
  checked: number;
  perSheet: number[];
  problems: string[];
  firsts: string[];
  chips: number;
  /** Where the lines of the first sheet sit against the lift above their rules, in device rows (the middle one). */
  reference: number | null;
}

/**
 * Checks one paper: every line on `count` sheets from sheet `first`, and where each sheet's rules start. With `tight`
 * set, each line of a sheet after the first must also sit within half a CSS pixel of where the lines of the first sheet
 * sit against their rules (`reference`, from the pass over the first sheet): a page break must not leave a line a
 * pixel low.
 */
async function checkSheets(
  page: Page,
  lab: Page,
  setup: {
    height: number;
    margin: number;
    kind: string;
    paginated: boolean;
    scale?: number;
    first?: number;
    count?: number;
    tight?: boolean;
    reference?: number | null;
  },
): Promise<SheetsResult> {
  const { margin, kind, paginated, scale = 2, first = 0, count = SHEETS_CHECKED, tight = false } = setup;
  let reference = setup.reference ?? null;
  // The screen draws each sheet of paper that text sits on a whole number of units tall (pages/layout/page.ts).
  const height = Math.round(setup.height);
  // Scroll to the top left of the page.
  const start = await sheetScene(page, height);
  const middle = { x: start.area.x + start.area.width / 2, y: start.area.y + start.area.height / 2 };
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(-8000, -40000);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  let now = await sheetScene(page, height);
  // A later sheet: scroll down until its top is a little under the top of the page area, clear of the toolbar over it.
  const sheetTop = () => now.world.y + first * height * now.zoom;
  for (let attempt = 0; first > 0 && attempt < 4; attempt++) {
    const away = sheetTop() - now.area.y - BELOW_TOOLBAR;
    if (Math.abs(away) < 1) break;
    await page.mouse.move(middle.x, middle.y);
    await page.mouse.wheel(0, Math.round(away));
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    now = await sheetScene(page, height);
  }
  const lift = liftOf(now.step) * now.zoom * scale;
  // Lined paper rules its margins too, and grid paper does on the infinite canvas; on sheets the grid leaves them
  // blank, so its column is in the text column, right of the fixture's short lines. Dots take a wide column there,
  // so it holds a dot even where a huge page keeps only every few dots of each row (paper/basic.ts).
  const column: [number, number] =
    kind === 'dots'
      ? [margin + 300, margin + 400]
      : kind === 'lined' || !paginated
        ? [MARGIN_COLUMN[0], MARGIN_COLUMN[1]]
        : [margin + 300, margin + 340];
  const band: [number, number] = [now.world.x + column[0] * now.zoom, now.world.x + column[1] * now.zoom];
  const limit = paginated ? (first + count) * height : 3 * 1056;
  const runs = now.runs.filter((run) => !paginated || (run.sheet >= first && run.sheet < first + count));
  const top = Math.max(now.area.y, first > 0 ? sheetTop() : now.world.y);
  const bottom = Math.min(now.area.y + now.area.height, now.world.y + limit * now.zoom);
  const right =
    Math.max(
      band[1],
      ...runs.map((run) => run.box.x + run.box.width),
      ...now.chips.map((chip) => chip.box.x + chip.box.width),
    ) + 4;
  const clip = { x: Math.max(now.area.x, now.world.x), y: top, width: 0, height: bottom - top };
  clip.width = right - clip.x;
  const inside = runs.filter(
    (run) => run.box.y >= clip.y + 2 && run.box.y + run.box.height <= clip.y + clip.height - 2,
  );
  const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  const chips = now.chips.filter(
    (chip) =>
      (!paginated || (chip.sheet >= first && chip.sheet < first + count)) &&
      chip.box.y >= clip.y + 2 &&
      chip.box.y + chip.box.height <= clip.y + clip.height - 2,
  );
  const pixels = await readPixels(lab, png, clip, band, inside, kind === 'dots', chips, now.step * now.zoom * scale);
  const problems: string[] = [];
  if (pixels.rules.length <= 3)
    return { checked: 0, perSheet: [], problems: ['no rules seen'], firsts: [], chips: 0, reference };
  if (first > 0 && Math.abs(now.world.y * scale - Math.round(now.world.y * scale)) > 0.01)
    problems.push(`the page scrolled to a fraction of a device pixel (${now.world.y})`);
  const sheetOf = (y: number) => Math.floor(((y + 0.5) / scale + clip.y - now.world.y) / now.zoom / height);
  const { rules, period } = lattice(
    pixels.rules,
    pixels.boxes,
    paginated ? sheetOf : undefined,
    first === 0 && now.header ? Math.floor((now.header.y - clip.y) * scale) : undefined,
  );
  const perSheet = Array.from({ length: paginated ? count : SHEETS_CHECKED }, () => 0);
  const firsts: string[] = [];
  // The lines of the first sheet below the title block set the reference for the lines of the sheets after it.
  if (tight && first === 0) {
    const bottomOfHeader = now.header ? now.header.y + now.header.height : 0;
    const offsets = inside
      .filter((run) => run.sheet === 0 && run.box.y >= bottomOfHeader)
      .map((run) => (pixels.ink[run.key] ? (residual(pixels.ink[run.key]!, rules, lift)?.off ?? null) : null))
      .filter((off): off is number => off !== null)
      .sort((a, b) => a - b);
    reference = offsets.length > 0 ? offsets[Math.floor(offsets.length / 2)] : null;
  }
  const half = 0.5 * now.zoom * scale + 1e-6;
  for (const run of inside) {
    const ink = pixels.ink[run.key];
    // Where a page unit is not a whole number of device pixels, the rules and the letters each round to a row of
    // their own: half a device pixel more either way.
    const slack = Number.isInteger(scale * now.zoom) ? 1 : 1.5;
    const problem = ink ? judge(ink, rules, period, lift, slack) : 'no ink found';
    if (paginated && perSheet[run.sheet - first] === 0 && run.sheet > 0) firsts.push(run.key.split(' ')[1]);
    if (paginated) perSheet[run.sheet - first] += 1;
    const label = `sheet ${run.sheet + 1}, ${run.key.replace(/\s+/g, ' ')}`;
    if (problem) {
      // The ink's rows and the rules near it, in device pixels of the screenshot, to read a failure by.
      const near = rules.filter(([a]) => ink && Math.abs(a - ink[1]) < 120).map(([a, b]) => `${a}-${b}`);
      const detail = ink ? ` (ink rows ${ink.join('-')}, rules ${near.join(' ')})` : '';
      problems.push(`${label}: ${problem}${detail}`);
    } else if (tight && paginated && ink && reference !== null && run.sheet > 0) {
      // Every line of a later sheet sits within half a CSS pixel of where the first sheet's lines sit.
      const found = residual(ink, rules, lift);
      // Behind a box (a callout, a code block) the paper's rules are hidden and are put back from the ones around it,
      // to the row: a rule that was put back is allowed that row more.
      const allowed = half + (found && !pixels.rules.includes(found.rule) ? 1 : 0);
      const off = found?.off ?? null;
      if (off !== null && Math.abs(off - reference) > allowed)
        problems.push(
          `${label}: its ink is ${(off - reference).toFixed(1)} device px from where the first sheet's lines sit over their rules (limit ${allowed.toFixed(1)}; ink rows ${ink.join('-')}, rules ${rules
            .filter(([a]) => Math.abs(a - ink[1]) < 60)
            .map((r) => r.join('-'))
            .join(' ')})`,
        );
    }
  }
  // The title and the date sit in an unruled header: no rule runs through them, and the first rule drawn is the one
  // the first line of body text sits above.
  if (first === 0) {
    if (now.header) {
      const through = rulesInHeader(pixels.rules, now.header, clip, scale);
      if (through.length > 0)
        problems.push(`rules run through the title block, at rows ${through.map((r) => r.join('-')).join(', ')}`);
      const bottomOfHeader = now.header.y + now.header.height;
      const firstLine = inside.filter((run) => run.box.y >= bottomOfHeader).sort((a, b) => a.box.y - b.box.y)[0];
      const ink = firstLine ? pixels.ink[firstLine.key] : null;
      if (!ink) problems.push('no first line of body text found below the title block');
      else {
        const slack = Number.isInteger(scale * now.zoom) ? 1 : 1.5;
        const wrong = judge(ink, pixels.rules.slice(0, 1), period, lift, slack);
        if (wrong) problems.push(`the first rule is not the one the first line sits above: ${wrong}`);
      }
    } else problems.push('no title block found');
  }
  // A highlight and a piece of inline code sit between two rules and leave the rule beneath them in view, with their
  // rounded corners and their side padding.
  const gap = Math.max(1, Math.round(now.zoom * scale));
  const seen = new Set<string>();
  for (const chip of chips) {
    const problem = judgeChip(
      pixels.chips[chip.key],
      gap,
      kind === 'dots',
      kind === 'lined',
      Number.isInteger(scale * now.zoom),
    );
    seen.add(chip.kind);
    const label = `sheet ${chip.sheet + 1}, ${chip.kind} ${chip.key.split(' ')[0]}`;
    if (problem) problems.push(`${label}: ${problem}`);
    if (!(chip.radius > 0)) problems.push(`${label}: its corners are square (radius ${chip.radius})`);
    if (!(chip.padding > 0)) problems.push(`${label}: it has no padding at its sides (${chip.padding})`);
  }
  if (first === 0) {
    for (const kindOf of ['mark', 'code']) if (!seen.has(kindOf)) problems.push(`no ${kindOf} was checked`);
  }
  // Each sheet's rules start from its own top margin: every rule seen is a whole number of spacings below it.
  if (paginated) {
    const device = scale * now.zoom;
    const tolerance = 1.5;
    for (const [s, e] of pixels.rules) {
      const y = ((s + e) / 2 + 0.5) / scale + clip.y - now.world.y;
      const units = y / now.zoom;
      const sheet = Math.floor(units / height);
      const into = units - sheet * height - margin;
      const off = (into - Math.round(into / now.step) * now.step) * device;
      if (Math.abs(off) > tolerance + (e - s) / 2)
        problems.push(`sheet ${sheet + 1}: a rule ${off.toFixed(1)} device px off the lattice of its top margin`);
    }
  }
  return { checked: inside.length, perSheet, problems, firsts, chips: chips.length, reference };
}

for (const paper of SHEET_PAPERS) {
  for (const orientation of ORIENTATIONS) {
    const name = paper.menu ?? 'Custom size';
    test.describe(`every ruled background on ${name}, ${orientation}`, () => {
      test.use({ viewport: { width: 1440, height: 5400 }, deviceScaleFactor: 2 });

      test(`each line on three sheets sits on its sheet's rules: ${name}, ${orientation}`, async ({
        page,
        context,
      }) => {
        test.setTimeout(600_000);
        await openRuledPage(page, RULED_BACKGROUNDS[0].menu, 'Pages with breaks', 'ruledSheets');
        if (paper.menu) await pick(page, 'Paper', paper.menu);
        await pick(page, 'Paper', orientation);
        const [width, height] = orientation === 'Portrait' ? [paper.width, paper.height] : [paper.height, paper.width];
        const lab = await context.newPage();
        const failures: string[] = [];
        const firsts = new Set<string>();
        let passed = 0;
        let total = 0;
        for (const margins of MARGIN_SETS) {
          await pick(page, 'Paper', margins.menu);
          for (const background of RULED_BACKGROUNDS) {
            await pick(page, 'Background', background.menu);
            for (const mode of MODES) {
              await pressMode(page, mode);
              await settle(page);
              await resetZoom(page);
              await settle(page);
              const paginated = mode === 'Pages with breaks';
              const combo = `${name} ${orientation} ${width}x${height}, ${margins.menu}, ${background.menu}, ${mode}`;
              const setup = { height, margin: margins.size, kind: background.kind, paginated, tight: true };
              const result = await checkSheets(page, lab, setup);
              if (paginated && result.perSheet.some((n) => n < 4))
                result.problems.push(`too few lines checked on a sheet: ${result.perSheet.join(', ')}`);
              if (paginated) {
                // One later sheet, scrolled to: its lines sit where the first sheet's do.
                const later = await checkSheets(page, lab, {
                  ...setup,
                  first: LATER_SHEET,
                  count: 1,
                  reference: result.reference,
                });
                result.problems.push(...later.problems);
                result.checked += later.checked;
                if (later.perSheet[0] < 3)
                  result.problems.push(`too few lines checked on sheet ${LATER_SHEET + 1}: ${later.perSheet[0]}`);
              }
              if (!paginated && result.checked < FIXTURE_LINES)
                result.problems.push(`only ${result.checked} lines checked`);
              result.firsts.forEach((tag) => firsts.add(tag));
              total += 1;
              if (result.problems.length === 0) passed += 1;
              else failures.push(`${combo}: ${result.problems.slice(0, 4).join('; ')}`);
              const status = result.problems.length === 0 ? 'pass' : 'FAIL';
              console.log(
                `RULED-MATRIX\t${combo}\t${status}\t${result.checked}\t${result.problems.slice(0, 3).join(' | ')}`,
              );
            }
          }
        }
        console.log(`RULED-MATRIX-FIRSTS\t${name} ${orientation}\t${[...firsts].sort().join(',')}`);
        await lab.close();
        expect(failures, `${passed} of ${total} papers had every line on its sheet's rules`).toEqual([]);
      });
    });
  }
}

/** Text size and zoom, sampled on a few papers past the first sheet: the matrix runs them all at 100 percent. */
const SAMPLES = [
  { paper: 'A4', orientation: 'Portrait', size: 80, zoom: { percent: 150, steps: 3 } },
  { paper: null, orientation: 'Landscape', size: 200, zoom: { percent: 100, steps: 0 } },
  { paper: 'A5', orientation: 'Portrait', size: 200, zoom: { percent: 100, steps: 0 } },
] as const;
const SAMPLE_BACKGROUNDS = [RULED_BACKGROUNDS[1], RULED_BACKGROUNDS[3], RULED_BACKGROUNDS[6]] as const;

for (const sample of SAMPLES) {
  const name = sample.paper ?? 'Custom size';
  test.describe(`at ${sample.size} percent text and ${sample.zoom.percent} percent zoom on ${name}`, () => {
    // At a scale of 4 a window as tall as three sheets at 150 percent is past what the browser rasterizes for a
    // screenshot, and parts of it come back blank: those samples stay at 100 percent in a shorter window.
    test.use({
      viewport: { width: 1440, height: sample.size === 200 ? 3000 : 5400 },
      deviceScaleFactor: (2 * sample.size) / 100,
    });

    test(`each line on three sheets sits on its sheet's rules: ${name}, ${sample.orientation}`, async ({
      page,
      context,
    }) => {
      test.setTimeout(600_000);
      await openRuledPage(page, SAMPLE_BACKGROUNDS[0].menu, 'Pages with breaks', 'ruledSheets');
      if (sample.paper) await pick(page, 'Paper', sample.paper);
      await pick(page, 'Paper', sample.orientation);
      const paper = SHEET_PAPERS.find((p) => p.menu === sample.paper)!;
      const height = sample.orientation === 'Portrait' ? paper.height : paper.width;
      const lab = await context.newPage();
      const failures: string[] = [];
      let total = 0;
      for (const background of SAMPLE_BACKGROUNDS) {
        await pick(page, 'Background', background.menu);
        await settle(page);
        await setZoom(page, sample.zoom.steps, sample.zoom.percent);
        await settle(page);
        const result = await checkSheets(page, lab, {
          height,
          margin: 72,
          kind: background.kind,
          paginated: true,
          scale: (2 * sample.size) / 100,
        });
        if (result.perSheet.some((n) => n < 4))
          result.problems.push(`too few lines checked on a sheet: ${result.perSheet.join(', ')}`);
        total += 1;
        const combo = `${name} ${sample.orientation}, ${sample.size}% text, ${sample.zoom.percent}% zoom, ${background.menu}`;
        if (result.problems.length > 0) failures.push(`${combo}: ${result.problems.slice(0, 4).join('; ')}`);
        const status = result.problems.length === 0 ? 'pass' : 'FAIL';
        console.log(`RULED-MATRIX	${combo}	${status}	${result.checked}	${result.problems.slice(0, 3).join(' | ')}`);
      }
      await lab.close();
      expect(failures, `${total - failures.length} of ${total} samples had every line on its sheet's rules`).toEqual(
        [],
      );
    });
  });
}
