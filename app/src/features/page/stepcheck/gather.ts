// The lines Check my work reads: typed lines (paragraphs, list items, headings, display equations) in the selection
// or on the whole page, and lassoed handwriting split into rows, each row read as math on this device. Every line
// keeps its place on the page, so the marks can sit beside it. Nothing here changes the page.
import { targetEditor } from '../formattingBar/target';
import type { MountedPage } from '../mount';
import { shownStrokes } from '../seams/inkStrokes';
import { rowsOf, type Box } from './rows';

export interface GatheredLine {
  text: string;
  format: 'text' | 'latex';
  /** In page units. */
  box: Box;
  from: 'typed' | 'ink';
  /** Handwriting read with symbols left out, or not read at all: confirm before judging. */
  unsure: boolean;
}

const LINE_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, [data-math-block]';

function toPage(mounted: MountedPage, rect: DOMRect): Box {
  const a = mounted.viewport.toWorld(rect.left, rect.top);
  const b = mounted.viewport.toWorld(rect.right, rect.bottom);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

/** A paragraph's text as lines: inline equations as their source, hard breaks as new lines, widgets left out. */
function paragraphText(element: Element): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }
    const inline = node.getAttribute('data-math');
    if (inline !== null) {
      out += ` ${inline} `;
      return;
    }
    if (node.getAttribute('contenteditable') === 'false') return;
    node.childNodes.forEach(walk);
  };
  element.childNodes.forEach(walk);
  return out;
}

/** True when a line reads like working rather than prose: a relation, a calculus mark, or a leading equals sign. */
function looksLikeMath(text: string): boolean {
  return /[=<>≤≥≠∫Σ]|\bd\/d[a-z]\b|\blim\b|\\(?:frac|int|sum|lim)/.test(text);
}

function typedLines(mounted: MountedPage, range: Range | null): GatheredLine[] {
  const world = mounted.viewport.world;
  const out: GatheredLine[] = [];
  for (const element of world.querySelectorAll(LINE_SELECTOR)) {
    if (element.closest('[data-step-check]')) continue;
    if (element.tagName === 'P' && element.closest('[data-math-block]')) continue;
    if (range && !range.intersectsNode(element)) continue;
    const latex = element.getAttribute('data-math-block');
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (latex !== null) {
      const text = latex.trim();
      if (text) out.push({ text, format: 'latex', box: toPage(mounted, rect), from: 'typed', unsure: false });
      continue;
    }
    const parts = paragraphText(element)
      .split('\n')
      .map((part) => part.trim());
    const count = Math.max(1, parts.length);
    const whole = toPage(mounted, rect);
    const tall = (whole.y1 - whole.y0) / count;
    const ends = textEnds(element, mounted);
    parts.forEach((text, i) => {
      if (!text) return;
      const box = { x0: whole.x0, y0: whole.y0 + i * tall, x1: ends[i] ?? whole.x1, y1: whole.y0 + (i + 1) * tall };
      out.push({ text, format: 'text', box, from: 'typed', unsure: false });
    });
  }
  return out;
}

/** Where each visual line of the text ends, so a mark sits just after the writing rather than at the far edge. */
function textEnds(element: Element, mounted: MountedPage): number[] {
  try {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    return rects.map((r) => mounted.viewport.toWorld(r.right, r.top).x);
  } catch {
    return [];
  }
}

export type InkReading = { ok: true; lines: GatheredLine[] } | { ok: false; reason: 'off' | 'failed' };

/** Reads each row of the strokes as math on this device. Asks before reading handwriting the first time. */
export async function inkLines(ids: readonly string[] | null): Promise<InkReading> {
  const strokes = shownStrokes(ids ?? undefined);
  if (strokes.length === 0) return { ok: true, lines: [] };
  const api = await import('../../intel').then((module) => module.loadApi());
  if (!(await api.askToTurnOn('handwriting'))) return { ok: false, reason: 'off' };
  const lines: GatheredLine[] = [];
  try {
    for (const row of rowsOf(strokes)) {
      const found = await api.recognizeMath(
        row.strokes.map((stroke) => ({
          key: stroke.id,
          points: stroke.points.map((point): [number, number] => [point.x, point.y]),
        })),
        api.readWith(api.intelClient),
      );
      lines.push({
        text: found.latex,
        format: 'latex',
        box: row.box,
        from: 'ink',
        unsure: found.unread > 0 || found.latex.trim() === '',
      });
    }
  } catch {
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, lines };
}

/** The selected typed lines, or every line on the page that looks like working when nothing is selected. */
export function typedSelection(mounted: MountedPage): GatheredLine[] {
  const selection = mounted.viewport.world.ownerDocument.getSelection();
  const range = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  const inWorld =
    (range && mounted.viewport.world.contains(range.commonAncestorContainer) ? range : null) ?? editorRange();
  const lines = typedLines(mounted, inWorld);
  if (inWorld) return lines;
  // A whole page: the lines that look like working, and an expression line just before a line starting with "=".
  return lines.filter((line, i) => looksLikeMath(line.text) || /^\s*=/.test(lines[i + 1]?.text ?? ''));
}

/**
 * The text editor's own selection as a range, for when the palette or a menu has taken the focus and the window's
 * selection with it. Null when nothing is selected.
 */
function editorRange(): Range | null {
  const editor = targetEditor();
  if (!editor || editor.state.selection.empty) return null;
  try {
    const { from, to } = editor.state.selection;
    const [start, end] = [editor.view.domAtPos(from), editor.view.domAtPos(to)];
    const range = editor.view.dom.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

/** In reading order: top to bottom, then left to right. */
export function inOrder(lines: GatheredLine[]): GatheredLine[] {
  return [...lines].sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
}
