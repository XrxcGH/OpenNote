// A small paginator for the PDF export spike. It flows blocks onto paper sheets and starts a new sheet at
// manual page breaks. A keep-together group moves whole to the next sheet, and a heading moves with the block
// after it. Then it draws ink anchored to where the text landed. Blocks never split; the real paginator in
// Phase 6 will also split paragraphs and tables between lines and rows.
import { render } from './pdf-blocks';
import type { Background, Block, Mark } from './pdf-content';
import {
  HIGHLIGHTER_OPACITY,
  HONEY,
  PENS,
  arrow,
  ellipse,
  inkLayer,
  line,
  random,
  scribble,
  star,
  stroke,
} from './pdf-ink';
import { CUE_WIDTH, INCH, SUMMARY_HEIGHT, contentBox, paperLayer, type Box, type Paper } from './pdf-paper';

type BreakBlock = Extract<Block, { kind: 'break' }>;

export interface Sheet {
  index: number;
  background: Background;
  element: HTMLElement;
  content: HTMLElement;
  highlights: SVGSVGElement;
  ink: SVGSVGElement;
  box: Box;
}

export interface Layout {
  paper: Paper;
  sheets: Sheet[];
  /** Keep-together groups that moved to the next sheet, and how much space they left behind. */
  keepTogether: { sheet: number; movedFrom: number; spaceLeftPx: number; heightPx: number }[];
  manualBreaks: { afterSheet: number; background: Background }[];
  carriedHeadings: number;
  /** Blocks taller than a whole sheet, which are clipped. */
  oversized: number;
  /** False when the sheet limit cut the document short. */
  complete: boolean;
}

function div(className: string, box: Partial<Box>, text = ''): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  for (const [key, value] of Object.entries(box)) node.style.setProperty(key, `${value}px`);
  if (text) node.textContent = text;
  return node;
}

function cornellParts(spec: BreakBlock, paper: Paper): HTMLElement[] {
  const parts: HTMLElement[] = [];
  if (spec.cues) {
    const cues = div('cues', { left: INCH / 2, top: INCH, width: CUE_WIDTH - INCH * 0.75 });
    for (const cue of spec.cues) cues.append(div('cue', {}, cue));
    parts.push(cues);
  }
  if (spec.summary) {
    const top = paper.height - SUMMARY_HEIGHT + INCH / 4;
    const summary = div('summary', { left: INCH / 2, top, width: paper.width - INCH });
    summary.append(div('summary-label', {}, 'Summary'), div('summary-text', {}, spec.summary));
    parts.push(summary);
  }
  return parts;
}

function openSheet(desk: HTMLElement, layout: Layout, spec: BreakBlock): Sheet {
  const { paper } = layout;
  const element = document.createElement('section');
  element.className = 'sheet';
  element.style.width = `${paper.width}px`;
  element.style.height = `${paper.height}px`;
  element.dataset.background = spec.background;
  const box = contentBox(paper, spec.background);
  const content = div('content', box);
  const highlights = inkLayer('highlights', paper.width, paper.height);
  const ink = inkLayer('ink', paper.width, paper.height);
  element.append(paperLayer(paper, spec.background), highlights, content, ...cornellParts(spec, paper), ink);
  desk.append(element);
  const sheet = {
    index: layout.sheets.length + 1,
    background: spec.background,
    element,
    content,
    highlights,
    ink,
    box,
  };
  layout.sheets.push(sheet);
  return sheet;
}

function overflows(content: HTMLElement): boolean {
  const last = content.lastElementChild;
  if (!last) return false;
  return last.getBoundingClientRect().bottom > content.getBoundingClientRect().bottom + 0.01;
}

/** How far down the content box the last block ends, in CSS pixels. */
export function usedHeight(content: HTMLElement): number {
  const last = content.lastElementChild;
  if (!last) return 0;
  return last.getBoundingClientRect().bottom - content.getBoundingClientRect().top;
}

/** Takes a heading off the end of a sheet, so it moves to the next sheet with the block it introduces. */
function carryHeading(sheet: Sheet): Element | null {
  const last = sheet.content.lastElementChild;
  if (!last || !last.matches('h2') || sheet.content.childElementCount < 2) return null;
  last.remove();
  return last;
}

