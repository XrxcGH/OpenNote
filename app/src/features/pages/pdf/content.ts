// Reading the content of a PDF page: the text it shows, in painting order, and a count of the images and vector shapes it
// draws. Text comes through each font's ToUnicode map, which is how a PDF viewer finds the text to search and copy.

import { Lexer, PdfName, PdfString, type PdfValue } from './objects';

/** Maps the codes a font shows to text. */
export class CMap {
  private readonly single = new Map<number, string>();
  private readonly ranges: { lo: number; hi: number; to: string | string[] }[] = [];
  /** The bytes in one code, from the codespace ranges. Two for the fonts Chromium writes, unless the map says one. */
  width = 2;

  static parse(data: Uint8Array): CMap {
    const text = new TextDecoder('latin1').decode(data);
    const map = new CMap();
    const space = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text);
    if (space) map.width = Math.max(1, Math.ceil(space[1].length / 2));
    for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
        map.single.set(parseInt(m[1], 16), utf16(m[2]));
      }
    }
    for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
        const to = m[3].startsWith('[')
          ? Array.from(m[3].matchAll(/<([0-9a-fA-F]*)>/g), (x) => utf16(x[1]))
          : utf16(m[3].slice(1, -1));
        map.ranges.push({ lo: parseInt(m[1], 16), hi: parseInt(m[2], 16), to });
      }
    }
    return map;
  }

  lookup(code: number): string | undefined {
    const one = this.single.get(code);
    if (one !== undefined) return one;
    for (const r of this.ranges) {
      if (code < r.lo || code > r.hi) continue;
      if (Array.isArray(r.to)) return r.to[code - r.lo];
      const base = r.to as string;
      return base.slice(0, -1) + String.fromCodePoint(base.codePointAt(base.length - 1)! + (code - r.lo));
    }
    return undefined;
  }

  decode(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i + this.width <= bytes.length; i += this.width) {
      let code = 0;
      for (let k = 0; k < this.width; k += 1) code = code * 256 + bytes[i + k];
      out += this.lookup(code) ?? '';
    }
    return out;
  }
}

function utf16(hex: string): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
}

/** What a named external object is: an image, or a form with content and resources of its own. */
export type XObject = { kind: 'image' } | { kind: 'form'; content: Uint8Array; resources: Resources };

export interface Resources {
  /** The CMap of each font resource name, or null for a font without one. */
  readonly fonts: ReadonlyMap<string, CMap | null>;
  /** What each XObject resource name is: an image, or a form with content of its own. */
  readonly xobjects: ReadonlyMap<string, XObject>;
}

export interface PageContent {
  /** The text, with a line feed where the text moves to a new line. */
  text: string;
  images: number;
  /** Fills and strokes of vector shapes. */
  fills: number;
  strokes: number;
  /** The marked-content IDs in the order they are drawn, which tie the content to the structure tree. */
  marked: number[];
}

const LINE_FEED = String.fromCharCode(10);
/** Tabs and no-break spaces count as spaces, as a viewer's search treats them. */
const SPACES = new RegExp('[' + String.fromCharCode(9, 160) + ']', 'g');
const FILL = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const STROKE = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);

interface State {
  font: CMap | null;
  size: number;
  x: number;
  y: number;
  invisible: boolean;
}

/** The text a show operator draws: a string, or an array of strings and spacing numbers. */
function shownText(operand: PdfValue | undefined, font: CMap | null): string {
  const pieces = operand instanceof PdfString ? [operand] : Array.isArray(operand) ? operand : [];
  return pieces.map((p) => (p instanceof PdfString ? (font ? font.decode(p.bytes) : p.text) : '')).join('');
}

/** The marked-content ID in the property list of a BDC operator, if it has one. */
function markedId(props: PdfValue | undefined): number | undefined {
  if (
    !props ||
    typeof props !== 'object' ||
    Array.isArray(props) ||
    props instanceof PdfName ||
    props instanceof PdfString
  ) {
    return undefined;
  }
  const id = (props as { MCID?: PdfValue }).MCID;
  return typeof id === 'number' ? id : undefined;
}

/** Interprets a content stream into `out`. Forms are followed one level at a time, up to a fixed depth. */
export function readContent(data: Uint8Array, resources: Resources, out: PageContent, depth = 0): void {
  const lexer = new Lexer(data);
  const state: State = { font: null, size: 10, x: 0, y: 0, invisible: false };
  const stack: State[] = [];
  let operands: PdfValue[] = [];
  let lastY: number | null = null;
  while (!lexer.done) {
    const v = lexer.value();
    if (v !== undefined) {
      operands.push(v);
      continue;
    }
    const op = lexer.operator();
    if (op === null) {
      lexer.pos += 1;
      continue;
    }
    if (op === 'q') stack.push({ ...state });
    else if (op === 'Q') Object.assign(state, stack.pop() ?? state);
    else if (op === 'Tf') {
      const [name, size] = operands;
      state.font = name instanceof PdfName ? (resources.fonts.get(name.name) ?? null) : null;
      state.size = typeof size === 'number' ? size : state.size;
    } else if (op === 'Tr') state.invisible = operands[0] === 3;
    else if (op === 'Tm') {
      const [, , , , e, f] = operands as number[];
      state.x = e;
      state.y = f;
    } else if (op === 'Td' || op === 'TD') {
      state.x += Number(operands[0]);
      state.y += Number(operands[1]);
    } else if (op === 'Tj' || op === 'TJ' || op === "'" || op === '"') {
      const text = shownText(operands.at(-1), state.font).replace(SPACES, ' ');
      if (text !== '' && !state.invisible) {
        // A new line starts where the text moves down by a fraction of its size. Spaces are in the text itself.
        const newLine = lastY !== null && Math.abs(state.y - lastY) > state.size * 0.4;
        if (newLine && !out.text.endsWith(LINE_FEED)) out.text += LINE_FEED;
        out.text += text;
        lastY = state.y;
      }
    } else if (op === 'Do' && operands[0] instanceof PdfName) {
      const x = resources.xobjects.get(operands[0].name);
      if (x?.kind === 'image') out.images += 1;
      else if (x?.kind === 'form' && depth < 4) readContent(x.content, x.resources, out, depth + 1);
    } else if (op === 'BDC' || op === 'BMC') {
      const mcid = markedId(operands[1]);
      if (mcid !== undefined) out.marked.push(mcid);
    } else if (op === 'ID') {
      // An inline image: its data runs to the next EI.
      const rest = new TextDecoder('latin1').decode(data.subarray(lexer.pos));
      const end = rest.search(/\sEI\b/);
      lexer.pos += end < 0 ? rest.length : end + 3;
      out.images += 1;
    }
    if (FILL.has(op)) out.fills += 1;
    if (STROKE.has(op)) out.strokes += 1;
    operands = [];
  }
}
