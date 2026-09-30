// Paper sizes and paper backgrounds for the PDF export spike. Sizes are in CSS pixels, where 96 make an inch.
import type { Background } from './pdf-content';

export type PaperName = 'letter' | 'a4';

export interface Paper {
  name: PaperName;
  /** Sheet size in CSS pixels. A4 is not a whole number of pixels, which the spike keeps on purpose. */
  width: number;
  height: number;
  /** The same size for the CSS @page rule. */
  cssSize: string;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const INCH = 96;
const MM = INCH / 25.4;
/** Cornell paper: a cue column 2.5 inches wide on the left, and a summary area 2 inches tall at the bottom. */
export const CUE_WIDTH = 2.5 * INCH;
export const SUMMARY_HEIGHT = 2 * INCH;
/** Ruled lines follow the note line height (BRAND.md section 5). */
const RULE = 26;
const DOT_PITCH = INCH / 4;

export const PAPERS: Record<PaperName, Paper> = {
  letter: { name: 'letter', width: 8.5 * INCH, height: 11 * INCH, cssSize: '8.5in 11in' },
  a4: { name: 'a4', width: 210 * MM, height: 297 * MM, cssSize: '210mm 297mm' },
};

/**
 * Chromium writes A4 pages 594.96 points wide, 0.32 points narrower than ISO A4 (measured by this spike).
 * PrintToPdf then shrinks a 210 mm page by 0.05% to fit. The adjusted variant uses the printed width, so
 * nothing needs to shrink.
 */
export const PRINTED_A4_WIDTH = (594.96 / 72) * INCH;

export function paperFor(name: PaperName, adjusted: boolean): Paper {
  const paper = PAPERS[name];
  if (!paper) throw new Error(`Unknown paper "${String(name)}".`);
  if (!adjusted || name !== 'a4') return paper;
  return { ...paper, width: PRINTED_A4_WIDTH, cssSize: `${PRINTED_A4_WIDTH}px ${paper.height}px` };
}

/** Where text flows on a sheet: inside 1-inch margins, and right of the cue column on Cornell paper. */
export function contentBox(paper: Paper, background: Background): Box {
  if (background === 'cornell') {
    const left = CUE_WIDTH + INCH / 4;
    return {
      left,
      top: INCH,
      width: paper.width - left - INCH,
      height: paper.height - INCH - SUMMARY_HEIGHT - INCH / 4,
    };
  }
  return { left: INCH, top: INCH, width: paper.width - 2 * INCH, height: paper.height - 2 * INCH };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function path(className: string, d: string): SVGPathElement {
  const node = document.createElementNS(SVG_NS, 'path');
  node.setAttribute('class', className);
  node.setAttribute('d', d);
  return node;
}

/** Horizontal rules from `top` down to `bottom`, as one path. */
function rules(paper: Paper, top: number, bottom: number): string {
  const parts: string[] = [];
  for (let y = top; y <= bottom; y += RULE) parts.push(`M0 ${y.toFixed(2)}H${paper.width.toFixed(2)}`);
  return parts.join('');
}

/** A dot every quarter inch, as one path of tiny circles. */
function dots(paper: Paper): string {
  const parts: string[] = [];
  for (let y = DOT_PITCH; y < paper.height; y += DOT_PITCH) {
    for (let x = DOT_PITCH; x < paper.width; x += DOT_PITCH) {
      parts.push(`M${(x - 1).toFixed(2)} ${y.toFixed(2)}a1 1 0 1 0 2 0a1 1 0 1 0 -2 0`);
    }
  }
  return parts.join('');
}

/** The paper background as vector graphics, so it prints sharp and matches the screen. */
export function paperLayer(paper: Paper, background: Background): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'paper');
  svg.setAttribute('width', String(paper.width));
  svg.setAttribute('height', String(paper.height));
  svg.setAttribute('viewBox', `0 0 ${paper.width} ${paper.height}`);
  svg.setAttribute('aria-hidden', 'true');
  const summaryTop = paper.height - SUMMARY_HEIGHT;
  if (background === 'lined') {
    svg.append(path('rule', rules(paper, INCH + RULE, paper.height - INCH / 2)));
    svg.append(path('margin-rule', `M${INCH - 12} 0V${paper.height.toFixed(2)}`));
  } else if (background === 'cornell') {
    svg.append(path('rule', rules(paper, INCH + RULE, summaryTop - RULE / 2)));
    svg.append(path('cornell-rule', `M${CUE_WIDTH} 0V${summaryTop.toFixed(2)}`));
    svg.append(path('cornell-rule', `M0 ${summaryTop.toFixed(2)}H${paper.width.toFixed(2)}`));
  } else if (background === 'dots') {
    svg.append(path('dot', dots(paper)));
  }
  return svg;
}