/** Places one block, opening a new sheet when it doesn't fit. Returns null when the sheet limit is reached. */
function place(block: Block, sheet: Sheet, desk: HTMLElement, layout: Layout, limit: number): Sheet | null {
  const node = render(block, sheet.box.width);
  sheet.content.append(node);
  if (!overflows(sheet.content)) return sheet;
  if (sheet.content.childElementCount === 1) {
    layout.oversized++;
    return sheet;
  }
  node.remove();
  if (layout.sheets.length >= limit) return null;
  const heading = carryHeading(sheet);
  const spaceLeftPx = sheet.box.height - usedHeight(sheet.content);
  const next = openSheet(desk, layout, { kind: 'break', background: sheet.background });
  if (heading) {
    next.content.append(heading);
    layout.carriedHeadings++;
  }
  next.content.append(node);
  if (block.kind === 'group') {
    const heightPx = node.getBoundingClientRect().height;
    layout.keepTogether.push({ sheet: next.index, movedFrom: sheet.index, spaceLeftPx, heightPx });
  }
  if (overflows(next.content)) layout.oversized++;
  return next;
}

/** Lays out `blocks` on sheets of `paper` inside `desk`, stopping before sheet `limit + 1`. */
export function paginate(desk: HTMLElement, blocks: Block[], paper: Paper, limit = Infinity): Layout {
  desk.replaceChildren();
  const layout: Layout = {
    paper,
    sheets: [],
    keepTogether: [],
    manualBreaks: [],
    carriedHeadings: 0,
    oversized: 0,
    complete: true,
  };
  let sheet = openSheet(desk, layout, { kind: 'break', background: 'lined' });
  for (const block of blocks) {
    let next: Sheet | null = null;
    if (block.kind !== 'break') next = place(block, sheet, desk, layout, limit);
    else if (layout.sheets.length < limit) {
      layout.manualBreaks.push({ afterSheet: layout.sheets.length, background: block.background });
      next = openSheet(desk, layout, block);
    }
    if (!next) {
      layout.complete = false;
      break;
    }
    sheet = next;
  }
  layout.sheets.forEach((each, i) => {
    each.element.insertBefore(div('folio', {}, `Page ${i + 1} of ${layout.sheets.length}`), each.ink);
    drawMarks(each, paper);
  });
  return layout;
}

/** Draws the ink marks on one sheet, anchored to the elements and words that asked for them. */
function drawMarks(sheet: Sheet, paper: Paper): void {
  const origin = sheet.element.getBoundingClientRect();
  const rng = random(sheet.index * 31);
  for (const target of sheet.element.querySelectorAll<HTMLElement>('[data-ink]')) {
    const range = document.createRange();
    range.selectNodeContents(target);
    const lines = [...range.getClientRects()].map(
      (rect) => new DOMRect(rect.x - origin.x, rect.y - origin.y, rect.width, rect.height),
    );
    if (lines.length) drawMark(target.dataset.ink as Mark, lines, sheet, paper, rng);
  }
}

function drawMark(mark: Mark, lines: DOMRect[], sheet: Sheet, paper: Paper, rng: () => number): void {
  const [first] = lines;
  const ink = (samples: [number, number, number][], color: string, size: number) =>
    sheet.ink.append(stroke(samples, color, size));
  const right = sheet.box.left + sheet.box.width;
  switch (mark) {
    case 'underline':
      ink(line(first.left, first.bottom + 3, first.right, first.bottom + 1, rng), PENS.brick, 2.6);
      break;
    case 'star':
      ink(star(sheet.box.left - 36, first.top + first.height / 2, 11), PENS.amber, 2.4);
      break;
    case 'circle': {
      const [cx, cy] = [first.left + first.width / 2, first.top + first.height / 2];
      ink(ellipse(cx, cy, first.width / 2 + 9, first.height / 2 + 5, rng), PENS.indigo, 2.2);
      break;
    }
    case 'highlight':
      for (const rect of lines) {
        const samples = line(rect.left, rect.top + rect.height / 2, rect.right, rect.top + rect.height / 2, rng);
        sheet.highlights.append(stroke(samples, HONEY, rect.height * 0.85, HIGHLIGHTER_OPACITY));
      }
      break;
    case 'note':
      ink(scribble(right + 14, first.top + 22, 58, 16, rng), PENS.plum, 2);
      ink(scribble(right + 14, first.top + 46, 44, 16, rng), PENS.plum, 2);
      break;
    case 'arrow':
      for (const part of arrow(paper.width - 30, first.top - 16, right + 8, first.top + 8, rng)) {
        ink(part, PENS.fern, 2.4);
      }
      break;
  }
}
