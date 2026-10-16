// Handwritten math to LaTeX (A1-28). Strokes are grouped into symbols. The symbols made of lines (fraction bars,
// roots, integrals, brackets) are told apart by their shape. The on-device handwriting recognizer reads the letters
// and digits one symbol at a time. The layout then turns them into LaTeX: fractions, roots, exponents, integrals with
// limits, and matrices. Everything runs on this device. The ink is never changed; the person gets an equation beside it.
import { isIntelError } from '../../../services/intel';
import type { IntelClient } from '../../../services/intel';
import { groupStrokes } from './group';
import type { Cluster, MathStroke } from './group';
import { layout } from './layout';
import type { Node } from './layout';

/** Reads one symbol drawn with these strokes: the text, or null when it can't be read. */
export type ReadSymbol = (strokes: MathStroke[]) => Promise<string | null>;

export interface MathResult {
  latex: string;
  /** Symbols that could not be read, which are left out of the LaTeX. */
  unread: number;
}

/** The most strokes one conversion takes, so a huge selection can't hold the recognizer for long. */
export const MAX_STROKES = 600;

const NAMED: Record<string, string> = {
  '×': '\\times ',
  '÷': '\\div ',
  '·': '\\cdot ',
  '±': '\\pm ',
  '≤': '\\leq ',
  '≥': '\\geq ',
  '≠': '\\neq ',
  '≈': '\\approx ',
  '∞': '\\infty ',
  '→': '\\to ',
  '∑': '\\sum ',
  '∏': '\\prod ',
  '∂': '\\partial ',
  '∈': '\\in ',
  '°': '^{\\circ}',
  '√': '',
  '∫': '',
  α: '\\alpha ',
  β: '\\beta ',
  γ: '\\gamma ',
  δ: '\\delta ',
  ε: '\\epsilon ',
  θ: '\\theta ',
  λ: '\\lambda ',
  μ: '\\mu ',
  π: '\\pi ',
  ρ: '\\rho ',
  σ: '\\sigma ',
  τ: '\\tau ',
  φ: '\\phi ',
  ω: '\\omega ',
  Δ: '\\Delta ',
  Σ: '\\Sigma ',
  Ω: '\\Omega ',
  '{': '\\{',
  '}': '\\}',
  '%': '\\%',
};

/** LaTeX for the text the recognizer read, with anything that could change the markup left out. */
export function toLatexChars(text: string): string {
  let out = '';
  for (const char of text.normalize('NFC')) {
    if (char in NAMED) out += NAMED[char];
    else if (/[\p{L}\p{N}+\-=<>()[\]|,.:;!/?']/u.test(char)) out += char;
    // A backslash, caret, underscore, dollar, hash, tilde, and ampersand are not typed math; they are dropped.
  }
  return out.trim();
}

async function readClusters(clusters: Cluster[], read: ReadSymbol): Promise<{ nodes: Node[]; unread: number }> {
  const nodes: Node[] = [];
  let unread = 0;
  for (const cluster of clusters) {
    if (cluster.role === 'char') {
      const text = cluster.text ?? (await read(cluster.strokes));
      const latex = text ? toLatexChars(text) : '';
      if (latex) nodes.push({ role: 'atom', box: cluster.box, latex });
      else unread += 1;
    } else {
      nodes.push({ role: cluster.role, box: cluster.box, latex: '' });
    }
  }
  return { nodes, unread };
}

/** Turns handwritten strokes into LaTeX. */
export async function recognizeMath(strokes: readonly MathStroke[], read: ReadSymbol): Promise<MathResult> {
  if (strokes.length === 0) return { latex: '', unread: 0 };
  const clusters = groupStrokes(strokes.slice(0, MAX_STROKES));
  const { nodes, unread } = await readClusters(clusters, read);
  return { latex: layout(nodes), unread };
}

/** A symbol reader over the handwriting recognizer: the first word it finds. Errors other than a stop read as unread. */
export function readWith(client: () => Promise<IntelClient>): ReadSymbol {
  return async (strokes) => {
    try {
      const result = await (
        await client()
      ).recognizeInk(
        strokes.map((stroke) => ({
          key: stroke.key,
          points: stroke.points.map((p): [number, number] => [p[0], p[1]]),
        })),
        { kind: 'writing' },
      );
      return result.lines[0]?.text.trim() || null;
    } catch (error) {
      if (isIntelError(error, 'canceled')) throw error;
      return null;
    }
  };
}
